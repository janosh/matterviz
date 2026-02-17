// Tests ported from pymatgen/tests/analysis/test_chempot_diagram.py, plus extensive
// edge-case, invariant, and physical-limit tests that pymatgen's suite lacks.
//
// Key differences from pymatgen:
// - Element ordering: pymatgen uses atomic number [Li, Fe, O], we use alphabetical [Fe, Li, O]
// - Formula keys: pymatgen uses Hill notation (Li2FeO3), we sort alphabetically (FeLi2O3)
// - O2 reduced formula: pymatgen keeps "O2", our get_reduced_formula reduces {O:6} to {O:1} → "O"

import {
  apply_element_padding,
  build_axis_ranges,
  build_border_hyperplanes,
  build_hyperplanes,
  compute_chempot_diagram,
  compute_domains,
  dedup_points,
  formula_key_from_composition,
  get_3d_domain_simplexes_and_ann_loc,
  get_energy_per_atom,
  get_min_entries_and_el_refs,
  orthonormal_2d,
  pad_domain_points,
  renormalize_entries,
  simple_pca,
} from '$lib/chempot-diagram/compute'
import type { PhaseData } from '$lib/convex-hull/types'
import type { Vec2 } from '$lib/math'
import { convex_hull_2d, polygon_centroid, solve_linear_system } from '$lib/math'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'

const test_dir = dirname(fileURLToPath(import.meta.url))

function load_gzip_json<T>(filename: string): T {
  const compressed_bytes = readFileSync(`${test_dir}/${filename}`)
  const decompressed_text = gunzipSync(compressed_bytes).toString(`utf8`)
  return JSON.parse(decompressed_text) as T
}

const entries = load_gzip_json<PhaseData[]>(`pd_entries_test.json.gz`)
const ytos_entries = load_gzip_json<PhaseData[]>(`ytos_entries.json.gz`)

// Filter to Fe-O binary subsystem
const fe_o_elements = new Set([`Fe`, `O`])
const binary_entries = entries.filter((entry) =>
  Object.entries(entry.composition)
    .filter(([, amt]) => amt > 0)
    .every(([el]) => fe_o_elements.has(el))
)

const cpd_ternary = compute_chempot_diagram(entries, {
  default_min_limit: -25,
  formal_chempots: false,
})

const cpd_ternary_formal = compute_chempot_diagram(entries, {
  default_min_limit: -25,
  formal_chempots: true,
})

const cpd_binary = compute_chempot_diagram(binary_entries, {
  default_min_limit: -25,
  formal_chempots: false,
})

// Mapping from pymatgen formula names to our alphabetically-sorted formula keys
const pmg_to_ours: Record<string, string> = {
  Fe: `Fe`,
  Fe2O3: `Fe2O3`,
  Fe3O4: `Fe3O4`,
  FeO: `FeO`,
  Li: `Li`,
  Li2O: `Li2O`,
  Li2O2: `LiO`,
  O2: `O`,
  Li2FeO3: `FeLi2O3`,
  Li5FeO4: `FeLi5O4`,
  LiFeO2: `FeLiO2`,
}

// Helper: make a PhaseData entry from composition and energy_per_atom
function make_entry(
  composition: Record<string, number>,
  energy_per_atom: number,
): PhaseData {
  const atoms = Object.values(composition).reduce((s, v) => s + v, 0)
  return { composition, energy: energy_per_atom * atoms, energy_per_atom }
}

// Reorder pymatgen [Li, Fe, O] columns to our [Fe, Li, O]
function reorder_cols(pts: number[][]): number[][] {
  return pts.map(([li, fe, o]) => [fe, li, o])
}

function sort_rows(pts: number[][]): number[][] {
  return [...pts]
    .map((row) => row.map((val) => Math.round(val * 1e6) / 1e6))
    .sort((a, b) => {
      for (let idx = 0; idx < a.length; idx++) {
        if (a[idx] !== b[idx]) return a[idx] - b[idx]
      }
      return 0
    })
}

function dedup_vertices(pts: number[][], tol: number = 1e-4): number[][] {
  const result: number[][] = []
  for (const pt of pts) {
    if (!result.some((ex) => ex.every((val, idx) => Math.abs(val - pt[idx]) < tol))) {
      result.push(pt)
    }
  }
  return result
}

// === Pymatgen parity tests ===

describe(`pymatgen parity: ChemicalPotentialDiagram`, () => {
  test(`dim`, () => {
    expect(cpd_binary.elements.length).toBe(2)
    expect(cpd_ternary.elements.length).toBe(3)
    expect(cpd_ternary_formal.elements.length).toBe(3)
  })

  test(`elements sorted alphabetically`, () => {
    expect(cpd_ternary.elements).toEqual([`Fe`, `Li`, `O`])
  })

  test(`el_refs (absolute)`, () => {
    expect(cpd_ternary.el_refs[`Li`].energy).toBeCloseTo(-1.91301487, 5)
    expect(cpd_ternary.el_refs[`Fe`].energy).toBeCloseTo(-6.5961471, 5)
    expect(cpd_ternary.el_refs[`O`].energy).toBeCloseTo(-25.54966885, 5)
  })

  test(`el_refs (formal) are zero`, () => {
    for (const entry of Object.values(cpd_ternary_formal.el_refs)) {
      expect(entry.energy).toBeCloseTo(0, 5)
    }
  })

  test(`border_hyperplanes`, () => {
    const desired = [
      [-1, 0, 0, -25],
      [1, 0, 0, 0],
      [0, -1, 0, -25],
      [0, 1, 0, 0],
      [0, 0, -1, -25],
      [0, 0, 1, 0],
    ]
    const border = build_border_hyperplanes([[-25, 0], [-25, 0], [-25, 0]])
    for (let idx = 0; idx < desired.length; idx++) {
      for (let jdx = 0; jdx < desired[idx].length; jdx++) {
        expect(border[idx][jdx]).toBeCloseTo(desired[idx][jdx], 5)
      }
    }
  })

  test(`lims`, () => {
    expect(cpd_ternary.lims).toEqual([[-25, 0], [-25, 0], [-25, 0]])
  })

  test.each(
    [
      [`Fe`, [
        [-25.0, -6.596147, -25.0],
        [-25.0, -6.596147, -7.115354],
        [-3.931615, -6.596147, -7.115354],
        [-3.625002, -6.596147, -7.268661],
        [-3.351598, -6.596147, -7.610416],
        [-1.913015, -6.596147, -25.0],
        [-1.913015, -6.596147, -10.487582],
      ]],
      [`Fe2O3`, [
        [-25.0, -10.739688, -4.258278],
        [-25.0, -7.29639, -6.55381],
        [-5.550202, -10.739688, -4.258278],
        [-5.406275, -10.451834, -4.450181],
        [-4.35446, -7.29639, -6.55381],
      ]],
      [`Fe3O4`, [
        [-25.0, -7.29639, -6.55381],
        [-25.0, -6.741594, -6.969907],
        [-4.35446, -7.29639, -6.55381],
        [-4.077062, -6.741594, -6.969907],
      ]],
      [`FeO`, [
        [-25.0, -6.741594, -6.969907],
        [-25.0, -6.596147, -7.115354],
        [-4.077062, -6.741594, -6.969907],
        [-3.931615, -6.596147, -7.115354],
      ]],
      [`Li`, [
        [-1.913015, -25.0, -25.0],
        [-1.913015, -25.0, -10.487582],
        [-1.913015, -6.596147, -25.0],
        [-1.913015, -6.596147, -10.487582],
      ]],
      [`Li2O`, [
        [-4.612511, -25.0, -5.088591],
        [-4.612511, -10.378885, -5.088591],
        [-3.351598, -6.596147, -7.610416],
        [-1.913015, -25.0, -10.487582],
        [-1.913015, -6.596147, -10.487582],
      ]],
      [`Li2O2`, [
        [-5.442823, -25.0, -4.258278],
        [-5.442823, -10.954446, -4.258278],
        [-4.739887, -10.251509, -4.961215],
        [-4.612511, -25.0, -5.088591],
        [-4.612511, -10.378885, -5.088591],
      ]],
      [`O2`, [
        [-25.0, -25.0, -4.258278],
        [-25.0, -10.739688, -4.258278],
        [-5.550202, -10.739688, -4.258278],
        [-5.442823, -25.0, -4.258278],
        [-5.442823, -10.954446, -4.258278],
      ]],
    ],
  )(`domain vertices for %s match pymatgen`, (pmg_formula, pmg_vertices) => {
    const our_key = pmg_to_ours[pmg_formula] ?? pmg_formula
    const actual_pts = cpd_ternary.domains[our_key]
    expect(actual_pts, `Domain missing for ${our_key}`).toBeDefined()
    const sorted_actual = sort_rows(dedup_vertices(actual_pts))
    const sorted_expected = sort_rows(reorder_cols(pmg_vertices as number[][]))
    expect(sorted_actual.length).toBe(sorted_expected.length)
    for (let idx = 0; idx < sorted_expected.length; idx++) {
      for (let jdx = 0; jdx < sorted_expected[idx].length; jdx++) {
        expect(sorted_actual[idx][jdx]).toBeCloseTo(sorted_expected[idx][jdx], 4)
      }
    }
  })
})

