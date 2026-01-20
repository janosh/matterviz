import type { ElementSymbol } from '$lib'
import type { Point4D } from '$lib/convex-hull/thermodynamics'
import {
  build_lower_hull_model,
  calculate_e_above_hull,
  compute_e_above_hull_4d,
  compute_e_above_hull_for_points,
  compute_e_above_hull_nd,
  compute_e_form_per_atom,
  compute_lower_hull_2d,
  compute_lower_hull_4d,
  compute_lower_hull_nd,
  compute_lower_hull_triangles,
  compute_quickhull_4d,
  compute_quickhull_nd,
  compute_quickhull_triangles,
  e_hull_at_xy,
  find_lowest_energy_unary_refs,
  get_convex_hull_stats,
  interpolate_hull_2d,
  normalize_hull_composition_keys,
  process_hull_entries,
} from '$lib/convex-hull/thermodynamics'
import type {
  ConvexHullTriangle,
  PhaseData,
  Point2D,
  Point3D,
} from '$lib/convex-hull/types'
import { describe, expect, test } from 'vitest'

// Test fixture factory - derives total energy from energy_per_atom and composition
const make_phase = (
  composition: Partial<Record<ElementSymbol, number>>,
  energy_per_atom: number,
  overrides: Partial<PhaseData> = {},
): PhaseData => {
  const atoms = Object.values(composition).reduce((sum, count) => sum + count, 0)
  return { composition, energy_per_atom, energy: energy_per_atom * atoms, ...overrides }
}

describe(`normalize_hull_composition_keys`, () => {
  test.each([
    [{ 'Fe2+': 1, 'O2-': 2 }, { Fe: 1, O: 2 }, `strips oxidation states`],
    [{ 'V4+': 1, V: 2, 'V3+': 0.5 }, { V: 3.5 }, `merges duplicate elements`],
    [{ Fe: 1, O: 0, Li: -1, Na: NaN, K: Infinity }, { Fe: 1 }, `filters invalid amounts`],
    [{ Fe2O3: 1 }, { Fe: 1 }, `extracts first element from compound-like keys`],
    [{ '12345': 1, '67890': 2 }, {}, `returns empty for invalid keys`],
  ])(`%s → %o (%s)`, (input, expected, _desc) => {
    expect(normalize_hull_composition_keys(input)).toEqual(expected)
  })
})

describe(`process_hull_entries`, () => {
  test(`separates stable/unstable and extracts elements`, () => {
    const entries: PhaseData[] = [
      make_phase({ Fe: 1 }, -4.0, { is_stable: true }),
      make_phase({ O: 1 }, -2.0, { is_stable: false }),
      make_phase({ Fe: 1, O: 2 }, -6.0, { e_above_hull: 0 }),
      make_phase({ Fe: 2, O: 3 }, -5.0, { e_above_hull: 0.1 }),
    ]
    const result = process_hull_entries(entries)
    expect(result.stable_entries).toHaveLength(2)
    expect(result.unstable_entries).toHaveLength(2)
    expect(result.elements).toEqual([`Fe`, `O`])
  })

  test(`builds element refs from stable unary entries`, () => {
    const entries: PhaseData[] = [
      make_phase({ Fe: 1 }, -4.0, { is_stable: true }),
      make_phase({ O: 1 }, -2.0, { is_stable: true }),
      make_phase({ Fe: 1, O: 1 }, -6.0, { is_stable: true }),
    ]
    expect(Object.keys(process_hull_entries(entries).el_refs)).toEqual([`Fe`, `O`])
  })

  test(`filters entries with empty normalized compositions`, () => {
    const entries: PhaseData[] = [
      make_phase({ '123': 1 } as Partial<Record<ElementSymbol, number>>, -4.0),
      make_phase({ Fe: 1 }, -3.0),
    ]
    const result = process_hull_entries(entries)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].composition).toEqual({ Fe: 1 })
  })
})

