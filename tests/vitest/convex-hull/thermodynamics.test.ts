import {
  calculate_e_above_hull,
  compute_e_above_hull_nd,
  compute_e_form_per_atom,
  compute_lower_hull_nd,
  compute_quickhull_nd,
  find_lowest_energy_unary_refs,
  get_convex_hull_stats,
  normalize_hull_composition_keys,
  process_hull_entries,
  process_hull_for_stats,
} from '$lib/convex-hull/thermodynamics'
import type { PhaseData } from '$lib/convex-hull/types'
import { solve_linear_system } from '$lib/math'
import { describe, expect, test, vi } from 'vitest'
import { make_rng } from '../numeric-helpers'
import { load_json, make_phase } from '../setup'
import pymatgen_quinary from './fixtures/quinary_pymatgen_reference.json' with { type: 'json' }

const make_elem = (el: string, energy = -1.0) =>
  make_phase({ [el]: 1 }, energy, { entry_id: el })

describe(`normalize_hull_composition_keys`, () => {
  test.each([
    [{ 'Fe2+': 1, 'O2-': 2 }, { Fe: 1, O: 2 }, `strips oxidation states`],
    [{ 'V4+': 1, V: 2, 'V3+': 0.5 }, { V: 3.5 }, `merges duplicate elements`],
    [{ Fe: 1, O: 0, Li: -1, Na: NaN, K: Infinity }, { Fe: 1 }, `filters invalid amounts`],
    [{ Fe2O3: 0 }, {}, `non-positive amounts are dropped before the key is checked`],
    // pymatgen Composition.as_dict() species forms passed through by pymatviz
    [{ 'Fe2+,spin=5': 1, 'Fe3+,spin=-5': 2, 'O2-': 4 }, { Fe: 3, O: 4 }, `spin suffixes`],
    [{ 'Fe2.5+': 2, 'O2-': 5 }, { Fe: 2, O: 5 }, `fractional oxidation states`],
    [{ 'Li+': 1, 'Cl-': 1 }, { Li: 1, Cl: 1 }, `unit charges without a digit`],
    [{ D: 2, T: 1, 'H+': 1, O: 2 }, { H: 4, O: 2 }, `hydrogen isotopes map to H`],
    [{ 'D+': 1, 'T2-': 1 }, { H: 2 }, `charged isotopes`],
  ])(`%s → %o (%s)`, (input, expected, _desc) => {
    expect(normalize_hull_composition_keys(input)).toEqual(expected)
  })

  test.each([
    [{ 'X0+': 1, Li: 1, O: 1 }, { Li: 1, O: 1 }, `X0+`],
    [{ Xa: 2, Fe: 1 }, { Fe: 1 }, `Xa`],
    [{ 'Xx2+,spin=1': 1, Fe: 1 }, { Fe: 1 }, `Xx2+,spin=1`],
    [{ 'Xe2+': 1, X: 1 }, { Xe: 1 }, `X`],
  ] as [Record<string, number>, Record<string, number>, string][])(
    `skips pymatgen DummySpecies %o with a warning (%s)`,
    (input, expected, key) => {
      const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
      expect(normalize_hull_composition_keys(input)).toEqual(expected)
      expect(warn).toHaveBeenCalledOnce()
      expect(warn.mock.calls[0][0]).toContain(`DummySpecies key "${key}"`)
      warn.mockRestore()
    },
  )

  test.each([
    [{ Fe2O3: 1 }, `compound-like key`],
    [{ '12345': 1 }, `numeric key`],
    [{ Zz: 1 }, `unknown symbol`],
    [{ fe: 1 }, `lowercase symbol`],
    [{ 'Fe2+,spin=': 1 }, `spin without a value`],
    [{ 'Fe2+spin=5': 1 }, `spin without the comma`],
    [{ 'Fe++': 1 }, `doubled charge sign`],
  ] as [Record<string, number>, string][])(
    `throws on %o (%s) instead of guessing an element`,
    (input) => {
      expect(() => normalize_hull_composition_keys(input)).toThrow(
        /Unrecognized composition key/,
      )
    },
  )

  test(`pseudo-components replace element validation when given`, () => {
    const components = [`BaO`, `TiO2`]
    expect(normalize_hull_composition_keys({ BaO: 0.4, TiO2: 0.6 }, components)).toEqual({
      BaO: 0.4,
      TiO2: 0.6,
    })
    expect(() => normalize_hull_composition_keys({ Ba: 1 }, components)).toThrow(
      /expected one of the components BaO, TiO2/,
    )
    const pseudo_compositions: Record<string, number>[] = [{ BaO: 1 }, { BaO: 0.5, TiO2: 0.5 }]
    const processed = process_hull_entries(
      pseudo_compositions.map((composition, idx) => ({ composition, energy: -0.3 * idx })),
      components,
    )
    expect(processed.elements).toEqual([`BaO`, `TiO2`])
  })
})

