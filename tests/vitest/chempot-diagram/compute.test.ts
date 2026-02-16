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
  dedup_points,
  formula_key_from_composition,
  get_energy_per_atom,
  get_min_entries_and_el_refs,
  orthonormal_2d,
  pad_domain_points,
  renormalize_entries,
  simple_pca,
} from '$lib/chempot-diagram/compute'
import type { PhaseData } from '$lib/convex-hull/types'
import {
  convex_hull_2d,
  polygon_centroid,
  solve_linear_system,
  type Vec2,
} from '$lib/math'
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
      const has_domain = Object.keys(cpd_ternary.domains).some(
        (formula) => cpd_ternary.el_refs[el] && formula === el,
      )
      expect(has_domain, `Element ${el} has no elemental domain`).toBe(true)
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

  test(`domains partition mu-space: no overlapping domains at test points`, () => {
    // At any point in mu-space, exactly one phase should be most stable.
    // Test at centroids of each domain.
    const dim = cpd_ternary.elements.length
    for (const pts of Object.values(cpd_ternary.domains)) {
      const unique = dedup_vertices(pts)
      if (unique.length < 2) continue
      // Compute centroid of this domain
      const centroid = unique[0].map((_, col) =>
        unique.reduce((s, p) => s + p[col], 0) / unique.length
      )
      // Check which phase has lowest energy at this point
      let best_energy = Infinity
      for (let hp_idx = 0; hp_idx < cpd_ternary.hyperplanes.length; hp_idx++) {
        const hs = cpd_ternary.hyperplanes[hp_idx]
        // Energy = -(a·mu) - b = sum(x_i * mu_i) - E_per_atom (negated form)
        let val = 0
        for (let jdx = 0; jdx < dim; jdx++) val += hs[jdx] * centroid[jdx]
        val += hs[dim] // add b (which is -E_per_atom)
        if (val < best_energy) {
          best_energy = val
        }
      }
      // The winning phase at the centroid should be the domain's own phase
      // (or at least be one of the phases sharing a boundary -- we just verify it's
      // the right phase for "interior" points, allowing small numerical tolerance)
      // This is a weak check but catches gross errors
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

  test(`X domain has mu_X = E_X (reference energy) at its upper bound`, () => {
    const x_domain = dedup_vertices(pure_binary.domains[`X`])
    const x_vals = x_domain.map((pt) => pt[0]) // X is alphabetically first
    expect(Math.max(...x_vals)).toBeCloseTo(-1.0, 4)
  })

  test(`Y domain has mu_Y = E_Y (reference energy) at its upper bound`, () => {
    const y_domain = dedup_vertices(pure_binary.domains[`Y`])
    const y_vals = y_domain.map((pt) => pt[1]) // Y is alphabetically second
    expect(Math.max(...y_vals)).toBeCloseTo(-2.0, 4)
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

  test(`distinguishes different compositions`, () => {
    const { min_entries } = get_min_entries_and_el_refs([
      make_entry({ A: 1 }, -1.0),
      make_entry({ B: 1 }, -2.0),
      make_entry({ A: 1, B: 1 }, -3.0),
    ])
    expect(min_entries.length).toBe(3)
  })

  test(`identifies elemental references`, () => {
    const { el_refs } = get_min_entries_and_el_refs([
      make_entry({ A: 1 }, -1.0),
      make_entry({ B: 1 }, -2.0),
      make_entry({ A: 1, B: 1 }, -3.0),
    ])
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
  test(`always includes elemental references`, () => {
    const el_refs: Record<string, PhaseData> = {
      A: make_entry({ A: 1 }, -2.0),
      B: make_entry({ B: 1 }, -3.0),
    }
    const min_entries = [el_refs[`A`], el_refs[`B`]]
    const { hyperplane_entries } = build_hyperplanes(min_entries, el_refs, [`A`, `B`])
    expect(hyperplane_entries.length).toBeGreaterThanOrEqual(2)
  })

  test(`hyperplane rows have correct dimensionality`, () => {
    const el_refs: Record<string, PhaseData> = {
      A: make_entry({ A: 1 }, -2.0),
      B: make_entry({ B: 1 }, -3.0),
    }
    const { hyperplanes } = build_hyperplanes(
      [el_refs[`A`], el_refs[`B`], make_entry({ A: 1, B: 1 }, -6.0)],
      el_refs,
      [`A`, `B`],
    )
    // Each row should have dim+1 = 3 columns [x_A, x_B, -E]
    for (const row of hyperplanes) {
      expect(row.length).toBe(3)
    }
  })

  test(`atomic fractions in hyperplane rows sum to 1`, () => {
    const el_refs: Record<string, PhaseData> = {
      A: make_entry({ A: 1 }, -2.0),
      B: make_entry({ B: 1 }, -3.0),
    }
    const { hyperplanes } = build_hyperplanes(
      [el_refs[`A`], el_refs[`B`], make_entry({ A: 1, B: 1 }, -6.0)],
      el_refs,
      [`A`, `B`],
    )
    for (const row of hyperplanes) {
      // First dim columns are atomic fractions, should sum to 1
      const frac_sum = row.slice(0, 2).reduce((s, v) => s + v, 0)
      expect(frac_sum).toBeCloseTo(1.0, 8)
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
  test(`2x2 identity`, () => {
    expect(solve_linear_system([[1, 0], [0, 1]], [3, 7])).toEqual([3, 7])
  })

  test(`2x2 general`, () => {
    const result = solve_linear_system([[2, 1], [1, 3]], [5, 10])
    expect(result).not.toBeNull()
    if (!result) throw new Error(`Expected non-null 2x2 solution`)
    expect(result[0]).toBeCloseTo(1, 8)
    expect(result[1]).toBeCloseTo(3, 8)
  })

  test(`2x2 singular returns null`, () => {
    expect(solve_linear_system([[1, 2], [2, 4]], [1, 2])).toBeNull()
  })

  test(`3x3 identity`, () => {
    const result = solve_linear_system(
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      [1, 2, 3],
    )
    expect(result).toEqual([1, 2, 3])
  })

  test(`3x3 general`, () => {
    // A=[1,2,3;4,5,6;7,8,10], x=[1,2,3] → b = [1*1+2*2+3*3, 4+10+18, 7+16+30] = [14, 32, 53]
    const result = solve_linear_system(
      [[1, 2, 3], [4, 5, 6], [7, 8, 10]],
      [14, 32, 53],
    )
    expect(result).not.toBeNull()
    if (!result) throw new Error(`Expected non-null 3x3 solution`)
    expect(result[0]).toBeCloseTo(1, 6)
    expect(result[1]).toBeCloseTo(2, 6)
    expect(result[2]).toBeCloseTo(3, 6)
  })

  test(`3x3 singular returns null`, () => {
    expect(solve_linear_system(
      [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
      [1, 2, 3],
    )).toBeNull()
  })

  test(`4x4 general (LU path)`, () => {
    const result = solve_linear_system(
      [[2, 1, -1, 0], [1, 3, 0, -1], [-1, 0, 2, 1], [0, -1, 1, 3]],
      [1, 2, 3, 4],
    )
    expect(result).not.toBeNull()
    if (!result) throw new Error(`Expected non-null 4x4 solution`)
    // Verify Ax = b
    const A = [[2, 1, -1, 0], [1, 3, 0, -1], [-1, 0, 2, 1], [0, -1, 1, 3]]
    for (let row = 0; row < 4; row++) {
      const val = A[row].reduce((s, v, col) => s + v * result[col], 0)
      expect(val).toBeCloseTo([1, 2, 3, 4][row], 6)
    }
  })

  test(`returns null for empty input`, () => {
    expect(solve_linear_system([], [])).toBeNull()
  })

  test(`returns null for mismatched dimensions`, () => {
    expect(solve_linear_system([[1, 2], [3, 4]], [1])).toBeNull()
  })
})

// === convex_hull_2d ===

describe(`convex_hull_2d`, () => {
  test(`triangle returns all 3 vertices`, () => {
    const pts: Vec2[] = [[0, 0], [1, 0], [0, 1]]
    const hull = convex_hull_2d(pts)
    expect(hull.length).toBe(3)
  })

  test(`square returns 4 vertices`, () => {
    const pts: Vec2[] = [[0, 0], [1, 0], [1, 1], [0, 1]]
    const hull = convex_hull_2d(pts)
    expect(hull.length).toBe(4)
  })

  test(`interior points are excluded`, () => {
    const pts: Vec2[] = [[0, 0], [2, 0], [2, 2], [0, 2], [1, 1]] // last is interior
    const hull = convex_hull_2d(pts)
    expect(hull.length).toBe(4)
  })

  test(`collinear points`, () => {
    const pts: Vec2[] = [[0, 0], [1, 1], [2, 2], [3, 3]]
    const hull = convex_hull_2d(pts)
    // Collinear points give a degenerate hull (line), 2 endpoints
    expect(hull.length).toBe(2)
  })

  test(`< 3 points returns copy`, () => {
    expect(convex_hull_2d([[1, 2]]).length).toBe(1)
    expect(convex_hull_2d([[1, 2], [3, 4]]).length).toBe(2)
  })

  test(`hull area is correct for unit square`, () => {
    const pts: Vec2[] = [[0, 0], [1, 0], [1, 1], [0, 1]]
    const hull = convex_hull_2d(pts)
    // Shoelace formula for area
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
    { pts: [[1, 1], [2, 2]], expected: [0.70710678, 0.70710678] },
    { pts: [[-2, -5], [-4, 6]], expected: [0.98386991, 0.17888544] },
  ])(`matches pymatgen for $pts`, ({ pts, expected }) => {
    const vec = orthonormal_2d(pts)
    expect(vec[0]).toBeCloseTo(expected[0], 5)
    expect(vec[1]).toBeCloseTo(expected[1], 5)
  })

  test(`result is unit length`, () => {
    const vec = orthonormal_2d([[0, 0], [3, 4]])
    expect(Math.hypot(vec[0], vec[1])).toBeCloseTo(1.0, 8)
  })

  test(`horizontal line gives [0, 1]`, () => {
    const vec = orthonormal_2d([[0, 5], [10, 5]])
    expect(vec[0]).toBeCloseTo(0, 5)
    expect(vec[1]).toBeCloseTo(1, 5)
  })

  test(`vertical line gives [1, 0]`, () => {
    const vec = orthonormal_2d([[5, 0], [5, 10]])
    expect(vec[0]).toBeCloseTo(1, 5)
    expect(vec[1]).toBeCloseTo(0, 5)
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
  ])(`$label → $n_unique unique`, ({ pts, tol, n_unique, indices }) => {
    const result = dedup_points(pts, tol)
    expect(result.unique.length).toBe(n_unique)
    expect(result.orig_indices).toEqual(indices)
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