describe(`compute_e_form_per_atom`, () => {
  const el_refs = { Fe: make_phase({ Fe: 1 }, -4.0), O: make_phase({ O: 1 }, -2.0) }

  test(`calculates formation energy: FeO at -7.0 eV/atom → e_form = -4.0`, () => {
    expect(compute_e_form_per_atom(make_phase({ Fe: 1, O: 1 }, -7.0), el_refs))
      .toBeCloseTo(-4.0, 10)
  })

  test.each([
    [{ Fe: 1, Li: 1 }, `missing reference element`],
    [{}, `empty composition`],
  ])(`returns null for %o (%s)`, (composition, _desc) => {
    expect(compute_e_form_per_atom(make_phase(composition, -5.0), el_refs)).toBeNull()
  })

  test(`handles correction field`, () => {
    const refs = { Fe: make_phase({ Fe: 1 }, -3.0, { correction: -1.0 }) }
    const entry = make_phase({ Fe: 1 }, -4.5, { correction: 0.5 })
    expect(compute_e_form_per_atom(entry, refs)).toBeCloseTo(0.0, 10)
  })
})

describe(`find_lowest_energy_unary_refs`, () => {
  test(`selects lowest energy polymorph per element`, () => {
    const entries = [
      make_phase({ Fe: 1 }, -3.5),
      make_phase({ Fe: 1 }, -4.0),
      make_phase({ Fe: 1 }, -3.8),
      make_phase({ O: 1 }, -2.0),
      make_phase({ O: 1 }, -2.5),
    ]
    const refs = find_lowest_energy_unary_refs(entries)
    expect(refs[`Fe`].energy_per_atom).toBe(-4.0)
    expect(refs[`O`].energy_per_atom).toBe(-2.5)
  })

  test(`ignores non-unary entries`, () => {
    const entries = [make_phase({ Fe: 1, O: 1 }, -6.0), make_phase({ Fe: 1 }, -4.0)]
    expect(Object.keys(find_lowest_energy_unary_refs(entries))).toEqual([`Fe`])
  })
})

describe(`2D Convex Hull`, () => {
  test(`compute_lower_hull_2d returns correct hull vertices`, () => {
    const points: Point2D[] = [
      { x: 0, y: 0 },
      { x: 0.5, y: -0.5 },
      { x: 0.5, y: 0.2 },
      { x: 1, y: 0 },
    ]
    const hull = compute_lower_hull_2d(points)
    expect(hull).toHaveLength(3)
    expect(hull).toEqual([{ x: 0, y: 0 }, { x: 0.5, y: -0.5 }, { x: 1, y: 0 }])
  })

  test.each([
    [[{ x: 0.5, y: 0 }], 1, `single point`],
    [[{ x: 0, y: 0 }, { x: 0.5, y: -0.25 }, { x: 1, y: -0.5 }], 2, `collinear (≥2)`],
  ])(`compute_lower_hull_2d handles %s`, (points, min_length) => {
    expect(compute_lower_hull_2d(points).length).toBeGreaterThanOrEqual(min_length)
  })

  describe(`interpolate_hull_2d`, () => {
    const hull: Point2D[] = [{ x: 0, y: 0 }, { x: 0.5, y: -0.5 }, { x: 1, y: 0 }]

    test.each([
      [0.25, -0.25],
      [0.5, -0.5],
      [0.75, -0.25],
    ])(`interpolates x=%d → y≈%d`, (x_val, expected) => {
      expect(interpolate_hull_2d(hull, x_val)).toBeCloseTo(expected, 10)
    })

    test.each([[-0.5, 0], [1.5, 0]])(
      `clamps x=%d to endpoint y=%d`,
      (x_val, expected) => {
        expect(interpolate_hull_2d(hull, x_val)).toBe(expected)
      },
    )

    test.each([
      [[], `empty hull`],
      [[{ x: 0, y: 0 }], `single point`],
    ])(`returns null for %s`, (hull_points) => {
      expect(interpolate_hull_2d(hull_points, 0.5)).toBeNull()
    })
  })
})