describe(`process_hull_entries`, () => {
  test(`normalizes keys, drops empty compositions and collects sorted elements`, () => {
    const entries: PhaseData[] = [
      make_phase({ 'Fe3+': 1, 'O2-': 2 }, -4.0),
      make_phase({ Li: 0 }, -4.0),
      make_phase({ O: 1 }, -2.0),
    ]
    const result = process_hull_entries(entries)
    expect(result.entries.map((entry) => entry.composition)).toEqual([
      { Fe: 1, O: 2 },
      { O: 1 },
    ])
    expect(result.elements).toEqual([`Fe`, `O`])
  })
})

describe(`compute_e_form_per_atom`, () => {
  const el_refs = { Fe: make_phase({ Fe: 1 }, -4.0), O: make_phase({ O: 1 }, -2.0) }

  test(`FeO at -7.0 eV/atom → e_form = -4.0`, () => {
    expect(compute_e_form_per_atom(make_phase({ Fe: 1, O: 1 }, -7.0), el_refs)).toBeCloseTo(
      -4.0,
      10,
    )
  })

  test.each([
    [{ Fe: 1, Li: 1 }, `missing reference element`],
    [{}, `empty composition`],
  ])(`returns null for %o (%s)`, (composition, _desc) => {
    expect(compute_e_form_per_atom(make_phase(composition, -5.0), el_refs)).toBeNull()
  })

  test(`corrections are total-energy (eV) values`, () => {
    const refs = { Fe: make_phase({ Fe: 1 }, -3.0, { correction: -1.0 }) }
    const entry = make_phase({ Fe: 2 }, -4.5, { correction: 1.0 }) // -9 + 1 = -8 → -4/atom
    expect(compute_e_form_per_atom(entry, refs)).toBeCloseTo(0.0, 10)
  })
})

describe(`find_lowest_energy_unary_refs`, () => {
  test.each([NaN, -Infinity, Infinity])(
    `selects finite unary references, ignoring %s`,
    (invalid_energy) => {
      const entries = [
        make_phase({ Fe: 1 }, invalid_energy),
        make_phase({ Li: 1 }, invalid_energy),
        make_phase({ Fe: 1 }, -3.5),
        make_phase({ Fe: 1 }, -4.0),
        make_phase({ O: 1 }, -2.0),
        make_phase({ O: 1 }, -2.5),
        make_phase({ Fe: 1, O: 1 }, -6.0),
      ]
      const refs = find_lowest_energy_unary_refs(entries)
      expect(Object.keys(refs)).toEqual([`Fe`, `O`])
      expect([refs.Fe.energy_per_atom, refs.O.energy_per_atom]).toEqual([-4.0, -2.5])
    },
  )
})

// Brute-force lower hull energy at `query`: min over all (d+1)-subsets containing the
// query's projection of the barycentric interpolation (spatial dim d = coords - 1)
function brute_force_e_hull(points: number[][], query: number[]): number {
  const dim = query.length - 1
  let best = Infinity
  const visit = (start: number, chosen: number[]) => {
    if (chosen.length === dim + 1) {
      const verts = chosen.map((idx) => points[idx])
      const matrix = Array.from({ length: dim }, (_, row) =>
        verts.slice(1).map((vert) => vert[row] - verts[0][row]),
      )
      const rhs = Array.from({ length: dim }, (_, row) => query[row] - verts[0][row])
      const lambda = solve_linear_system(matrix, rhs)
      if (!lambda) return
      const weights = [1 - lambda.reduce((sum, val) => sum + val, 0), ...lambda]
      if (weights.every((val) => val >= -1e-9)) {
        best = Math.min(
          best,
          weights.reduce((sum, wt, idx) => sum + wt * verts[idx][dim], 0),
        )
      }
      return
    }
    for (let idx = start; idx < points.length; idx++) visit(idx + 1, [...chosen, idx])
  }
  visit(0, [])
  return best
}

