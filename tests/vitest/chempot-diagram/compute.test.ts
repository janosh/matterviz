// Tests ported from pymatgen/tests/analysis/test_chempot_diagram.py, plus extensive
// edge-case, invariant, and physical-limit tests that pymatgen's suite lacks.
//
// Key differences from pymatgen:
// - Element ordering: pymatgen uses atomic number [Li, Fe, O], we use alphabetical [Fe, Li, O]
// - Formula keys: pymatgen uses Hill notation (Li2FeO3), we sort alphabetically (FeLi2O3)
// - O2 reduced formula: pymatgen keeps "O2", our get_reduced_formula reduces {O:6} to {O:1} → "O"

import {
  apply_element_padding,
  bbox_diagonal,
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
  best_form_energy_for_formula,
  get_ternary_combinations,
  get_visible_domain_labels,
  make_nd_cache_key,
  orthonormal_2d,
  pad_domain_points,
  renormalize_entries,
  scale_to_font_range,
  simple_pca,
} from '$lib/chempot-diagram/compute'
import { get_hill_formula } from '$lib/composition/format'
import { filter_entries_at_temperature } from '$lib/convex-hull/helpers'
import type { PhaseData } from '$lib/convex-hull/types'
import type { Vec2 } from '$lib/math'
import { convex_hull_2d, polygon_centroid, solve_linear_system } from '$lib/math'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { load_json } from '../setup'

const test_dir = import.meta.dirname
const entries = load_json<PhaseData[]>(`${test_dir}/pd_entries_test.json.gz`)
const ytos_entries = load_json<PhaseData[]>(`${test_dir}/ytos_entries.json.gz`)

