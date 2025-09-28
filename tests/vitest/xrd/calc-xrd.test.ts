import type { ElementSymbol } from '$lib'
import type { PymatgenStructure } from '$lib/structure'
import { parse_structure_file } from '$lib/structure/parse'
import { compute_xrd_pattern } from '$lib/xrd'
import params from '$lib/xrd/atomic-scattering-params.json' with { type: 'json' }
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { describe, expect, test } from 'vitest'

type FilePair = {
  name: string
  struct_path: string
  xrd_path: string
}

type ExpectedPattern = {
  x: number[]
  y: number[]
  hkls?: unknown
  d_hkls?: number[]
}

const structures_dir = path.resolve(
  process.cwd(),
  `src/site/structures`,
)
const xrd_dir = path.resolve(process.cwd(), `tests/vitest/fixtures/xrd`)

function list_matching_pairs(): FilePair[] {
  const structure_files = fs
    .readdirSync(structures_dir)
    .filter((name) => name.endsWith(`.json`))
  const xrd_files = new Set(
    fs
      .readdirSync(xrd_dir)
      .filter((name) => name.endsWith(`.json`)),
  )
  const pairs: FilePair[] = []
  for (const file_name of structure_files) {
    if (!xrd_files.has(file_name)) continue
    pairs.push({
      name: file_name,
      struct_path: path.join(structures_dir, file_name),
      xrd_path: path.join(xrd_dir, file_name),
    })
  }
  return pairs
}

function _get_structure_elements(structure: PymatgenStructure): ElementSymbol[] {
  const elems = new Set<ElementSymbol>()
  for (const site of structure.sites) {
    for (const species of site.species) {
      elems.add(species.element as ElementSymbol)
    }
  }
  return Array.from(elems).sort()
}

describe(`compute_xrd_pattern parity with pymatgen JSON`, () => {
  const file_pairs = list_matching_pairs()

  test(`found structure/XRD JSON pairs`, () => {
    expect(file_pairs.length).toBeGreaterThan(0)
  })

  test.each(file_pairs.map((p) => [p.name, p] as const))(
    `compare XRD for %s`,
    (_name, pair) => {
      const structure_json = fs.readFileSync(pair.struct_path, `utf8`)
      const parsed = parse_structure_file(structure_json, pair.name)
      expect(parsed).not.toBeNull()
      if (!parsed) return

      const structure = parsed as unknown as PymatgenStructure
      const expected: ExpectedPattern = JSON.parse(
        fs.readFileSync(pair.xrd_path, `utf8`),
      ) as ExpectedPattern

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
      const top_indices = Array.from({ length: expected.y.length }, (_, i) => i)
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

      // Compare d-spacings if present, over overlapping range only
      if (expected.d_hkls && computed.d_hkls) {
        const top_d_indices = Array.from({ length: expected.y.length }, (_, i) => i)
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
  function make_simple_cubic_structure(a_len: number): PymatgenStructure {
    const a = a_len
    const lattice = {
      matrix: [
        [a, 0, 0],
        [0, a, 0],
        [0, 0, a],
      ] as [[number, number, number], [number, number, number], [number, number, number]],
      a,
      b: a,
      c: a,
      alpha: 90,
      beta: 90,
      gamma: 90,
      volume: a * a * a,
      pbc: [true, true, true] as [boolean, boolean, boolean],
    }

    const structure: PymatgenStructure = {
      lattice,
      sites: [
        {
          species: [{ element: `H`, occu: 1, oxidation_state: 0 }],
          abc: [0, 0, 0],
          xyz: [0, 0, 0],
          label: `H1`,
          properties: {},
        },
      ],
    }

    return structure
  }

  test.each(
    [
      [`CuKa`, 1.54184],
      [`MoKa`, 0.71073],
    ] as const,
  )(
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

  test(`supports object-shaped coefficients with optional c term`, () => {
    const original = (params as { [key: string]: unknown }).H
    try {
      ;(params as unknown as Record<string, unknown>).H = { a: [], b: [], c: 5 }
      const structure = make_simple_cubic_structure(2)
      const pattern = compute_xrd_pattern(structure, {
        wavelength: `CuKa`,
        scaled: true,
        two_theta_range: [0, 90],
      })
      expect(pattern.x.length).toBeGreaterThan(0)
      expect(
        pattern.y.every((intensity: number) =>
          Number.isFinite(intensity) && intensity > 0
        ),
      ).toBe(true)
    } finally {
      ;(params as unknown as Record<string, unknown>).H = original as unknown
    }
  })
})