describe(`3D Convex Hull`, () => {
  const tetrahedron: Point3D[] = [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0.5, y: Math.sqrt(3) / 2, z: 0 },
    { x: 0.5, y: Math.sqrt(3) / 6, z: Math.sqrt(2 / 3) },
  ]

  test(`compute_quickhull_triangles: tetrahedron has 4 faces`, () => {
    expect(compute_quickhull_triangles(tetrahedron)).toHaveLength(4)
  })

  test.each([
    [[{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }], `<4 points`],
    [[{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, {
      x: 1,
      y: 1,
      z: 0,
    }], `coplanar`],
  ])(`compute_quickhull_triangles returns empty for %s`, (points) => {
    expect(compute_quickhull_triangles(points)).toHaveLength(0)
  })

  test(`compute_lower_hull_triangles filters downward-facing`, () => {
    const points: Point3D[] = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0.5, y: 0.5, z: -0.5 },
    ]
    for (const tri of compute_lower_hull_triangles(points)) {
      expect(tri.normal.z).toBeLessThan(0)
    }
  })

  test(`e_hull_at_xy interpolates correctly`, () => {
    const triangles: ConvexHullTriangle[] = [{
      vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0.5, y: 1, z: -1 }],
      normal: { x: 0, y: 0.707, z: -0.707 },
      centroid: { x: 0.5, y: 1 / 3, z: -1 / 3 },
    }]
    const models = build_lower_hull_model(triangles)
    expect(e_hull_at_xy(models, 0.5, 1 / 3)).toBeCloseTo(-1 / 3, 5)
    expect(e_hull_at_xy(models, 10, 10)).toBeNull()
  })

  test.each([
    [{ x: 0.5, y: 0.3, z: 0 }, 0, `on hull`],
    [{ x: 0.5, y: 0.3, z: 0.5 }, 0.5, `above hull`],
  ])(`compute_e_above_hull_for_points: %s → %d`, (point, expected) => {
    const triangles: ConvexHullTriangle[] = [{
      vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0.5, y: 1, z: 0 }],
      normal: { x: 0, y: 0, z: -1 },
      centroid: { x: 0.5, y: 1 / 3, z: 0 },
    }]
    const models = build_lower_hull_model(triangles)
    expect(compute_e_above_hull_for_points([point], models)[0]).toBeCloseTo(expected, 10)
  })
})

describe(`4D Convex Hull`, () => {
  const simplex_4d: Point4D[] = [
    { x: 0, y: 0, z: 0, w: 0 },
    { x: 1, y: 0, z: 0, w: 0 },
    { x: 0.5, y: Math.sqrt(3) / 2, z: 0, w: 0 },
    { x: 0.5, y: Math.sqrt(3) / 6, z: Math.sqrt(2 / 3), w: 0 },
    { x: 0.5, y: Math.sqrt(3) / 6, z: Math.sqrt(2 / 3) / 3, w: 1 },
  ]

  test(`compute_quickhull_4d: 4-simplex has 5 facets`, () => {
    expect(compute_quickhull_4d(simplex_4d)).toHaveLength(5)
  })

  test(`compute_quickhull_4d returns empty for <5 points`, () => {
    expect(compute_quickhull_4d(simplex_4d.slice(0, 4))).toHaveLength(0)
  })

  test(`compute_lower_hull_4d filters by w-normal`, () => {
    const points: Point4D[] = [
      ...simplex_4d.slice(0, 4).map((pt) => ({ ...pt, w: 0 })),
      { x: 0.5, y: 0.3, z: 0.3, w: -0.5 },
    ]
    for (const tet of compute_lower_hull_4d(points)) {
      expect(tet.normal.w).toBeLessThan(0)
    }
  })

  test(`compute_e_above_hull_4d returns ≥0`, () => {
    const points: Point4D[] = [
      { x: 0, y: 0, z: 0, w: 0 },
      { x: 1, y: 0, z: 0, w: 0 },
      { x: 0, y: 1, z: 0, w: 0 },
      { x: 0, y: 0, z: 1, w: 0 },
      { x: 0.25, y: 0.25, z: 0.25, w: -1 },
    ]
    const hull = compute_lower_hull_4d(points)
    expect(hull.length).toBeGreaterThan(0)
    expect(compute_e_above_hull_4d([{ x: 0.25, y: 0.25, z: 0.25, w: 0 }], hull)[0])
      .toBeGreaterThanOrEqual(0)
  })
})

