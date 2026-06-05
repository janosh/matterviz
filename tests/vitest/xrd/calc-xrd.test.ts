import type { Matrix3x3, Vec2, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { Crystal, Pbc } from '$lib/structure'
import { parse_structure_file } from '$lib/structure/parse'
import { add_xrd_pattern, compute_xrd_pattern, WAVELENGTHS, type XrdPattern } from '$lib/xrd'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { describe, expect, test } from 'vitest'
import { fixture_id, xrd_patterns } from '../fixtures/xrd'
import { read_maybe_gz } from '../setup'

const structures_dir = path.resolve(process.cwd(), `src/site/structures`)

// Shared helper for test suites
function make_simple_cubic_structure(a_len: number): Crystal {
  const matrix: Matrix3x3 = [
    [a_len, 0, 0],
    [0, a_len, 0],
    [0, 0, a_len],
  ]
  const volume = a_len * a_len * a_len
  const pbc: Pbc = [true, true, true]
  const lattice_params = { a: a_len, b: a_len, c: a_len, alpha: 90, beta: 90, gamma: 90 }
  const lattice = { matrix, pbc, ...lattice_params, volume }
  const site = {
    species: [{ element: `H` as const, occu: 1, oxidation_state: 0 }],
    abc: [0, 0, 0] satisfies Vec3,
    xyz: [0, 0, 0] satisfies Vec3,
    label: `H1`,
    properties: {},
  }
  return { lattice, sites: [site] }
}

// Pair each structure file with its precomputed XRD pattern from ../fixtures/xrd
function list_matching_pairs() {
  const pairs = []
  for (const file_name of fs.readdirSync(structures_dir)) {
    if (!/\.json(\.gz)?$/.test(file_name)) continue
    const expected: XrdPattern | undefined = xrd_patterns[fixture_id(file_name)]
    if (!expected) continue
    pairs.push({
      name: file_name,
      struct_path: path.join(structures_dir, file_name),
      expected,
    })
  }
  return pairs
}

describe(`compute_xrd_pattern parity with pymatgen JSON`, () => {
  const file_pairs = list_matching_pairs()

  test(`found structure/XRD JSON pairs`, () => {
    expect(file_pairs.length).toBeGreaterThan(0)
  })

  test.each(file_pairs.map((p) => [p.name, p] as const))(
    `compare XRD for %s`,
    (_name, pair) => {
      const structure_json = read_maybe_gz(pair.struct_path)
      const parsed = parse_structure_file(structure_json, pair.name)
      expect(parsed).not.toBeNull()
      if (!parsed) return

      const structure = parsed as Crystal
      const expected = pair.expected

      const computed = compute_xrd_pattern(structure, {
        wavelength: `CuKa`,
        scaled: true,
        two_theta_range: [0, 90],
      })

      // Angle tolerance (degrees)
      const angle_tol = 5e-3
      const d_rtol = 1e-6
      const d_atol = 1e-6

      // Compare peak positions in a set-wise manner: each expected peak should
      // have a computed counterpart within tolerance (independent of intensity filtering)
      const has_close = (arr: number[], target: number, tol: number): boolean => {
        for (let idx = 0; idx < arr.length; idx++) {
          if (Math.abs(arr[idx] - target) <= tol) return true
        }
        return false
      }
      // Focus on strongest expected peaks by intensity to avoid discrepancies from
      // low-intensity filtering differences between implementations
      const top_n = Math.min(200, expected.x.length)
      const top_indices = Array.from({ length: expected.y.length }, (_, idx) => idx)
        .sort((i, j) => expected.y[j] - expected.y[i])
        .slice(0, top_n)
        .sort((a, b) => a - b)
      let matched = 0
      for (let ii = 0; ii < top_indices.length; ii++) {
        const idx = top_indices[ii]
        const angle = expected.x[idx]
        if (has_close(computed.x, angle, angle_tol)) matched++
      }
      const min_match_ratio = 0.95
      expect(matched / top_indices.length).toBeGreaterThanOrEqual(min_match_ratio)

      // The 20 strongest expected peaks must also match in normalized intensity (both
      // patterns scaled to max=100). Regression for the missing Z − 41.78214·s² prefactor
      // in the atomic scattering factor, which skewed relative peak heights (38.3 vs 51.0)
      const top_20 = [...top_indices].sort((i1, i2) => expected.y[i2] - expected.y[i1])
      for (const idx of top_20.slice(0, 20)) {
        const diffs = computed.x.map((x_val) => Math.abs(x_val - expected.x[idx]))
        const nearest = diffs.indexOf(Math.min(...diffs))
        if (diffs[nearest] > angle_tol) continue // position check covers misses
        const y_err = Math.abs(computed.y[nearest] - expected.y[idx])
        expect(y_err, `y at 2θ=${expected.x[idx].toFixed(3)}`).toBeLessThanOrEqual(1)
      }

      // Compare d-spacings if present, over overlapping range only
      if (expected.d_hkls && computed.d_hkls) {
        const top_d_indices = Array.from({ length: expected.y.length }, (_, idx) => idx)
          .sort((i, j) => expected.y[j] - expected.y[i])
          .slice(0, Math.min(200, expected.d_hkls.length))
          .sort((a, b) => a - b)
        let d_matched = 0
        for (let ii = 0; ii < top_d_indices.length; ii++) {
          const idx = top_d_indices[ii]
          const d_val = expected.d_hkls[idx]
          const tol = d_atol + d_rtol * Math.abs(d_val)
          if (has_close(computed.d_hkls, d_val, tol)) d_matched++
        }
        const min_d_match_ratio = 0.95
        expect(d_matched / top_d_indices.length).toBeGreaterThanOrEqual(min_d_match_ratio)
      }
    },
  )
})

// Concise edge-case tests for recent fixes
describe(`compute_xrd_pattern edge cases`, () => {
  test.each([
    [`CuKa`, 1.54184],
    [`MoKa`, 0.71073],
  ] as const)(
    `asin clamping yields finite values and 2θ≈180° at boundary (%s)`,
    (_label, wavelength) => {
      const a_len = wavelength / 2
      const structure = make_simple_cubic_structure(a_len)

      const pattern = compute_xrd_pattern(structure, {
        wavelength: _label,
        scaled: true,
        two_theta_range: null,
      })

      expect(pattern.x.length).toBeGreaterThan(0)
      for (let idx = 0; idx < pattern.x.length; idx++) {
        expect(Number.isFinite(pattern.x[idx])).toBe(true)
        expect(Number.isFinite(pattern.y[idx])).toBe(true)
      }
      const max_angle = Math.max(...pattern.x)
      expect(Math.abs(max_angle - 180)).toBeLessThan(1e-6)
    },
  )

  test(`scaled_intensity_tol filters peaks as configured`, () => {
    const structure = make_simple_cubic_structure(3)
    const base_opts = {
      wavelength: `CuKa` as const,
      two_theta_range: [0, 90] as Vec2,
    }

    const none_pass = compute_xrd_pattern(structure, {
      ...base_opts,
      scaled: true,
      scaled_intensity_tol: 101, // higher than any scaled intensity
    })
    expect(none_pass.x).toHaveLength(0)

    const many_pass = compute_xrd_pattern(structure, {
      ...base_opts,
      scaled: true,
      scaled_intensity_tol: 0, // include everything after scaling
    })
    expect(many_pass.x.length).toBeGreaterThan(0)
  })

  // Regression: hkl bounds from reciprocal-row norms (max_radius/|b_i| + 2) miss in-sphere
  // reflections for skewed cells — this monoclinic cell (γ ≈ 32°) silently dropped 82 of
  // 2132 reflections in [0°, 180°]. Correct bound uses direct rows: |h_i| ≤ R·|a_i|.
  test(`skewed monoclinic cell enumerates every in-sphere reflection`, () => {
    const file_name = `mp-1183089-Ac4Mg2-monoclinic.json`
    const structure = parse_structure_file(
      read_maybe_gz(path.join(structures_dir, file_name)),
      file_name,
    ) as Crystal
    const pattern = compute_xrd_pattern(structure, {
      wavelength: `CuKa`,
      two_theta_range: [0, 180],
      scaled_intensity_tol: 0, // keep every peak so multiplicities are complete
    })
    const total_multiplicity = (pattern.hkls ?? [])
      .flat()
      .reduce((sum, fam) => sum + (fam.multiplicity ?? 0), 0)

    // Brute-force count with generous index bound 25 (exact bound is ≤ 11 for this cell)
    const recip_cols = math.matrix_inverse_3x3(structure.lattice.matrix) // bᵢ as columns
    const max_radius = 2 / WAVELENGTHS.CuKa // 2·sin(90°)/λ
    const span = Array.from({ length: 51 }, (_, idx) => idx - 25)
    const brute_count = span
      .flatMap((h_idx) =>
        span.flatMap((k_idx) =>
          span.map((l_idx) => Math.hypot(...math.dot(recip_cols, [h_idx, k_idx, l_idx]))),
        ),
      )
      .filter((g_norm) => g_norm > 0 && g_norm <= max_radius).length

    expect(brute_count).toBeGreaterThan(2000) // sanity: full sphere covered
    expect(total_multiplicity).toBe(brute_count)
  })

  test(`enumeration safety cap throws for pathological ranges`, () => {
    // Use a huge direct lattice to create very small reciprocal spacing (dense grid)
    const structure = make_simple_cubic_structure(1e4)
    // two_theta_range null => up to 2/λ; with standard wavelength this yields large index bounds
    expect(() =>
      compute_xrd_pattern(structure, {
        wavelength: `AgKa`,
        scaled: true,
        two_theta_range: null,
      }),
    ).toThrow(/exceeds cap/i)
  })
})

describe(`precomputed XRD fixtures are consistent`, () => {
  const entries = Object.entries(xrd_patterns)
  test(`found XRD fixtures`, () => {
    expect(entries.length).toBeGreaterThan(0)
  })
  test.each(entries.map(([id, pattern]) => [id, pattern] as const))(
    `fixture %s length consistency`,
    (_id, pattern) => {
      expect(pattern.x).toHaveLength(pattern.y.length)
      if (pattern.hkls) expect(pattern.hkls).toHaveLength(pattern.x.length)
      if (pattern.d_hkls) expect(pattern.d_hkls).toHaveLength(pattern.x.length)
    },
  )
})

describe(`add_xrd_pattern`, () => {
  test(`computes pattern from valid JSON string`, async () => {
    const structure = make_simple_cubic_structure(3)
    const json = JSON.stringify(structure)
    const result = await add_xrd_pattern(json, `test.json`, null)
    expect(result.error).toBeUndefined()
    expect(result.pattern).toBeDefined()
    expect(result.pattern?.label).toBe(`test.json`)
    expect(result.pattern?.pattern.x.length).toBeGreaterThan(0)
  })

  test(`computes pattern from ArrayBuffer`, async () => {
    const structure = make_simple_cubic_structure(3)
    const json = JSON.stringify(structure)
    const buffer = new TextEncoder().encode(json).buffer
    const result = await add_xrd_pattern(buffer, `test.json`, null)
    expect(result.error).toBeUndefined()
    expect(result.pattern).toBeDefined()
  })

  test(`returns error for invalid structure`, async () => {
    const result = await add_xrd_pattern(`invalid json`, `test.json`, null)
    expect(result.error).toBeDefined()
    expect(result.pattern).toBeUndefined()
  })

  test(`returns error for structure without lattice`, async () => {
    const structure = { sites: [] } // no lattice
    const json = JSON.stringify(structure)
    const result = await add_xrd_pattern(json, `test.json`, null)
    expect(result.error).toMatch(/must have a lattice/)
  })

  test(`respects wavelength parameter`, async () => {
    const structure = make_simple_cubic_structure(3)
    const json = JSON.stringify(structure)

    const res_cu = await add_xrd_pattern(json, `cu.json`, 1.54184) // Compute with CuKa (default approx 1.54)
    const res_mo = await add_xrd_pattern(json, `mo.json`, 0.71073) // Compute with MoKa (approx 0.71)

    expect(res_cu.pattern).toBeDefined()
    expect(res_mo.pattern).toBeDefined()

    // Peaks should be at different angles
    // For simple cubic a=3, first peak (100) d=3
    // lambda = 2d sin(theta) => theta = asin(lambda/2d)
    // 2theta = 2 * asin(lambda/6)
    const peaks_cu = res_cu.pattern?.pattern.x ?? []
    const peaks_mo = res_mo.pattern?.pattern.x ?? []

    expect(peaks_cu.length).toBeGreaterThan(0)
    expect(peaks_mo.length).toBeGreaterThan(0)
    expect(peaks_cu[0]).not.toBeCloseTo(peaks_mo[0], 1)
  })
})