// Deterministic RNG so failures reproduce
const rand = make_rng(12345)
// Random point in the composition simplex (reduced coords) with a random energy
const random_point = (spatial_dim: number, energy: number): number[] => {
  const weights = Array.from({ length: spatial_dim + 1 }, () => -Math.log(rand() + 1e-12))
  const total = weights.reduce((sum, val) => sum + val, 0)
  return [...weights.slice(1).map((val) => val / total), energy]
}
const corners = (spatial_dim: number): number[][] =>
  Array.from({ length: spatial_dim + 1 }, (_, corner_idx) => {
    const corner = Array(spatial_dim + 1).fill(0)
    if (corner_idx > 0) corner[corner_idx - 1] = 1
    return corner
  })

describe(`N-dimensional quickhull`, () => {
  test.each([2, 3, 4])(
    `dim=%i: lower hull + e_above_hull agree with brute force to 1e-10 on random point sets`,
    (dim) => {
      const spatial_dim = dim - 1
      let max_diff = 0
      // brute force enumerates C(24, dim) simplexes per query: 2D/3D are cheap, 4D is ~10k
      // solves per query, so it gets fewer trials to stay well inside the CI timeout
      const n_trials = dim === 4 ? 3 : 8
      for (let trial = 0; trial < n_trials; trial++) {
        const points = [
          ...corners(spatial_dim),
          ...Array.from({ length: 18 }, () => random_point(spatial_dim, 0.2 - 2 * rand())),
        ]
        // Duplicate point and a same-composition polymorph 0.3 eV higher
        points.push(
          [...points[6]],
          [...points[5].slice(0, spatial_dim), points[5][spatial_dim] + 0.3],
        )
        const facets = compute_lower_hull_nd(points)
        expect(facets.length).toBeGreaterThan(0)
        for (const facet of facets) {
          expect(facet.vertex_indices).toHaveLength(dim)
          expect(facet.normal.at(-1)).toBeLessThan(0)
        }
        const queries = [
          ...points,
          ...Array.from({ length: 10 }, () => random_point(spatial_dim, 0)),
        ]
        const distances = compute_e_above_hull_nd(queries, facets, points)
        for (const [idx, query] of queries.entries()) {
          const reference = query[spatial_dim] - brute_force_e_hull(points, query)
          max_diff = Math.max(max_diff, Math.abs(distances[idx] - reference))
        }
      }
      expect(max_diff).toBeLessThan(1e-10)
    },
  )

  test(`full hull of a simplex has dim+1 facets in 2D..6D`, () => {
    for (let dim = 2; dim <= 6; dim++) {
      const simplex = [...corners(dim - 1), [...Array(dim - 1).fill(1 / dim), -1]]
      expect(compute_quickhull_nd(simplex)).toHaveLength(dim + 1)
      // The dim facets touching the bottom apex point down; the top face (all corners at
      // E = 0) is horizontal and excluded
      expect(compute_lower_hull_nd(simplex)).toHaveLength(dim)
    }
  })

  test.each([
    [
      `fewer than dim+1 points`,
      [
        [0, 0],
        [1, 0],
      ],
    ],
    [
      `co-hyperplanar (all E = 0)`,
      [
        [0, 0],
        [1, 0],
        [0.5, 0],
      ],
    ],
    [
      `collinear in 3D`,
      [
        [0, 0, 0],
        [1, 1, 1],
        [2, 2, 2],
        [3, 3, 3],
      ],
    ],
    [`empty`, []],
  ])(`returns no facets for %s`, (_desc, points) => {
    expect(compute_quickhull_nd(points)).toEqual([])
  })

  test(`throws on mixed dimensions`, () => {
    expect(() => compute_quickhull_nd([[0, 0], [1]])).toThrow(`dimension mismatch`)
  })

  // Facet count is combinatorial in BOTH the point count and the dimension, and only the
  // running count bounds it: unguarded, 500 points in 8D built 1.16M facets over 210 s
  test(`throws once the facet budget is spent`, () => {
    let seed = 42
    const rng = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    // Points in convex position (on a paraboloid), so every one of them is a hull vertex
    const points = Array.from({ length: 120 }, () => {
      const spatial = Array.from({ length: 5 }, () => rng())
      return [...spatial, spatial.reduce((sum, val) => sum + (val - 0.5) ** 2, 0)]
    })
    expect(compute_quickhull_nd(points).length).toBeGreaterThan(2000)
    expect(() => compute_quickhull_nd(points, 2000)).toThrow(
      /120 points in 6D built \d+ facets, past the 2000 budget/,
    )
  })

  test(`compute_e_above_hull_nd: NaN outside the hull's composition domain, without facets, or for NaN queries`, () => {
    const points = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0.3, 0.3, -1],
    ]
    const facets = compute_lower_hull_nd(points)
    const [outside, degenerate, nan_query] = [
      compute_e_above_hull_nd([[2, 2, 0]], facets, points)[0],
      compute_e_above_hull_nd([[0.3, 0.3, 0]], [], points)[0],
      compute_e_above_hull_nd([[0.3, NaN, 0]], facets, points)[0],
    ]
    expect([outside, degenerate, nan_query].every(Number.isNaN)).toBe(true)
    // Inside: the apex sits 1 eV below the E = 0 corner plane; the apex itself scores 0
    expect(compute_e_above_hull_nd([[0.3, 0.3, 0]], facets, points)[0]).toBeCloseTo(1, 12)
    expect(compute_e_above_hull_nd([[0.3, 0.3, -1]], facets, points)[0]).toBeCloseTo(0, 12)
  })

  test(`duplicate compositions: duplicates score 0, the higher polymorph its energy gap`, () => {
    const points = [
      [0, 0],
      [1, 0],
      [0.5, -1],
      [0.5, -1],
      [0.5, -0.5],
    ]
    const facets = compute_lower_hull_nd(points)
    expect(facets).toHaveLength(2)
    const dist = compute_e_above_hull_nd(points, facets, points)
    expect(dist.map((val) => Math.round(val * 1e9) / 1e9)).toEqual([0, 0, 0, 0, 0.5])
  })
})