// Filter to Fe-O binary subsystem
const fe_o_elements = new Set([`Fe`, `O`])
const binary_entries = entries.filter((entry) =>
  Object.entries(entry.composition)
    .filter(([, amt]) => amt > 0)
    .every(([el]) => fe_o_elements.has(el)),
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
function make_entry(composition: Record<string, number>, energy_per_atom: number): PhaseData {
  const atoms = Object.values(composition).reduce((sum, count) => sum + count, 0)
  return { composition, energy: energy_per_atom * atoms, energy_per_atom }
}

// Reorder pymatgen [Li, Fe, O] columns to our [Fe, Li, O]
const reorder_cols = (pts: number[][]): number[][] =>
  pts.map(([li, fe, oxygen]) => [fe, li, oxygen])

const sort_rows = (pts: number[][]): number[][] =>
  [...pts]
    .map((row) => row.map((val) => Math.round(val * 1e6) / 1e6))
    .sort((a, b) => {
      for (let idx = 0; idx < a.length; idx++) {
        if (a[idx] !== b[idx]) return a[idx] - b[idx]
      }
      return 0
    })

// Thin wrapper over production dedup_points (keeps just the unique points)
const dedup_vertices = (pts: number[][], tol: number = 1e-4): number[][] =>
  dedup_points(pts, tol).unique

describe(`pymatgen parity: ChemicalPotentialDiagram`, () => {
  test(`diagram metadata matches pymatgen`, () => {
    expect(cpd_binary.elements).toHaveLength(2)
    expect(cpd_ternary.elements).toHaveLength(3)
    expect(cpd_ternary_formal.elements).toHaveLength(3)
    expect(cpd_ternary.elements).toEqual([`Fe`, `Li`, `O`])
    expect(cpd_ternary.lims).toEqual([
      [-25, 0],
      [-25, 0],
      [-25, 0],
    ])
  })

  test(`el_refs (absolute)`, () => {
    expect(cpd_ternary.el_refs.Li.energy).toBeCloseTo(-1.91301487, 5)
    expect(cpd_ternary.el_refs.Fe.energy).toBeCloseTo(-6.5961471, 5)
    expect(cpd_ternary.el_refs.O.energy).toBeCloseTo(-25.54966885, 5)
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
    const lims: Vec2[] = [
      [-25, 0],
      [-25, 0],
      [-25, 0],
    ]
    const border = build_border_hyperplanes(lims)
    for (let idx = 0; idx < desired.length; idx++) {
      for (let jdx = 0; jdx < desired[idx].length; jdx++) {
        expect(border[idx][jdx]).toBeCloseTo(desired[idx][jdx], 5)
      }
    }
  })

  test.each([
    [
      `Fe`,
      [
        [-25.0, -6.596147, -25.0],
        [-25.0, -6.596147, -7.115354],
        [-3.931615, -6.596147, -7.115354],
        [-3.625002, -6.596147, -7.268661],
        [-3.351598, -6.596147, -7.610416],
        [-1.913015, -6.596147, -25.0],
        [-1.913015, -6.596147, -10.487582],
      ],
    ],
    [
      `Fe2O3`,
      [
        [-25.0, -10.739688, -4.258278],
        [-25.0, -7.29639, -6.55381],
        [-5.550202, -10.739688, -4.258278],
        [-5.406275, -10.451834, -4.450181],
        [-4.35446, -7.29639, -6.55381],
      ],
    ],
    [
      `Fe3O4`,
      [
        [-25.0, -7.29639, -6.55381],
        [-25.0, -6.741594, -6.969907],
        [-4.35446, -7.29639, -6.55381],
        [-4.077062, -6.741594, -6.969907],
      ],
    ],
    [
      `FeO`,
      [
        [-25.0, -6.741594, -6.969907],
        [-25.0, -6.596147, -7.115354],
        [-4.077062, -6.741594, -6.969907],
        [-3.931615, -6.596147, -7.115354],
      ],
    ],
    [
      `Li`,
      [
        [-1.913015, -25.0, -25.0],
        [-1.913015, -25.0, -10.487582],
        [-1.913015, -6.596147, -25.0],
        [-1.913015, -6.596147, -10.487582],
      ],
    ],
    [
      `Li2O`,
      [
        [-4.612511, -25.0, -5.088591],
        [-4.612511, -10.378885, -5.088591],
        [-3.351598, -6.596147, -7.610416],
        [-1.913015, -25.0, -10.487582],
        [-1.913015, -6.596147, -10.487582],
      ],
    ],
    [
      `Li2O2`,
      [
        [-5.442823, -25.0, -4.258278],
        [-5.442823, -10.954446, -4.258278],
        [-4.739887, -10.251509, -4.961215],
        [-4.612511, -25.0, -5.088591],
        [-4.612511, -10.378885, -5.088591],
      ],
    ],
    [
      `O2`,
      [
        [-25.0, -25.0, -4.258278],
        [-25.0, -10.739688, -4.258278],
        [-5.550202, -10.739688, -4.258278],
        [-5.442823, -25.0, -4.258278],
        [-5.442823, -10.954446, -4.258278],
      ],
    ],
  ])(`domain vertices for %s match pymatgen`, (pmg_formula, pmg_vertices) => {
    const our_key = pmg_to_ours[pmg_formula] ?? pmg_formula
    const actual_pts = cpd_ternary.domains[our_key]
    expect(actual_pts, `Domain missing for ${our_key}`).toBeDefined()
    const sorted_actual = sort_rows(dedup_vertices(actual_pts))
    const sorted_expected = sort_rows(reorder_cols(pmg_vertices))
    expect(sorted_actual).toHaveLength(sorted_expected.length)
    for (let idx = 0; idx < sorted_expected.length; idx++) {
      for (let jdx = 0; jdx < sorted_expected[idx].length; jdx++) {
        expect(sorted_actual[idx][jdx]).toBeCloseTo(sorted_expected[idx][jdx], 4)
      }
    }
  })
})

describe(`physical invariants`, () => {
  test(`all domain vertices satisfy all hyperplane constraints`, () => {
    const all_hs = [...cpd_ternary.hyperplanes, ...build_border_hyperplanes(cpd_ternary.lims)]
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

  test(`vertices within limits and every element has a domain`, () => {
    for (const el of cpd_ternary.elements) {
      expect(cpd_ternary.domains[el], `Element ${el} has no domain`).toBeDefined()
    }
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

  test(`elemental domains touch the el_ref energy axis`, () => {
    const fe_ref_e = cpd_ternary.el_refs.Fe.energy
    const fe_vals = dedup_vertices(cpd_ternary.domains.Fe).map((pt) => pt[0])
    expect(fe_vals.some((val) => Math.abs(val - fe_ref_e) < 0.01)).toBe(true)
  })

  test(`formal chempots touch mu=0 and are non-positive`, () => {
    for (const el of cpd_ternary_formal.elements) {
      const domain = dedup_vertices(cpd_ternary_formal.domains[el])
      const el_idx = cpd_ternary_formal.elements.indexOf(el)
      expect(
        domain.some((pt) => Math.abs(pt[el_idx]) < 0.01),
        `${el} formal domain should touch mu_${el}=0`,
      ).toBe(true)
    }
    for (const pts of Object.values(cpd_ternary_formal.domains)) {
      for (const pt of pts) {
        for (const chempot of pt) {
          expect(chempot, `Formal chempot should be <= 0`).toBeLessThanOrEqual(1e-4)
        }
      }
    }
  })

  test(`domain vertex centroids satisfy hyperplane feasibility`, () => {
    // Centroids of boundary-clamped vertices may leave their domain; only check feasibility.
    const dim = cpd_ternary.elements.length
    for (const pts of Object.values(cpd_ternary.domains)) {
      const unique = dedup_vertices(pts)
      if (unique.length < 2) continue
      const centroid = unique[0].map(
        (_, col) => unique.reduce((sum, row) => sum + row[col], 0) / unique.length,
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

describe(`binary system (2 elements)`, () => {
  const ab_binary_entries = [
    make_entry({ A: 1 }, -2.0),
    make_entry({ B: 1 }, -3.0),
    make_entry({ A: 1, B: 1 }, -6.0),
  ]
  const binary_simple = compute_chempot_diagram(ab_binary_entries, {
    default_min_limit: -20,
    formal_chempots: false,
  })

  test(`A-B-AB structure, refs, and AB vertices between refs`, () => {
    expect(Object.keys(binary_simple.domains).sort()).toEqual([`A`, `AB`, `B`])
    expect(binary_simple.el_refs.A.energy_per_atom).toBe(-2.0)
    expect(binary_simple.el_refs.B.energy_per_atom).toBe(-3.0)
    for (const pt of dedup_vertices(binary_simple.domains.AB)) {
      expect(pt[0]).toBeLessThanOrEqual(-2.0 + 1e-4)
      expect(pt[1]).toBeLessThanOrEqual(-3.0 + 1e-4)
    }
  })

  test(`formal chempots shift all refs to zero`, () => {
    const formal = compute_chempot_diagram(ab_binary_entries, {
      default_min_limit: -20,
      formal_chempots: true,
    })
    expect(formal.el_refs.A.energy_per_atom).toBeCloseTo(0, 8)
    expect(formal.el_refs.B.energy_per_atom).toBeCloseTo(0, 8)
  })

  test(`tighter limits produce vertices within bounds`, () => {
    const tight = compute_chempot_diagram(ab_binary_entries, {
      default_min_limit: -10,
      formal_chempots: false,
    })
    for (const pts of Object.values(tight.domains)) {
      for (const pt of pts) {
        expect(pt[0]).toBeGreaterThanOrEqual(-10 - 1e-4)
        expect(pt[1]).toBeGreaterThanOrEqual(-10 - 1e-4)
      }
    }
  })
})

describe(`pure binary (no compounds)`, () => {
  const pure_binary = compute_chempot_diagram(
    [make_entry({ X: 1 }, -1.0), make_entry({ Y: 1 }, -2.0)],
    { default_min_limit: -10, formal_chempots: false },
  )

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

describe(`error handling`, () => {
  test.each([
    {
      label: `< 2 elements`,
      phase_entries: [make_entry({ A: 1 }, -1.0)],
      message: `requires 2+ elements`,
    },
    {
      label: `missing elemental ref`,
      phase_entries: [make_entry({ A: 1, B: 1 }, -3.0), make_entry({ A: 2, B: 1 }, -5.0)],
      message: `Missing elemental reference`,
    },
    {
      label: `empty entries`,
      phase_entries: [] as PhaseData[],
      message: `requires 2+ elements`,
    },
  ])(`throws for $label`, ({ phase_entries, message }) => {
    expect(() => compute_chempot_diagram(phase_entries)).toThrow(message)
  })
})

describe(`get_min_entries_and_el_refs`, () => {
  test.each([
    {
      label: `picks lowest energy per composition`,
      phase_entries: [
        make_entry({ A: 1 }, -1.0),
        make_entry({ A: 1 }, -2.0),
        make_entry({ A: 1 }, -0.5),
      ],
      assert: ({ min_entries }: ReturnType<typeof get_min_entries_and_el_refs>) => {
        expect(min_entries).toHaveLength(1)
        expect(min_entries[0].energy_per_atom).toBe(-2.0)
      },
    },
    {
      label: `distinguishes compositions and identifies elemental refs`,
      phase_entries: [
        make_entry({ A: 1 }, -1.0),
        make_entry({ B: 1 }, -2.0),
        make_entry({ A: 1, B: 1 }, -3.0),
      ],
      assert: ({ min_entries, el_refs }: ReturnType<typeof get_min_entries_and_el_refs>) => {
        expect(min_entries).toHaveLength(3)
        expect(el_refs.A.energy_per_atom).toBe(-1.0)
        expect(el_refs.B.energy_per_atom).toBe(-2.0)
      },
    },
    {
      label: `handles multiple polymorphs of same composition`,
      phase_entries: [
        make_entry({ Fe: 1 }, -6.0),
        make_entry({ Fe: 1 }, -6.5),
        make_entry({ Fe: 1 }, -6.2),
        make_entry({ O: 2 }, -8.0),
      ],
      assert: ({ min_entries, el_refs }: ReturnType<typeof get_min_entries_and_el_refs>) => {
        expect(min_entries).toHaveLength(2)
        expect(el_refs.Fe.energy_per_atom).toBe(-6.5)
      },
    },
  ])(`$label`, ({ phase_entries, assert }) => {
    assert(get_min_entries_and_el_refs(phase_entries))
  })

  test.each([Number.NaN, Infinity, -Infinity])(`ignores non-finite EPA/e_form %s`, (bad) => {
    expect(
      get_min_entries_and_el_refs([
        make_entry({ A: 1 }, bad),
        make_entry({ A: 1 }, -2),
        make_entry({ B: 1 }, bad),
      ]).min_entries.map((entry) => entry.energy_per_atom),
    ).toEqual([-2])
    expect(
      best_form_energy_for_formula(
        [
          { ...make_entry({ A: 1, B: 1 }, -1), e_form_per_atom: bad },
          { ...make_entry({ A: 1, B: 1 }, -1), e_form_per_atom: -0.5 },
        ],
        `AB`,
        { A: make_entry({ A: 1 }, 0), B: make_entry({ B: 1 }, 0) },
      ),
    ).toBe(-0.5)
  })
})

describe(`renormalize_entries`, () => {
  const el_refs: Record<string, PhaseData> = {
    A: make_entry({ A: 1 }, -2.0),
    B: make_entry({ B: 1 }, -3.0),
  }

  test.each([
    {
      label: `pure elements renormalize to zero`,
      phase_entries: [make_entry({ A: 1 }, -2.0), make_entry({ B: 1 }, -3.0)],
      expected_epa: [0, 0],
      expected_energy: null as number[] | null,
    },
    {
      label: `compound formation energy is preserved`,
      phase_entries: [make_entry({ A: 1, B: 1 }, -3.0)],
      expected_epa: [-0.5],
      expected_energy: [-1.0],
    },
  ])(`$label`, ({ phase_entries, expected_epa, expected_energy }) => {
    const renormed = renormalize_entries(phase_entries, el_refs, [`A`, `B`])
    for (let idx = 0; idx < expected_epa.length; idx++) {
      expect(renormed[idx].energy_per_atom).toBeCloseTo(expected_epa[idx], 8)
    }
    if (expected_energy) {
      for (let idx = 0; idx < expected_energy.length; idx++) {
        expect(renormed[idx].energy).toBeCloseTo(expected_energy[idx], 8)
      }
    }
  })
})

describe(`build_hyperplanes`, () => {
  const el_refs: Record<string, PhaseData> = {
    A: make_entry({ A: 1 }, -2.0),
    B: make_entry({ B: 1 }, -3.0),
  }
  const ab_entry = make_entry({ A: 1, B: 1 }, -6.0)
  const { hyperplanes, hyperplane_entries } = build_hyperplanes(
    [el_refs.A, el_refs.B, ab_entry],
    el_refs,
    [`A`, `B`],
  )

  test(`includes elemental refs with valid row structure`, () => {
    expect(hyperplane_entries.length).toBeGreaterThanOrEqual(2)
    for (const row of hyperplanes) {
      expect(row).toHaveLength(3)
      expect(row[0] + row[1]).toBeCloseTo(1.0, 8)
    }
  })

  test.each([
    {
      label: `precomputed hull stability excludes known above-hull phases`,
      refs: {
        A: { ...make_entry({ A: 1 }, -2), is_stable: true, e_above_hull: 0 },
        B: { ...make_entry({ B: 1 }, -3), is_stable: true, e_above_hull: 0 },
      },
      extra: [
        { ...make_entry({ A: 1, B: 1 }, -6), is_stable: true, e_above_hull: 0 },
        { ...make_entry({ A: 2, B: 1 }, -5), is_stable: false, e_above_hull: 0.2 },
      ],
      expected: [`A`, `B`, `AB`],
    },
    {
      label: `falls back to negative formation energy when hull stability is absent`,
      refs: {
        A: make_entry({ A: 1 }, -2),
        B: make_entry({ B: 1 }, -3),
      },
      extra: [make_entry({ A: 2, B: 1 }, -5)],
      expected: [`A`, `B`, `A2B`],
    },
  ])(`$label`, ({ refs, extra, expected }) => {
    const result = build_hyperplanes([refs.A, refs.B, ...extra], refs, [`A`, `B`])
    expect(
      result.hyperplane_entries.map((entry) =>
        formula_key_from_composition(entry.composition),
      ),
    ).toEqual(expected)
  })
})

describe(`element padding`, () => {
  test(`padding reduces extreme coordinates`, () => {
    const domains = {
      A: [
        [-50, -3],
        [-2, -3],
      ],
      B: [
        [-50, -50],
        [-50, -5],
      ],
    }
    const new_lims = apply_element_padding(domains, [0, 1], 1.0, -50)
    // For axis 0: non-default min is -2, so new_lim = -2 - 1 = -3
    expect(new_lims[0]).toBeCloseTo(-3, 4)
    // For axis 1: non-default min is -5, so new_lim = -5 - 1 = -6
    expect(new_lims[1]).toBeCloseTo(-6, 4)
  })

  test(`pad_domain_points replaces defaults and preserves non-defaults`, () => {
    const replaced = pad_domain_points(
      [
        [-50, -3],
        [-2, -50],
      ],
      [0, 1],
      [-10, -10],
      -50,
      1.0,
    )
    expect(replaced[0][0]).toBe(-10) // was -50 → replaced
    expect(replaced[0][1]).toBe(-3) // not near -50 → unchanged
    expect(replaced[1][0]).toBe(-2)
    expect(replaced[1][1]).toBe(-10)

    const preserved = pad_domain_points([[-5.123, -7.456]], [0, 1], [-20, -20], -50, 1.0)
    expect(preserved[0]).toEqual([-5.123, -7.456])
  })

  test(`padding threshold scales with large padding values`, () => {
    const domains = {
      A: [
        [-50, -50],
        [-47, -46],
        [-40, -44],
      ],
    }
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

describe(`solve_linear_system`, () => {
  test.each([
    {
      label: `2x2 identity`,
      mat: [
        [1, 0],
        [0, 1],
      ],
      rhs: [3, 7],
      expected: [3, 7],
    },
    {
      label: `2x2 general`,
      mat: [
        [2, 1],
        [1, 3],
      ],
      rhs: [5, 10],
      expected: [1, 3],
    },
    {
      label: `3x3 identity`,
      mat: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      rhs: [1, 2, 3],
      expected: [1, 2, 3],
    },
    {
      label: `3x3 general`,
      mat: [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 10],
      ],
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
    const mat = [
      [2, 1, -1, 0],
      [1, 3, 0, -1],
      [-1, 0, 2, 1],
      [0, -1, 1, 3],
    ]
    const rhs = [1, 2, 3, 4]
    const result = solve_linear_system(mat, rhs)
    if (!result) throw new Error(`expected non-null solution`)
    for (let row = 0; row < 4; row++) {
      const val = mat[row].reduce((sum, cell, col) => sum + cell * result[col], 0)
      expect(val).toBeCloseTo(rhs[row], 6)
    }
  })

  test.each([
    {
      mat: [
        [1, 2],
        [2, 4],
      ],
      rhs: [1, 2],
      label: `2x2 singular`,
    },
    {
      mat: [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ],
      rhs: [1, 2, 3],
      label: `3x3 singular`,
    },
    { mat: [] as number[][], rhs: [] as number[], label: `empty` },
    {
      mat: [
        [1, 2],
        [3, 4],
      ],
      rhs: [1],
      label: `mismatched dims`,
    },
  ])(`$label → returns null`, ({ mat, rhs }) => {
    expect(solve_linear_system(mat, rhs)).toBeNull()
  })
})

describe(`convex_hull_2d`, () => {
  test.each([
    {
      pts: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
      n: 3,
      label: `triangle`,
    },
    {
      pts: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      n: 4,
      label: `square`,
    },
    {
      pts: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
        [1, 1],
      ],
      n: 4,
      label: `square + interior`,
    },
    {
      pts: [
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
      ],
      n: 2,
      label: `collinear`,
    },
    { pts: [[1, 2]], n: 1, label: `single point` },
    {
      pts: [
        [1, 2],
        [3, 4],
      ],
      n: 2,
      label: `two points`,
    },
  ] as { pts: Vec2[]; n: number; label: string }[])(
    `$label → $n hull vertices`,
    ({ pts, n }) => {
      expect(convex_hull_2d(pts)).toHaveLength(n)
    },
  )

  test(`hull area is correct for unit square`, () => {
    const hull = convex_hull_2d([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ])
    let area = 0
    for (let idx = 0; idx < hull.length; idx++) {
      const [x0, y0] = hull[idx]
      const [x1, y1] = hull[(idx + 1) % hull.length]
      area += x0 * y1 - x1 * y0
    }
    expect(Math.abs(area / 2)).toBeCloseTo(1.0, 8)
  })
})

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
    const data = [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
      [10, 11, 12],
    ]
    const { scores } = simple_pca(data, 2)
    for (let col = 0; col < 2; col++) {
      const mean = scores.reduce((sum, row) => sum + row[col], 0) / scores.length
      expect(mean).toBeCloseTo(0, 8)
    }
  })

  test(`empty data returns empty`, () => {
    const { scores, eigenvectors } = simple_pca([], 2)
    expect(scores).toEqual([])
    expect(eigenvectors).toEqual([])
  })

  test(`eigenvectors are unit length and orthogonal`, () => {
    const data = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 1, 1],
    ]
    const { eigenvectors } = simple_pca(data, 2)
    for (const ev of eigenvectors) {
      expect(Math.hypot(...ev)).toBeCloseTo(1.0, 6)
    }
    if (eigenvectors.length >= 2) {
      const dot = eigenvectors[0].reduce(
        (sum, val, idx) => sum + val * eigenvectors[1][idx],
        0,
      )
      expect(Math.abs(dot)).toBeLessThan(1e-6)
    }
  })
})

describe(`orthonormal_2d`, () => {
  test.each([
    // perp = [-dy, dx] normalized
    {
      pts: [
        [1, 1],
        [2, 2],
      ],
      expected: [-Math.SQRT1_2, Math.SQRT1_2],
      label: `45°`,
    },
    {
      pts: [
        [-2, -5],
        [-4, 6],
      ],
      expected: [-0.98386991, -0.17888544],
      label: `steep`,
    },
    {
      pts: [
        [0, 0],
        [3, 4],
      ],
      expected: [-0.8, 0.6],
      label: `diagonal`,
    },
    {
      pts: [
        [0, 5],
        [10, 5],
      ],
      expected: [0, 1],
      label: `horizontal`,
    },
    {
      pts: [
        [5, 0],
        [5, 10],
      ],
      expected: [-1, 0],
      label: `vertical`,
    },
    {
      pts: [
        [3, 7],
        [3, 7],
      ],
      expected: [0, 1],
      label: `degenerate`,
      exact: true,
    },
  ])(`$label: correct value, unit length, perpendicular`, ({ pts, expected, exact }) => {
    const vec = orthonormal_2d(pts)
    if (exact) {
      expect(vec).toEqual(expected)
      return
    }
    expect(vec[0]).toBeCloseTo(expected[0], 5)
    expect(vec[1]).toBeCloseTo(expected[1], 5)
    expect(Math.hypot(vec[0], vec[1])).toBeCloseTo(1.0, 8)
    const dx = pts[1][0] - pts[0][0]
    const dy = pts[1][1] - pts[0][1]
    expect(Math.abs(vec[0] * dx + vec[1] * dy)).toBeLessThan(1e-10)
  })
})

describe(`polygon_centroid`, () => {
  test.each([
    {
      label: `unit square`,
      pts: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ] as Vec2[],
      expected: [0.5, 0.5],
      digits: 8,
    },
    {
      label: `equilateral triangle`,
      pts: [
        [0, 0],
        [1, 0],
        [0.5, Math.sqrt(3) / 2],
      ] as Vec2[],
      expected: [0.5, Math.sqrt(3) / 6],
      digits: 6,
    },
    { label: `single point`, pts: [[7, 3]] as Vec2[], expected: [7, 3], digits: null },
    {
      label: `two points midpoint`,
      pts: [
        [0, 0],
        [4, 6],
      ] as Vec2[],
      expected: [2, 3],
      digits: 8,
    },
    { label: `empty`, pts: [] as Vec2[], expected: [0, 0], digits: null },
  ])(`$label`, ({ pts, expected, digits }) => {
    const centroid = polygon_centroid(pts)
    if (digits === null) expect(centroid).toEqual(expected)
    else {
      expect(centroid[0]).toBeCloseTo(expected[0], digits)
      expect(centroid[1]).toBeCloseTo(expected[1], digits)
    }
  })
})

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
    expect(Object.keys(result.domains)).toHaveLength(Object.keys(cpd_ternary.domains).length)
  })

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
      const is_interior = (pt: number[], min_lim: number) =>
        pt.every((val) => Math.abs(val - min_lim) > 1 && Math.abs(val) > 1)

      const feo_tight_interior = dedup_vertices(tight.domains.FeO ?? []).filter((pt) =>
        is_interior(pt, -15),
      )
      const feo_wide_interior = dedup_vertices(wide.domains.FeO ?? []).filter((pt) =>
        is_interior(pt, -50),
      )

      expect(feo_tight_interior).toHaveLength(feo_wide_interior.length)
      const sorted_t = sort_rows(feo_tight_interior)
      const sorted_w = sort_rows(feo_wide_interior)
      for (let idx = 0; idx < sorted_t.length; idx++) {
        for (let jdx = 0; jdx < sorted_t[idx].length; jdx++) {
          expect(sorted_t[idx][jdx]).toBeCloseTo(sorted_w[idx][jdx], 3)
        }
      }
    })

    test(`formal vs absolute produces same domains`, () => {
      expect(Object.keys(cpd_ternary_formal.domains).sort()).toEqual(
        Object.keys(cpd_ternary.domains).sort(),
      )
    })
  })
})

// YTOS data from doped: github.com/SMTG-Bham/doped/blob/main/examples/YTOS/ytos_phase_diagram.json
describe(`YTOS quaternary system (projection mode)`, () => {
  test.each([
    {
      label: `Y-Ti-O`,
      diagram: ytos_y_ti_o,
      elements: [`O`, `Ti`, `Y`],
      phases: [`O`, `Ti`, `Y`, `O3Y2`, `O2Ti`],
      min_domains: 10,
    },
    {
      label: `Ti-O-S`,
      diagram: ytos_ti_o_s,
      elements: [`O`, `S`, `Ti`],
      phases: [`O2Ti`, `S`, `Ti`],
    },
  ])(
    `$label projection metadata and key phases`,
    ({ diagram, elements, phases, min_domains }) => {
      expect(diagram.elements).toEqual(elements)
      expect(diagram.lims).toHaveLength(3)
      const formulas = Object.keys(diagram.domains)
      for (const formula of phases) expect(formulas).toContain(formula)
      if (min_domains !== undefined) expect(formulas.length).toBeGreaterThan(min_domains)
    },
  )

  test(`Y-Ti-O has Y2Ti2O7, valid vertices, and elemental mu=0 touch`, () => {
    const key = `O7Ti2Y2`
    expect(ytos_y_ti_o.domains[key], `Domain for ${key} (Y2Ti2O7)`).toBeDefined()
    expect(dedup_vertices(ytos_y_ti_o.domains[key]).length).toBeGreaterThanOrEqual(3)

    for (const pts of Object.values(ytos_y_ti_o.domains)) {
      for (const pt of pts) {
        expect(pt).toHaveLength(3)
        for (let dim = 0; dim < 3; dim++) {
          expect(pt[dim]).toBeLessThanOrEqual(1e-4)
          expect(pt[dim]).toBeGreaterThanOrEqual(ytos_y_ti_o.lims[dim][0] - 1e-4)
          expect(pt[dim]).toBeLessThanOrEqual(ytos_y_ti_o.lims[dim][1] + 1e-4)
        }
      }
    }

    for (const el of ytos_y_ti_o.elements) {
      const domain = dedup_vertices(ytos_y_ti_o.domains[el])
      const el_idx = ytos_y_ti_o.elements.indexOf(el)
      expect(
        domain.some((pt) => Math.abs(pt[el_idx]) < 0.01),
        `${el} should touch mu=0`,
      ).toBe(true)
    }
  })

  test(`projection produces more domains than subsystem filtering`, () => {
    const oty_only = ytos_entries.filter((entry) => {
      const els = Object.entries(entry.composition)
        .filter(([, amt]) => amt > 0)
        .map(([el]) => el)
      return els.every((el) => [`O`, `Ti`, `Y`].includes(el))
    })
    const subsystem = compute_chempot_diagram(oty_only, {
      elements: [`O`, `Ti`, `Y`],
      default_min_limit: -25,
      formal_chempots: true,
    })
    expect(Object.keys(ytos_y_ti_o.domains).length).toBeGreaterThan(
      Object.keys(subsystem.domains).length,
    )
  })
})

describe(`build_axis_ranges`, () => {
  test.each([
    {
      label: `computes min/max per axis`,
      points: [
        [-3, 1],
        [2, 5],
        [0, -4],
      ],
      elements: [`X`, `Y`],
      expected: [
        { element: `X`, min_val: -3, max_val: 2 },
        { element: `Y`, min_val: -4, max_val: 5 },
      ],
    },
    {
      label: `single point has equal min/max`,
      points: [[7, -2]],
      elements: [`A`, `B`],
      expected: [
        { element: `A`, min_val: 7, max_val: 7 },
        { element: `B`, min_val: -2, max_val: -2 },
      ],
    },
    {
      label: `elements longer than point dimensions produces Infinity`,
      points: [[1, 2]],
      elements: [`A`, `B`, `C`],
      expected: [
        { element: `A`, min_val: 1, max_val: 1 },
        { element: `B`, min_val: 2, max_val: 2 },
        { element: `C`, min_val: Infinity, max_val: -Infinity },
      ],
    },
  ])(`$label`, ({ points, elements, expected }) => {
    expect(build_axis_ranges(points, elements)).toEqual(expected)
  })
})

describe(`dedup_points`, () => {
  test.each([
    {
      pts: [
        [1, 2],
        [3, 4],
        [1, 2],
      ],
      tol: 1e-4,
      n_unique: 2,
      indices: [0, 1],
      label: `exact duplicates`,
    },
    {
      pts: [
        [0, 0],
        [0.00005, 0.00005],
      ],
      tol: 1e-4,
      n_unique: 1,
      indices: [0],
      label: `within tolerance`,
    },
    {
      pts: [
        [0, 0],
        [0.001, 0.001],
      ],
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
      pts: [
        [0, 0],
        [1e-7, 1e-7],
        [0.001, 0.001],
      ],
      tol: 1e-6,
      n_unique: 2,
      indices: [0, 2],
      label: `sub-tolerance pair merged, distant point kept`,
    },
    {
      pts: [
        [1, 2],
        [3, 4],
        [1, 2],
        [5, 6],
        [3, 4],
      ],
      tol: 1e-4,
      n_unique: 3,
      indices: [0, 1, 3],
      label: `multiple duplicates scattered`,
    },
  ])(`$label → $n_unique unique`, ({ pts, tol, n_unique, indices }) => {
    const result = dedup_points(pts, tol)
    expect(result.unique).toHaveLength(n_unique)
    expect(result.orig_indices).toEqual(indices)
    // unique points should match the points at orig_indices
    for (let idx = 0; idx < result.unique.length; idx++) {
      expect(result.unique[idx]).toEqual(pts[result.orig_indices[idx]])
    }
  })
})

describe(`get_energy_per_atom`, () => {
  test.each([
    {
      label: `returns energy_per_atom when present`,
      entry: make_entry({ Fe: 2 }, -3.0),
      expected: -3.0,
    },
    {
      label: `computes from energy / atoms when energy_per_atom missing`,
      entry: { composition: { Fe: 2, O: 1 }, energy: -9.0 },
      expected: -3.0,
    },
  ])(`$label`, ({ entry, expected }) => {
    expect(get_energy_per_atom(entry)).toBeCloseTo(expected, 8)
  })

  test.each([
    { label: `empty composition`, entry: { composition: {}, energy: -1.0 } },
    {
      label: `non-finite explicit EPA`,
      entry: { composition: { Li: 1 }, energy: -1, energy_per_atom: Number.NaN },
    },
    {
      label: `non-finite total energy`,
      entry: { composition: { Li: 1 }, energy: Number.POSITIVE_INFINITY },
    },
  ])(`returns NaN for $label (safe for $derived)`, ({ entry }) => {
    expect(Number.isNaN(get_energy_per_atom(entry))).toBe(true)
  })

  test(`get_min_entries skips invalid compositions instead of throwing`, () => {
    const { min_entries } = get_min_entries_and_el_refs([
      { composition: {}, energy: -1 },
      make_entry({ Li: 1 }, -3),
    ])
    expect(min_entries).toHaveLength(1)
    expect(min_entries[0]?.composition).toEqual({ Li: 1 })
  })
})

describe(`formula_key_from_composition`, () => {
  test.each([
    { comp: { Fe: 1 }, expected: `Fe`, label: `single element` },
    { comp: { O: 3, Li: 2, Fe: 1 }, expected: `FeLi2O3`, label: `alphabetical sorting` },
    { comp: { Fe: 2, O: 4 }, expected: `FeO2`, label: `reduces to lowest terms` },
    { comp: { Fe: 1, O: 0 }, expected: `Fe`, label: `ignores zero amounts` },
    { comp: { Fe: 0.5, Li: 0.5 }, expected: `FeLi`, label: `fractional halves` },
    { comp: { Fe: 0.67, Li: 0.33 }, expected: `Fe2Li`, label: `fractional 2:1 ratio` },
    {
      comp: { Li: 0.33, Fe: 0.33, O: 0.34 },
      expected: `FeLiO`,
      label: `fractional ternary ~1:1:1`,
    },
    { comp: { Fe: 0.25, Li: 0.5, O: 0.25 }, expected: `FeLi2O`, label: `fractional quarters` },
    {
      comp: { Fe: 0.005, O: 0.995 },
      expected: `Fe0.005O0.995`,
      label: `tiny fraction falls through`,
    },
  ])(`$label → $expected`, ({ comp, expected }) => {
    const key = formula_key_from_composition(comp as Record<string, number>)
    expect(key).toBe(expected)
    // Regression: integer formula keys must round-trip through get_hill_formula
    if (!expected.includes(`.`)) {
      expect(get_hill_formula(key, true).length, `key "${key}" → empty label`).toBeGreaterThan(
        0,
      )
    }
  })
})

// Helper: verify all edge indices are in [0, n_pts) and distinct within each edge
function assert_valid_edges(result: { simplex_indices: number[][] }, n_pts: number): void {
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
      pts: [
        [5, 5, 5],
        [5, 5, 5],
        [5, 5, 5],
      ],
      n_edges: 0,
      ann_loc: [5, 5, 5],
      label: `all duplicates`,
    },
    {
      pts: [
        [0, 0, 0],
        [10, 0, 0],
        [5, 10, 0],
      ],
      n_edges: 3,
      ann_loc: null,
      label: `triangle`,
    },
    {
      pts: [
        [0, 0, 0],
        [10, 0, 0],
        [10, 10, 0],
        [0, 10, 0],
      ],
      n_edges: 4,
      ann_loc: null,
      label: `square`,
    },
    {
      pts: [
        [0, 0, 0],
        [10, 0, 0],
        [12, 8, 0],
        [5, 14, 0],
        [-2, 8, 0],
      ],
      n_edges: 5,
      ann_loc: null,
      label: `pentagon`,
    },
    {
      pts: [
        [0, 0, 0],
        [4, 6, 2],
      ],
      n_edges: 1,
      edges: [[0, 1]],
      ann_loc: [2, 3, 1],
      label: `two points`,
    },
  ])(`$label → $n_edges edges`, ({ pts, n_edges, ann_loc, edges }) => {
    const result = get_3d_domain_simplexes_and_ann_loc(pts)
    expect(result.simplex_indices).toHaveLength(n_edges)
    if (edges) expect(result.simplex_indices).toEqual(edges)
    if (ann_loc) expect(result.ann_loc).toEqual(ann_loc)
    if (n_edges > 0) assert_valid_edges(result, pts.length)
  })

  test(`dedup maps indices to first occurrences`, () => {
    // Dups at 3,4 → 3 unique points → 3 triangle edges referencing indices <= 2
    const pts = [
      [0, 0, 0],
      [10, 0, 0],
      [5, 10, 0],
      [0, 0, 0],
      [10, 0, 0],
    ]
    const result = get_3d_domain_simplexes_and_ann_loc(pts)
    expect(result.simplex_indices).toHaveLength(3)
    expect(result.simplex_indices.flat().every((idx) => idx <= 2)).toBe(true)
    assert_valid_edges(result, pts.length)
  })

  test(`dup at non-zero position maps to correct original indices`, () => {
    // Dup at idx 1 → orig_indices = [0, 2, 3], edges must skip index 1
    const pts = [
      [5, 10, 0],
      [5, 10, 0],
      [0, 0, 0],
      [10, 0, 0],
    ]
    const result = get_3d_domain_simplexes_and_ann_loc(pts)
    expect(new Set(result.simplex_indices.flat())).toEqual(new Set([0, 2, 3]))
  })

  test(`nearly collinear 3D points produce valid edges`, () => {
    const pts = [
      [0, 0, 0],
      [10, 0.001, 0],
      [5, 0.0005, 0],
      [20, 0.002, 0],
    ]
    const result = get_3d_domain_simplexes_and_ann_loc(pts)
    expect(result.simplex_indices.length).toBeGreaterThanOrEqual(1)
    assert_valid_edges(result, pts.length)
  })
})

