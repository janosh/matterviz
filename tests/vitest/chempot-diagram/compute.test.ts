// Tests ported from pymatgen/tests/analysis/test_chempot_diagram.py, plus extensive
// edge-case, invariant, and physical-limit tests that pymatgen's suite lacks.
//
// Key differences from pymatgen:
// - Element ordering: pymatgen uses atomic number [Li, Fe, O], we use alphabetical [Fe, Li, O]
// - Formula keys: pymatgen uses Hill notation (Li2FeO3), we sort alphabetically (FeLi2O3)
// - O2 reduced formula: pymatgen keeps "O2", our get_reduced_formula reduces {O:6} to {O:1} → "O"

import type { VisibleDomainLabel } from '$lib/chempot-diagram/compute'
import {
  apply_element_padding,
  assign_faces_to_domains,
  bbox_diagonal,
  best_form_energy_for_formula,
  build_axis_ranges,
  build_border_hyperplanes,
  build_chempot_hyperplanes,
  build_hyperplanes,
  chebyshev_centre,
  compute_chempot_diagram,
  dedup_points,
  fit_plane,
  formula_key_from_composition,
  get_3d_domain_simplexes_and_ann_loc,
  get_energy_stats_by_formula,
  get_min_entries_and_el_refs,
  get_ternary_combinations,
  get_touches_limits,
  get_visible_domain_labels,
  orthonormal_2d,
  pad_domain_points,
  renormalize_entries,
  safe_energy_per_atom,
  scale_to_font_range,
  simple_pca,
  strip_closing_faces,
} from '$lib/chempot-diagram/compute'
import { get_domain_color_data } from '$lib/chempot-diagram/color'
import { filter_entries_at_temperature, slim_phase_entry } from '$lib/convex-hull/helpers'
import type { PhaseData } from '$lib/convex-hull/types'
import type { Vec2, Vec3 } from '$lib/math'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { load_json, make_phase } from '../setup'

// n-D points written as one flat list, so geometry fixtures stay on a single line
const chunk = (size: number, flat: number[]): number[][] =>
  Array.from({ length: flat.length / size }, (_, idx) =>
    flat.slice(idx * size, (idx + 1) * size),
  )

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
const ternary_hull_input = build_chempot_hyperplanes(entries, cpd_ternary.elements, false)

const cpd_ternary_formal = compute_chempot_diagram(entries, {
  default_min_limit: -25,
  formal_chempots: true,
})
const ternary_formal_hull_input = build_chempot_hyperplanes(
  entries,
  cpd_ternary.elements,
  true,
)

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

// Reorder pymatgen [Li, Fe, O] columns to our [Fe, Li, O]
const reorder_cols = (pts: number[][]): number[][] =>
  pts.map(([li, fe, oxygen]) => [fe, li, oxygen])

const sort_rows = (pts: number[][]): number[][] =>
  [...pts]
    .map((row) => row.map((val) => Math.round(val * 1e6) / 1e6))
    .toSorted((a, b) => {
      for (let idx = 0; idx < a.length; idx++) {
        if (a[idx] !== b[idx]) return a[idx] - b[idx]
      }
      return 0
    })

// Thin wrapper over production dedup_points (keeps just the unique points)
const dedup_vertices = (pts: number[][], tol: number = 1e-4): number[][] =>
  dedup_points(pts, tol).unique

// Element-wise toBeCloseTo over rows of numbers
const close_rows = (rows: number[][], digits: number) =>
  rows.map((row) => row.map((val) => expect.closeTo(val, digits)))

// Elemental references of the analytic A-B test systems
const AB_REFS: Record<string, PhaseData> = {
  A: make_phase({ A: 1 }, -2.0),
  B: make_phase({ B: 1 }, -3.0),
}

// Every domain vertex lies inside the diagram's axis limits (4-decimal tolerance)
function expect_within_lims({
  domains,
  lims,
}: {
  domains: Record<string, number[][]>
  lims: Vec2[]
}) {
  for (const pts of Object.values(domains)) {
    for (const pt of pts) {
      for (const [axis, [lo, hi]] of lims.entries()) {
        expect(pt[axis]).toBeGreaterThanOrEqual(lo - 1e-4)
        expect(pt[axis]).toBeLessThanOrEqual(hi + 1e-4)
      }
    }
  }
}

// Each element's domain touches its own mu = 0 axis (formal chempots)
function expect_elemental_touch({
  domains,
  elements,
}: {
  domains: Record<string, number[][]>
  elements: string[]
}) {
  for (const [el_idx, el] of elements.entries()) {
    expect(
      dedup_vertices(domains[el]).some((pt) => Math.abs(pt[el_idx]) < 0.01),
      `${el} formal domain should touch mu_${el}=0`,
    ).toBe(true)
  }
}

// Every vertex satisfies every halfspace a·x + b <= 0 (rows are [...normal, offset])
function expect_feasible(domains: Record<string, number[][]>, halfspaces: number[][]) {
  for (const [formula, pts] of Object.entries(domains)) {
    for (const pt of dedup_vertices(pts)) {
      for (const hs of halfspaces) {
        const val = pt.reduce((sum, coord, idx) => sum + hs[idx] * coord, hs[pt.length])
        expect(val, `Vertex of ${formula} violates halfspace`).toBeLessThanOrEqual(1e-4)
      }
    }
  }
}

describe(`pymatgen parity: ChemicalPotentialDiagram`, () => {
  test(`diagram metadata matches pymatgen`, () => {
    expect(cpd_binary.elements).toEqual([`Fe`, `O`])
    expect(cpd_ternary.elements).toEqual([`Fe`, `Li`, `O`])
    expect(cpd_ternary_formal.elements).toEqual([`Fe`, `Li`, `O`])
    expect(cpd_ternary.lims).toEqual([
      [-25, 0],
      [-25, 0],
      [-25, 0],
    ])
  })

  test.each([
    {
      label: `absolute`,
      refs: ternary_hull_input.el_refs,
      expected: { Li: -1.91301487, Fe: -6.5961471, O: -25.54966885 },
    },
    {
      label: `formal → zero`,
      refs: ternary_formal_hull_input.el_refs,
      expected: { Li: 0, Fe: 0, O: 0 },
    },
  ])(`el_refs ($label)`, ({ refs, expected }) => {
    for (const [el, energy] of Object.entries(expected)) {
      expect(refs[el].energy).toBeCloseTo(energy, 5)
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
    expect(build_border_hyperplanes(lims)).toEqual(close_rows(desired, 5))
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
    const expected = sort_rows(reorder_cols(pmg_vertices))
    expect(sort_rows(dedup_vertices(actual_pts))).toEqual(close_rows(expected, 4))
  })
})

describe(`physical invariants`, () => {
  test(`all domain vertices satisfy all hyperplane constraints`, () => {
    const border = build_border_hyperplanes(cpd_ternary.lims)
    expect(border).toHaveLength(2 * cpd_ternary.elements.length)
    expect_feasible(cpd_ternary.domains, [...ternary_hull_input.hyperplanes, ...border])
  })

  test(`vertices within limits and every element has a domain`, () => {
    for (const el of cpd_ternary.elements) {
      expect(cpd_ternary.domains[el], `Element ${el} has no domain`).toBeDefined()
    }
    expect_within_lims(cpd_ternary)
  })

  test(`elemental domains touch the el_ref energy axis`, () => {
    const fe_ref_e = ternary_hull_input.el_refs.Fe.energy
    const fe_vals = dedup_vertices(cpd_ternary.domains.Fe).map((pt) => pt[0])
    expect(fe_vals.some((val) => Math.abs(val - fe_ref_e) < 0.01)).toBe(true)
  })

  test(`formal chempots touch mu=0 and are non-positive`, () => {
    expect_elemental_touch(cpd_ternary_formal)
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
      for (const hs of ternary_hull_input.hyperplanes) {
        let val = hs[dim]
        for (let jdx = 0; jdx < dim; jdx++) val += hs[jdx] * centroid[jdx]
        if (val < best_energy) best_energy = val
      }
      expect(best_energy).toBeLessThanOrEqual(1e-4)
    }
  })
})