// === Physical invariant tests ===

describe(`physical invariants`, () => {
  test(`all domain vertices satisfy all hyperplane constraints`, () => {
    // Every vertex must lie on or below every hyperplane: a·mu + b <= tol
    const all_hs = [
      ...cpd_ternary.hyperplanes,
      ...build_border_hyperplanes(cpd_ternary.lims),
    ]
    const dim = cpd_ternary.elements.length
    for (const [formula, pts] of Object.entries(cpd_ternary.domains)) {
      for (const pt of dedup_vertices(pts)) {
        for (const hs of all_hs) {
          let val = hs[dim]
          for (let jdx = 0; jdx < dim; jdx++) val += hs[jdx] * pt[jdx]
          expect(val, `Vertex of ${formula} violates halfspace`).toBeLessThanOrEqual(1e-4)
        }
      }
    }
  })

  test(`all domain vertices lie within specified limits`, () => {
    for (const pts of Object.values(cpd_ternary.domains)) {
      for (const pt of pts) {
        for (let dim = 0; dim < cpd_ternary.elements.length; dim++) {
          const [lo, hi] = cpd_ternary.lims[dim]
          expect(pt[dim]).toBeGreaterThanOrEqual(lo - 1e-4)
          expect(pt[dim]).toBeLessThanOrEqual(hi + 1e-4)
        }
      }
    }
  })

  test(`every element has a domain (no element vanishes from the diagram)`, () => {
    for (const el of cpd_ternary.elements) {
      expect(cpd_ternary.domains[el], `Element ${el} has no domain`).toBeDefined()
    }
  })

  test(`elemental domains touch the el_ref energy axis`, () => {
    // For absolute chempots: the Fe domain should have vertices where
    // mu_Fe = E_ref(Fe) (the elemental reference energy per atom)
    const fe_ref_e = cpd_ternary.el_refs[`Fe`].energy
    const fe_domain = dedup_vertices(cpd_ternary.domains[`Fe`])
    // Fe column is index 0 (alphabetical: Fe, Li, O)
    const fe_vals = fe_domain.map((pt) => pt[0])
    expect(fe_vals.some((val) => Math.abs(val - fe_ref_e) < 0.01)).toBe(true)
  })

  test(`formal chempots: elemental domain vertices include mu=0`, () => {
    for (const el of cpd_ternary_formal.elements) {
      const domain = dedup_vertices(cpd_ternary_formal.domains[el])
      const el_idx = cpd_ternary_formal.elements.indexOf(el)
      const has_zero = domain.some((pt) => Math.abs(pt[el_idx]) < 0.01)
      expect(has_zero, `${el} formal domain should touch mu_${el}=0`).toBe(true)
    }
  })

  test(`formal chempots: all chemical potentials are non-positive`, () => {
    // With formal chempots, mu_X - mu_X^0 <= 0 always (phases can't have higher
    // chemical potential than the pure element)
    for (const pts of Object.values(cpd_ternary_formal.domains)) {
      for (const pt of pts) {
        for (let dim = 0; dim < pt.length; dim++) {
          expect(pt[dim], `Formal chempot should be <= 0`).toBeLessThanOrEqual(1e-4)
        }
      }
    }
  })

  test(`domain vertex centroids satisfy hyperplane feasibility`, () => {
    // Vertex centroids aren't guaranteed to lie inside their own domain
    // (boundary-clamped vertices can skew centroids into neighbors), so we only
    // check that the energy at centroids is feasible (non-positive score).
    const dim = cpd_ternary.elements.length
    for (const pts of Object.values(cpd_ternary.domains)) {
      const unique = dedup_vertices(pts)
      if (unique.length < 2) continue
      const centroid = unique[0].map((_, col) =>
        unique.reduce((s, p) => s + p[col], 0) / unique.length
      )
      let best_energy = Infinity
      for (const hs of cpd_ternary.hyperplanes) {
        let val = hs[dim]
        for (let jdx = 0; jdx < dim; jdx++) val += hs[jdx] * centroid[jdx]
        if (val < best_energy) best_energy = val
      }
      expect(best_energy).toBeLessThanOrEqual(1e-4)
    }
  })
})

// === Binary system tests ===

describe(`binary system (2 elements)`, () => {
  // A binary system A-B with compounds AB and A2B gives a well-understood diagram
  const binary_simple = compute_chempot_diagram([
    make_entry({ A: 1 }, -2.0), // element A
    make_entry({ B: 1 }, -3.0), // element B
    make_entry({ A: 1, B: 1 }, -6.0), // compound AB, formation energy = -6 - (-2 -3) = -1 eV/fu
  ], { default_min_limit: -20, formal_chempots: false })

  test(`produces exactly 3 domains for A-B-AB system`, () => {
    expect(Object.keys(binary_simple.domains).sort()).toEqual([`A`, `AB`, `B`])
  })

  test(`elemental ref energies match input`, () => {
    expect(binary_simple.el_refs[`A`].energy_per_atom).toBe(-2.0)
    expect(binary_simple.el_refs[`B`].energy_per_atom).toBe(-3.0)
  })

  test(`compound domain vertices lie between element refs`, () => {
    const ab_domain = dedup_vertices(binary_simple.domains[`AB`])
    // AB domain should not extend beyond the elemental reference energies
    for (const pt of ab_domain) {
      expect(pt[0]).toBeLessThanOrEqual(-2.0 + 1e-4) // mu_A <= E_A
      expect(pt[1]).toBeLessThanOrEqual(-3.0 + 1e-4) // mu_B <= E_B
    }
  })

  test(`formal chempots shift all refs to zero`, () => {
    const formal = compute_chempot_diagram([
      make_entry({ A: 1 }, -2.0),
      make_entry({ B: 1 }, -3.0),
      make_entry({ A: 1, B: 1 }, -6.0),
    ], { default_min_limit: -20, formal_chempots: true })

    expect(formal.el_refs[`A`].energy_per_atom).toBeCloseTo(0, 8)
    expect(formal.el_refs[`B`].energy_per_atom).toBeCloseTo(0, 8)
  })

  test(`tighter limits produce vertices within bounds`, () => {
    const tight = compute_chempot_diagram([
      make_entry({ A: 1 }, -2.0),
      make_entry({ B: 1 }, -3.0),
      make_entry({ A: 1, B: 1 }, -6.0),
    ], { default_min_limit: -10, formal_chempots: false })

    for (const pts of Object.values(tight.domains)) {
      for (const pt of pts) {
        expect(pt[0]).toBeGreaterThanOrEqual(-10 - 1e-4)
        expect(pt[1]).toBeGreaterThanOrEqual(-10 - 1e-4)
      }
    }
  })
})