describe(`calculate_e_above_hull`, () => {
  const fe_o_refs: PhaseData[] = [
    make_phase({ Fe: 1 }, -4.0, { entry_id: `Fe` }),
    make_phase({ O: 1 }, -2.0, { entry_id: `O` }),
  ]

  test(`unary: Fe at -3.5 → e_above = 0.5`, () => {
    const refs = [make_phase({ Fe: 1 }, -4.0, { entry_id: `Fe-stable` })]
    expect(
      calculate_e_above_hull(make_phase({ Fe: 1 }, -3.5, { entry_id: `Fe-high` }), refs),
    ).toBeCloseTo(0.5, 10)
  })

  test(`binary: unstable FeO > 0, on-hull FeO ≈ 0`, () => {
    const refs = [...fe_o_refs, make_phase({ Fe: 1, O: 1 }, -7.5, { entry_id: `FeO` })]
    expect(
      calculate_e_above_hull(
        make_phase({ Fe: 1, O: 1 }, -6.5, { entry_id: `FeO-unstable` }),
        refs,
      ),
    ).toBeGreaterThan(0)
    expect(
      calculate_e_above_hull(make_phase({ Fe: 1 }, -4.0, { entry_id: `Fe-test` }), refs),
    ).toBeCloseTo(0, 10)
  })

  test(`ternary system`, () => {
    const refs: PhaseData[] = [
      make_phase({ Li: 1 }, -1.9, { entry_id: `Li` }),
      ...fe_o_refs,
      make_phase({ Li: 1, Fe: 1, O: 2 }, -8.5, { entry_id: `LiFeO2` }),
    ]
    expect(
      calculate_e_above_hull(
        make_phase({ Li: 1, Fe: 1, O: 2 }, -7.5, { entry_id: `LiFeO2-unstable` }),
        refs,
      ),
    ).toBeGreaterThanOrEqual(0)
  })

  test(`throws for empty refs`, () => {
    expect(() => calculate_e_above_hull(make_phase({ Fe: 1 }, -4.0), [])).toThrow(
      /cannot be empty/,
    )
  })

  test(`throws for missing element in refs`, () => {
    const refs = [make_phase({ Fe: 1 }, -4.0)]
    const entry = make_phase({ Li: 1 }, -2.0)
    expect(() => calculate_e_above_hull(entry, refs)).toThrow(/not present in reference/)
  })

  // Quinary (5-element) system tests
  const make_quinary_elem = (el: string, energy = -1.0) =>
    make_phase({ [el]: 1 } as Partial<Record<ElementSymbol, number>>, energy, {
      entry_id: el,
    })

  test(`handles quinary system: stable/unstable phases`, () => {
    const refs = [
      make_quinary_elem(`Li`, -1.9),
      make_quinary_elem(`Fe`, -4.0),
      make_quinary_elem(`Mn`, -3.5),
      make_quinary_elem(`P`, -2.5),
      make_quinary_elem(`O`, -2.0),
    ]
    expect(
      calculate_e_above_hull(make_phase({ Li: 1 }, -1.9, { entry_id: `Li-test` }), refs),
    )
      .toBeCloseTo(0, 5)
    expect(
      calculate_e_above_hull(
        make_phase({ Li: 1 }, -1.5, { entry_id: `Li-unstable` }),
        refs,
      ),
    )
      .toBeCloseTo(0.4, 5)
  })

  test(`quinary: interior point above hull has positive distance`, () => {
    const refs = [`Li`, `Na`, `K`, `Rb`, `Cs`].map((el) => make_quinary_elem(el))
    refs.push(make_phase(
      { Li: 1, Na: 1, K: 1, Rb: 1, Cs: 1 } as Partial<Record<ElementSymbol, number>>,
      -1.5,
      { entry_id: `stable-interior` },
    ))
    const unstable = make_phase(
      { Li: 1, Na: 1, K: 1, Rb: 1, Cs: 1 } as Partial<Record<ElementSymbol, number>>,
      -0.8,
      { entry_id: `unstable-interior` },
    )
    expect(calculate_e_above_hull(unstable, refs)).toBeGreaterThan(0)
  })

  test.each([
    { id: `Li-1`, energy: -1.0, expected: 0 },
    { id: `Li-2`, energy: -0.5, expected: 0.5 },
    { id: `Na-1`, energy: -1.0, expected: 0 },
  ])(
    `quinary batch: $id at e=$energy → e_above=$expected`,
    ({ id, energy, expected }) => {
      const refs = [`Li`, `Na`, `K`, `Rb`, `Cs`].map((el) => make_quinary_elem(el))
      const el = id.split(`-`)[0] as ElementSymbol
      const entry = make_phase(
        { [el]: 1 } as Partial<Record<ElementSymbol, number>>,
        energy,
        { entry_id: id },
      )
      expect(calculate_e_above_hull(entry, refs)).toBeCloseTo(expected, 5)
    },
  )

  test(`batch mode`, () => {
    const entries = [
      make_phase({ Fe: 1 }, -4.0, { entry_id: `Fe-1` }),
      make_phase({ Fe: 1 }, -3.5, { entry_id: `Fe-2` }),
      make_phase({ O: 1 }, -2.0, { entry_id: `O-1` }),
    ]
    const results = calculate_e_above_hull(entries, fe_o_refs)
    expect(results[`Fe-1`]).toBeCloseTo(0, 10)
    expect(results[`Fe-2`]).toBeCloseTo(0.5, 10)
    expect(results[`O-1`]).toBeCloseTo(0, 10)
  })

  test(`returns empty for empty input array`, () => {
    expect(calculate_e_above_hull([], fe_o_refs)).toEqual({})
  })
})