// Exact vertex sets. Sorting + dedup make the comparison independent of enumeration order
// and of the same vertex being reported once per active hyperplane.
const expect_vertices = (actual: number[][], expected: number[][]) => {
  const unique = sort_rows(dedup_vertices(actual, 1e-9))
  expect(unique).toHaveLength(expected.length)
  expect(unique).toEqual(
    sort_rows(expected).map((row) => row.map((val) => expect.closeTo(val, 9))),
  )
}

describe(`analytic binary A-B-AB`, () => {
  // Hyperplanes: mu_A <= E_A, mu_B <= E_B, (mu_A + mu_B)/2 <= E_AB; box [-20, 0]^2
  const ab_binary_entries = [
    ...Object.values(AB_REFS),
    make_phase({ A: 1, B: 1 }, -6.0), // E_form = -6 - (-2 - 3)/2 = -3.5 eV/atom
  ]

  test(`absolute chempots: AB segment spans mu_A + mu_B = -12 between the element lines`, () => {
    const { domains } = compute_chempot_diagram(ab_binary_entries, {
      default_min_limit: -20,
      formal_chempots: false,
    })
    const { el_refs } = build_chempot_hyperplanes(ab_binary_entries, [`A`, `B`], false)
    expect(el_refs.A.energy_per_atom).toBe(-2.0)
    expect(el_refs.B.energy_per_atom).toBe(-3.0)
    expect_vertices(domains.A, [
      [-2, -10],
      [-2, -20],
    ])
    expect_vertices(domains.B, [
      [-9, -3],
      [-20, -3],
    ])
    expect_vertices(domains.AB, [
      [-2, -10],
      [-9, -3],
    ])
  })

  test(`formal chempots shift the element lines to 0 and AB to mu_A + mu_B = -7`, () => {
    const { domains } = compute_chempot_diagram(ab_binary_entries, {
      default_min_limit: -20,
      formal_chempots: true,
    })
    const { el_refs } = build_chempot_hyperplanes(ab_binary_entries, [`A`, `B`], true)
    expect(el_refs.A.energy_per_atom).toBeCloseTo(0, 12)
    expect(el_refs.B.energy_per_atom).toBeCloseTo(0, 12)
    expect_vertices(domains.A, [
      [0, -7],
      [0, -20],
    ])
    expect_vertices(domains.B, [
      [-7, 0],
      [-20, 0],
    ])
    expect_vertices(domains.AB, [
      [0, -7],
      [-7, 0],
    ])
  })

  test(`per-element limits clip the element domains (AB untouched)`, () => {
    const { domains, lims } = compute_chempot_diagram(ab_binary_entries, {
      default_min_limit: -20,
      formal_chempots: true,
      limits: { B: [-10, 0] },
    })
    expect(lims).toEqual([
      [-20, 0],
      [-10, 0],
    ])
    expect_vertices(domains.A, [
      [0, -7],
      [0, -10],
    ])
    expect_vertices(domains.B, [
      [-7, 0],
      [-20, 0],
    ])
    expect_vertices(domains.AB, [
      [0, -7],
      [-7, 0],
    ])
  })

  // The interior point used to seed the halfspace intersection is the Chebyshev centre; a
  // centre-of-box heuristic that assumed equal-width limits declared this region empty
  test(`narrow per-element limit next to a wide default limit (100:1) still yields a diagram`, () => {
    // mu_A <= 0, mu_B <= 0, (1/3) mu_A + (2/3) mu_B <= -50 within A ∈ [-1, 0], B ∈ [-100, 0]
    const { domains, lims } = compute_chempot_diagram(
      [make_phase({ A: 1 }, 0), make_phase({ B: 1 }, 0), make_phase({ A: 1, B: 2 }, -50)],
      { default_min_limit: -100, formal_chempots: true, limits: { A: [-1, 0] } },
    )
    expect(lims).toEqual([
      [-1, 0],
      [-100, 0],
    ])
    // B is never stable inside the box (mu_B = 0 needs mu_A <= -150), so it has no domain
    expect(Object.keys(domains).toSorted()).toEqual([`A`, `AB2`])
    expect_vertices(domains.A, [
      [0, -75],
      [0, -100],
    ])
    expect_vertices(domains.AB2, [
      [0, -75],
      [-1, -74.5],
    ])
  })

  test(`asymmetric limits (12:1) clip every domain vertex to the custom range`, () => {
    const { domains } = compute_chempot_diagram(ab_binary_entries, {
      default_min_limit: -60,
      formal_chempots: false,
      limits: { A: [-5, 0] },
    })
    for (const pts of Object.values(domains)) {
      for (const pt of pts) expect(pt[0]).toBeGreaterThanOrEqual(-5 - 1e-9)
    }
    // mu_B = -3 needs mu_A <= -9 for AB to be unstable, outside A's range: no B domain
    expect(Object.keys(domains).toSorted()).toEqual([`A`, `AB`])
    expect_vertices(domains.A, [
      [-2, -10],
      [-2, -60],
    ])
    expect_vertices(domains.AB, [
      [-2, -10],
      [-5, -7],
    ])
  })

  test.each([
    [`compound below every reachable chemical potential`, { default_min_limit: -10 }],
    [
      `inverted per-element limits`,
      { default_min_limit: -100, limits: { A: [0, -1] as Vec2 } },
    ],
  ])(`genuinely empty region throws (%s)`, (_desc, config) => {
    expect(() =>
      compute_chempot_diagram(
        [make_phase({ A: 1 }, 0), make_phase({ B: 1 }, 0), make_phase({ A: 1, B: 1 }, -50)],
        { ...config, formal_chempots: true },
      ),
    ).toThrow(/Chemical potential region is empty/)
  })

  test(`two elements without compounds: the domains meet only at the box corner`, () => {
    const { domains } = compute_chempot_diagram(
      [make_phase({ X: 1 }, -1.0), make_phase({ Y: 1 }, -2.0)],
      { default_min_limit: -10, formal_chempots: false },
    )
    expect(Object.keys(domains).toSorted()).toEqual([`X`, `Y`])
    expect_vertices(domains.X, [
      [-1, -2],
      [-1, -10],
    ])
    expect_vertices(domains.Y, [
      [-1, -2],
      [-10, -2],
    ])
  })
})