// === Trivial / analytic binary: only two elements, no compounds ===

describe(`pure binary (no compounds)`, () => {
  const pure_binary = compute_chempot_diagram([
    make_entry({ X: 1 }, -1.0),
    make_entry({ Y: 1 }, -2.0),
  ], { default_min_limit: -10, formal_chempots: false })

  test(`produces exactly 2 domains`, () => {
    expect(Object.keys(pure_binary.domains).sort()).toEqual([`X`, `Y`])
  })

  test.each([
    { el: `X`, axis: 0, ref_epa: -1.0 },
    { el: `Y`, axis: 1, ref_epa: -2.0 },
  ])(`$el domain touches mu=$ref_epa at upper bound`, ({ el, axis, ref_epa }) => {
    const vals = dedup_vertices(pure_binary.domains[el]).map((pt) => pt[axis])
    expect(Math.max(...vals)).toBeCloseTo(ref_epa, 4)
  })
})

// === Error handling ===

describe(`error handling`, () => {
  test(`throws for < 2 elements`, () => {
    expect(() =>
      compute_chempot_diagram([
        make_entry({ A: 1 }, -1.0),
      ])
    ).toThrow(`requires 2+ elements`)
  })

  test(`throws for missing elemental ref`, () => {
    // Compound-only entries have elements detected but no elemental reference entries
    expect(() =>
      compute_chempot_diagram([
        make_entry({ A: 1, B: 1 }, -3.0),
        make_entry({ A: 2, B: 1 }, -5.0),
      ])
    ).toThrow(`Missing elemental reference`)
  })

  test(`empty entries array throws`, () => {
    expect(() => compute_chempot_diagram([])).toThrow()
  })
})

// === get_min_entries_and_el_refs ===

describe(`get_min_entries_and_el_refs`, () => {
  test(`picks lowest energy per composition`, () => {
    const { min_entries } = get_min_entries_and_el_refs([
      make_entry({ A: 1 }, -1.0),
      make_entry({ A: 1 }, -2.0), // lower energy
      make_entry({ A: 1 }, -0.5),
    ])
    expect(min_entries.length).toBe(1)
    expect(min_entries[0].energy_per_atom).toBe(-2.0)
  })

  test(`distinguishes compositions and identifies elemental refs`, () => {
    const { min_entries, el_refs } = get_min_entries_and_el_refs([
      make_entry({ A: 1 }, -1.0),
      make_entry({ B: 1 }, -2.0),
      make_entry({ A: 1, B: 1 }, -3.0),
    ])
    expect(min_entries.length).toBe(3)
    expect(el_refs[`A`].energy_per_atom).toBe(-1.0)
    expect(el_refs[`B`].energy_per_atom).toBe(-2.0)
  })

  test(`handles multiple polymorphs of same composition`, () => {
    const { min_entries, el_refs } = get_min_entries_and_el_refs([
      make_entry({ Fe: 1 }, -6.0),
      make_entry({ Fe: 1 }, -6.5), // BCC Fe, lowest
      make_entry({ Fe: 1 }, -6.2),
      make_entry({ O: 2 }, -8.0),
    ])
    expect(min_entries.length).toBe(2)
    expect(el_refs[`Fe`].energy_per_atom).toBe(-6.5)
  })
})

// === renormalize_entries ===

describe(`renormalize_entries`, () => {
  test(`pure elements renormalize to zero`, () => {
    const el_refs: Record<string, PhaseData> = {
      A: make_entry({ A: 1 }, -2.0),
      B: make_entry({ B: 1 }, -3.0),
    }
    const renormed = renormalize_entries(
      [make_entry({ A: 1 }, -2.0), make_entry({ B: 1 }, -3.0)],
      el_refs,
      [`A`, `B`],
    )
    expect(renormed[0].energy_per_atom).toBeCloseTo(0, 8)
    expect(renormed[1].energy_per_atom).toBeCloseTo(0, 8)
  })

  test(`compound formation energy is preserved`, () => {
    const entry_a = make_entry({ A: 1 }, -2.0) // E_per_atom = -2.0
    const entry_b = make_entry({ B: 1 }, -3.0) // E_per_atom = -3.0
    const el_refs: Record<string, PhaseData> = { A: entry_a, B: entry_b }
    // AB: make_entry({A:1, B:1}, -3.0) → E_per_atom = -3.0, energy = -6.0
    // Renorm = E_per_atom - (x_A * E_ref_A + x_B * E_ref_B)
    //        = -3.0 - (0.5*(-2.0) + 0.5*(-3.0)) = -3.0 - (-2.5) = -0.5
    const renormed = renormalize_entries(
      [make_entry({ A: 1, B: 1 }, -3.0)],
      el_refs,
      [`A`, `B`],
    )
    expect(renormed[0].energy_per_atom).toBeCloseTo(-0.5, 8)
    // Total energy = E_per_atom_renormed * n_atoms = -0.5 * 2 = -1.0
    expect(renormed[0].energy).toBeCloseTo(-1.0, 8)
  })
})

// === build_hyperplanes ===

describe(`build_hyperplanes`, () => {
  const el_refs: Record<string, PhaseData> = {
    A: make_entry({ A: 1 }, -2.0),
    B: make_entry({ B: 1 }, -3.0),
  }
  const ab_entry = make_entry({ A: 1, B: 1 }, -6.0)
  const { hyperplanes, hyperplane_entries } = build_hyperplanes(
    [el_refs[`A`], el_refs[`B`], ab_entry],
    el_refs,
    [`A`, `B`],
  )

  test(`always includes elemental references`, () => {
    expect(hyperplane_entries.length).toBeGreaterThanOrEqual(2)
  })

  test(`rows have dim+1 columns and atomic fractions sum to 1`, () => {
    for (const row of hyperplanes) {
      expect(row.length).toBe(3) // [x_A, x_B, -E]
      expect(row[0] + row[1]).toBeCloseTo(1.0, 8)
    }
  })
})

// === apply_element_padding / pad_domain_points ===

describe(`element padding`, () => {
  test(`padding reduces extreme coordinates`, () => {
    const domains = { A: [[-50, -3], [-2, -3]], B: [[-50, -50], [-50, -5]] }
    const new_lims = apply_element_padding(domains, [0, 1], 1.0, -50)
    // For axis 0: non-default min is -2, so new_lim = -2 - 1 = -3
    expect(new_lims[0]).toBeCloseTo(-3, 4)
    // For axis 1: non-default min is -5, so new_lim = -5 - 1 = -6
    expect(new_lims[1]).toBeCloseTo(-6, 4)
  })

  test(`pad_domain_points replaces default_min_limit values`, () => {
    const pts = [[-50, -3], [-2, -50]]
    const padded = pad_domain_points(pts, [0, 1], [-10, -10], -50, 1.0)
    expect(padded[0][0]).toBe(-10) // was -50 → replaced
    expect(padded[0][1]).toBe(-3) // not near -50 → unchanged
    expect(padded[1][0]).toBe(-2) // not near -50 → unchanged
    expect(padded[1][1]).toBe(-10) // was -50 → replaced
  })

  test(`pad_domain_points preserves non-default values exactly`, () => {
    const pts = [[-5.123, -7.456]]
    const padded = pad_domain_points(pts, [0, 1], [-20, -20], -50, 1.0)
    expect(padded[0][0]).toBe(-5.123)
    expect(padded[0][1]).toBe(-7.456)
  })

  test(`padding threshold scales with large padding values`, () => {
    const domains = { A: [[-50, -50], [-47, -46], [-40, -44]] }
    const padding = 5.0
    const new_lims = apply_element_padding(domains, [0, 1], padding, -50)
    // Axis mins should ignore near-default points within 5 eV: use -40 and -44
    expect(new_lims[0]).toBeCloseTo(-45, 8)
    expect(new_lims[1]).toBeCloseTo(-49, 8)

    const padded = pad_domain_points(domains.A, [0, 1], new_lims, -50, padding)
    // Values within 5 eV of default_min_limit should be replaced
    expect(padded[0]).toEqual([-45, -49])
    expect(padded[1]).toEqual([-45, -49])
    // Values farther than 5 eV should be preserved
    expect(padded[2]).toEqual([-40, -44])
  })
})

