import type { ElementSymbol } from '$lib/element'
import type { Matrix3x3, Vec2, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { RadiationType } from '$lib/scattering'
import { electron_form_factor, xray_form_factor } from '$lib/scattering'
import type { Crystal } from '$lib/structure'
import { parse_structure_file } from '$lib/structure/parse'
import {
  add_xrd_pattern,
  compute_xrd_pattern,
  electron_wavelength,
  enumerate_reciprocal_points,
  structure_factors_squared,
  WAVELENGTHS,
} from '$lib/xrd'
import type { XrdPattern } from '$lib/xrd'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { describe, expect, test } from 'vitest'
import { fixture_id, xrd_patterns } from '../fixtures/xrd'
import { make_crystal, read_maybe_gz } from '../setup'

const structures_dir = path.resolve(process.cwd(), `src/site/structures`)

// Shared helper for test suites
const make_simple_cubic_structure = (a_len: number): Crystal =>
  make_crystal(a_len, [{ element: `H`, abc: [0, 0, 0], label: `H1` }])

// Rock-salt MX: cation FCC at (0,0,0), anion on the octahedral sites. All-odd reflections
// scatter as (f_M − f_X) and all-even ones as (f_M + f_X), which makes it the cleanest
// structure for showing a neutron/X-ray intensity reversal driven by a negative b_coh.
const make_rocksalt = (a_len: number, cation: ElementSymbol, anion: ElementSymbol): Crystal =>
  make_crystal(a_len, [
    { element: cation, abc: [0, 0, 0], label: `M1` },
    { element: cation, abc: [0, 0.5, 0.5], label: `M2` },
    { element: cation, abc: [0.5, 0, 0.5], label: `M3` },
    { element: cation, abc: [0.5, 0.5, 0], label: `M4` },
    { element: anion, abc: [0.5, 0.5, 0.5], label: `X1` },
    { element: anion, abc: [0.5, 0, 0], label: `X2` },
    { element: anion, abc: [0, 0.5, 0], label: `X3` },
    { element: anion, abc: [0, 0, 0.5], label: `X4` },
  ])

// Intensity of the peak whose hkl family list contains `target`. Throws rather than
// returning null so a missing reflection names itself instead of failing a later comparison.
const intensity_of = (pattern: XrdPattern, target: string): number => {
  const peak_idx = (pattern.hkls ?? []).findIndex((families) =>
    families.some((family) => family.hkl.join(``) === target),
  )
  if (peak_idx === -1) throw new Error(`no ${target} peak among ${pattern.x.length} peaks`)
  return pattern.y[peak_idx]
}

describe(`compute_xrd_pattern parity with pymatgen JSON`, () => {
  // Pair each structure file with its precomputed XRD pattern from ../fixtures/xrd
  const file_pairs = fs
    .readdirSync(structures_dir)
    .filter((name) => /\.json(?:\.gz)?$/.test(name) && xrd_patterns[fixture_id(name)])
    .map((name) => ({ name, expected: xrd_patterns[fixture_id(name)] }))

  test(`found structure/XRD JSON pairs`, () => {
    expect(file_pairs.length).toBeGreaterThan(0)
  })

  test.each(file_pairs.map((pair) => [pair.name, pair] as const))(
    `compare XRD for %s`,
    (_name, pair) => {
      const structure_json = read_maybe_gz(path.join(structures_dir, pair.name))
      const structure = parse_structure_file(structure_json, pair.name) as Crystal | null
      expect(structure).not.toBeNull()
      if (!structure) return
      const expected = pair.expected

      const computed = compute_xrd_pattern(structure, {
        wavelength: `CuKa`,
        scaled: true,
        two_theta_range: [0, 90],
      })

      const angle_tol = 5e-3 // degrees
      const has_close = (arr: number[], target: number, tol: number) =>
        arr.some((val) => Math.abs(val - target) <= tol)

      // Compare peak positions set-wise over the strongest expected peaks (by intensity)
      // to avoid discrepancies from low-intensity filtering differences between implementations
      const top_indices = Array.from({ length: expected.y.length }, (_, idx) => idx)
        .toSorted((i1, i2) => expected.y[i2] - expected.y[i1])
        .slice(0, Math.min(200, expected.x.length))
      const matched = top_indices.filter((idx) =>
        has_close(computed.x, expected.x[idx], angle_tol),
      ).length
      expect(matched / top_indices.length).toBeGreaterThanOrEqual(0.95)

      // The 20 strongest expected peaks must also match in normalized intensity (both
      // patterns scaled to max=100). Regression for the missing Z − 41.78214·s² prefactor
      // in the atomic scattering factor, which skewed relative peak heights (38.3 vs 51.0)
      for (const idx of top_indices.slice(0, 20)) {
        const diffs = computed.x.map((x_val) => Math.abs(x_val - expected.x[idx]))
        const nearest = diffs.indexOf(Math.min(...diffs))
        if (diffs[nearest] > angle_tol) continue // position check covers misses
        const y_err = Math.abs(computed.y[nearest] - expected.y[idx])
        expect(y_err, `y at 2θ=${expected.x[idx].toFixed(3)}`).toBeLessThanOrEqual(1)
      }

      // Compare d-spacings if present (fixture consistency test asserts d_hkls aligns with x)
      const computed_d = computed.d_hkls
      if (expected.d_hkls && computed_d) {
        const expected_d = expected.d_hkls
        const d_matched = top_indices.filter((idx) =>
          has_close(computed_d, expected_d[idx], 1e-6 + 1e-6 * Math.abs(expected_d[idx])),
        ).length
        expect(d_matched / top_indices.length).toBeGreaterThanOrEqual(0.95)
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

  test(`default two_theta_range stops short of the Lorentz singularity`, () => {
    // The powder Lorentz factor 1/(sin²θ·|cosθ|) diverges at 2θ = 180°, and the clamp in
    // the intensity loop turns that into a ~1e10 spike which becomes the normalization
    // maximum and pushes every real peak under scaled_intensity_tol. With a = λ the (100)
    // reflection sits at 60°; a [0, 180] default returned only a 180° artifact instead.
    const structure = make_simple_cubic_structure(1.54184)
    const pattern = compute_xrd_pattern(structure)
    expect(pattern.x).toHaveLength(1)
    expect(pattern.x[0]).toBeCloseTo(60, 6)
    expect(pattern.y[0]).toBe(100)
  })

  test(`x-ray form factor decays monotonically instead of returning to Z`, () => {
    // f_x(s) = Z − 41.78·s²·Σaᵢexp(−bᵢs²) is a Mott–Bethe inversion of Doyle–Turner
    // ELECTRON amplitudes, valid only at small s: the correction vanishes as s → ∞ and the
    // expression climbs back to +Z. A real form factor decays to 0 and is never negative —
    // unclamped, H dipped to −0.0021 near s = 0.85 and was back at 1.000 by s = 4, which
    // inverted Mo/Ag Kα patterns (s_max = 1/λ reaches 1.41 and 1.78 respectively).
    for (const element of [`H`, `C`, `Si`, `Fe`, `Cs`] as const) {
      let prev = Infinity
      for (let s_val = 0; s_val <= 6; s_val += 0.005) {
        const val = xray_form_factor(element, s_val)
        expect(val).toBeGreaterThanOrEqual(0)
        expect(val).toBeLessThanOrEqual(prev + 1e-12)
        prev = val
      }
    }
  })

  test(`Ag Ka pattern is led by a real reflection, not a back-reflection artifact`, () => {
    const nacl = make_crystal(5.64, [
      { element: `Na`, abc: [0, 0, 0] },
      { element: `Cl`, abc: [0.5, 0.5, 0.5] },
    ])
    const pattern = compute_xrd_pattern(nacl, {
      wavelength: `AgKa`,
      two_theta_range: [0, 180],
    })
    const strongest = pattern.x[pattern.y.indexOf(Math.max(...pattern.y))]
    expect(strongest).toBeLessThan(20) // was a spurious 176° peak
  })

  test(`intensities scale to 100 even when raw values are below 1`, () => {
    // Raw |F|² is electrons² for X-rays but fm² for neutrons: V's b_coh of −0.3824 fm puts
    // every peak under 1, where a Math.max(1, ...) normalization floor silently capped the
    // pattern at 92 instead of 100.
    const structure = make_crystal(
      [
        [3.1, 0, 0],
        [0.7, 3.3, 0],
        [0.4, 0.9, 3.7],
      ],
      [{ element: `V`, abc: [0, 0, 0] }],
    )
    const pattern = compute_xrd_pattern(structure, {
      radiation: `neutron`,
      wavelength: 1.5,
      two_theta_range: [80, 100],
    })
    expect(Math.max(...pattern.y)).toBeCloseTo(100, 10)
  })

  test(`scaled_intensity_tol filters peaks as configured`, () => {
    const structure = make_simple_cubic_structure(3)
    const base_opts = { wavelength: `CuKa` as const, two_theta_range: [0, 90] as Vec2 }

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

describe(`enumerate_reciprocal_points`, () => {
  // This module's reciprocal rows are transpose(inverse(A)) with NO 2π factor, unlike
  // src/lib/brillouin/compute.ts. Tests below assume that convention.
  const triclinic_rows: Matrix3x3 = [
    [4.1, 0, 0],
    [1.3, 3.7, 0],
    [0.8, -1.1, 5.2],
  ]

  test(`g_norm is |h·b1 + k·b2 + l·b3|, within the shell, sorted with h, k, l descending`, () => {
    const recip_rows = math.transpose_3x3_matrix(math.matrix_inverse_3x3(triclinic_rows))
    const [row_b1, row_b2, row_b3] = recip_rows
    const [min_radius, max_radius] = [0.2, 1.5]
    const points = enumerate_reciprocal_points(
      recip_rows,
      triclinic_rows,
      max_radius,
      min_radius,
    )
    expect(points.length).toBeGreaterThan(500) // many points, not a degenerate sample

    let max_rel_dev = 0
    for (const [idx, { hkl, g_norm }] of points.entries()) {
      const [h_idx, k_idx, l_idx] = hkl
      expect(g_norm).toBeGreaterThanOrEqual(min_radius)
      expect(g_norm).toBeLessThanOrEqual(max_radius)
      const expected = Math.hypot(
        ...[0, 1, 2].map(
          (axis) => h_idx * row_b1[axis] + k_idx * row_b2[axis] + l_idx * row_b3[axis],
        ),
      )
      max_rel_dev = Math.max(max_rel_dev, Math.abs(g_norm - expected) / g_norm)
      // pymatgen ordering: g_norm ascending, ties broken by descending h, then k, then l
      const prev = points[idx - 1]
      if (!prev) continue
      expect(prev.g_norm).toBeLessThanOrEqual(g_norm)
      if (prev.g_norm === g_norm && prev.hkl[0] === h_idx) {
        expect(prev.hkl[1]).toBeGreaterThanOrEqual(k_idx)
      }
    }
    // A few ulps of reassociation land near 1e-16; anything structural is far larger
    expect(max_rel_dev).toBeLessThan(1e-14)
  })

  // The SAED path passes a Laue bound so it never has to materialise the full sphere. It
  // must select exactly the sub-list an unbounded enumeration would have filtered by hand.
  test.each([0, 1, 3])(
    `a Laue bound of %i selects the same points as filtering`,
    (max_laue) => {
      const recip_rows = math.transpose_3x3_matrix(math.matrix_inverse_3x3(triclinic_rows))
      const zone_axis: Vec3 = [1, 0, 2]
      const unbounded = enumerate_reciprocal_points(recip_rows, triclinic_rows, 1.5, 0)
      const bounded = enumerate_reciprocal_points(recip_rows, triclinic_rows, 1.5, 0, {
        zone_axis,
        max_laue,
      })
      const expected = unbounded.filter(
        ({ hkl }) =>
          Math.abs(hkl[0] * zone_axis[0] + hkl[1] * zone_axis[1] + hkl[2] * zone_axis[2]) <=
          max_laue,
      )
      expect(bounded).toEqual(expected)
      expect(bounded.length).toBeGreaterThan(0)
      expect(bounded.length).toBeLessThan(unbounded.length)
    },
  )
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

describe(`electron_wavelength`, () => {
  // Relativistic de Broglie wavelengths as tabulated in every TEM textbook (Williams & Carter
  // Table 1.1, De Graef Table 2.1), quoted to 4 significant figures. The tolerance below is
  // set by that quoting precision (5e-5 relative for the 0.03701 entry), not by our arithmetic.
  test.each([
    [100, 0.03701],
    [200, 0.02508],
    [300, 0.01969],
    [80, 0.04176],
    [120, 0.03349],
    [400, 0.01644],
    [1000, 0.008719],
  ])(`%i kV gives the tabulated wavelength %f Å`, (voltage_kv, tabulated) => {
    const computed = electron_wavelength(voltage_kv)
    // 1.5e-4 relative covers half a unit in the last quoted digit of every entry above
    expect(Math.abs(computed - tabulated) / tabulated).toBeLessThan(1.5e-4)
  })

  test(`the relativistic correction is not silently dropped`, () => {
    // Non-relativistic h/sqrt(2·m0·e·V) would give 0.02741 Å at 200 kV, 9.3% too long
    const non_relativistic = 0.0274
    expect(electron_wavelength(200)).toBeLessThan(non_relativistic * 0.95)
  })

  test.each([0, -100, NaN, Infinity])(`invalid voltage %p throws`, (voltage_kv) => {
    expect(() => electron_wavelength(voltage_kv)).toThrow(/Invalid accelerating voltage/)
  })
})

describe(`radiation types`, () => {
  const cu_wavelength = WAVELENGTHS.CuKa
  const probe_structures = [
    [`rocksalt TiC`, make_rocksalt(4.328, `Ti`, `C`)],
    [`rocksalt MnO`, make_rocksalt(4.445, `Mn`, `O`)],
    [`simple cubic H`, make_simple_cubic_structure(3)],
  ] as const
  // scaled_intensity_tol -1 keeps every merged peak, so no pattern can lose a reflection to
  // intensity filtering and the position arrays of two radiations line up index by index
  const unfiltered = (max_two_theta: number) => ({
    wavelength: cu_wavelength,
    two_theta_range: [0, max_two_theta] as Vec2,
    scaled: true,
    scaled_intensity_tol: -1,
  })

  test.each(probe_structures)(
    `%s: omitting radiation is exactly the X-ray path`,
    (_label, structure) => {
      const implicit = compute_xrd_pattern(structure, { wavelength: cu_wavelength })
      const explicit = compute_xrd_pattern(structure, {
        wavelength: cu_wavelength,
        radiation: `xray`,
      })
      expect(implicit).toEqual(explicit)
      // The pymatgen-parity fixtures above pin the absolute values; this pins the branch
      expect(implicit.x.length).toBeGreaterThan(0)
    },
  )

  test.each(probe_structures)(
    `%s: neutron peak positions match X-ray exactly, intensities do not`,
    (_label, structure) => {
      const shared = unfiltered(120)
      const xray = compute_xrd_pattern(structure, { ...shared, radiation: `xray` })
      const neutron = compute_xrd_pattern(structure, { ...shared, radiation: `neutron` })

      // Bragg geometry is radiation-independent: identical 2θ, identical d, identical hkls
      expect(neutron.x).toEqual(xray.x)
      expect(neutron.d_hkls).toEqual(xray.d_hkls)
      expect(neutron.hkls).toEqual(xray.hkls)
      expect(neutron.y).not.toEqual(xray.y)
    },
  )

  // Ti (b_coh = −3.438 fm), Mn (−3.73 fm) and V (−0.3824 fm) scatter neutrons with a 180°
  // phase shift. In a rock-salt MX that flips which reflections are strong: all-even hkl see
  // (b_M + b_X) — a near-cancellation — while all-odd hkl see (b_M − b_X), a reinforcement.
  // X-rays, which only ever see positive electron density, show the opposite ordering.
  test.each([
    // [label, a_len, cation, anion]
    [`TiC`, 4.328, `Ti`, `C`],
    [`MnO`, 4.445, `Mn`, `O`],
    // b_Ti + b_Al = −3.438 + 3.449 = 0.011 fm, a 99.7% cancellation: the strongest X-ray
    // reflection is essentially extinct for neutrons
    [`TiAl`, 4.3, `Ti`, `Al`],
  ] as const)(
    `%s rock salt: 200 dominates for X-rays but 111 dominates for neutrons`,
    (_label, a_len, cation, anion) => {
      const structure = make_rocksalt(a_len, cation, anion)
      const shared = unfiltered(90)
      const xray = compute_xrd_pattern(structure, { ...shared, radiation: `xray` })
      const neutron = compute_xrd_pattern(structure, { ...shared, radiation: `neutron` })

      const [xray_111, xray_200] = [intensity_of(xray, `111`), intensity_of(xray, `200`)]
      const neutron_111 = intensity_of(neutron, `111`)
      const neutron_200 = intensity_of(neutron, `200`)

      // Qualitative reversal, not merely "the numbers moved"
      expect(xray_200).toBeGreaterThan(xray_111)
      expect(neutron_111).toBeGreaterThan(neutron_200)
      // And it is a large effect, not a rounding-scale wobble: the 200/111 ratio drops by
      // more than an order of magnitude going from X-rays to neutrons
      expect(xray_200 / xray_111 / (neutron_200 / neutron_111)).toBeGreaterThan(10)
    },
  )

  test(`TiAl rock salt: 200 is the strongest X-ray line and neutron-extinct`, () => {
    const structure = make_rocksalt(4.3, `Ti`, `Al`)
    const shared = unfiltered(90)
    const xray = compute_xrd_pattern(structure, { ...shared, radiation: `xray` })
    const neutron = compute_xrd_pattern(structure, { ...shared, radiation: `neutron` })

    expect(intensity_of(xray, `200`)).toBeCloseTo(100, 6) // strongest X-ray reflection
    // (b_Ti + b_Al)² / (b_Ti − b_Al)² = (0.011/6.887)² = 2.6e-6, so on a 0-100 scale the
    // 200 line lands well below 0.01 — extinct for any practical measurement
    expect(intensity_of(neutron, `200`)).toBeLessThan(0.01)
    expect(intensity_of(neutron, `111`)).toBeCloseTo(100, 6)
  })

  test.each([`xray`, `neutron`, `electron`] as const)(
    `%s intensities are all finite and positive`,
    (radiation: RadiationType) => {
      const structure = make_rocksalt(4.328, `Ti`, `C`)
      const pattern = compute_xrd_pattern(structure, {
        radiation,
        // electron wavelengths are 60x shorter, so cap 2θ to keep the reflection count sane
        wavelength: radiation === `electron` ? electron_wavelength(200) : cu_wavelength,
        two_theta_range: radiation === `electron` ? [0, 3] : [0, 90],
      })
      expect(pattern.x.length).toBeGreaterThan(0)
      for (const intensity of pattern.y) {
        expect(Number.isFinite(intensity)).toBe(true)
        expect(intensity).toBeGreaterThanOrEqual(0)
      }
    },
  )

  // Mott–Bethe divides (Z − f_x) by s², which naively diverges at forward scattering. The
  // s² cancels analytically in $lib/scattering, and this asserts it survives our call path.
  test(`electron structure factor is finite at s = 0`, () => {
    const structure = make_rocksalt(4.328, `Ti`, `C`)
    const forward = structure_factors_squared(structure, `electron`, {}, [
      { hkl: [0, 0, 0], g_norm: 0 },
      { hkl: [1, 1, 1], g_norm: 1e-12 }, // just off zero, where a literal 1/s² also blows up
    ])
    for (const f_sq of forward) {
      expect(Number.isFinite(f_sq)).toBe(true)
      // Forward scattering adds every atom in phase, so |F(0)|² must be strictly positive
      expect(f_sq).toBeGreaterThan(0)
    }
  })

  test(`neutron pattern of a nucleus with no tabulated b_coh throws with context`, () => {
    // Po has no natural-abundance bound coherent scattering length in the NIST table
    const structure = make_crystal(3.35, [{ element: `Po`, abc: [0, 0, 0], label: `Po1` }])
    expect(() =>
      compute_xrd_pattern(structure, { radiation: `neutron`, wavelength: 1.54 }),
    ).toThrow(/neutron.*Po|Po.*neutron/is)
    // The same structure is perfectly fine for X-rays
    expect(compute_xrd_pattern(structure, { wavelength: `CuKa` }).x.length).toBeGreaterThan(0)
  })

  test.each([
    [
      `neutron with an X-ray anode key`,
      { radiation: `neutron`, wavelength: `CuKa` },
      /CuKa is an X-ray anode wavelength/,
    ],
    [
      `neutron without a wavelength`,
      { radiation: `neutron` },
      /Neutron patterns require an explicit options.wavelength/,
    ],
    [
      `electron with an X-ray anode key`,
      { radiation: `electron`, wavelength: `MoKa` },
      /MoKa is an X-ray anode wavelength/,
    ],
    [
      `electron with neither voltage nor wavelength`,
      { radiation: `electron` },
      /Electron patterns require options.accelerating_voltage/,
    ],
    [
      `electron with both voltage and wavelength`,
      { radiation: `electron`, wavelength: 0.025, accelerating_voltage: 200 },
      /not both/,
    ],
    [
      `X-ray with an accelerating voltage`,
      { radiation: `xray`, accelerating_voltage: 200 },
      /only meaningful for radiation: 'electron'/,
    ],
    [`unknown radiation type`, { radiation: `positron` }, /Unknown radiation type positron/],
    [`unknown X-ray anode key`, { wavelength: `FooBar` }, /Unknown radiation key/i],
  ] as const)(`%s throws`, (_label, options, expected) => {
    const structure = make_simple_cubic_structure(3)
    expect(() => compute_xrd_pattern(structure, options as never)).toThrow(expected)
  })

  test(`electron pattern accepts an accelerating voltage and uses that wavelength`, () => {
    const structure = make_rocksalt(4.328, `Ti`, `C`)
    const by_voltage = compute_xrd_pattern(structure, {
      radiation: `electron`,
      accelerating_voltage: 200,
      two_theta_range: [0, 3],
    })
    const by_wavelength = compute_xrd_pattern(structure, {
      radiation: `electron`,
      wavelength: electron_wavelength(200),
      two_theta_range: [0, 3],
    })
    expect(by_voltage).toEqual(by_wavelength)
    expect(by_voltage.x.length).toBeGreaterThan(0)
  })

  // Only X-rays are polarized by the scattering event. Reusing (1 + cos²2θ) for the other
  // probes would inflate low-angle and high-angle lines relative to the ones near 2θ = 90°.
  // Both non-X-ray branches are pinned: with only the neutron case covered, widening the
  // guard from `radiation === xray` to `radiation !== neutron` went unnoticed.
  test.each([
    // b_coh for H is −3.739 fm and carries no s dependence at all
    [`neutron` as const, () => (-3.739) ** 2],
    [`electron` as const, (s_val: number) => electron_form_factor(`H`, s_val) ** 2],
  ])(`%s intensities carry no polarization factor`, (radiation, f_squared_at) => {
    const structure = make_simple_cubic_structure(3)
    const pattern = compute_xrd_pattern(structure, {
      radiation,
      wavelength: cu_wavelength,
      two_theta_range: [0, 150],
      scaled: false,
      scaled_intensity_tol: -1,
    })

    // Single-atom cell: |F|² = f(s)²·exp(0), so the only 2θ dependence left in the intensity
    // beyond the form factor must be the bare Lorentz factor 1/(sin²θ·|cosθ|)
    let max_rel_dev = 0
    for (let idx = 0; idx < pattern.x.length; idx++) {
      const theta = (pattern.x[idx] / 2) * (Math.PI / 180)
      const expected =
        f_squared_at(Math.sin(theta) / cu_wavelength) /
        Math.max(Math.sin(theta) ** 2 * Math.abs(Math.cos(theta)), 1e-12)
      // Merged peaks accumulate several reflections, so divide the multiplicity back out
      const n_reflections = (pattern.hkls?.[idx] ?? []).reduce(
        (sum, family) => sum + (family.multiplicity ?? 0),
        0,
      )
      const dev = Math.abs(pattern.y[idx] / n_reflections / expected - 1)
      if (dev > max_rel_dev) max_rel_dev = dev
    }
    // 1e-12 relative: θ round-trips through 2θ in degrees, so s carries a few ulps that the
    // Gaussian sum amplifies by b·s² ≲ 30. A polarization factor would be off by 2x.
    expect(max_rel_dev).toBeLessThan(1e-12)
    expect(pattern.x.length).toBeGreaterThan(5)
  })
})

describe(`add_xrd_pattern`, () => {
  const cubic_json = JSON.stringify(make_simple_cubic_structure(3))

  test.each([
    [`JSON string`, cubic_json],
    [`ArrayBuffer`, new TextEncoder().encode(cubic_json).buffer],
  ])(`computes a pattern from a %s`, async (_label, content) => {
    const result = await add_xrd_pattern(content, `test.json`, null)
    expect(result.error).toBeUndefined()
    expect(result.pattern?.label).toBe(`test.json`)
    expect(result.pattern?.pattern.x.length).toBeGreaterThan(0)
  })

  test(`returns error for invalid structure`, async () => {
    const result = await add_xrd_pattern(`invalid json`, `test.json`, null)
    expect(result.error).toBeDefined()
    expect(result.pattern).toBeUndefined()
  })

  test(`returns error for structure without lattice`, async () => {
    const { lattice: _lattice, ...structure } = make_simple_cubic_structure(3) // strip lattice
    const result = await add_xrd_pattern(JSON.stringify(structure), `test.json`, null)
    expect(result.error).toMatch(/must have a lattice/)
  })

  test(`respects wavelength parameter`, async () => {
    const res_cu = await add_xrd_pattern(cubic_json, `cu.json`, WAVELENGTHS.CuKa)
    const res_mo = await add_xrd_pattern(cubic_json, `mo.json`, WAVELENGTHS.MoKa)
    const peaks_cu = res_cu.pattern?.pattern.x ?? []
    const peaks_mo = res_mo.pattern?.pattern.x ?? []

    // Bragg: 2θ = 2·asin(λ/2d), so halving λ has to move the first (100) line of a = 3 Å
    expect(peaks_cu.length).toBeGreaterThan(0)
    expect(peaks_mo.length).toBeGreaterThan(0)
    expect(peaks_cu[0]).not.toBeCloseTo(peaks_mo[0], 1)
  })
})

// Option handling shared by every radiation branch
describe(`compute_xrd_pattern options`, () => {
  test.each([0, -1.5, NaN, Infinity, -Infinity])(
    `invalid wavelength %p throws`,
    (wavelength) => {
      // message must name the problem, echo the value, and state the requirement
      expect(() =>
        compute_xrd_pattern(make_simple_cubic_structure(2), { wavelength }),
      ).toThrow(`Invalid wavelength: ${wavelength}. Must be a finite positive number.`)
    },
  )

  test(`unknown element symbol throws`, () => {
    const structure = make_crystal(2, [{ element: `Xx`, abc: [0, 0, 0], label: `Xx` }])
    expect(() => compute_xrd_pattern(structure, { wavelength: `CuKa` })).toThrow(
      /Unknown atomic number/i,
    )
  })

  test(`valid numeric wavelength works`, () => {
    const pattern = compute_xrd_pattern(make_simple_cubic_structure(2), {
      wavelength: 1.54184,
    })
    expect(pattern.x.length).toBeGreaterThan(0)
    expect(pattern.y).toHaveLength(pattern.x.length)
  })

  test(`hkls and d_hkls line up with x`, () => {
    const pattern = compute_xrd_pattern(make_simple_cubic_structure(2), { wavelength: `CuKa` })
    expect(pattern.x.length).toBeGreaterThan(0)
    expect(pattern.hkls).toHaveLength(pattern.x.length)
    expect(pattern.d_hkls).toHaveLength(pattern.x.length)
  })

  test.each([
    [0, 30],
    [10, 60],
  ] as Vec2[])(
    `two_theta_range [%i, %i] is respected and x comes out sorted`,
    (min_angle, max_angle) => {
      const { x: angles } = compute_xrd_pattern(make_simple_cubic_structure(2), {
        wavelength: `CuKa`,
        two_theta_range: [min_angle, max_angle],
        scaled: false,
      })
      expect(angles.every((angle) => angle >= min_angle && angle <= max_angle)).toBe(true)
      expect(angles).toEqual(angles.toSorted((ang_a, ang_b) => ang_a - ang_b))
    },
  )

  test(`scaled false returns raw intensities; scaled true caps max to 100`, () => {
    const structure = make_simple_cubic_structure(2)
    const raw = compute_xrd_pattern(structure, { wavelength: `CuKa`, scaled: false })
    const scaled = compute_xrd_pattern(structure, { wavelength: `CuKa`, scaled: true })
    expect(raw.x.length).toBeGreaterThan(0)
    expect(Math.max(...raw.y)).not.toBeCloseTo(100, 6)
    expect(Math.max(...scaled.y)).toBeCloseTo(100, 12)
  })

  test(`Debye-Waller factors damp intensities when not scaled`, () => {
    const structure = make_simple_cubic_structure(2)
    const shared = { wavelength: `CuKa`, scaled: false } as const
    const base = compute_xrd_pattern(structure, shared)
    const damped = compute_xrd_pattern(structure, {
      ...shared,
      debye_waller_factors: { H: 10 },
    })
    expect(Math.max(0, ...damped.y)).toBeLessThan(Math.max(0, ...base.y))
  })
})