describe(`calculate_e_above_hull`, () => {
  const fe_o_refs: PhaseData[] = [make_elem(`Fe`, -4.0), make_elem(`O`, -2.0)]

  test(`unary: polymorph 0.5 eV/atom above the lowest → 0.5`, () => {
    const refs = [make_phase({ Fe: 1 }, -4.0, { entry_id: `Fe-stable` })]
    expect(
      calculate_e_above_hull(make_phase({ Fe: 1 }, -3.5, { entry_id: `Fe-high` }), refs),
    ).toBeCloseTo(0.5, 10)
  })

  test(`binary: interpolates hull tie-line, on-hull entries ≈ 0`, () => {
    // Hull: Fe (x=0, e_form 0) — FeO (x=0.5, e_form -4.5) — O (x=1, e_form 0)
    const refs = [...fe_o_refs, make_phase({ Fe: 1, O: 1 }, -7.5, { entry_id: `FeO` })]
    const results = calculate_e_above_hull(
      [
        make_phase({ Fe: 1, O: 1 }, -6.5, { entry_id: `FeO-unstable` }), // e_form -3.5 → 1.0
        make_phase({ Fe: 3, O: 1 }, -5.25, { entry_id: `Fe3O` }), // tie-line -2.25, e_form -1.75
        make_phase({ Fe: 1 }, -4.0, { entry_id: `Fe-test` }),
        make_phase({ Fe: 1 }, -3.5, { entry_id: `Fe-high` }),
      ],
      refs,
    )
    expect(results[`FeO-unstable`]).toBeCloseTo(1.0, 10)
    expect(results.Fe3O).toBeCloseTo(0.5, 10)
    expect(results[`Fe-test`]).toBeCloseTo(0, 10)
    expect(results[`Fe-high`]).toBeCloseTo(0.5, 10)
  })

  test(`oxidation-state keys are normalized against plain-symbol references`, () => {
    const refs = [...fe_o_refs, make_phase({ Fe: 1, O: 1 }, -7.5, { entry_id: `FeO` })]
    const charged = { 'Fe2+': 1, 'O2-': 1 }
    expect(
      calculate_e_above_hull(make_phase(charged, -6.5, { entry_id: `FeO-charged` }), refs),
    ).toBeCloseTo(1.0, 10)
    expect(() => calculate_e_above_hull(make_phase({ Fe2O3: 1 }, -6.5), refs)).toThrow(
      /Unrecognized composition key/,
    )
  })

  // A compound below the elemental tie-plane shapes the hull; a same-composition
  // polymorph 0.5 eV/atom higher must land exactly 0.5 above it, and an excluded compound
  // must not shape it at all
  test.each([
    { arity: 3, els: [`Li`, `Fe`, `O`] },
    { arity: 4, els: [`Li`, `Fe`, `P`, `O`] },
    { arity: 5, els: [`Li`, `Na`, `K`, `Rb`, `Cs`] },
  ])(`arity-$arity: compounds shape the hull unless exclude_from_hull`, ({ els }) => {
    const comp = Object.fromEntries(els.map((el) => [el, 1]))
    const refs = [
      ...els.map((el) => make_elem(el, 0)),
      make_phase(comp, -1.0, { entry_id: `stable-compound` }),
    ]
    expect(
      calculate_e_above_hull(make_phase(comp, -0.5, { entry_id: `q` }), refs),
    ).toBeCloseTo(0.5, 10)
    const excluded_refs = [
      ...els.map((el) => make_elem(el, 0)),
      make_phase(comp, -2.0, { entry_id: `excluded`, exclude_from_hull: true }),
    ]
    // Below the elemental tie-plane → clamped to 0 (would be ~1.0 if the excluded compound counted)
    expect(
      calculate_e_above_hull(make_phase(comp, -1.0, { entry_id: `q` }), excluded_refs),
    ).toBeCloseTo(0, 10)
  })

  test.each([
    { arity: 2, comp: { Fe: 1, O: 1 } },
    { arity: 3, comp: { Li: 1, Fe: 1, O: 1 } },
    { arity: 4, comp: { Li: 1, Fe: 1, P: 1, O: 1 } },
  ] as { arity: number; comp: Record<string, number> }[])(
    `arity-$arity: all refs at e_form = 0 → hull is the tie-plane at 0`,
    ({ comp }) => {
      const refs = Object.keys(comp).map((el) => make_elem(el, 0))
      expect(
        calculate_e_above_hull(make_phase(comp, 0.5, { entry_id: `above` }), refs),
      ).toBeCloseTo(0.5, 10)
      expect(calculate_e_above_hull(make_phase(comp, -0.2, { entry_id: `below` }), refs)).toBe(
        0,
      )
    },
  )

  test(`missing pure-element references default to e_form = 0 corners`, () => {
    // Only Fe reference + precomputed e_form: the O corner is synthesized at 0
    const refs = [
      make_phase({ Fe: 1 }, 0, { entry_id: `Fe`, e_form_per_atom: 0 }),
      make_phase({ Fe: 1, O: 1 }, -1, { entry_id: `FeO`, e_form_per_atom: -1 }),
    ]
    const query = make_phase({ Fe: 1, O: 3 }, 0, { entry_id: `FeO3`, e_form_per_atom: -0.25 })
    // Tie-line FeO (x=0.5, -1) → O (x=1, 0) gives -0.5 at x=0.75
    expect(calculate_e_above_hull(query, refs)).toBeCloseTo(0.25, 10)
  })

  test(`pre-computed e_form_per_atom wins over recomputation`, () => {
    const entry = make_phase({ Fe: 1, O: 1 }, -6.0, { entry_id: `FeO`, e_form_per_atom: 0.5 })
    expect(calculate_e_above_hull(entry, fe_o_refs)).toBeCloseTo(0.5, 10)
  })

  test.each([
    [`empty refs`, make_elem(`Fe`), [], /cannot be empty/],
    [
      `missing element`,
      make_phase({ Li: 1 }, -2.0),
      [make_elem(`Fe`)],
      /not present in reference/,
    ],
  ] as const)(`throws for %s`, (_desc, entry, refs, err) => {
    expect(() => calculate_e_above_hull(entry, [...refs])).toThrow(err)
  })

  test(`empty input → {} and unplaceable entries → NaN`, () => {
    expect(calculate_e_above_hull([], fe_o_refs)).toEqual({})
    const no_atoms = make_phase({}, 0, { entry_id: `empty` })
    expect(calculate_e_above_hull([no_atoms], fe_o_refs).empty).toBeNaN()
    // an explicit e_form_per_atom must not turn the zero-atom case into a throw
    const no_atoms_with_e_form = make_phase({ Fe: 0 }, 0, {
      entry_id: `zero`,
      e_form_per_atom: -0.1,
    })
    expect(calculate_e_above_hull([no_atoms_with_e_form], fe_o_refs).zero).toBeNaN()
    expect(
      calculate_e_above_hull(
        [no_atoms_with_e_form],
        [...fe_o_refs, make_phase({ Li: 1 }, -2.0, { entry_id: `Li` })],
      ).zero,
    ).toBeNaN()
  })

  test(`keys same-composition polymorphs separately when entry_id is absent`, () => {
    const entries = [
      make_phase({ Fe: 1 }, -4.0),
      make_phase({ O: 1 }, -2.0),
      make_phase({ Fe: 1, O: 1 }, -3.0),
      make_phase({ Fe: 1, O: 1 }, -2.5),
    ]
    expect(Object.keys(calculate_e_above_hull(entries, entries))).toHaveLength(4)
  })
})