describe(`analytic ternary A-B-C with AB and ABC`, () => {
  // Formal hyperplanes: mu_i <= 0, (mu_A + mu_B)/2 <= -1, (mu_A + mu_B + mu_C)/3 <= -3.
  // Vertices come from intersecting three active constraints; AB's line cuts the ABC
  // triangle's (0, 0, -9) corner off, and the [-50, 0] box closes the element domains.
  const ternary_entries = [
    make_phase({ A: 1 }, -1.0),
    make_phase({ B: 1 }, -2.0),
    make_phase({ C: 1 }, -3.0),
    make_phase({ A: 1, B: 1 }, -2.5), // E_form = -1 eV/atom
    make_phase({ A: 1, B: 1, C: 1 }, -5.0), // E_form = -3 eV/atom
  ]
  const formal_vertices = {
    A: [
      [0, -2, -7],
      [0, -9, 0],
      [0, -50, 0],
      [0, -2, -50],
      [0, -50, -50],
    ],
    B: [
      [-2, 0, -7],
      [-9, 0, 0],
      [-50, 0, 0],
      [-2, 0, -50],
      [-50, 0, -50],
    ],
    C: [
      [0, -9, 0],
      [-9, 0, 0],
      [0, -50, 0],
      [-50, 0, 0],
      [-50, -50, 0],
    ],
    AB: [
      [0, -2, -7],
      [-2, 0, -7],
      [0, -2, -50],
      [-2, 0, -50],
    ],
    ABC: [
      [0, -2, -7],
      [-2, 0, -7],
      [0, -9, 0],
      [-9, 0, 0],
    ],
  }
  // Absolute chempots: every plane moves by the element reference energies (-1, -2, -3),
  // so each vertex coordinate shifts by its element's reference, except coordinates pinned
  // to the -50 box wall, which is an absolute bound
  const ref_energies = [-1, -2, -3]
  const absolute_vertices = Object.fromEntries(
    Object.entries(formal_vertices).map(([formula, vertices]) => [
      formula,
      vertices.map((vertex) =>
        vertex.map((val, axis) => (val === -50 ? -50 : val + ref_energies[axis])),
      ),
    ]),
  )

  test.each([
    [`formal`, true, formal_vertices],
    [`absolute`, false, absolute_vertices],
  ])(`%s chempots reproduce the hand-computed vertex sets`, (_label, formal, expected) => {
    const { domains, elements } = compute_chempot_diagram(ternary_entries, {
      formal_chempots: formal,
    })
    const { hyperplanes } = build_chempot_hyperplanes(ternary_entries, elements, formal)
    expect(elements).toEqual([`A`, `B`, `C`])
    expect(Object.keys(domains).toSorted()).toEqual([`A`, `AB`, `ABC`, `B`, `C`])
    // rows are [x_A, x_B, x_C, -E/atom] in sorted-formula order (A, AB, ABC, B, C)
    const offset = formal ? 0 : 1
    expect(hyperplanes).toEqual(
      [
        [1, 0, 0, 0 + offset],
        [0.5, 0.5, 0, 1 + 1.5 * offset],
        [1 / 3, 1 / 3, 1 / 3, 3 + 2 * offset],
        [0, 1, 0, 0 + 2 * offset],
        [0, 0, 1, 0 + 3 * offset],
      ].map((row) => row.map((val) => expect.closeTo(val, 12))),
    )
    for (const [formula, vertices] of Object.entries(expected)) {
      expect_vertices(domains[formula], vertices)
    }
  })

  test(`a metastable compound passes the E_form filter but carves out no domain`, () => {
    // A2B at -0.4 eV/atom lies 0.27 eV above the A-AB tie line (-2/3 at x_B = 1/3), so its
    // plane 2 mu_A + mu_B <= -1.2 is slack everywhere inside the region the others bound
    const with_metastable = [...ternary_entries, make_phase({ A: 2, B: 1 }, -0.4 - 4 / 3)]
    const { domains, elements } = compute_chempot_diagram(with_metastable, {
      formal_chempots: true,
    })
    const { hyperplane_entries } = build_chempot_hyperplanes(with_metastable, elements, true)
    expect(
      hyperplane_entries.map((entry) => formula_key_from_composition(entry.composition)),
    ).toContain(`A2B`)
    expect(Object.keys(domains).toSorted()).toEqual([`A`, `AB`, `ABC`, `B`, `C`])
    for (const [formula, vertices] of Object.entries(formal_vertices)) {
      expect_vertices(domains[formula], vertices)
    }
  })
})

describe(`error handling`, () => {
  test.each([
    {
      label: `< 2 elements`,
      phase_entries: [make_phase({ A: 1 }, -1.0)],
      message: `requires 2+ elements`,
    },
    {
      label: `missing elemental ref`,
      phase_entries: [make_phase({ A: 1, B: 1 }, -3.0), make_phase({ A: 2, B: 1 }, -5.0)],
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
      label: `distinguishes compositions and identifies elemental refs`,
      phase_entries: [
        make_phase({ A: 1 }, -1.0),
        make_phase({ B: 1 }, -2.0),
        make_phase({ A: 1, B: 1 }, -3.0),
      ],
      assert: ({ min_entries, el_refs }: ReturnType<typeof get_min_entries_and_el_refs>) => {
        expect(min_entries).toHaveLength(3)
        expect(el_refs.A.energy_per_atom).toBe(-1.0)
        expect(el_refs.B.energy_per_atom).toBe(-2.0)
      },
    },
    {
      label: `picks lowest-energy polymorph per composition`,
      phase_entries: [
        make_phase({ Fe: 1 }, -6.0),
        make_phase({ Fe: 1 }, -6.5),
        make_phase({ Fe: 1 }, -6.2),
        make_phase({ O: 2 }, -8.0),
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
        make_phase({ A: 1 }, bad),
        make_phase({ A: 1 }, -2),
        make_phase({ B: 1 }, bad),
      ]).min_entries.map((entry) => entry.energy_per_atom),
    ).toEqual([-2])
    expect(
      best_form_energy_for_formula(
        [
          { ...make_phase({ A: 1, B: 1 }, -1), e_form_per_atom: bad },
          { ...make_phase({ A: 1, B: 1 }, -1), e_form_per_atom: -0.5 },
        ],
        `AB`,
        { A: make_phase({ A: 1 }, 0), B: make_phase({ B: 1 }, 0) },
      ),
    ).toBe(-0.5)
  })
})

describe(`renormalize_entries`, () => {
  test.each([
    {
      label: `pure elements renormalize to zero`,
      phase_entries: Object.values(AB_REFS),
      expected_epa: [0, 0],
      expected_energy: [0, 0],
    },
    {
      label: `compound formation energy is preserved`,
      phase_entries: [make_phase({ A: 1, B: 1 }, -3.0)],
      expected_epa: [-0.5],
      expected_energy: [-1.0],
    },
  ])(`$label`, ({ phase_entries, expected_epa, expected_energy }) => {
    const renormed = renormalize_entries(phase_entries, AB_REFS)
    expect(renormed.map((entry) => [entry.energy_per_atom, entry.energy])).toEqual(
      close_rows(
        expected_epa.map((epa, idx) => [epa, expected_energy[idx]]),
        8,
      ),
    )
  })
})