// === solve_linear_system ===

describe(`solve_linear_system`, () => {
  test.each([
    {
      label: `2x2 identity`,
      mat: [[1, 0], [0, 1]],
      rhs: [3, 7],
      expected: [3, 7],
    },
    {
      label: `2x2 general`,
      mat: [[2, 1], [1, 3]],
      rhs: [5, 10],
      expected: [1, 3],
    },
    {
      label: `3x3 identity`,
      mat: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      rhs: [1, 2, 3],
      expected: [1, 2, 3],
    },
    {
      label: `3x3 general`,
      mat: [[1, 2, 3], [4, 5, 6], [7, 8, 10]],
      rhs: [14, 32, 53],
      expected: [1, 2, 3],
    },
  ])(`$label → solves correctly`, ({ mat, rhs, expected }) => {
    const result = solve_linear_system(mat, rhs)
    if (!result) throw new Error(`expected non-null solution`)
    for (let idx = 0; idx < expected.length; idx++) {
      expect(result[idx]).toBeCloseTo(expected[idx], 6)
    }
  })

  test(`4x4 general: Ax=b round-trip`, () => {
    const mat = [[2, 1, -1, 0], [1, 3, 0, -1], [-1, 0, 2, 1], [0, -1, 1, 3]]
    const rhs = [1, 2, 3, 4]
    const result = solve_linear_system(mat, rhs)
    if (!result) throw new Error(`expected non-null solution`)
    for (let row = 0; row < 4; row++) {
      const val = mat[row].reduce((s, v, col) => s + v * result[col], 0)
      expect(val).toBeCloseTo(rhs[row], 6)
    }
  })

  test.each([
    { mat: [[1, 2], [2, 4]], rhs: [1, 2], label: `2x2 singular` },
    { mat: [[1, 2, 3], [4, 5, 6], [7, 8, 9]], rhs: [1, 2, 3], label: `3x3 singular` },
    { mat: [] as number[][], rhs: [] as number[], label: `empty` },
    { mat: [[1, 2], [3, 4]], rhs: [1], label: `mismatched dims` },
  ])(`$label → returns null`, ({ mat, rhs }) => {
    expect(solve_linear_system(mat, rhs)).toBeNull()
  })
})

// === convex_hull_2d ===

describe(`convex_hull_2d`, () => {
  test.each([
    { pts: [[0, 0], [1, 0], [0, 1]], n: 3, label: `triangle` },
    { pts: [[0, 0], [1, 0], [1, 1], [0, 1]], n: 4, label: `square` },
    { pts: [[0, 0], [2, 0], [2, 2], [0, 2], [1, 1]], n: 4, label: `square + interior` },
    { pts: [[0, 0], [1, 1], [2, 2], [3, 3]], n: 2, label: `collinear` },
    { pts: [[1, 2]], n: 1, label: `single point` },
    { pts: [[1, 2], [3, 4]], n: 2, label: `two points` },
  ] as { pts: Vec2[]; n: number; label: string }[])(
    `$label → $n hull vertices`,
    ({ pts, n }) => {
      expect(convex_hull_2d(pts).length).toBe(n)
    },
  )

  test(`hull area is correct for unit square`, () => {
    const hull = convex_hull_2d([[0, 0], [1, 0], [1, 1], [0, 1]])
    let area = 0
    for (let idx = 0; idx < hull.length; idx++) {
      const [x0, y0] = hull[idx]
      const [x1, y1] = hull[(idx + 1) % hull.length]
      area += x0 * y1 - x1 * y0
    }
    expect(Math.abs(area / 2)).toBeCloseTo(1.0, 8)
  })
})

// === simple_pca ===

describe(`simple_pca`, () => {
  test(`matches pymatgen output`, () => {
    const points_3d = [
      [-25.0, -6.5961471, -7.11535414],
      [-25.0, -6.74159386, -6.96990738],
      [-4.07706195, -6.74159386, -6.96990738],
      [-3.93161519, -6.5961471, -7.11535414],
    ]
    const expected_2d = [
      [10.49782722, 0.10320265],
      [10.4978342, -0.10249014],
      [-10.42510384, -0.10320018],
      [-10.57055758, 0.10248767],
    ]
    const { scores } = simple_pca(points_3d, 2)
    for (let idx = 0; idx < expected_2d.length; idx++) {
      for (let jdx = 0; jdx < 2; jdx++) {
        expect(Math.abs(scores[idx][jdx])).toBeCloseTo(Math.abs(expected_2d[idx][jdx]), 3)
      }
    }
  })

  test(`projections are zero-mean`, () => {
    const data = [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]]
    const { scores } = simple_pca(data, 2)
    for (let col = 0; col < 2; col++) {
      const mean = scores.reduce((s, row) => s + row[col], 0) / scores.length
      expect(mean).toBeCloseTo(0, 8)
    }
  })

  test(`empty data returns empty`, () => {
    const { scores, eigenvectors } = simple_pca([], 2)
    expect(scores).toEqual([])
    expect(eigenvectors).toEqual([])
  })

  test(`eigenvectors are unit length`, () => {
    const data = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1]]
    const { eigenvectors } = simple_pca(data, 2)
    for (const ev of eigenvectors) {
      const norm = Math.hypot(...ev)
      expect(norm).toBeCloseTo(1.0, 6)
    }
  })

  test(`eigenvectors are orthogonal`, () => {
    const data = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1]]
    const { eigenvectors } = simple_pca(data, 2)
    if (eigenvectors.length >= 2) {
      const dot = eigenvectors[0].reduce((s, v, idx) => s + v * eigenvectors[1][idx], 0)
      expect(Math.abs(dot)).toBeLessThan(1e-6)
    }
  })
})

// === orthonormal_2d ===

describe(`orthonormal_2d`, () => {
  test.each([
    // perp = [-dy, dx] normalized
    { pts: [[1, 1], [2, 2]], expected: [-0.70710678, 0.70710678], label: `45°` },
    { pts: [[-2, -5], [-4, 6]], expected: [-0.98386991, -0.17888544], label: `steep` },
    { pts: [[0, 0], [3, 4]], expected: [-0.8, 0.6], label: `diagonal` },
    { pts: [[0, 5], [10, 5]], expected: [0, 1], label: `horizontal` },
    { pts: [[5, 0], [5, 10]], expected: [-1, 0], label: `vertical` },
  ])(`$label: correct value, unit length, perpendicular`, ({ pts, expected }) => {
    const vec = orthonormal_2d(pts)
    // exact value
    expect(vec[0]).toBeCloseTo(expected[0], 5)
    expect(vec[1]).toBeCloseTo(expected[1], 5)
    // unit length
    expect(Math.hypot(vec[0], vec[1])).toBeCloseTo(1.0, 8)
    // perpendicular to line direction (dot product = 0)
    const dx = pts[1][0] - pts[0][0]
    const dy = pts[1][1] - pts[0][1]
    expect(Math.abs(vec[0] * dx + vec[1] * dy)).toBeLessThan(1e-10)
  })

  test(`degenerate (zero-length) line returns safe default [0, 1]`, () => {
    expect(orthonormal_2d([[3, 7], [3, 7]])).toEqual([0, 1])
  })
})