// Cross-validation against pymatgen's PhaseDiagram: Materials Project quaternaries (with
// their ternary and binary sub-systems, whose hulls are faces of the full hull) and a
// synthetic quinary. e_above_hull comes from pymatgen, stored in the fixtures.
describe(`pymatgen cross-validation`, () => {
  const site_dir = `${import.meta.dirname}/../../../src/site/convex-hull/quaternaries`
  const subsystem = (entries: PhaseData[], elements: string[]) => {
    const element_set = new Set(elements)
    return entries.filter((entry) =>
      Object.entries(entry.composition).every(([el, amt]) => amt <= 0 || element_set.has(el)),
    )
  }
  type PymatgenEntry = {
    id: string
    composition: Record<string, number>
    e_form_per_atom: number
    e_above_hull: number
    is_stable: boolean
  }
  const quinary = (pymatgen_quinary as { entries: PymatgenEntry[] }).entries.map(
    (entry): PhaseData => ({
      composition: entry.composition,
      e_form_per_atom: entry.e_form_per_atom,
      energy: 0,
      entry_id: entry.id,
      e_above_hull: entry.e_above_hull,
      is_stable: entry.is_stable,
    }),
  )
  const fixtures: [string, PhaseData[]][] = [[`Li-Na-K-Rb-Cs (quinary)`, quinary]]
  for (const name of [`Li-Co-Ni-O`, `Na-Fe-P-O`]) {
    const entries = load_json<PhaseData[]>(`${site_dir}/${name}.json.gz`)
    const [el_a, el_b, , el_d] = name.split(`-`)
    fixtures.push(
      [name, entries],
      [`${el_a}-${el_b}-${el_d}`, subsystem(entries, [el_a, el_b, el_d])],
      [`${el_b}-${el_d}`, subsystem(entries, [el_b, el_d])],
    )
  }

  // Both from the stored e_form_per_atom and recomputed from raw energy + correction
  test.each(fixtures)(`%s: e_above_hull matches pymatgen to 1e-10`, (_name, entries) => {
    const without_hull = entries.map(({ e_above_hull: _e, is_stable: _s, ...rest }) => rest)
    const without_e_form = without_hull.map(({ e_form_per_atom: _f, ...rest }) => rest)
    for (const input of [without_hull, without_e_form]) {
      if (input === without_e_form && entries === quinary) continue // quinary has no raw energies
      const results = calculate_e_above_hull(input, input)
      let max_diff = 0
      for (const entry of entries) {
        const id = entry.entry_id as string
        max_diff = Math.max(max_diff, Math.abs(results[id] - (entry.e_above_hull as number)))
        expect(results[id] < 1e-6).toBe(entry.is_stable)
      }
      expect(max_diff).toBeLessThan(1e-10)
    }
  })

  test(`single-entry mode matches batch mode`, () => {
    const batch = calculate_e_above_hull(quinary, quinary)
    for (const entry of quinary) {
      expect(calculate_e_above_hull(entry, quinary)).toBe(batch[entry.entry_id as string])
    }
  })
})