describe.each([
  { label: `ternary (Fe-Li-O)`, domains: cpd_ternary.domains },
  { label: `YTOS projection (O-Ti-Y)`, domains: ytos_y_ti_o.domains },
])(`domain edge indices: $label`, ({ domains }) => {
  test(`all simplex indices reference valid points`, () => {
    for (const [formula, pts] of Object.entries(domains)) {
      const result = get_3d_domain_simplexes_and_ann_loc(pts)
      for (const [idx_a, idx_b] of result.simplex_indices) {
        expect(idx_a, `${formula}: idx_a=${idx_a} >= ${pts.length}`).toBeLessThan(pts.length)
        expect(idx_b, `${formula}: idx_b=${idx_b} >= ${pts.length}`).toBeLessThan(pts.length)
      }
    }
  })
})

describe(`compute_domains`, () => {
  const ab_refs: Record<string, PhaseData> = {
    A: make_entry({ A: 1 }, -2.0),
    B: make_entry({ B: 1 }, -3.0),
  }
  const border = build_border_hyperplanes([
    [-20, 0],
    [-20, 0],
  ])

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
    expect(domains.AB).toBeUndefined()
  })
})

describe(`compute_chempot_diagram edge cases`, () => {
  test(`custom limits restrict domain vertices`, () => {
    const result = compute_chempot_diagram(
      [
        make_entry({ A: 1 }, -2.0),
        make_entry({ B: 1 }, -3.0),
        make_entry({ A: 1, B: 1 }, -6.0),
      ],
      { default_min_limit: -20, limits: { A: [-5, 0] }, formal_chempots: false },
    )
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
    expect(
      Object.keys(reordered.domains).sort((str_a, str_b) => str_a.localeCompare(str_b)),
    ).toEqual(
      Object.keys(cpd_ternary.domains).sort((str_a, str_b) => str_a.localeCompare(str_b)),
    )
    // Verify axes actually swapped: Fe domain's O-axis range (col 0 in reordered)
    // should match its col 2 range in default [Fe,Li,O] order
    const fe_reordered = dedup_vertices(reordered.domains.Fe)
    const fe_default = dedup_vertices(cpd_ternary.domains.Fe)
    const re_o_vals = fe_reordered.map((pt) => pt[0]).sort((val_a, val_b) => val_a - val_b)
    const def_o_vals = fe_default.map((pt) => pt[2]).sort((val_a, val_b) => val_a - val_b) // O is axis 2 in default
    expect(re_o_vals).toHaveLength(def_o_vals.length)
    for (let idx = 0; idx < re_o_vals.length; idx++) {
      expect(re_o_vals[idx]).toBeCloseTo(def_o_vals[idx], 4)
    }
  })

  test(`config.elements with unknown element throws`, () => {
    expect(() =>
      compute_chempot_diagram([make_entry({ A: 1 }, -1.0), make_entry({ B: 1 }, -2.0)], {
        elements: [`A`, `C`],
      }),
    ).toThrow(`Missing elemental reference`)
  })

  test(`identical polymorphs keep one domain`, () => {
    const result = compute_chempot_diagram(
      [make_entry({ A: 1 }, -2.0), make_entry({ A: 1 }, -2.0), make_entry({ B: 1 }, -3.0)],
      { default_min_limit: -10, formal_chempots: false },
    )
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
    expect(result.lims).toHaveLength(n_axes)
    for (const pts of Object.values(result.domains)) {
      for (const pt of pts) expect(pt).toHaveLength(n_axes)
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
        expect(pt).toHaveLength(3)
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

// Tests the math used by ChemPotDiagram3D.compute_e_form:
// e_form = energy_per_atom - sum(fraction_i * ref_energy_per_atom_i)

describe(`formation energy from elemental refs`, () => {
  // Reproduce the compute_e_form logic using exported helpers
  function compute_e_form(entry: PhaseData, el_refs: Record<string, PhaseData>): number {
    const atoms = Object.values(entry.composition).reduce((sum, count) => sum + count, 0)
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
    const all_entries: PhaseData[] = [make_entry({ A: 1 }, -2.0), make_entry({ B: 1 }, -3.0)]
    const { el_refs: raw_refs } = get_min_entries_and_el_refs(all_entries)
    const renormed = renormalize_entries(all_entries, raw_refs, [`A`, `B`])
    const { el_refs: renorm_refs } = get_min_entries_and_el_refs(renormed)
    // Renormalized refs have epa=0, so compute_e_form degenerates to just epa
    expect(get_energy_per_atom(renorm_refs.A)).toBeCloseTo(0, 8)
    expect(get_energy_per_atom(renorm_refs.B)).toBeCloseTo(0, 8)
    // Using renormalized refs, e_form equals raw epa (not true formation energy!)
    const ab = make_entry({ A: 1, B: 1 }, -3.5)
    expect(compute_e_form(ab, renorm_refs)).toBeCloseTo(-3.5, 8)
    // This confirms raw_el_refs (not diagram_data.el_refs) must be used
  })

  test(`formation energy from real data: Fe-Li-O system`, () => {
    const { el_refs: raw_refs } = get_min_entries_and_el_refs(entries)
    // All elemental refs should have zero formation energy
    for (const [el, ref] of Object.entries(raw_refs)) {
      expect(compute_e_form(ref, raw_refs), `${el} should have e_form=0`).toBeCloseTo(0, 8)
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

describe(`temperature filtering integration behavior`, () => {
  const baseline_entries: PhaseData[] = [
    {
      composition: { Li: 1 },
      energy: -1,
      energy_per_atom: -1,
      temperatures: [300, 600],
      free_energies: [-1.1, -0.9],
    },
    {
      composition: { O: 1 },
      energy: -2,
      energy_per_atom: -2,
      temperatures: [300, 600],
      free_energies: [-2.2, -1.8],
    },
    {
      composition: { Li: 1, O: 1 },
      energy: -3.2,
      energy_per_atom: -1.6,
      temperatures: [300, 600],
      free_energies: [-1.7, -1.5],
    },
    {
      composition: { Li: 2, O: 1 },
      energy: -5.1,
      energy_per_atom: -1.7,
      temperatures: [300, 900],
      free_energies: [-1.9, -1.3],
    },
    {
      composition: { Li: 1, O: 2 },
      energy: -4.5,
      energy_per_atom: -1.5,
    },
  ]

  test.each([
    { selected_temperature: 300, expected_energy: -1.1 },
    { selected_temperature: 600, expected_energy: -0.9 },
  ])(
    `exact temperature selection replaces entry energies at $selected_temperature K`,
    ({ selected_temperature, expected_energy }) => {
      const filtered_entries = filter_entries_at_temperature(
        baseline_entries,
        selected_temperature,
      )
      const elemental_li_entry = filtered_entries.find(
        (entry) => formula_key_from_composition(entry.composition) === `Li`,
      )
      expect(elemental_li_entry).toBeDefined()
      expect(elemental_li_entry?.energy).toBeCloseTo(expected_energy, 8)
      expect(elemental_li_entry?.energy_per_atom).toBeCloseTo(expected_energy, 8)
    },
  )

  test(`interpolation works within max_interpolation_gap`, () => {
    const interpolated_entries = filter_entries_at_temperature(baseline_entries, 700, {
      interpolate: true,
      max_interpolation_gap: 700,
    })
    const li2o_entry = interpolated_entries.find(
      (entry) => formula_key_from_composition(entry.composition) === `Li2O`,
    )
    expect(li2o_entry).toBeDefined()
    // Linear interpolation between 300K (-1.9) and 900K (-1.3):
    // fraction = (700 - 300) / (900 - 300) = 2/3 => -1.9 + 2/3 * 0.6 = -1.5
    expect(li2o_entry?.energy).toBeCloseTo(-1.5, 8)
    expect(li2o_entry?.energy_per_atom).toBeCloseTo(-1.5, 8)
  })

  test(`entries lacking temperature arrays are preserved`, () => {
    const filtered_entries = filter_entries_at_temperature(baseline_entries, 600)
    const lio2_entry = filtered_entries.find(
      (entry) => formula_key_from_composition(entry.composition) === `LiO2`,
    )
    expect(lio2_entry).toBeDefined()
    expect(lio2_entry?.energy).toBeCloseTo(-4.5, 8)
    expect(lio2_entry?.energy_per_atom).toBeCloseTo(-1.5, 8)
  })

  test(`entries with unavailable temperatures are excluded when interpolation is off or invalid`, () => {
    const non_interpolated_entries = filter_entries_at_temperature(baseline_entries, 700, {
      interpolate: false,
    })
    const strict_gap_entries = filter_entries_at_temperature(baseline_entries, 700, {
      interpolate: true,
      max_interpolation_gap: 500,
    })
    expect(
      non_interpolated_entries.some(
        (entry) => formula_key_from_composition(entry.composition) === `Li2O`,
      ),
    ).toBe(false)
    expect(
      strict_gap_entries.some(
        (entry) => formula_key_from_composition(entry.composition) === `Li2O`,
      ),
    ).toBe(false)
  })

  test(`filtered entries still compute a valid 2D chempot diagram`, () => {
    const filtered_entries = filter_entries_at_temperature(baseline_entries, 600)
    const result = compute_chempot_diagram(filtered_entries, {
      default_min_limit: -20,
      formal_chempots: false,
    })
    expect(result.elements).toHaveLength(2)
    expect(Object.keys(result.domains)).toEqual(expect.arrayContaining([`Li`, `O`]))
  })
})

describe(`get_ternary_combinations`, () => {
  test.each([
    { elements: [], expected: [] as string[][], label: `empty` },
    { elements: [`Li`], expected: [], label: `unary` },
    { elements: [`Li`, `O`], expected: [], label: `binary` },
    {
      elements: [`O`, `Fe`, `Li`],
      expected: [[`Fe`, `Li`, `O`]],
      label: `ternary`,
    },
    {
      elements: [`O`, `Ni`, `Co`, `Li`],
      expected: [
        [`Co`, `Li`, `Ni`],
        [`Co`, `Li`, `O`],
        [`Co`, `Ni`, `O`],
        [`Li`, `Ni`, `O`],
      ],
      label: `quaternary`,
    },
    { elements: [`Co`, `Li`, `Ni`, `O`, `S`], expected_count: 10, label: `quinary` },
  ])(`$label system ($elements)`, ({ elements, expected, expected_count }) => {
    const combos = get_ternary_combinations(elements)
    if (expected !== undefined) expect(combos).toEqual(expected)
    else expect(combos).toHaveLength(expected_count ?? Number.NaN)
  })
})

describe(`make_nd_cache_key`, () => {
  const li: PhaseData = { composition: { Li: 1 }, energy: -3 }
  const oxygen: PhaseData = { composition: { O: 1 }, energy: -5 }
  const base_key = make_nd_cache_key([li, oxygen], true, -50, undefined)

  test.each([
    {
      a: { composition: { Li: 2 }, energy: -6, energy_per_atom: -3 },
      b: { composition: { Li: 2 }, energy: -6, energy_per_atom: -2.5 },
      same: false,
      label: `different EPA`,
    },
    {
      a: { composition: { Li: 1 }, energy: -3 },
      b: { composition: { Li: 2 }, energy: -3 },
      same: false,
      label: `different composition`,
    },
    {
      a: { composition: { Li: 1 }, energy: -3 },
      b: { composition: { Li: 1 }, energy: -3, energy_per_atom: -3 },
      same: true,
      label: `EPA matches total/atoms`,
    },
    { a: li, b: oxygen, same: true, label: `order invariance`, multi: true },
  ])(`nd cache key same=$same for $label`, ({ a, b, same, multi }) => {
    if (multi) {
      expect(make_nd_cache_key([a, b], true, -50, undefined)).toBe(
        make_nd_cache_key([b, a], true, -50, undefined),
      )
      expect(make_nd_cache_key([a, b], true, -50, undefined)).toBe(base_key)
    } else {
      expect(
        make_nd_cache_key([a], true, -50, undefined) ===
          make_nd_cache_key([b], true, -50, undefined),
      ).toBe(same)
    }
  })

  test.each([
    {
      kept: { composition: { Li: 2, O: 1 }, energy: -10, exclude_from_hull: false },
      dropped: { composition: { Li: 4, O: 2 }, energy: -20, exclude_from_hull: true },
    },
    {
      kept: { composition: { Li: 1 }, energy: -3, is_stable: true },
      dropped: { composition: { Li: 1 }, energy: -3, is_stable: false },
    },
    {
      kept: { composition: { Li: 1 }, energy: -3, e_above_hull: 0 },
      dropped: { composition: { Li: 1 }, energy: -3, e_above_hull: 0.1 },
    },
  ])(`EPA ties keep preferred entry independent of order`, ({ kept, dropped }) => {
    expect(get_min_entries_and_el_refs([kept, dropped]).min_entries[0]).toBe(kept)
    expect(get_min_entries_and_el_refs([dropped, kept]).min_entries[0]).toBe(kept)
    expect(make_nd_cache_key([kept, dropped], true, -50, undefined)).toBe(
      make_nd_cache_key([dropped, kept], true, -50, undefined),
    )
  })

  test.each([
    {
      label: `different compositions`,
      phase_entries: [
        { composition: { Fe: 1 }, energy: -3 },
        { composition: { Co: 1 }, energy: -5 },
      ],
    },
    {
      label: `different energies`,
      phase_entries: [
        { composition: { Li: 1 }, energy: -4 },
        { composition: { O: 1 }, energy: -4 },
      ],
    },
    {
      label: `different hull stability`,
      phase_entries: [
        { composition: { Li: 1 }, energy: -3, is_stable: true, e_above_hull: 0 },
        { composition: { O: 1 }, energy: -5, is_stable: false, e_above_hull: 0.1 },
      ],
    },
    { label: `different formal_chempots`, phase_entries: [li, oxygen], formal: false },
    {
      label: `different limits`,
      phase_entries: [li, oxygen],
      limits: { Li: [-10, 0] as [number, number] },
    },
  ])(`$label → different key`, ({ phase_entries, formal = true, limits }) => {
    expect(make_nd_cache_key(phase_entries, formal, -50, limits)).not.toBe(base_key)
  })
})

describe(`N-D projection cache consistency`, () => {
  const config_base = { default_min_limit: -25, formal_chempots: true }

  test(`shared N-D formula set across projections; display lims follow elements`, () => {
    const proj_a = compute_chempot_diagram(ytos_entries, {
      ...config_base,
      elements: [`O`, `Ti`, `Y`],
    })
    const proj_b = compute_chempot_diagram(ytos_entries, {
      ...config_base,
      elements: [`S`, `Ti`, `Y`],
    })
    // Both projections see the same N-D domains; formula keys match
    expect(Object.keys(proj_a.domains).sort()).toEqual(Object.keys(proj_b.domains).sort())

    const binary_proj = compute_chempot_diagram(ytos_entries, {
      ...config_base,
      elements: [`S`, `Y`],
    })
    expect(binary_proj.elements).toEqual([`S`, `Y`])
    expect(binary_proj.lims).toHaveLength(2)
    for (const [min_val, max_val] of binary_proj.lims) {
      expect(min_val).toBeLessThan(max_val)
    }
  })

  test(`changing formal_chempots invalidates cache (different domain coords)`, () => {
    const formal = compute_chempot_diagram(ytos_entries, {
      ...config_base,
      elements: [`O`, `Ti`, `Y`],
    })
    const absolute = compute_chempot_diagram(ytos_entries, {
      ...config_base,
      formal_chempots: false,
      elements: [`O`, `Ti`, `Y`],
    })
    expect(formal.domains.O2Ti[0][0]).not.toBeCloseTo(absolute.domains.O2Ti[0][0], 1)
  })
})

describe(`bbox_diagonal`, () => {
  test.each([
    { points: [], expected: 0, label: `empty` },
    { points: [[1, 2, 3]], expected: 0, label: `single point` },
    {
      points: [
        [5, 5],
        [5, 5],
        [5, 5],
      ],
      expected: 0,
      label: `coincident points`,
    },
    {
      points: [
        [0, 0, 0],
        [1, 1, 1],
        [0, 1, 0],
      ],
      expected: Math.sqrt(3),
      label: `unit cube`,
    },
    {
      points: [
        [0, 0],
        [3, 0],
        [3, 4],
        [0, 4],
      ],
      expected: 5,
      label: `3×4 rectangle`,
    },
  ])(`$label → $expected`, ({ points, expected }) => {
    expect(bbox_diagonal(points)).toBeCloseTo(expected, 10)
  })
})

describe(`scale_to_font_range`, () => {
  test.each([
    { sizes: [1, 5, 3], min: 8, max: 16, expected: [8, 16, 12], label: `min/max/mid` },
    { sizes: [3, 3, 3], min: 10, max: 20, expected: [15, 15, 15], label: `equal → midpoint` },
    { sizes: [42], min: 10, max: 20, expected: [15], label: `single → midpoint` },
  ])(`$label`, ({ sizes, min, max, expected }) => {
    expect(scale_to_font_range(sizes, min, max)).toEqual(expected)
  })

  test(`preserves relative ordering`, () => {
    const fonts = scale_to_font_range([10, 2, 7, 1, 9], 6, 18)
    expect(fonts[3]).toBeLessThan(fonts[1]) // 1 < 2
    expect(fonts[1]).toBeLessThan(fonts[2]) // 2 < 7
    expect(fonts[2]).toBeLessThan(fonts[4]) // 7 < 9
    expect(fonts[4]).toBeLessThan(fonts[0]) // 9 < 10
  })
})

describe(`get_visible_domain_labels`, () => {
  test(`returns one area-weighted label per visible formula`, () => {
    const face_positions = [
      // Two triangles for one square facet owned by AB
      0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 0, 0, 2, 2, 0, 0, 2, 0,
      // One separate facet owned by AC
      10, 0, 0, 11, 0, 0, 10, 1, 0,
    ]
    const labels = get_visible_domain_labels(
      face_positions,
      [`AB`, `AB`, `AC`],
      new Map([
        [`AB`, 14],
        [`AC`, 10],
        [`AD`, 8],
      ]),
    )

    expect(labels.map((label) => label.formula)).toEqual([`AB`, `AC`])
    expect(labels[0].position).toEqual([1, 1, 0])
    expect(labels[0].label_font_size).toBe(14)
    expect(labels[1].position).toEqual([10 + 1 / 3, 1 / 3, 0])
  })

  test(`ignores zero-area faces and formulas without visible facets`, () => {
    const labels = get_visible_domain_labels(
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0],
      [`AB`, `AC`],
      new Map([[`AB`, 12]]),
    )

    expect(labels).toEqual([])
  })

  test(`combines separated visible facets of the same domain`, () => {
    const labels = get_visible_domain_labels(
      [
        // Two equal-area facets owned by AB, separated in space
        0, 0, 0, 1, 0, 0, 0, 1, 0, 3, 0, 0, 4, 0, 0, 3, 1, 0,
      ],
      [`AB`, `AB`],
      new Map([[`AB`, 12]]),
    )

    expect(labels).toHaveLength(1)
    expect(labels[0].formula).toBe(`AB`)
    expect(labels[0].label_font_size).toBe(12)
    expect(labels[0].position).toEqual([expect.closeTo(11 / 6), expect.closeTo(1 / 3), 0])
  })

  test(`ignores trailing face-domain entries without triangles`, () => {
    const labels = get_visible_domain_labels(
      [0, 0, 0, 1, 0, 0, 0, 1, 0],
      [`AB`, `AC`],
      new Map([
        [`AB`, 12],
        [`AC`, 10],
      ]),
    )

    expect(labels.map((label) => label.formula)).toEqual([`AB`])
  })

  test(`preserves pinned labels for overlay domains without visible facets`, () => {
    const labels = get_visible_domain_labels(
      [0, 0, 0, 1, 0, 0, 0, 1, 0],
      [`AB`],
      new Map([[`AB`, 12]]),
      [
        { formula: `AC`, position: [2, 2, 2], label_font_size: 10 },
        { formula: `AB`, position: [9, 9, 9], label_font_size: 99 },
      ],
    )

    expect(labels.map((label) => label.formula)).toEqual([`AB`, `AC`])
    expect(labels[0].position).toEqual([1 / 3, 1 / 3, 0])
    expect(labels[0].label_font_size).toBe(12)
    expect(labels[1]).toEqual({ formula: `AC`, position: [2, 2, 2], label_font_size: 10 })
  })
})

describe(`compute_chempot_async`, () => {
  const async_entries: PhaseData[] = [
    { composition: { Li: 1 }, energy: -1 },
    { composition: { O: 1 }, energy: -2 },
  ]

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  async function load_async(worker: unknown) {
    vi.stubGlobal(`Worker`, worker)
    vi.resetModules()
    return import(`$lib/chempot-diagram/async-compute.svelte`)
  }

  test(`rejects instead of throwing synchronously when Worker construction fails`, async () => {
    // Must be constructable (`new Worker()`); arrow functions are not.
    function FailingWorker() {
      throw new Error(`worker blocked by CSP`)
    }
    const { compute_chempot_async } = await load_async(FailingWorker)
    await expect(compute_chempot_async(async_entries)).rejects.toThrow(`worker blocked by CSP`)
  })

  test(`falls back to main-thread compute without a Worker global`, async () => {
    const { compute_chempot_async } = await load_async(undefined)
    const data = await compute_chempot_async(async_entries, { elements: [`Li`, `O`] })
    expect(Object.keys(data.domains).length).toBeGreaterThan(0)
  })
})