describe(`build_hyperplanes`, () => {
  const { hyperplanes, hyperplane_entries } = build_hyperplanes(
    [...Object.values(AB_REFS), make_phase({ A: 1, B: 1 }, -6.0)],
    AB_REFS,
    [`A`, `B`],
  )

  // each row is [atomic fraction per element..., -energy_per_atom], in input order
  test(`emits one [fractions..., -E/atom] row per element ref and stable compound`, () => {
    expect(
      hyperplane_entries.map((entry) => formula_key_from_composition(entry.composition)),
    ).toEqual([`A`, `B`, `AB`])
    expect(hyperplanes).toEqual(
      close_rows(
        [
          [1, 0, 2],
          [0, 1, 3],
          [0.5, 0.5, 6],
        ],
        12,
      ),
    )
  })

  test.each([
    {
      label: `precomputed hull stability excludes known above-hull phases`,
      refs: {
        A: { ...make_phase({ A: 1 }, -2), is_stable: true, e_above_hull: 0 },
        B: { ...make_phase({ B: 1 }, -3), is_stable: true, e_above_hull: 0 },
      },
      extra: [
        { ...make_phase({ A: 1, B: 1 }, -6), is_stable: true, e_above_hull: 0 },
        { ...make_phase({ A: 2, B: 1 }, -5), is_stable: false, e_above_hull: 0.2 },
      ],
      expected: [`A`, `B`, `AB`],
    },
    {
      // AB has E_form = -3.5 eV/atom here, yet a stale `is_stable: false` deletes its domain
      label: `stale hull flags from a larger chemsys drop a locally stable phase`,
      refs: {
        A: { ...make_phase({ A: 1 }, -2), is_stable: true, e_above_hull: 0 },
        B: { ...make_phase({ B: 1 }, -3), is_stable: true, e_above_hull: 0 },
      },
      extra: [{ ...make_phase({ A: 1, B: 1 }, -6), is_stable: false, e_above_hull: 0.2 }],
      expected: [`A`, `B`],
    },
    {
      label: `falls back to negative formation energy when hull stability is absent`,
      refs: {
        A: make_phase({ A: 1 }, -2),
        B: make_phase({ B: 1 }, -3),
      },
      extra: [make_phase({ A: 2, B: 1 }, -5)],
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
  test(`axis limits ignore near-default points; pad_domain_points replaces only those`, () => {
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
    // component signs are arbitrary, so compare magnitudes
    expect(scores.map((row) => row.map(Math.abs))).toEqual(
      close_rows(
        expected_2d.map((row) => row.map(Math.abs)),
        3,
      ),
    )
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
    expect(eigenvectors).toHaveLength(2)
    for (const ev of eigenvectors) {
      expect(Math.hypot(...ev)).toBeCloseTo(1.0, 6)
    }
    const dot = eigenvectors[0].reduce((sum, val, idx) => sum + val * eigenvectors[1][idx], 0)
    expect(Math.abs(dot)).toBeLessThan(1e-6)
  })

  // Rank-deficient input leaves nothing in the deflated covariance for the second component to
  // converge to, so the loop broke with `vec` still at its raw seed - not orthogonal to the
  // first, and for 3 collinear points literally the same vector again. `is_planar`'s
  // reconstruction check then judged a trivially planar domain non-planar, and
  // ChemPotDiagram3D fell through to hull_crease_edges, which threw on collinear points and
  // left the domain with no outline at all.
  test.each([
    [
      `4 collinear points`,
      [
        [0, 0, 0],
        [1, 1, 1],
        [2, 2, 2],
        [3, 3, 3],
      ],
    ],
    [
      `3 collinear points`,
      [
        [0, 0, 0],
        [1, 1, 1],
        [2, 2, 2],
      ],
    ],
    [
      `coincident points`,
      [
        [2, 2, 2],
        [2, 2, 2],
        [2, 2, 2],
      ],
    ],
  ])(`returns an orthonormal basis for %s`, (_case, data) => {
    const { eigenvectors } = simple_pca(data, 2)
    expect(eigenvectors).toHaveLength(2)
    for (const ev of eigenvectors) expect(Math.hypot(...ev)).toBeCloseTo(1, 12)
    const dot = eigenvectors[0].reduce((sum, val, idx) => sum + val * eigenvectors[1][idx], 0)
    expect(Math.abs(dot)).toBeLessThan(1e-12) // was 0.577 for collinear, 1.0 for coincident
  })

  // Regression: an elemental domain has zero variance along its own axis. Seeding power
  // iteration with e_x made the first "eigenvector" that null direction, collapsing the
  // projected polygon onto a line (1 edge instead of n, label anchor on the boundary).
  test.each([0, 1, 2])(
    `spans the plane of a polygon with zero variance along axis %i`,
    (flat_axis) => {
      const polygon = [
        [0, 0],
        [4, 0],
        [6, 3],
        [4, 7],
        [0, 7],
        [-2, 3],
      ].map(([u_val, v_val]) => {
        const point = [-6.6, -6.6, -6.6]
        point[(flat_axis + 1) % 3] = u_val
        point[(flat_axis + 2) % 3] = v_val
        return point
      })
      const { scores, eigenvectors } = simple_pca(polygon, 2)
      for (const ev of eigenvectors) expect(Math.abs(ev[flat_axis])).toBeLessThan(1e-9)
      // the two components reconstruct every vertex: projection is lossless
      const mean = [0, 1, 2].map((dim) => polygon.reduce((sum, pt) => sum + pt[dim], 0) / 6)
      for (const [idx, point] of polygon.entries()) {
        const rebuilt = mean.map(
          (mean_val, dim) =>
            mean_val +
            scores[idx][0] * eigenvectors[0][dim] +
            scores[idx][1] * eigenvectors[1][dim],
        )
        expect(rebuilt).toEqual(point.map((val) => expect.closeTo(val, 9)))
      }
      const { simplex_indices, ann_loc, is_planar } =
        get_3d_domain_simplexes_and_ann_loc(polygon)
      expect(simplex_indices).toHaveLength(6)
      expect(is_planar).toBe(true)
      expect(ann_loc[flat_axis]).toBeCloseTo(-6.6, 9)
    },
  )

  // Regression: near-square planar domains have two almost-equal eigenvalues, so power
  // iteration does not converge in 100 steps; without re-orthogonalization the second
  // component drifted (v1·v2 up to 1.5e-3) and a planar rectangle was reported non-planar
  test.each([0.999, 0.99, 0.97, 0.95])(
    `tilted rectangle with side ratio %d has orthonormal components and is planar`,
    (ratio) => {
      const u_axis = [1, 1, 0].map((val) => val / Math.SQRT2)
      const w_axis = [-1, 1, 2].map((val) => val / Math.sqrt(6))
      const rect = [-1, 1].flatMap((s_val) =>
        [-ratio, ratio].map((t_val) =>
          [0, 1, 2].map((dim) => -3 + s_val * u_axis[dim] + t_val * w_axis[dim]),
        ),
      )
      const { eigenvectors } = simple_pca(rect, 2)
      const dot = eigenvectors[0].reduce(
        (sum, val, idx) => sum + val * eigenvectors[1][idx],
        0,
      )
      expect(Math.abs(dot)).toBeLessThan(1e-12)
      const { simplex_indices, is_planar } = get_3d_domain_simplexes_and_ann_loc(rect)
      expect(is_planar).toBe(true)
      expect(simplex_indices).toHaveLength(4)
    },
  )
})

describe(`orthonormal_2d`, () => {
  test.each([
    // perp = [-dy, dx] normalized
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
        [0, 5],
        [10, 5],
      ],
      expected: [0, 1],
      label: `horizontal`,
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

describe(`config.elements projection vs subsystem`, () => {
  // every stable phase of the full Fe-Li-O hull, in our alphabetical formula-key notation
  const fe_li_o_stable = [
    `Fe`,
    `Fe2O3`,
    `Fe3O4`,
    `FeLi2O3`,
    `FeLi5O4`,
    `FeLiO2`,
    `FeO`,
    `Li`,
    `Li2O`,
    `LiO`,
    `O`,
  ]

  test(`binary elements on ternary data triggers projection (includes Li phases)`, () => {
    const result = compute_chempot_diagram(entries, {
      elements: [`Fe`, `O`],
      default_min_limit: -25,
      formal_chempots: false,
    })
    expect(result.elements).toEqual([`Fe`, `O`])
    // Projection mode: Li-containing phases are projected onto the Fe-O axes, so ALL
    // stable ternary phases get a domain, whereas the plain Fe-O subsystem only has the
    // Li-free ones
    expect(Object.keys(result.domains).toSorted()).toEqual(fe_li_o_stable)
    expect(Object.keys(cpd_binary.domains).toSorted()).toEqual(
      fe_li_o_stable.filter((formula) => !formula.includes(`Li`)),
    )
  })

  test(`standalone binary data produces subsystem (no projection)`, () => {
    // binary_entries only contain Fe and O → no projection triggered
    const result = compute_chempot_diagram(binary_entries, {
      elements: [`Fe`, `O`],
      default_min_limit: -25,
      formal_chempots: false,
    })
    const formulas = Object.keys(result.domains).toSorted()
    const expected = Object.keys(cpd_binary.domains).toSorted()
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
    // Same domains as cpd_ternary (computed without config.elements)
    expect(Object.keys(result.domains).toSorted()).toEqual(fe_li_o_stable)
    expect(Object.keys(cpd_ternary.domains).toSorted()).toEqual(fe_li_o_stable)
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

      expect(sort_rows(feo_tight_interior)).toEqual(
        close_rows(sort_rows(feo_wide_interior), 3),
      )
    })

    test(`formal vs absolute produces same domains`, () => {
      expect(Object.keys(cpd_ternary_formal.domains).toSorted()).toEqual(
        Object.keys(cpd_ternary.domains).toSorted(),
      )
    })
  })
})

// YTOS data from doped: github.com/SMTG-Bham/doped/blob/main/examples/YTOS/ytos_phase_diagram.json
describe(`YTOS quaternary system (projection mode)`, () => {
  // Projection keeps every stable phase of the full Y-Ti-O-S hull regardless of which
  // three elements span the axes, so both diagrams carry the same 29 domains
  const ytos_stable = [
    `O`,
    `O12S3Y2`,
    `O2S`,
    `O2SY2`,
    `O2Ti`,
    `O3S`,
    `O3Ti2`,
    `O3Y2`,
    `O5S2Ti2Y2`,
    `O5STi`,
    `O5TiY2`,
    `O7Ti2Y2`,
    `O8S2Ti`,
    `OTi`,
    `OTi2`,
    `OTi3`,
    `OTi6`,
    `S`,
    `S2Ti`,
    `S3Ti`,
    `S3Ti8`,
    `S3Y2`,
    `S7Y5`,
    `S8Ti5`,
    `STi`,
    `STi2`,
    `SY`,
    `Ti`,
    `Y`,
  ]
  test.each([
    { label: `Y-Ti-O`, diagram: ytos_y_ti_o, elements: [`O`, `Ti`, `Y`] },
    { label: `Ti-O-S`, diagram: ytos_ti_o_s, elements: [`O`, `S`, `Ti`] },
  ])(
    `$label projection metadata, all stable phases, and 3-column vertices`,
    ({ diagram, elements }) => {
      expect(diagram.elements).toEqual(elements)
      expect(diagram.lims).toHaveLength(3)
      expect(Object.keys(diagram.domains).toSorted()).toEqual(ytos_stable)
      for (const points of Object.values(diagram.domains)) {
        for (const point of points) expect(point).toHaveLength(3)
      }
    },
  )

  test(`Y-Ti-O has Y2Ti2O7, in-bounds vertices, and elemental mu=0 touch`, () => {
    const key = `O7Ti2Y2`
    expect(ytos_y_ti_o.domains[key], `Domain for ${key} (Y2Ti2O7)`).toBeDefined()
    expect(dedup_vertices(ytos_y_ti_o.domains[key]).length).toBeGreaterThanOrEqual(3)
    for (const pts of Object.values(ytos_y_ti_o.domains)) {
      for (const pt of pts) for (const chempot of pt) expect(chempot).toBeLessThanOrEqual(1e-4)
    }
    expect_within_lims(ytos_y_ti_o)
    expect_elemental_touch(ytos_y_ti_o)
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
      pts: [] as number[][],
      tol: 1e-4,
      n_unique: 0,
      indices: [] as number[],
      label: `empty`,
    },
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
      label: `multiple exact duplicates scattered`,
    },
  ])(`$label → $n_unique unique`, ({ pts, tol, n_unique, indices }) => {
    const result = dedup_points(pts, tol)
    expect(result.unique).toHaveLength(n_unique)
    expect(result.orig_indices).toEqual(indices)
    for (let idx = 0; idx < result.unique.length; idx++) {
      expect(result.unique[idx]).toEqual(pts[result.orig_indices[idx]])
    }
  })
})

describe(`fit_plane`, () => {
  // n . p = d for the plane 2x + 3y + 6z = 12 (|n| = 7)
  const on_plane = chunk(3, [6, 0, 0, 0, 4, 0, 0, 0, 2, 3, 2, 0, 1.5, 1, 1])

  test.each([
    [`fewer than 3 unique points`, on_plane.slice(0, 2)],
    [`collinear points`, [0, 1, 2, 3].map((val) => [val, val, val])],
    [`points spanning a volume`, [...on_plane, [0, 0, 0]]], // origin is 12/7 off the plane
  ])(`returns null for %s`, (_label, points) => {
    expect(fit_plane(points)).toBeNull()
  })

  test(`rel_tol is relative to the bounding-box diagonal`, () => {
    // bbox diagonal of `on_plane` is ~7.5, so a 1e-3 out-of-plane nudge needs rel_tol > ~1.4e-4
    const nudged = [...on_plane.slice(0, 4), [1.5 + 2e-3 / 7, 1 + 3e-3 / 7, 1 + 6e-3 / 7]]
    expect(fit_plane(nudged, 1e-6)).toBeNull()
    expect(fit_plane(nudged, 1e-2)).not.toBeNull()
  })

  // Recovers the unit normal and offset at any coordinate scale. The PCA rank threshold used
  // to be an absolute epsilon on a covariance entry, i.e. on a length squared, so a domain a
  // micro-eV across had a second eigenvalue near 1e-13, was called rank-deficient, and came
  // back as an arbitrary direction — a perfectly flat domain reported as non-planar.
  test.each([1e6, 1e3, 1, 1e-3, 1e-6, 1e-9])(
    `fits a plane at coordinate scale %s`,
    (scale) => {
      const plane = fit_plane(on_plane.map((pt) => pt.map((val) => val * scale)))
      if (!plane) throw new Error(`expected a plane at scale ${scale}`)
      const sign = Math.sign(plane.offset) || 1 // either face normal is valid
      expect(plane.normal.map((val) => val * sign)).toEqual(
        [2 / 7, 3 / 7, 6 / 7].map((val) => expect.closeTo(val, 9)),
      )
      expect((plane.offset * sign) / scale).toBeCloseTo(12 / 7, 9)
    },
  )

  // A hairline domain must never come back with an arbitrary plane: below the aspect ratio
  // simple_pca can still resolve a second axis for, fit_plane has to return null and let the
  // caller fall back rather than hand out a normal it guessed. Rotated off the axes, so a
  // fallback basis vector cannot pass for the real second axis.
  const [cos_z, sin_z, cos_x, sin_x] = [0.5, 0.7].flatMap((ang) => [
    Math.cos(ang),
    Math.sin(ang),
  ])
  const rotate = ([x_val, y_val, z_val]: number[]): Vec3 => {
    const [rot_x, rot_y] = [cos_z * x_val - sin_z * y_val, sin_z * x_val + cos_z * y_val]
    return [rot_x, cos_x * rot_y - sin_x * z_val, sin_x * rot_y + cos_x * z_val]
  }

  test.each([1e-2, 1e-4, 1e-5, 1e-6, 1e-8])(`hairline sliver of aspect %s`, (aspect) => {
    const rect = chunk(3, [0, 0, 0, 1, 0, 0, 1, aspect, 0, 0, aspect, 0])
    const plane = fit_plane(rect.map(rotate))
    if (!plane) return // rejecting a sliver is the safe answer
    const truth = rotate([0, 0, 1])
    expect(
      Math.abs(plane.normal.reduce((sum, val, idx) => sum + val * truth[idx], 0)),
    ).toBeCloseTo(1, 9)
  })

  test(`in_outline separates the polygon from the rest of its plane`, () => {
    const plane = fit_plane(on_plane)
    if (!plane) throw new Error(`expected a plane`)
    expect(plane.in_outline([2, 1, 1])).toBe(true) // 2*2 + 3*1 + 6*1 = 13, ~on plane, inside
    expect(plane.in_outline([12, -4, 0])).toBe(false) // on the plane, far outside the outline
  })
})

// The tolerance used to be an absolute 1e-3 eV, so a window narrower than a few meV called
// every domain clipped on every bound.
describe(`get_touches_limits`, () => {
  const elements = [`Y`, `Ti`]
  test.each([
    [`wide window`, [-25, 0], [-25, -12, -3, -0.5], [`Y lower bound`]],
    // in a 4 meV window a domain 0.1 meV clear of every bound is inside all four, though an
    // absolute 1e-3 eV tolerance calls it clipped on all four
    [`narrow window`, [-0.004, 0], [-0.0039, -0.0039, -0.0001, -0.0001], []],
    [
      `domain spanning a narrow window`,
      [-0.004, 0],
      [-0.004, -0.004, 0, 0],
      [`Y lower bound`, `Y upper bound`, `Ti lower bound`, `Ti upper bound`],
    ],
  ])(`%s`, (_label, window, flat_points, expected) => {
    const lims = [window, window] as Vec2[]
    expect(get_touches_limits(chunk(2, flat_points), lims, elements)).toEqual(expected)
  })
})

describe(`strip_closing_faces`, () => {
  // Tetrahedron on the origin and the three unit steps into the negative octant. Its three
  // coordinate-plane faces are real boundaries; the slanted fourth has outward normal
  // (-1, -1, -1) and is the artificial wall closing a diagram at its lower axis limits. It is
  // also the only face with no corner at the origin.
  const corners = [[0, 0, 0], ...[0, 1, 2].map((axis) => [0, 0, 0].with(axis, -1))]
  const tris = [0, 1, 2, 3].map((drop) => [0, 1, 2, 3].filter((idx) => idx !== drop))

  // winding must not matter: normals are oriented against the hull centroid, not the buffer
  test.each([
    [`as wound`, tris],
    [`reversed`, tris.map((tri) => tri.toReversed())],
  ])(`drops the face closing the negative octant, %s`, (_label, wound) => {
    const kept = strip_closing_faces(wound.flat().flatMap((idx) => corners[idx]))
    expect(kept).toHaveLength(3 * 9) // three of the four triangles survive
    const at_origin = (face: number) =>
      [0, 3, 6].some((corner) =>
        [0, 1, 2].every((axis) => kept?.[face * 9 + corner + axis] === 0),
      )
    expect([0, 1, 2].map(at_origin)).toEqual([true, true, true])
  })

  test.each([[[]], [[0, 0, 0, -1, 0, 0, 0, -1]]])(
    `returns null for %s, a buffer holding no whole triangle`,
    (positions) => expect(strip_closing_faces(positions)).toBeNull(),
  )
})

describe(`assign_faces_to_domains`, () => {
  // `Strip` and `Blob` are coplanar (z = 0), `Wall` is not (x = 0). Nearest-centroid
  // assignment, the Voronoi rule this replaced, mislabels two of the three faces below: the
  // strip's far end goes to `Blob` (3.59 vs 4.67) and the wall's low end to `Strip`
  // (6.15 vs 10.67).
  const domains = [
    { formula: `Strip`, points: chunk(3, [0, 0, 0, 12, 0, 0, 12, 1, 0, 0, 1, 0]) },
    { formula: `Blob`, points: chunk(3, [10, 2, 0, 14, 2, 0, 14, 6, 0, 10, 6, 0]) },
    { formula: `Wall`, points: chunk(3, [0, 0, 0, 0, 1, 0, 0, 1, 24, 0, 0, 24]) },
  ]
  const faces = [
    [12, 0, 0, 12, 1, 0, 8, 1, 0], // the strip's far end, coplanar with Blob's outline
    [10, 2, 0, 14, 2, 0, 14, 6, 0], // Blob's own corner, on that same shared plane
    [0, 0, 0, 0, 1, 0, 0, 0, 4], // on the wall's own plane, so the plane test alone decides
  ]

  test(`gives each face of a buffer to the domain whose outline holds it`, () => {
    expect(assign_faces_to_domains(faces.flat(), domains)).toEqual([`Strip`, `Blob`, `Wall`])
  })

  test(`a domain too degenerate to bound a face claims none`, () => {
    const line = { formula: `Line`, points: chunk(3, [0, 0, 0, 1, 0, 0, 2, 0, 0]) }
    expect(assign_faces_to_domains(faces[0], [...domains, line])).toEqual([`Strip`])
  })
})

describe(`safe_energy_per_atom`, () => {
  test.each([
    {
      label: `returns energy_per_atom when present`,
      entry: make_phase({ Fe: 2 }, -3.0),
      expected: -3.0,
    },
    {
      label: `computes from energy / atoms when energy_per_atom missing`,
      entry: { composition: { Fe: 2, O: 1 }, energy: -9.0 },
      expected: -3.0,
    },
    {
      label: `applies the MP total-energy correction like the convex hull`,
      entry: { composition: { Ni: 9, O: 13 }, energy: -22 * 4.643, correction: -22 * 1.445 },
      expected: -6.088,
    },
  ])(`$label`, ({ entry, expected }) => {
    expect(safe_energy_per_atom(entry)).toBeCloseTo(expected, 8)
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
    expect(Number.isNaN(safe_energy_per_atom(entry))).toBe(true)
  })

  test(`get_min_entries skips invalid compositions instead of throwing`, () => {
    const { min_entries } = get_min_entries_and_el_refs([
      { composition: {}, energy: -1 },
      make_phase({ Li: 1 }, -3),
    ])
    expect(min_entries).toHaveLength(1)
    expect(min_entries[0]?.composition).toEqual({ Li: 1 })
  })

  test(`corrections shift domains: a corrected compound becomes stable`, () => {
    // Uncorrected AB (-2.5 eV/atom) sits on the A-B tie line and carves out no domain;
    // a -1 eV total correction (-0.5 eV/atom) makes it stable
    const ab_entries = Object.values(AB_REFS)
    const on_tie_line = make_phase({ A: 1, B: 1 }, -2.5)
    const uncorrected = compute_chempot_diagram([...ab_entries, on_tie_line], {
      formal_chempots: true,
    })
    expect(uncorrected.domains.AB).toBeUndefined()
    const corrected = compute_chempot_diagram(
      [...ab_entries, { ...on_tie_line, correction: -1.0 }],
      { formal_chempots: true },
    )
    expect(Object.keys(corrected.domains).toSorted()).toEqual([`A`, `AB`, `B`])
    // Formal plane (mu_A + mu_B) / 2 = -0.5 → AB meets A at (0, -1) and B at (-1, 0)
    expect_vertices(corrected.domains.AB, [
      [0, -1],
      [-1, 0],
    ])
  })
})

describe(`formula_key_from_composition`, () => {
  test.each([
    { comp: { Fe: 1 }, expected: `Fe`, label: `single element` },
    { comp: { O: 3, Li: 2, Fe: 1 }, expected: `FeLi2O3`, label: `alphabetical sorting` },
    { comp: { Fe: 2, O: 4 }, expected: `FeO2`, label: `reduces to lowest terms` },
    { comp: { Fe: 1, O: 0 }, expected: `Fe`, label: `ignores zero amounts` },
    { comp: { Fe: 2 / 3, Li: 1 / 3 }, expected: `Fe2Li`, label: `fractional 2:1 ratio` },
    // 0.67:0.33 is not 2:1 to within 1/10000, so it stays a distinct composition from Fe2Li
    { comp: { Fe: 0.67, Li: 0.33 }, expected: `Fe67Li33`, label: `rounded 2:1 stays 67:33` },
    { comp: { Fe: 0.005, O: 0.995 }, expected: `FeO199`, label: `dilute ratio resolves` },
    { comp: { Fe: 1.01, O: 2 }, expected: `Fe101O200`, label: `1% off is a real ratio` },
    { comp: { Fe: 1.04, O: 2 }, expected: `Fe13O25`, label: `4% off scales to 13:25` },
  ])(`$label → $expected`, ({ comp, expected }) => {
    const key = formula_key_from_composition(comp as Record<string, number>)
    expect(key).toBe(expected)
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
    expect(result.is_planar).toBe(true)
    if (edges) expect(result.simplex_indices).toEqual(edges)
    if (ann_loc) expect(result.ann_loc).toEqual(ann_loc)
    if (n_edges > 0) assert_valid_edges(result, pts.length)
  })

  test.each([
    [
      `tetrahedron`,
      [
        [0, 0, 0],
        [10, 0, 0],
        [0, 10, 0],
        [0, 0, 10],
      ],
    ],
    [
      `unit cube`,
      [0, 1].flatMap((x_val) =>
        [0, 1].flatMap((y_val) => [0, 1].map((z_val) => [x_val, y_val, z_val])),
      ),
    ],
    // planar square plus one vertex lifted by 1e-3 of its size: no longer a polygon
    [
      `square with a lifted corner`,
      [
        [0, 0, 0],
        [10, 0, 0],
        [10, 10, 0.01],
        [0, 10, 0],
      ],
    ],
  ])(`%s is reported non-planar`, (_label, pts) => {
    expect(get_3d_domain_simplexes_and_ann_loc(pts).is_planar).toBe(false)
  })

  test(`trailing duplicates map edges to first occurrences`, () => {
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

  test(`a duplicate at a non-zero index is skipped in edges`, () => {
    const pts = [
      [5, 10, 0],
      [5, 10, 0],
      [0, 0, 0],
      [10, 0, 0],
    ]
    const result = get_3d_domain_simplexes_and_ann_loc(pts)
    expect(new Set(result.simplex_indices.flat())).toEqual(new Set([0, 2, 3]))
    assert_valid_edges(result, pts.length)
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

describe(`chebyshev_centre`, () => {
  const box: Vec2[] = [
    [-10, 0],
    [-10, 0],
  ]
  // Formal binary: mu_A <= 0, mu_B <= 0 and the AB plane (mu_A + mu_B)/2 <= -2 cut the corner
  // off the [-10, 0]² box. By symmetry the largest inscribed circle sits on the diagonal,
  // touching both lower walls and the AB line: -10 + r = -2 - r/√2 → r = 8 / (1 + 1/√2)
  const ab_rows = [
    [1, 0, 0],
    [0, 1, 0],
    [0.5, 0.5, 2],
  ]
  test(`maximises the inscribed radius`, () => {
    const radius = 8 / (1 + Math.SQRT1_2)
    const { centre, radius: found } = chebyshev_centre(ab_rows, box)
    expect(found).toBeCloseTo(radius, 10)
    expect(centre).toEqual([
      expect.closeTo(-10 + radius, 10),
      expect.closeTo(-10 + radius, 10),
    ])
  })

  test.each([
    [`an entry below every reachable chemical potential`, [[0.5, 0.5, 50]], box],
    [
      `inverted limits`,
      ab_rows,
      [
        [0, -1],
        [-10, 0],
      ] as Vec2[],
    ],
  ])(`reports an empty region for %s`, (_label, rows, lims) => {
    expect(chebyshev_centre(rows, lims).radius).toBe(-Infinity)
  })

  // The lower-corner feasibility argument needs non-negative normals. They are guaranteed at
  // the entry boundary (build_chempot_hyperplanes names the offending entry) rather than by a
  // per-call scan here, so a negative amount must never reach the LP.
  test.each([
    [`entry_id`, { entry_id: `mp-bad` }, `mp-bad`],
    [`reduced_formula`, { reduced_formula: `AB` }, `AB`],
    [`composition`, {}, `{"A":-0.5,"B":1.5}`],
  ])(`a negative composition amount throws naming the entry by %s`, (_by, extra, name) => {
    const bad = make_phase({ A: -0.5, B: 1.5 }, -3, extra)
    const refs = [make_phase({ A: 1 }, -1), make_phase({ B: 1 }, -1)]
    expect(() => build_chempot_hyperplanes([...refs, bad], [`A`, `B`], false)).toThrow(
      `Invalid composition amount A: -0.5 in entry ${name}`,
    )
    expect(() => compute_chempot_diagram([...refs, bad])).toThrow(`in entry ${name}`)
  })

  test(`zero amounts still mean absent (no throw, entry stays in the subsystem)`, () => {
    const refs = [make_phase({ A: 1 }, -1), make_phase({ B: 1, C: 0 }, -1)]
    expect(build_chempot_hyperplanes(refs, [`A`, `B`], false).hyperplane_entries).toHaveLength(
      2,
    )
  })
})

describe(`compute_chempot_diagram edge cases`, () => {
  test(`config.elements reorders axes`, () => {
    const reordered = compute_chempot_diagram(entries, {
      elements: [`O`, `Fe`, `Li`],
      default_min_limit: -25,
      formal_chempots: false,
    })
    expect(reordered.elements).toEqual([`O`, `Fe`, `Li`])
    // Same domains as default order, just reordered columns
    expect(
      Object.keys(reordered.domains).toSorted((str_a, str_b) => str_a.localeCompare(str_b)),
    ).toEqual(
      Object.keys(cpd_ternary.domains).toSorted((str_a, str_b) => str_a.localeCompare(str_b)),
    )
    // Verify axes actually swapped: Fe domain's O-axis range (col 0 in reordered)
    // should match its col 2 range in default [Fe,Li,O] order
    const o_values = (domain: number[][], o_axis: number) =>
      dedup_vertices(domain)
        .map((pt) => [pt[o_axis]])
        .toSorted(([val_a], [val_b]) => val_a - val_b)
    expect(o_values(reordered.domains.Fe, 0)).toEqual(
      close_rows(o_values(cpd_ternary.domains.Fe, 2), 4),
    )
  })

  test(`config.elements with unknown element throws`, () => {
    expect(() =>
      compute_chempot_diagram([make_phase({ A: 1 }, -1.0), make_phase({ B: 1 }, -2.0)], {
        elements: [`A`, `C`],
      }),
    ).toThrow(`Missing elemental reference`)
  })

  test(`identical polymorphs keep one domain`, () => {
    const result = compute_chempot_diagram(
      [make_phase({ A: 1 }, -2.0), make_phase({ A: 1 }, -2.0), make_phase({ B: 1 }, -3.0)],
      { default_min_limit: -10, formal_chempots: false },
    )
    expect(Object.keys(result.domains).toSorted()).toEqual([`A`, `B`])
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
    for (const [min_value, max_value] of result.lims) {
      expect(min_value).toBeLessThan(max_value)
    }
    for (const pts of Object.values(result.domains)) {
      for (const pt of pts) expect(pt).toHaveLength(n_axes)
    }
  })
})

// === Formation energy computation ===
// e_form = energy_per_atom - sum(fraction_i * ref_energy_per_atom_i)

describe(`get_energy_stats_by_formula`, () => {
  test(`aggregates polymorph counts and energy bounds`, () => {
    const stats = get_energy_stats_by_formula([
      make_phase({ A: 1 }, -1),
      make_phase({ A: 1, B: 1 }, -2),
      make_phase({ A: 1, B: 1 }, -1.5),
    ])

    expect(stats.get(`A`)).toEqual({
      matching_entry_count: 1,
      min_energy_per_atom: -1,
      max_energy_per_atom: -1,
    })
    expect(stats.get(`AB`)).toEqual({
      matching_entry_count: 2,
      min_energy_per_atom: -2,
      max_energy_per_atom: -1.5,
    })
    expect(get_energy_stats_by_formula([])).toEqual(new Map())
  })

  test.each([Number.NaN, Infinity, -Infinity])(
    `skips non-finite EPA %s when aggregating`,
    (bad) => {
      const stats = get_energy_stats_by_formula([
        make_phase({ A: 1 }, bad),
        make_phase({ A: 1 }, -2),
      ])
      expect(stats.get(`A`)).toEqual({
        matching_entry_count: 1,
        min_energy_per_atom: -2,
        max_energy_per_atom: -2,
      })
    },
  )
})

describe(`best_form_energy_for_formula`, () => {
  const e_form = (entry: PhaseData, refs: Record<string, PhaseData> = AB_REFS) =>
    best_form_energy_for_formula(
      [entry],
      formula_key_from_composition(entry.composition),
      refs,
    )

  test.each([
    { comp: { A: 1 }, epa: -2.0, expected: 0, label: `element A` },
    { comp: { B: 1 }, epa: -3.0, expected: 0, label: `element B` },
    // AB: ref = 0.5*(-2) + 0.5*(-3) = -2.5, e_form = -3.5 - (-2.5) = -1.0
    { comp: { A: 1, B: 1 }, epa: -3.5, expected: -1.0, label: `AB stable compound` },
    // A2B: ref = 2/3*(-2) + 1/3*(-3) = -7/3, e_form = -3.0 + 7/3 = -2/3
    { comp: { A: 2, B: 1 }, epa: -3.0, expected: -2 / 3, label: `A2B compound` },
    { comp: { A: 1, B: 1 }, epa: -2.0, expected: 0.5, label: `AB unstable (positive)` },
  ])(`$label → e_form = $expected`, ({ comp, epa, expected }) => {
    expect(e_form(make_phase(comp as Record<string, number>, epa))).toBeCloseTo(expected, 8)
  })

  test(`picks minimum formation energy across polymorphs`, () => {
    const polymorphs = [make_phase({ A: 1, B: 1 }, -3.5), make_phase({ A: 1, B: 1 }, -3.0)]
    expect(best_form_energy_for_formula(polymorphs, `AB`, AB_REFS)).toBeCloseTo(-1.0, 8)

    const color_entries = [...Object.values(AB_REFS), ...polymorphs]
    const color_data = get_domain_color_data({
      formulas: [`A`, `B`, `AB`],
      color_mode: `formation_energy`,
      color_scale: `interpolateViridis`,
      reverse_color_scale: false,
      entries: color_entries,
      el_refs: AB_REFS,
      energy_stats: get_energy_stats_by_formula(color_entries),
    })

    expect(color_data.color_range).toMatchObject({ min: -1, max: 0 })
    expect(color_data.colors.size).toBe(3)
  })

  test(`renormalized el_refs (formal_chempots) produce zero-energy refs`, () => {
    const all_entries = Object.values(AB_REFS)
    const renormed = renormalize_entries(all_entries, AB_REFS)
    const { el_refs: renorm_refs } = get_min_entries_and_el_refs(renormed)
    expect(safe_energy_per_atom(renorm_refs.A)).toBeCloseTo(0, 8)
    expect(safe_energy_per_atom(renorm_refs.B)).toBeCloseTo(0, 8)
    // With zero-energy refs, e_form equals raw epa (not true formation energy!)
    // This confirms raw (non-renormalized) el_refs must be used for coloring.
    expect(e_form(make_phase({ A: 1, B: 1 }, -3.5), renorm_refs)).toBeCloseTo(-3.5, 8)
  })

  test(`formation energy from real data: Fe-Li-O system`, () => {
    const { el_refs: raw_refs } = get_min_entries_and_el_refs(entries)
    // All elemental refs should have zero formation energy
    for (const [el, ref] of Object.entries(raw_refs)) {
      expect(e_form(ref, raw_refs), `${el} should have e_form=0`).toBeCloseTo(0, 8)
    }
    // Fe2O3 formation energy per atom of the lowest-energy Fe2O3 entry vs the raw refs
    expect(best_form_energy_for_formula(entries, `Fe2O3`, raw_refs)).toBeCloseTo(-1.657416, 5)
  })
})

// filter_entries_at_temperature itself is covered in convex-hull/helpers.test.ts;
// this only checks the filtered output still feeds compute_chempot_diagram correctly.
test(`temperature-filtered entries still compute a valid 2D chempot diagram`, () => {
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
  ]
  const filtered_entries = filter_entries_at_temperature(baseline_entries, 600)
  const result = compute_chempot_diagram(filtered_entries, {
    default_min_limit: -20,
    formal_chempots: false,
  })
  expect(result.elements).toEqual([`Li`, `O`])
  expect(Object.keys(result.domains).toSorted()).toEqual([`Li`, `LiO`, `O`])
  // At 600 K: mu_Li = -0.9, mu_O = -1.8 (the element G(T)), LiO on mu_Li + mu_O = -3.0, so
  // its segment runs from the Li line (-0.9, -2.1) to the O line (-1.2, -1.8)
  expect_vertices(result.domains.LiO, [
    [-0.9, -2.1],
    [-1.2, -1.8],
  ])
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

describe(`get_min_entries_and_el_refs tie-breaking`, () => {
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
  })
})

describe(`N-D projections`, () => {
  const config_base = { default_min_limit: -25, formal_chempots: true }

  test(`every projection of the same N-D geometry has the same formulas`, () => {
    const proj_a = compute_chempot_diagram(ytos_entries, {
      ...config_base,
      elements: [`O`, `Ti`, `Y`],
    })
    const proj_b = compute_chempot_diagram(ytos_entries, {
      ...config_base,
      elements: [`S`, `Ti`, `Y`],
    })
    expect(Object.keys(proj_a.domains).toSorted()).toEqual(
      Object.keys(proj_b.domains).toSorted(),
    )
    expect(proj_a.elements).toEqual([`O`, `Ti`, `Y`])
    expect(proj_a.lims).toEqual([
      [-25, 0],
      [-25, 0],
      [-25, 0],
    ])
  })

  test(`formal vs absolute chempots give different domain coords`, () => {
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
})

describe(`get_visible_domain_labels`, () => {
  // face_positions are flat xyz triangle vertices; one label per formula at the area-weighted
  // centroid of its visible faces, sized by the font map
  const unit_triangle = [0, 0, 0, 1, 0, 0, 0, 1, 0]
  test.each([
    {
      label: `one area-weighted label per visible formula`,
      positions: [
        // Two triangles for one square facet owned by AB, one separate facet owned by AC
        0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 0, 0, 2, 2, 0, 0, 2, 0, 10, 0, 0, 11, 0, 0, 10, 1, 0,
      ],
      face_formulas: [`AB`, `AB`, `AC`],
      sizes: new Map([
        [`AB`, 14],
        [`AC`, 10],
        [`AD`, 8],
      ]),
      expected: [
        { formula: `AB`, position: [1, 1, 0], label_font_size: 14 },
        { formula: `AC`, position: [10 + 1 / 3, 1 / 3, 0], label_font_size: 10 },
      ],
    },
    {
      label: `ignores zero-area faces and formulas without visible facets`,
      positions: [0, 0, 0, 0, 0, 0, 0, 0, 0, ...unit_triangle],
      face_formulas: [`AB`, `AC`],
      sizes: new Map([[`AB`, 12]]),
      expected: [],
    },
    {
      label: `combines separated visible facets of the same domain`,
      // Two equal-area facets owned by AB, separated in space
      positions: [...unit_triangle, 3, 0, 0, 4, 0, 0, 3, 1, 0],
      face_formulas: [`AB`, `AB`],
      sizes: new Map([[`AB`, 12]]),
      expected: [
        {
          formula: `AB`,
          position: [expect.closeTo(11 / 6), expect.closeTo(1 / 3), 0],
          label_font_size: 12,
        },
      ],
    },
    {
      label: `ignores trailing face-domain entries without triangles`,
      positions: unit_triangle,
      face_formulas: [`AB`, `AC`],
      sizes: new Map([
        [`AB`, 12],
        [`AC`, 10],
      ]),
      expected: [{ formula: `AB`, position: [1 / 3, 1 / 3, 0], label_font_size: 12 }],
    },
    {
      label: `preserves pinned labels for overlay domains without visible facets`,
      positions: unit_triangle,
      face_formulas: [`AB`],
      sizes: new Map([[`AB`, 12]]),
      pinned: [
        { formula: `AC`, position: [2, 2, 2], label_font_size: 10 },
        { formula: `AB`, position: [9, 9, 9], label_font_size: 99 },
      ] as VisibleDomainLabel[],
      expected: [
        { formula: `AB`, position: [1 / 3, 1 / 3, 0], label_font_size: 12 },
        { formula: `AC`, position: [2, 2, 2], label_font_size: 10 },
      ],
    },
  ])(`$label`, ({ positions, face_formulas, sizes, pinned, expected }) => {
    expect(get_visible_domain_labels(positions, face_formulas, sizes, pinned)).toEqual(
      expected,
    )
  })
})

// The worker payload: listed keys only, composition cloned, undefined fields left out
test(`slim_phase_entry keeps the listed keys and drops structures and undefined fields`, () => {
  const entry: PhaseData = {
    composition: { Li: 2, O: 1 },
    energy: -14,
    entry_id: `mp-1`,
    structure: { lattice: { volume: 42 }, sites: [{}] },
    data: { volume: 42 },
  }
  const slim = slim_phase_entry(entry, [`energy`, `entry_id`, `correction`])
  expect(slim).toEqual({ composition: { Li: 2, O: 1 }, energy: -14, entry_id: `mp-1` })
  expect(`correction` in slim).toBe(false)
  expect(slim.composition).not.toBe(entry.composition)
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

  test(`computes on the main thread (with a warning) when Worker construction fails`, async () => {
    // Must be constructable (`new Worker()`); arrow functions are not.
    function FailingWorker() {
      throw new Error(`worker blocked by CSP`)
    }
    const warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => undefined)
    const { compute_chempot_async } = await load_async(FailingWorker)
    const data = await compute_chempot_async(async_entries)
    expect(Object.keys(data.domains).toSorted()).toEqual([`Li`, `O`])
    expect(warn_spy).toHaveBeenCalledWith(
      `Chempot worker could not be constructed; computing on the main thread:`,
      expect.objectContaining({ message: `worker blocked by CSP` }),
    )
    warn_spy.mockRestore()
  })

  test(`falls back to main-thread compute without a Worker global`, async () => {
    const { compute_chempot_async } = await load_async(undefined)
    const data = await compute_chempot_async(async_entries, { elements: [`Li`, `O`] })
    expect(Object.keys(data.domains).toSorted()).toEqual([`Li`, `O`])
  })

  test(`dedupes equivalent entry snapshots without conflating entry metadata`, async () => {
    const { compute_chempot_async } = await load_async(undefined)
    const config = { elements: [`Li`, `O`] }
    const first = compute_chempot_async(structuredClone(async_entries), config)
    const equivalent = compute_chempot_async(structuredClone(async_entries), { ...config })
    const reordered_entries = structuredClone(async_entries).toReversed()
    const reordered = compute_chempot_async(reordered_entries, config)
    const renamed_entries = structuredClone(async_entries)
    renamed_entries[0].name = `renamed lithium`
    const renamed = compute_chempot_async(renamed_entries, config)

    expect(equivalent).toBe(first)
    expect(reordered).toBe(first)
    expect(renamed).not.toBe(first)
    await Promise.all([first, renamed])
  })
})