describe(`get_convex_hull_stats`, () => {
  test(`returns null for empty entries`, () => {
    expect(get_convex_hull_stats([], [`Fe`], 3)).toBeNull()
  })

  test(`e_form_range is null when no entry has a formation energy`, () => {
    const stats = get_convex_hull_stats([make_phase({ Fe: 1 }, -4.0)], [`Fe`], 1)
    expect(stats?.e_form_range).toBeNull()
  })

  test(`arity counts, stability, energy stats and electronegativity-sorted system`, () => {
    const entries: PhaseData[] = [
      make_phase({ Fe: 1 }, -4.0, { is_stable: true, e_form_per_atom: -1.0, e_above_hull: 0 }),
      make_phase({ O: 1 }, -2.0, { e_above_hull: 0, e_form_per_atom: -0.5 }),
      make_phase({ Fe: 1, O: 1 }, -6.0, { e_above_hull: 0.2, e_form_per_atom: -2.0 }),
      make_phase({ Fe: 1, O: 2 }, -7.0, { e_above_hull: 0.1, e_form_per_atom: -1.5 }),
      make_phase({ Li: 1, Fe: 1, O: 2 }, -8.0, { e_above_hull: 0.3, e_form_per_atom: -1.0 }),
      make_phase({ Li: 1, Fe: 1, P: 1, O: 1, Mn: 1 }, -8.0),
    ]
    const stats = get_convex_hull_stats(entries, [`O`, `Fe`, `Li`], 3)
    expect(stats).toMatchObject({
      total: 6,
      unary: 2,
      binary: 2,
      ternary: 1,
      quaternary: 0,
      quinary_plus: 1,
      stable: 2,
      unstable: 4,
      elements: 3,
      chemical_system: `Li-Fe-O`,
      max_arity: 3,
    })
    // the quinary has no e_form_per_atom; its raw -8.0 eV/atom must not leak into this range
    expect(stats?.e_form_range).toEqual({ min: -2.0, max: -0.5, avg: -1.2 })
    expect(stats?.hull_distance.max).toBe(0.3)
    expect(stats?.hull_distance.avg).toBeCloseTo(0.6 / 5, 12)
  })

  test.each([
    [1, { unary: 1, binary: 0, ternary: 0, quaternary: 0 }],
    [2, { unary: 1, binary: 1, ternary: 0, quaternary: 0 }],
    [3, { unary: 1, binary: 1, ternary: 1, quaternary: 0 }],
    [undefined, { unary: 1, binary: 1, ternary: 1, quaternary: 1 }],
  ])(`max_arity=%s zeroes counts beyond the system dimensionality`, (max_arity, expected) => {
    const entries: PhaseData[] = [
      make_phase({ Fe: 1 }, -4.0),
      make_phase({ Fe: 1, O: 1 }, -5.0),
      make_phase({ Li: 1, Fe: 1, O: 1 }, -6.0),
      make_phase({ Li: 1, Fe: 1, P: 1, O: 1 }, -7.0),
    ]
    expect(get_convex_hull_stats(entries, [`Li`, `Fe`, `P`, `O`], max_arity)).toMatchObject(
      expected,
    )
  })
})