// === polygon_centroid ===

describe(`polygon_centroid`, () => {
  test(`unit square centroid is (0.5, 0.5)`, () => {
    const c = polygon_centroid([[0, 0], [1, 0], [1, 1], [0, 1]])
    expect(c[0]).toBeCloseTo(0.5, 8)
    expect(c[1]).toBeCloseTo(0.5, 8)
  })

  test(`equilateral triangle centroid`, () => {
    const c = polygon_centroid([[0, 0], [1, 0], [0.5, Math.sqrt(3) / 2]])
    expect(c[0]).toBeCloseTo(0.5, 6)
    expect(c[1]).toBeCloseTo(Math.sqrt(3) / 6, 6)
  })

  test(`single point returns that point`, () => {
    expect(polygon_centroid([[7, 3]])).toEqual([7, 3])
  })

  test(`two points returns midpoint`, () => {
    const c = polygon_centroid([[0, 0], [4, 6]])
    expect(c[0]).toBeCloseTo(2, 8)
    expect(c[1]).toBeCloseTo(3, 8)
  })

  test(`empty returns origin`, () => {
    expect(polygon_centroid([])).toEqual([0, 0])
  })
})

// === config.elements projection and subsystem ===

describe(`config.elements projection vs subsystem`, () => {
  test(`binary elements on ternary data triggers projection (includes Li phases)`, () => {
    const result = compute_chempot_diagram(entries, {
      elements: [`Fe`, `O`],
      default_min_limit: -25,
      formal_chempots: false,
    })
    expect(result.elements).toEqual([`Fe`, `O`])
    // Projection mode: should include phases with Li projected onto Fe-O axes
    const formulas = Object.keys(result.domains)
    expect(formulas).toContain(`Fe`)
    expect(formulas).toContain(`O`)
    // Li-containing phases should appear in projection but not in subsystem
    expect(formulas.length).toBeGreaterThan(Object.keys(cpd_binary.domains).length)
  })

  test(`standalone binary data produces subsystem (no projection)`, () => {
    // binary_entries only contain Fe and O → no projection triggered
    const result = compute_chempot_diagram(binary_entries, {
      elements: [`Fe`, `O`],
      default_min_limit: -25,
      formal_chempots: false,
    })
    const formulas = Object.keys(result.domains).sort()
    const expected = Object.keys(cpd_binary.domains).sort()
    expect(formulas).toEqual(expected)
  })

  test(`ternary elements on ternary data is subsystem (no projection)`, () => {
    // 3 elements on 3-element data → no projection
    const result = compute_chempot_diagram(entries, {
      elements: [`Fe`, `Li`, `O`],
      default_min_limit: -25,
      formal_chempots: false,
    })
    expect(result.elements).toEqual([`Fe`, `Li`, `O`])
    // Same domain count as cpd_ternary (computed without config.elements)
    expect(Object.keys(result.domains).length).toBe(
      Object.keys(cpd_ternary.domains).length,
    )
  })

  // === Stability: configuration sensitivity ===

  describe(`configuration sensitivity`, () => {
    test(`default_min_limit does not affect interior vertices`, () => {
      const tight = compute_chempot_diagram(entries, {
        default_min_limit: -15,
        formal_chempots: false,
      })
      const wide = compute_chempot_diagram(entries, {
        default_min_limit: -50,
        formal_chempots: false,
      })
      // Interior vertices (not touching any boundary limit) must be identical
      // regardless of default_min_limit. Filter to only vertices far from both limits.
      const is_interior = (pt: number[], min_lim: number) =>
        pt.every((val) => Math.abs(val - min_lim) > 1 && Math.abs(val) > 1)

      const feo_tight_interior = dedup_vertices(tight.domains[`FeO`] ?? [])
        .filter((pt) => is_interior(pt, -15))
      const feo_wide_interior = dedup_vertices(wide.domains[`FeO`] ?? [])
        .filter((pt) => is_interior(pt, -50))

      expect(feo_tight_interior.length).toBe(feo_wide_interior.length)
      const sorted_t = sort_rows(feo_tight_interior)
      const sorted_w = sort_rows(feo_wide_interior)
      for (let idx = 0; idx < sorted_t.length; idx++) {
        for (let jdx = 0; jdx < sorted_t[idx].length; jdx++) {
          expect(sorted_t[idx][jdx]).toBeCloseTo(sorted_w[idx][jdx], 3)
        }
      }
    })

    test(`formal vs absolute produces same number of domains`, () => {
      const n_absolute = Object.keys(cpd_ternary.domains).length
      const n_formal = Object.keys(cpd_ternary_formal.domains).length
      expect(n_formal).toBe(n_absolute)
    })

    test(`formal vs absolute produces same formulas`, () => {
      const formulas_abs = Object.keys(cpd_ternary.domains).sort()
      const formulas_formal = Object.keys(cpd_ternary_formal.domains).sort()
      expect(formulas_formal).toEqual(formulas_abs)
    })
  })
})

// === YTOS (Y-Ti-O-S) quaternary system tests ===
// Uses real data from doped: github.com/SMTG-Bham/doped/blob/main/examples/YTOS/ytos_phase_diagram.json

describe(`YTOS quaternary system (projection mode)`, () => {
  // 3-element views of 4-element data → triggers projection mode
  const ytos_y_ti_o = compute_chempot_diagram(ytos_entries, {
    elements: [`O`, `Ti`, `Y`],
    default_min_limit: -25,
    formal_chempots: true,
  })

  const ytos_ti_o_s = compute_chempot_diagram(ytos_entries, {
    elements: [`O`, `S`, `Ti`],
    default_min_limit: -25,
    formal_chempots: true,
  })

  test(`Y-Ti-O projection has 3 display elements`, () => {
    expect(ytos_y_ti_o.elements).toEqual([`O`, `Ti`, `Y`])
  })

  test(`Ti-O-S projection has 3 display elements`, () => {
    expect(ytos_ti_o_s.elements).toEqual([`O`, `S`, `Ti`])
  })

  test(`Y-Ti-O projection contains expected phases`, () => {
    const formulas = Object.keys(ytos_y_ti_o.domains)
    expect(formulas).toContain(`O`)
    expect(formulas).toContain(`Ti`)
    expect(formulas).toContain(`Y`)
    expect(formulas).toContain(`O3Y2`) // Y2O3
    expect(formulas).toContain(`O2Ti`) // TiO2
  })

  test(`projection includes cross-system phases (S-containing in O-Ti-Y view)`, () => {
    const formulas = Object.keys(ytos_y_ti_o.domains)
    // S-containing phases should appear because they have non-zero O/Ti/Y fractions
    // and their domains in 4D project non-trivially onto O-Ti-Y axes
    expect(formulas.length).toBeGreaterThan(10) // more than pure O-Ti-Y subsystem
  })

  test(`Ti-O-S projection contains key phases`, () => {
    const formulas = Object.keys(ytos_ti_o_s.domains)
    expect(formulas).toContain(`O2Ti`) // TiO2
    expect(formulas).toContain(`S`) // elemental S
    expect(formulas).toContain(`Ti`) // elemental Ti
  })

  test(`projected vertices have 3 columns`, () => {
    for (const pts of Object.values(ytos_y_ti_o.domains)) {
      for (const pt of pts) {
        expect(pt.length).toBe(3)
      }
    }
  })

  test(`projected lims have 3 entries`, () => {
    expect(ytos_y_ti_o.lims.length).toBe(3)
    expect(ytos_ti_o_s.lims.length).toBe(3)
  })

  test(`formal chempots are non-positive in projected coordinates`, () => {
    for (const pts of Object.values(ytos_y_ti_o.domains)) {
      for (const pt of pts) {
        for (const val of pt) {
          expect(val).toBeLessThanOrEqual(1e-4)
        }
      }
    }
  })

  test(`projected vertices lie within display-axis limits`, () => {
    for (const pts of Object.values(ytos_y_ti_o.domains)) {
      for (const pt of pts) {
        for (let dim = 0; dim < 3; dim++) {
          expect(pt[dim]).toBeGreaterThanOrEqual(ytos_y_ti_o.lims[dim][0] - 1e-4)
          expect(pt[dim]).toBeLessThanOrEqual(ytos_y_ti_o.lims[dim][1] + 1e-4)
        }
      }
    }
  })

  test(`elemental domains touch mu=0 in projection`, () => {
    for (const el of ytos_y_ti_o.elements) {
      const domain = dedup_vertices(ytos_y_ti_o.domains[el])
      const el_idx = ytos_y_ti_o.elements.indexOf(el)
      const has_zero = domain.some((pt) => Math.abs(pt[el_idx]) < 0.01)
      expect(has_zero, `${el} should touch mu=0`).toBe(true)
    }
  })

  test(`Y2Ti2O7 domain exists in Y-Ti-O projection`, () => {
    const key = `O7Ti2Y2`
    expect(ytos_y_ti_o.domains[key], `Domain for ${key} (Y2Ti2O7)`).toBeDefined()
    const domain = dedup_vertices(ytos_y_ti_o.domains[key])
    expect(domain.length).toBeGreaterThanOrEqual(3)
  })

  test(`projection produces more domains than subsystem filtering`, () => {
    // Filter to only O-Ti-Y entries (subsystem mode)
    const oty_only = ytos_entries.filter((entry) => {
      const els = Object.entries(entry.composition)
        .filter(([, amt]) => amt > 0).map(([el]) => el)
      return els.every((el) => [`O`, `Ti`, `Y`].includes(el))
    })
    const subsystem = compute_chempot_diagram(oty_only, {
      elements: [`O`, `Ti`, `Y`],
      default_min_limit: -25,
      formal_chempots: true,
    })
    // Projection should have strictly more domains (includes S-containing phases)
    expect(Object.keys(ytos_y_ti_o.domains).length)
      .toBeGreaterThan(Object.keys(subsystem.domains).length)
  })
})