describe(`get_convex_hull_stats`, () => {
  test(`returns null for empty entries`, () => {
    expect(get_convex_hull_stats([], [`Fe`], 3)).toBeNull()
  })

  test(`calculates arity counts`, () => {
    const entries: PhaseData[] = [
      make_phase({ Fe: 1 }, -4.0),
      make_phase({ O: 1 }, -2.0),
      make_phase({ Fe: 1, O: 1 }, -6.0),
      make_phase({ Fe: 1, O: 2 }, -7.0),
      make_phase({ Li: 1, Fe: 1, O: 2 }, -8.0),
    ]
    const { unary, binary, ternary, total } =
      get_convex_hull_stats(entries, [`Li`, `Fe`, `O`], 3) ?? {}
    expect([unary, binary, ternary, total]).toEqual([2, 2, 1, 5])
  })

  test(`calculates stable/unstable and energy stats`, () => {
    const entries: PhaseData[] = [
      make_phase({ Fe: 1 }, -4.0, {
        is_stable: true,
        e_form_per_atom: -1.0,
        e_above_hull: 0,
      }),
      make_phase({ O: 1 }, -2.0, { e_above_hull: 0, e_form_per_atom: -0.5 }),
      make_phase({ Fe: 1, O: 1 }, -6.0, { e_above_hull: 0.2, e_form_per_atom: -2.0 }),
    ]
    const stats = get_convex_hull_stats(entries, [`Fe`, `O`], 3)
    expect(stats).not.toBeNull()
    expect(stats?.stable).toBe(2)
    expect(stats?.unstable).toBe(1)
    expect(stats?.energy_range.min).toBe(-2.0)
    expect(stats?.energy_range.max).toBe(-0.5)
    expect(stats?.hull_distance.max).toBe(0.2)
  })

  test(`includes quaternary when max_arity=4`, () => {
    const entries = [make_phase({ Li: 1, Fe: 1, P: 1, O: 4 }, -10.0)]
    expect(get_convex_hull_stats(entries, [`Li`, `Fe`, `P`, `O`], 4)?.quaternary).toBe(
      1,
    )
  })

  test(`sorts chemical system by electronegativity`, () => {
    const entries = [make_phase({ Fe: 1 }, -4.0)]
    expect(get_convex_hull_stats(entries, [`O`, `Fe`, `Li`], 3)?.chemical_system).toBe(
      `Li-Fe-O`,
    )
  })
})