describe(`process_hull_for_stats`, () => {
  test(`returns null for empty entries`, () => {
    expect(process_hull_for_stats([])).toBeNull()
  })

  test(`computes formation energies + hull distances, keeps precomputed e_form`, () => {
    const entries: PhaseData[] = [
      make_phase({ Fe: 1 }, -4.0, { entry_id: `Fe` }),
      make_phase({ O: 1 }, -2.0, { entry_id: `O` }),
      make_phase({ Fe: 1, O: 1 }, -2.5, { entry_id: `FeO` }), // tie-line -3.0 → 0.5 above
      make_phase({ Fe: 1, O: 3 }, -3.5, { entry_id: `FeO3`, e_form_per_atom: 1 }), // would be -1 if recomputed
    ]
    const result = process_hull_for_stats(entries)
    if (!result) throw new Error(`expected result`)
    const by_id = Object.fromEntries(
      [...result.stable_entries, ...result.unstable_entries].map((entry) => [
        entry.entry_id,
        entry,
      ]),
    )
    expect(by_id.FeO.e_form_per_atom).toBeCloseTo(0.5, 10)
    expect(by_id.FeO.e_above_hull).toBeCloseTo(0.5, 10)
    expect(by_id.FeO3.e_form_per_atom).toBe(1)
    expect(by_id.FeO3.e_above_hull).toBeCloseTo(1, 10)
    expect(by_id.Fe.is_element).toBe(true)
    expect(
      result.stable_entries
        .map((entry) => entry.entry_id)
        .toSorted((id_a, id_b) => String(id_a).localeCompare(String(id_b))),
    ).toEqual([`Fe`, `O`])
    expect(result.phase_stats).toMatchObject({ total: 4, unary: 2, binary: 2, stable: 2 })
  })

  test(`exclude_from_hull entries don't shape the hull but are still scored`, () => {
    const entries: PhaseData[] = [
      make_phase({ Li: 1 }, 0, { entry_id: `Li` }),
      make_phase({ Fe: 1 }, 0, { entry_id: `Fe` }),
      make_phase({ Li: 1, Fe: 1 }, -0.5, { entry_id: `LiFe`, exclude_from_hull: true }),
      make_phase({ Li: 1, Fe: 2 }, -0.1, { entry_id: `LiFe2` }),
    ]
    const result = process_hull_for_stats(entries)
    const all = [...(result?.stable_entries ?? []), ...(result?.unstable_entries ?? [])]
    // LiFe2 (-0.1) sits on the Li-Fe tie-line (else ~0.233 above the Li-LiFe-Fe hull);
    // LiFe is scored (below hull → 0) but never counted stable
    expect(all.find((entry) => entry.entry_id === `LiFe2`)?.e_above_hull).toBeCloseTo(0, 10)
    expect(all.find((entry) => entry.entry_id === `LiFe`)?.e_above_hull).toBeCloseTo(0, 10)
    expect(result?.stable_entries.some((entry) => entry.entry_id === `LiFe`)).toBe(false)
  })

  // Hull distances are keyed by entry_id, else composition + energy: same-composition
  // polymorphs without ids must not collide
  test.each([
    {
      system: `binary`,
      entries: [
        make_elem(`Fe`, -4.0),
        make_elem(`O`, -2.0),
        make_phase({ Fe: 1, O: 1 }, -3.0), // on the tie-line
        make_phase({ Fe: 1, O: 1 }, -2.5), // 0.5 above
      ],
    },
    {
      system: `ternary`,
      entries: [
        make_elem(`Li`, 0),
        make_elem(`Fe`, 0),
        make_elem(`O`, 0),
        make_phase({ Li: 1, Fe: 1, O: 2 }, -1.0),
        make_phase({ Li: 1, Fe: 1, O: 2 }, -0.5),
      ],
    },
  ])(
    `scores same-composition polymorphs without entry_id distinctly ($system)`,
    ({ entries }) => {
      const result = process_hull_for_stats(entries)
      const all = [...(result?.stable_entries ?? []), ...(result?.unstable_entries ?? [])]
      const compounds = all
        .filter((entry) => !entry.is_element)
        .toSorted((a, b) => a.energy - b.energy)
      expect(compounds.map((entry) => entry.e_above_hull)).toEqual([0, 0.5])
    },
  )
})