// === build_axis_ranges ===

describe(`build_axis_ranges`, () => {
  test(`computes min/max per axis`, () => {
    const points = [[-3, 1], [2, 5], [0, -4]]
    const result = build_axis_ranges(points, [`X`, `Y`])
    expect(result).toEqual([
      { element: `X`, min_val: -3, max_val: 2 },
      { element: `Y`, min_val: -4, max_val: 5 },
    ])
  })

  test(`single point has equal min/max`, () => {
    const result = build_axis_ranges([[7, -2]], [`A`, `B`])
    expect(result[0].min_val).toBe(7)
    expect(result[0].max_val).toBe(7)
    expect(result[1].min_val).toBe(-2)
    expect(result[1].max_val).toBe(-2)
  })

  test(`elements longer than point dimensions produces Infinity`, () => {
    const result = build_axis_ranges([[1, 2]], [`A`, `B`, `C`])
    expect(result.length).toBe(3)
    // axis 2 reads undefined from points → loop finds no finite values
    expect(result[2].min_val).toBe(Infinity)
    expect(result[2].max_val).toBe(-Infinity)
  })
})

// === dedup_points ===

describe(`dedup_points`, () => {
  test.each([
    {
      pts: [[1, 2], [3, 4], [1, 2]],
      tol: 1e-4,
      n_unique: 2,
      indices: [0, 1],
      label: `exact duplicates`,
    },
    {
      pts: [[0, 0], [0.00005, 0.00005]],
      tol: 1e-4,
      n_unique: 1,
      indices: [0],
      label: `within tolerance`,
    },
    {
      pts: [[0, 0], [0.001, 0.001]],
      tol: 1e-4,
      n_unique: 2,
      indices: [0, 1],
      label: `beyond tolerance`,
    },
    {
      pts: [] as number[][],
      tol: 1e-4,
      n_unique: 0,
      indices: [] as number[],
      label: `empty`,
    },
    { pts: [[5, 6, 7]], tol: 1e-4, n_unique: 1, indices: [0], label: `single point` },
    {
      pts: [[0, 0], [1e-7, 1e-7], [0.001, 0.001]],
      tol: 1e-6,
      n_unique: 2,
      indices: [0, 2],
      label: `sub-tolerance pair merged, distant point kept`,
    },
    {
      pts: [[1, 2], [3, 4], [1, 2], [5, 6], [3, 4]],
      tol: 1e-4,
      n_unique: 3,
      indices: [0, 1, 3],
      label: `multiple duplicates scattered`,
    },
  ])(`$label → $n_unique unique`, ({ pts, tol, n_unique, indices }) => {
    const result = dedup_points(pts, tol)
    expect(result.unique.length).toBe(n_unique)
    expect(result.orig_indices).toEqual(indices)
    // unique points should match the points at orig_indices
    for (let idx = 0; idx < result.unique.length; idx++) {
      expect(result.unique[idx]).toEqual(pts[result.orig_indices[idx]])
    }
  })
})

// === get_energy_per_atom ===

describe(`get_energy_per_atom`, () => {
  test(`returns energy_per_atom when present`, () => {
    const entry = make_entry({ Fe: 2 }, -3.0)
    expect(get_energy_per_atom(entry)).toBe(-3.0)
  })

  test(`computes from energy / atoms when energy_per_atom missing`, () => {
    const entry: PhaseData = {
      composition: { Fe: 2, O: 1 },
      energy: -9.0,
    }
    expect(get_energy_per_atom(entry)).toBeCloseTo(-3.0, 8)
  })

  test(`throws for zero atom count`, () => {
    const entry = { composition: {}, energy: -1.0 } as PhaseData
    expect(() => get_energy_per_atom(entry)).toThrow(`non-positive`)
  })
})

// === formula_key_from_composition ===

describe(`formula_key_from_composition`, () => {
  test.each([
    { comp: { Fe: 1 }, expected: `Fe`, label: `single element` },
    { comp: { O: 3, Li: 2, Fe: 1 }, expected: `FeLi2O3`, label: `alphabetical sorting` },
    { comp: { Fe: 2, O: 4 }, expected: `FeO2`, label: `reduces to lowest terms` },
    { comp: { Fe: 1, O: 0 }, expected: `Fe`, label: `ignores zero amounts` },
  ])(`$label → $expected`, ({ comp, expected }) => {
    expect(formula_key_from_composition(comp as Record<string, number>)).toBe(expected)
  })
})

// === get_3d_domain_simplexes_and_ann_loc ===

// Helper: verify all edge indices are in [0, n_pts) and distinct within each edge
function assert_valid_edges(
  result: { simplex_indices: number[][] },
  n_pts: number,
): void {
  for (const [idx_a, idx_b] of result.simplex_indices) {
    expect(idx_a).toBeGreaterThanOrEqual(0)
    expect(idx_a).toBeLessThan(n_pts)
    expect(idx_b).toBeGreaterThanOrEqual(0)
    expect(idx_b).toBeLessThan(n_pts)
    expect(idx_a).not.toBe(idx_b)
  }
}