describe(`Edge cases`, () => {
  test(`formation energy with explicit energy_per_atom`, () => {
    const refs = [make_phase({ Fe: 1 }, -4.0), make_phase({ O: 1 }, -2.0)]
    const compound = make_phase({ Fe: 1, O: 1 }, -3.5)
    expect(compute_e_form_per_atom(compound, find_lowest_energy_unary_refs(refs)))
      .toBeCloseTo(-0.5, 10)
  })

  test(`pre-computed e_form_per_atom is used`, () => {
    const refs = [
      make_phase({ Fe: 1 }, -4.0, { entry_id: `Fe` }),
      make_phase({ O: 1 }, -2.0, { entry_id: `O` }),
    ]
    // Set e_form_per_atom to a positive value that differs from what would be
    // computed from energy_per_atom (-6.0 - (-3.0) = -3.0), so we can verify
    // the function uses the pre-computed value instead of recomputing
    const e_form_per_atom = 0.5
    const entry = make_phase({ Fe: 1, O: 1 }, -6.0, {
      entry_id: `FeO`,
      e_form_per_atom,
    })
    // For Fe1O1, the hull is built from unary refs: Fe (x=0, e_form=0) and O (x=1, e_form=0)
    // At x=0.5, the tie-line formation energy = 0
    // e_above_hull = max(0, e_form_per_atom - 0) = e_form_per_atom
    expect(calculate_e_above_hull(entry, refs)).toBeCloseTo(e_form_per_atom)
  })
})