describe(`get_3d_domain_simplexes_and_ann_loc`, () => {
  test.each([
    { pts: [] as number[][], n_edges: 0, ann_loc: [0, 0, 0], label: `empty` },
    { pts: [[1, 2, 3]], n_edges: 0, ann_loc: [1, 2, 3], label: `single point` },
    {
      pts: [[5, 5, 5], [5, 5, 5], [5, 5, 5]],
      n_edges: 0,
      ann_loc: [5, 5, 5],
      label: `all duplicates`,
    },
    {
      pts: [[0, 0, 0], [10, 0, 0], [5, 10, 0]],
      n_edges: 3,
      ann_loc: null,
      label: `triangle`,
    },
    {
      pts: [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]],
      n_edges: 4,
      ann_loc: null,
      label: `square`,
    },
    {
      pts: [[0, 0, 0], [10, 0, 0], [12, 8, 0], [5, 14, 0], [-2, 8, 0]],
      n_edges: 5,
      ann_loc: null,
      label: `pentagon`,
    },
  ])(`$label → $n_edges edges`, ({ pts, n_edges, ann_loc }) => {
    const result = get_3d_domain_simplexes_and_ann_loc(pts)
    expect(result.simplex_indices.length).toBe(n_edges)
    if (ann_loc) expect(result.ann_loc).toEqual(ann_loc)
    if (n_edges > 0) assert_valid_edges(result, pts.length)
  })

  test(`two points returns midpoint ann_loc`, () => {
    const result = get_3d_domain_simplexes_and_ann_loc([[0, 0, 0], [4, 6, 2]])
    expect(result.simplex_indices).toEqual([[0, 1]])
    expect(result.ann_loc[0]).toBeCloseTo(2, 6)
    expect(result.ann_loc[1]).toBeCloseTo(3, 6)
    expect(result.ann_loc[2]).toBeCloseTo(1, 6)
  })

  test(`dedup maps indices to first occurrences`, () => {
    // Dups at 3,4 → 3 unique points → 3 triangle edges referencing indices <= 2
    const pts = [[0, 0, 0], [10, 0, 0], [5, 10, 0], [0, 0, 0], [10, 0, 0]]
    const result = get_3d_domain_simplexes_and_ann_loc(pts)
    expect(result.simplex_indices.length).toBe(3)
    expect(result.simplex_indices.flat().every((idx) => idx <= 2)).toBe(true)
    assert_valid_edges(result, pts.length)
  })

  test(`dup at non-zero position maps to correct original indices`, () => {
    // Dup at idx 1 → orig_indices = [0, 2, 3], edges must skip index 1
    const pts = [[5, 10, 0], [5, 10, 0], [0, 0, 0], [10, 0, 0]]
    const result = get_3d_domain_simplexes_and_ann_loc(pts)
    expect(new Set(result.simplex_indices.flat())).toEqual(new Set([0, 2, 3]))
  })

  test(`nearly collinear 3D points produce valid edges`, () => {
    const pts = [[0, 0, 0], [10, 0.001, 0], [5, 0.0005, 0], [20, 0.002, 0]]
    const result = get_3d_domain_simplexes_and_ann_loc(pts)
    expect(result.simplex_indices.length).toBeGreaterThanOrEqual(1)
    assert_valid_edges(result, pts.length)
  })
})

// === Domain edge indices from real diagram data ===

describe.each([
  { label: `ternary (Fe-Li-O)`, domains: cpd_ternary.domains },
  {
    label: `YTOS projection (O-Ti-Y)`,
    domains: compute_chempot_diagram(ytos_entries, {
      elements: [`O`, `Ti`, `Y`],
      default_min_limit: -25,
      formal_chempots: true,
    }).domains,
  },
])(`domain edge indices: $label`, ({ domains }) => {
  test(`all simplex indices reference valid points`, () => {
    for (const [formula, pts] of Object.entries(domains)) {
      const result = get_3d_domain_simplexes_and_ann_loc(pts)
      for (const [idx_a, idx_b] of result.simplex_indices) {
        expect(idx_a, `${formula}: idx_a=${idx_a} >= ${pts.length}`).toBeLessThan(
          pts.length,
        )
        expect(idx_b, `${formula}: idx_b=${idx_b} >= ${pts.length}`).toBeLessThan(
          pts.length,
        )
      }
    }
  })
})

// === compute_domains (vertex enumeration) ===

describe(`compute_domains`, () => {
  const ab_refs: Record<string, PhaseData> = {
    A: make_entry({ A: 1 }, -2.0),
    B: make_entry({ B: 1 }, -3.0),
  }
  const border = build_border_hyperplanes([[-20, 0], [-20, 0]])

  function make_ab_domains(ab_energy_per_atom: number) {
    const { hyperplanes, hyperplane_entries } = build_hyperplanes(
      [ab_refs.A, ab_refs.B, make_entry({ A: 1, B: 1 }, ab_energy_per_atom)],
      ab_refs,
      [`A`, `B`],
    )
    return {
      domains: compute_domains(hyperplanes, border, hyperplane_entries, 2),
      hyperplanes,
    }
  }

  test(`stable compound → 3 domains with valid vertices`, () => {
    const { domains, hyperplanes } = make_ab_domains(-6.0)
    expect(Object.keys(domains).sort()).toEqual([`A`, `AB`, `B`])
    for (const pts of Object.values(domains)) {
      expect(pts.length).toBeGreaterThanOrEqual(2)
    }
    // All vertices satisfy all halfspace constraints
    const all_hs = [...hyperplanes, ...border]
    for (const [formula, pts] of Object.entries(domains)) {
      for (const pt of pts) {
        for (const hs of all_hs) {
          const val = hs[0] * pt[0] + hs[1] * pt[1] + hs[2]
          expect(val, `Vertex of ${formula} violates halfspace`).toBeLessThanOrEqual(1e-4)
        }
      }
    }
  })

  test(`unstable compound → no domain for AB`, () => {
    // AB with E_per_atom = -2.0 is above hull → no stability domain
    const { domains } = make_ab_domains(-2.0)
    expect(domains[`AB`]).toBeUndefined()
  })
})

// === compute_chempot_diagram edge cases ===

describe(`compute_chempot_diagram edge cases`, () => {
  test(`custom limits restrict domain vertices`, () => {
    const result = compute_chempot_diagram([
      make_entry({ A: 1 }, -2.0),
      make_entry({ B: 1 }, -3.0),
      make_entry({ A: 1, B: 1 }, -6.0),
    ], { default_min_limit: -20, limits: { A: [-5, 0] }, formal_chempots: false })
    for (const pts of Object.values(result.domains)) {
      for (const pt of pts) {
        expect(pt[0]).toBeGreaterThanOrEqual(-5 - 1e-4)
      }
    }
  })

  test(`config.elements reorders axes`, () => {
    const reordered = compute_chempot_diagram(entries, {
      elements: [`O`, `Fe`, `Li`],
      default_min_limit: -25,
      formal_chempots: false,
    })
    expect(reordered.elements).toEqual([`O`, `Fe`, `Li`])
    // Same domains as default order, just reordered columns
    expect(Object.keys(reordered.domains).sort()).toEqual(
      Object.keys(cpd_ternary.domains).sort(),
    )
    // Verify axes actually swapped: Fe domain's O-axis range (col 0 in reordered)
    // should match its col 2 range in default [Fe,Li,O] order
    const fe_reordered = dedup_vertices(reordered.domains[`Fe`])
    const fe_default = dedup_vertices(cpd_ternary.domains[`Fe`])
    const re_o_vals = fe_reordered.map((pt) => pt[0]).sort()
    const def_o_vals = fe_default.map((pt) => pt[2]).sort() // O is axis 2 in default
    expect(re_o_vals.length).toBe(def_o_vals.length)
    for (let idx = 0; idx < re_o_vals.length; idx++) {
      expect(re_o_vals[idx]).toBeCloseTo(def_o_vals[idx], 4)
    }
  })

  test(`config.elements with unknown element throws`, () => {
    expect(() =>
      compute_chempot_diagram([
        make_entry({ A: 1 }, -1.0),
        make_entry({ B: 1 }, -2.0),
      ], { elements: [`A`, `C`] })
    ).toThrow(`Missing elemental reference`)
  })

  test(`identical polymorphs keep one domain`, () => {
    const result = compute_chempot_diagram([
      make_entry({ A: 1 }, -2.0),
      make_entry({ A: 1 }, -2.0),
      make_entry({ B: 1 }, -3.0),
    ], { default_min_limit: -10, formal_chempots: false })
    expect(Object.keys(result.domains).sort()).toEqual([`A`, `B`])
  })

  test.each([
    { elements: [`Ti`, `S`, `Y`], n_axes: 3, label: `3-axis projection` },
    { elements: [`Ti`, `Y`], n_axes: 2, label: `2-axis projection` },
  ])(`4-element YTOS → $label`, ({ elements, n_axes }) => {
    const result = compute_chempot_diagram(ytos_entries, {
      elements,
      default_min_limit: -25,
      formal_chempots: true,
    })
    expect(result.elements).toEqual(elements)
    expect(result.lims.length).toBe(n_axes)
    for (const pts of Object.values(result.domains)) {
      for (const pt of pts) expect(pt.length).toBe(n_axes)
    }
  })

  test(`non-sequential 4D projection preserves domain dimensionality`, () => {
    const projected = compute_chempot_diagram(ytos_entries, {
      elements: [`Y`, `Ti`, `S`],
      default_min_limit: -25,
      formal_chempots: true,
    })
    expect(projected.elements).toEqual([`Y`, `Ti`, `S`])
    const domain_keys = Object.keys(projected.domains)
    expect(domain_keys.length).toBeGreaterThan(0)
    for (const pts of Object.values(projected.domains)) {
      for (const pt of pts) {
        expect(pt.length).toBe(3)
        for (const coord of pt) expect(Number.isFinite(coord)).toBe(true)
      }
    }
  })

  test(`different projection triplets keep stable formula set overlap`, () => {
    const proj_tsy = compute_chempot_diagram(ytos_entries, {
      elements: [`Ti`, `S`, `Y`],
      default_min_limit: -25,
      formal_chempots: true,
    })
    const proj_tyo = compute_chempot_diagram(ytos_entries, {
      elements: [`Ti`, `Y`, `O`],
      default_min_limit: -25,
      formal_chempots: true,
    })
    const tsy_formulas = new Set(Object.keys(proj_tsy.domains))
    const tyo_formulas = new Set(Object.keys(proj_tyo.domains))
    const overlap = [...tsy_formulas].filter((formula) => tyo_formulas.has(formula))
    expect(overlap.length).toBeGreaterThan(0)
    expect(overlap).toContain(`Ti`)
    expect(overlap).toContain(`Y`)
  })
})

// === Formation energy computation ===
// Tests the math used by ChemPotDiagram3D.compute_e_form:
// e_form = energy_per_atom - sum(fraction_i * ref_energy_per_atom_i)

describe(`formation energy from elemental refs`, () => {
  // Reproduce the compute_e_form logic using exported helpers
  function compute_e_form(
    entry: PhaseData,
    el_refs: Record<string, PhaseData>,
  ): number {
    const atoms = Object.values(entry.composition).reduce((s, v) => s + v, 0)
    const epa = get_energy_per_atom(entry)
    let ref_energy = 0
    for (const [el, amt] of Object.entries(entry.composition)) {
      if (amt <= 0) continue
      ref_energy += (amt / atoms) * get_energy_per_atom(el_refs[el])
    }
    return epa - ref_energy
  }

  const el_refs: Record<string, PhaseData> = {
    A: make_entry({ A: 1 }, -2.0),
    B: make_entry({ B: 1 }, -3.0),
  }

  test.each([
    { comp: { A: 1 }, epa: -2.0, expected: 0, label: `element A` },
    { comp: { B: 1 }, epa: -3.0, expected: 0, label: `element B` },
    // AB: frac_A=0.5, frac_B=0.5, ref = 0.5*(-2) + 0.5*(-3) = -2.5
    // e_form = -3.5 - (-2.5) = -1.0
    { comp: { A: 1, B: 1 }, epa: -3.5, expected: -1.0, label: `AB stable compound` },
    // A2B: frac_A=2/3, frac_B=1/3, ref = 2/3*(-2) + 1/3*(-3) = -7/3
    // e_form = -3.0 - (-7/3) = -3 + 7/3 = -2/3
    { comp: { A: 2, B: 1 }, epa: -3.0, expected: -2 / 3, label: `A2B compound` },
    // Unstable compound: e_form > 0
    {
      comp: { A: 1, B: 1 },
      epa: -2.0,
      expected: 0.5,
      label: `AB unstable (positive e_form)`,
    },
  ])(`$label → e_form = $expected`, ({ comp, epa, expected }) => {
    const entry = make_entry(comp as Record<string, number>, epa)
    expect(compute_e_form(entry, el_refs)).toBeCloseTo(expected, 8)
  })

  test(`raw_el_refs from get_min_entries_and_el_refs give correct formation energies`, () => {
    const all_entries: PhaseData[] = [
      make_entry({ A: 1 }, -2.0),
      make_entry({ B: 1 }, -3.0),
      make_entry({ A: 1, B: 1 }, -3.5),
    ]
    const { el_refs: raw_refs } = get_min_entries_and_el_refs(all_entries)
    // AB: e_form = -3.5 - (0.5*(-2) + 0.5*(-3)) = -3.5 + 2.5 = -1.0
    const ab_entry = all_entries[2]
    expect(compute_e_form(ab_entry, raw_refs)).toBeCloseTo(-1.0, 8)
    // Elements should be exactly 0
    expect(compute_e_form(all_entries[0], raw_refs)).toBeCloseTo(0, 8)
    expect(compute_e_form(all_entries[1], raw_refs)).toBeCloseTo(0, 8)
  })

  test(`renormalized el_refs (formal_chempots) produce zero-energy refs`, () => {
    const all_entries: PhaseData[] = [
      make_entry({ A: 1 }, -2.0),
      make_entry({ B: 1 }, -3.0),
    ]
    const { el_refs: raw_refs } = get_min_entries_and_el_refs(all_entries)
    const renormed = renormalize_entries(all_entries, raw_refs, [`A`, `B`])
    const { el_refs: renorm_refs } = get_min_entries_and_el_refs(renormed)
    // Renormalized refs have epa=0, so compute_e_form degenerates to just epa
    expect(get_energy_per_atom(renorm_refs[`A`])).toBeCloseTo(0, 8)
    expect(get_energy_per_atom(renorm_refs[`B`])).toBeCloseTo(0, 8)
    // Using renormalized refs, e_form equals raw epa (not true formation energy!)
    const ab = make_entry({ A: 1, B: 1 }, -3.5)
    expect(compute_e_form(ab, renorm_refs)).toBeCloseTo(-3.5, 8)
    // This confirms raw_el_refs (not diagram_data.el_refs) must be used
  })

  test(`formation energy from real data: Fe-Li-O system`, () => {
    const { el_refs: raw_refs } = get_min_entries_and_el_refs(entries)
    // All elemental refs should have zero formation energy
    for (const [el, ref] of Object.entries(raw_refs)) {
      expect(compute_e_form(ref, raw_refs), `${el} should have e_form=0`).toBeCloseTo(
        0,
        8,
      )
    }
    // Find a compound entry (Fe2O3) and verify formation energy is negative (stable)
    const fe2o3 = entries.find(
      (entry) => formula_key_from_composition(entry.composition) === `Fe2O3`,
    )
    if (fe2o3) {
      const e_form = compute_e_form(fe2o3, raw_refs)
      expect(e_form).toBeLessThan(0)
      // Fe2O3 formation energy should be in a reasonable range (-3 to 0 eV/atom)
      expect(e_form).toBeGreaterThan(-3)
    }
  })
})