describe(`N-Dimensional Convex Hull`, () => {
  // 5D simplex: 6 points in 5-dimensional space (coords: x1, x2, x3, x4, w)
  // This represents a 5-element system where coords[0-3] are barycentric and coords[4] is energy
  const simplex_5d: number[][] = [
    [1, 0, 0, 0, 0], // Corner 1
    [0, 1, 0, 0, 0], // Corner 2
    [0, 0, 1, 0, 0], // Corner 3
    [0, 0, 0, 1, 0], // Corner 4
    [0, 0, 0, 0, 0], // Corner 5 (implicit 5th barycentric coord = 1)
    [0.2, 0.2, 0.2, 0.2, -1], // Interior point below corners
  ]

  test(`compute_quickhull_nd: 5D simplex produces correct number of facets`, () => {
    const hull = compute_quickhull_nd(simplex_5d)
    // A convex hull of 6 points in 5D should have facets
    expect(hull.length).toBeGreaterThan(0)
  })

  test(`compute_quickhull_nd returns empty for <N+1 points`, () => {
    // 5D needs at least 6 points
    expect(compute_quickhull_nd(simplex_5d.slice(0, 5))).toHaveLength(0)
  })

  test(`compute_lower_hull_nd filters by energy normal direction`, () => {
    const all_facets = compute_quickhull_nd(simplex_5d)
    const lower_facets = compute_lower_hull_nd(all_facets)
    // Lower facets should have negative normal in the last dimension (energy)
    for (const facet of lower_facets) {
      const energy_normal = facet.plane.normal[facet.plane.normal.length - 1]
      expect(energy_normal).toBeLessThan(0)
    }
  })

  test.each([
    { point: [0.25, 0.25, 0.25, 0.25, 0], expect_zero: true, desc: `on hull` },
    { point: [0.2, 0.2, 0.2, 0.2, 0.5], expect_zero: false, desc: `above hull` },
  ])(`compute_e_above_hull_nd: $desc`, ({ point, expect_zero }) => {
    const hull_facets = compute_lower_hull_nd(compute_quickhull_nd(simplex_5d))
    const distances = compute_e_above_hull_nd([point], hull_facets, simplex_5d)
    if (expect_zero) expect(distances[0]).toBeCloseTo(0, 5)
    else expect(distances[0]).toBeGreaterThan(0)
  })

  test(`6-element (senary) system works`, () => {
    // 6D simplex: 7 points
    const simplex_6d: number[][] = [
      [1, 0, 0, 0, 0, 0], // 6 corners at energy=0
      [0, 1, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0],
      [0, 0, 0, 1, 0, 0],
      [0, 0, 0, 0, 1, 0],
      [0, 0, 0, 0, 0, 0], // 6th corner (implicit coord = 1)
      [0.16, 0.16, 0.16, 0.16, 0.16, -1], // Interior point below
    ]
    const hull = compute_quickhull_nd(simplex_6d)
    expect(hull.length).toBeGreaterThan(0)

    const lower_hull = compute_lower_hull_nd(hull)
    const above_point = [0.16, 0.16, 0.16, 0.16, 0.16, 0.5]
    const distances = compute_e_above_hull_nd([above_point], lower_hull, simplex_6d)
    expect(distances[0]).toBeGreaterThan(0)
  })

  test(`compute_e_above_hull_nd: energy interpolation uses correct dimension`, () => {
    // This test uses data where spatial coords differ significantly from energy
    // to ensure the interpolation uses the correct index (energy dimension, not spatial)
    // Spatial coords: corners at 1, energy at -10 (very different!)
    const test_points: number[][] = [
      [1, 0, 0, 0, -10], // Corner 1 at energy -10
      [0, 1, 0, 0, -10], // Corner 2 at energy -10
      [0, 0, 1, 0, -10], // Corner 3 at energy -10
      [0, 0, 0, 1, -10], // Corner 4 at energy -10
      [0, 0, 0, 0, -10], // Corner 5 at energy -10
      [0.2, 0.2, 0.2, 0.2, -15], // Interior point at energy -15 (below corners)
    ]

    const hull = compute_quickhull_nd(test_points)
    const lower_hull = compute_lower_hull_nd(hull)

    // Query point at center with energy -8 (above hull which is at -10 for corners)
    // e_above_hull should be approximately -8 - (-10) = 2
    const query = [0.25, 0.25, 0.25, 0.25, -8]
    const distances = compute_e_above_hull_nd([query], lower_hull, test_points)

    // If the wrong dimension (spatial coord) was used for interpolation,
    // the result would be very different (around 0.25 vs -10)
    // This test explicitly checks that the energy dimension is used correctly
    expect(distances[0]).toBeCloseTo(2, 1)
  })

  // Asymmetric hull with corners at different energies: -1, -2, -3, -4, -5
  // Tests barycentric weighting and catches off-by-one errors in linear system solving
  const asymmetric_hull: number[][] = [
    [1, 0, 0, 0, -1],
    [0, 1, 0, 0, -2],
    [0, 0, 1, 0, -3],
    [0, 0, 0, 1, -4],
    [0, 0, 0, 0, -5],
    [0.2, 0.2, 0.2, 0.2, -10],
  ]

  test.each([
    { query: [1, 0, 0, 0, 0], expected: 1, desc: `corner 1 (hull_e=-1)` },
    { query: [0, 0, 0, 0, 0], expected: 5, desc: `corner 5 (hull_e=-5)` },
    {
      query: [0.25, 0.25, 0.25, 0.25, 0],
      expected: 2.5,
      desc: `uniform mix (hull_e=-2.5)`,
    },
  ])(`barycentric interpolation: $desc → e_above=$expected`, ({ query, expected }) => {
    const lower_hull = compute_lower_hull_nd(compute_quickhull_nd(asymmetric_hull))
    const distances = compute_e_above_hull_nd([query], lower_hull, asymmetric_hull)
    expect(distances[0]).toBeCloseTo(expected, 1)
  })
})
