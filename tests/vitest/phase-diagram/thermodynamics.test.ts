import type { ElementSymbol } from '$lib'
import type { Point4D } from '$lib/phase-diagram/thermodynamics'
import {
  build_lower_hull_model,
  compute_e_above_hull_4d,
  compute_e_above_hull_for_points,
  compute_e_form_per_atom,
  compute_lower_hull_4d,
  compute_lower_hull_triangles,
  compute_quickhull_4d,
  compute_quickhull_triangles,
  e_hull_at_xy,
  find_lowest_energy_unary_refs,
  get_phase_diagram_stats,
  normalize_pd_composition_keys,
  process_pd_entries,
} from '$lib/phase-diagram/thermodynamics'
import type { ConvexHullTriangle, PhaseData } from '$lib/phase-diagram/types'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, test, vi } from 'vitest'

function make_paraboloid_points(): { x: number; y: number; z: number }[] {
  const pts: { x: number; y: number; z: number }[] = []
  // grid over [-1,1] x [-1,1]
  for (let ix = -1; ix <= 1; ix++) {
    for (let iy = -1; iy <= 1; iy++) {
      const x = ix
      const y = iy
      const z = x * x + y * y
      pts.push({ x, y, z })
    }
  }
  return pts
}

// Helper to build entries succinctly
function entry(
  composition: Record<string, number>,
  energy: number,
  opts: Partial<PhaseData> = {},
): PhaseData {
  return {
    composition,
    energy,
    entry_id: opts.entry_id ??
      `test-${Object.keys(composition).join(`-`)}-${crypto.randomUUID()}`,
    correction: opts.correction,
    energy_per_atom: opts.energy_per_atom,
    e_form_per_atom: opts.e_form_per_atom,
  }
}

describe(`convex-hull: quickhull triangle generation`, () => {
  test(`returns empty for < 4 unique points`, () => {
    const pts = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }]
    const tris = compute_quickhull_triangles(pts)
    expect(tris.length).toBe(0)
  })

  test(`produces faces for non-coplanar set`, () => {
    const pts = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 1, z: 1 },
    ]
    const tris = compute_quickhull_triangles(pts)
    expect(tris.length).toBeGreaterThan(0)
    for (const t of tris) {
      expect(t.vertices.length).toBe(3)
      expect(t.normal).toBeDefined()
      expect(t.centroid).toBeDefined()
    }
  })
})

describe(`convex-hull: lower hull filtering`, () => {
  test(`returns only faces with downward normal`, () => {
    const pts = make_paraboloid_points()
    const all = compute_quickhull_triangles(pts)
    const lower = compute_lower_hull_triangles(pts)
    expect(lower.length).toBeGreaterThan(0)
    expect(lower.length).toBeLessThanOrEqual(all.length)
    for (const tri of lower) expect(tri.normal.z).toBeLessThan(0)
  })

  test(`coplanar points produce no hull and e_hull outside triangle is null`, () => {
    const coplanar = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0.5, y: 0.25, z: 0 },
    ]
    const tris2 = compute_quickhull_triangles(coplanar)
    expect(tris2.length).toBe(0)

    const face = {
      vertices: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
      ] as [
        { x: number; y: number; z: number },
        { x: number; y: number; z: number },
        { x: number; y: number; z: number },
      ],
      normal: { x: 0, y: 0, z: -1 },
      centroid: { x: 1 / 3, y: 1 / 3, z: 0 },
    }
    const models = build_lower_hull_model([face])
    expect(e_hull_at_xy(models, -0.1, -0.1)).toBeNull()
    expect(e_hull_at_xy(models, 1.1, 1.1)).toBeNull()
  })
})

describe(`energies: hull model and e_above_hull evaluation`, () => {
  test(`build_lower_hull_model and e_hull evaluation for a simple plane`, () => {
    const face: ConvexHullTriangle = {
      vertices: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      normal: { x: 0, y: 0, z: -1 },
      centroid: { x: 1 / 3, y: 1 / 3, z: 0 },
    }
    const models = build_lower_hull_model([face])
    expect(models.length).toBe(1)
    const z0 = e_hull_at_xy(models, 0.2, 0.2)
    expect(z0 ?? NaN).toBeCloseTo(0, 9)
    const e = compute_e_above_hull_for_points([{ x: 0.2, y: 0.2, z: 0.1 }], models)
    expect(e[0]).toBeCloseTo(0.1, 9)
  })
})

describe(`energies: process_pd_entries categorization and element extraction`, () => {
  test(`splits stable/unstable and extracts elements + el_refs`, () => {
    const entries: PhaseData[] = [
      { composition: { Li: 1 }, energy: 0, e_above_hull: 0 },
      { composition: { Fe: 2 }, energy: 0, e_above_hull: 0 },
      { composition: { Li: 1, Fe: 1 }, energy: -1, e_above_hull: 0.05 },
      { composition: { Li: 1, Fe: 2 }, energy: -2, e_above_hull: 0 },
    ]
    const out = process_pd_entries(entries)
    expect(out.elements.sort()).toEqual([`Fe`, `Li`])
    expect(out.stable_entries.length).toBe(3)
    expect(out.unstable_entries.length).toBe(1)
    expect(Object.keys(out.el_refs).sort()).toEqual([`Fe`, `Li`])
  })
})

describe(`normalize_pd_composition_keys`, () => {
  test(`strips oxidation states from composition keys`, () => {
    const result = normalize_pd_composition_keys({ 'Fe3+': 2, 'O2-': 3 })
    expect(result).toEqual({ Fe: 2, O: 3 })
  })

  test(`merges amounts for duplicate elements after stripping`, () => {
    const result = normalize_pd_composition_keys({ 'V4+': 1, 'V5+': 2 })
    expect(result).toEqual({ V: 3 })
  })

  test(`extracts only first element from multi-element keys`, () => {
    // Multi-element keys like "Fe2O3" should only use first element (Fe)
    // This is intentional - such keys should be cleaned upstream
    const result = normalize_pd_composition_keys({ Fe2O3: 2, Li: 1 })
    expect(result).toEqual({ Fe: 2, Li: 1 }) // O is NOT extracted
  })

  test(`warns and filters out invalid composition keys`, () => {
    const warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const result = normalize_pd_composition_keys({
      Fe: 2,
      invalid_key: 1,
      '!!!': 3,
      O: 1,
    })
    expect(result).toEqual({ Fe: 2, O: 1 })
    expect(warn_spy).toHaveBeenCalledTimes(2)
    expect(warn_spy).toHaveBeenCalledWith(
      `Skipping unrecognized composition key: "invalid_key"`,
    )
    expect(warn_spy).toHaveBeenCalledWith(`Skipping unrecognized composition key: "!!!"`)

    warn_spy.mockRestore()
  })

  test(`filters non-positive and non-finite amounts`, () => {
    const result = normalize_pd_composition_keys({
      Fe: 2,
      O: 0,
      Na: -1,
      Cl: NaN,
      K: Infinity,
      Ca: 3,
    })
    expect(result).toEqual({ Fe: 2, Ca: 3 })
  })

  test(`handles empty composition`, () => {
    const result = normalize_pd_composition_keys({})
    expect(result).toEqual({})
  })
})

describe(`find_lowest_energy_unary_refs()`, () => {
  test(`picks lowest corrected unary per element`, () => {
    const entries: PhaseData[] = [
      entry({ Li: 1 }, -1.0),
      entry({ Li: 1 }, -0.9, { correction: -0.2 }), // corrected per atom = -1.1 (lower)
      entry({ O: 2 }, -10.0),
      entry({ O: 2 }, -9.6, { correction: -1.0 }), // corrected per atom = (-9.6-1.0)/2 = -5.3 < -5.0
      entry({ Li: 1, O: 1 }, -4.0),
    ]

    const refs = find_lowest_energy_unary_refs(entries)
    expect(Object.keys(refs).sort()).toEqual([`Li`, `O`])

    // Validate corrected energy per atom ordering drove selection
    const picked_li = refs[`Li`]
    const picked_o = refs[`O`]
    expect(picked_li.energy).toBe(-0.9)
    expect(picked_li.correction).toBe(-0.2)
    expect(picked_o.energy).toBe(-9.6)
    expect(picked_o.correction).toBe(-1.0)
  })

  test(`ignores non-unary entries and uses energy_per_atom if present`, () => {
    const entries: PhaseData[] = [
      entry({ Li: 2 }, -2.0), // -1.0 eV/at
      entry({ Li: 1 }, 0, { energy_per_atom: -1.05 }), // should win
      entry({ Li: 1, O: 1 }, -100), // non-unary, ignored
      entry({ O: 2 }, 0, { energy_per_atom: -5.1 }), // -5.1 eV/at
      entry({ O: 2 }, -10.2), // -5.1 eV/at (tie)
    ]
    const refs = find_lowest_energy_unary_refs(entries)
    expect(Object.keys(refs).sort()).toEqual([`Li`, `O`])
    expect(refs[`Li`].energy_per_atom).toBe(-1.05)
    // Either O ref with -5.1 eV/at is acceptable
    const o_e_pa = refs[`O`].energy_per_atom ?? ((refs[`O`].energy ?? 0) / 2)
    expect(o_e_pa).toBeCloseTo(-5.1, 3)
  })
})

describe(`compute_e_form_per_atom()`, () => {
  test.each([
    // [compound, refs, expected e_form]
    [
      entry({ Li: 1, O: 1 }, -6.0),
      { Li: entry({ Li: 1 }, -1.0), O: entry({ O: 2 }, -10.0) },
      // e_pa(comp) = -6.0/2 = -3.0; refs per atom = (0.5*-1.0) + (0.5*-5.0) = -3.0; e_form = 0
      0,
    ],
    [
      entry({ Li: 1, O: 1 }, -5.9, { correction: -0.2 }),
      { Li: entry({ Li: 1 }, -1.0), O: entry({ O: 2 }, -10.0) },
      // corrected comp e_pa = (-5.9-0.2)/2 = -3.05; refs = -3.0; e_form = -0.05
      -0.05,
    ],
    [
      entry({ Li: 1, O: 1 }, -6.0),
      { Li: entry({ Li: 1 }, -1.0, { correction: -0.2 }), O: entry({ O: 2 }, -10.0) },
      // refs Li corrected = (-1.0-0.2)/1 = -1.2; refs mix = 0.5*-1.2 + 0.5*-5.0 = -3.1; e_form = -3.0 - (-3.1) = +0.1
      0.1,
    ],
  ])(`matches expected formation energy %#`, (comp, refs, expected) => {
    const e_form = compute_e_form_per_atom(comp, refs)
    expect(e_form).not.toBeNull()
    expect(e_form).toBeCloseTo(expected, 6)
  })

  test(`returns null when a needed elemental reference is missing`, () => {
    const comp = entry({ Li: 1, O: 1 }, -6.0)
    const refs = { Li: entry({ Li: 1 }, -1.0) } as Record<string, PhaseData>
    expect(compute_e_form_per_atom(comp, refs)).toBeNull()
  })

  test(`invariant to composition scaling (per-atom)`, () => {
    const comp1 = entry({ Li: 1, O: 1 }, -6.0)
    const comp2 = entry({ Li: 2, O: 2 }, -12.0) // scaled by 2
    const refs = { Li: entry({ Li: 1 }, -1.0), O: entry({ O: 2 }, -10.0) }
    const e1 = compute_e_form_per_atom(comp1, refs)
    const e2 = compute_e_form_per_atom(comp2, refs)
    expect(e1 ?? 0).toBeCloseTo(e2 ?? 0, 9)
  })
})

describe(`get_phase_diagram_stats: stability handling`, () => {
  test.each([
    {
      name: `counts stable when is_stable === true and e_above_hull undefined`,
      opts: {
        is_stable: true as boolean | undefined,
        e_above_hull: undefined as number | undefined,
      },
      expected_stable: 1,
    },
    {
      name: `counts unstable when is_stable === false and e_above_hull undefined`,
      opts: {
        is_stable: false as boolean | undefined,
        e_above_hull: undefined as number | undefined,
      },
      expected_stable: 0,
    },
    {
      name: `does not treat missing e_above_hull as stable`,
      opts: {
        is_stable: undefined as boolean | undefined,
        e_above_hull: undefined as number | undefined,
      },
      expected_stable: 0,
    },
    {
      name: `counts stable when e_above_hull === 0`,
      opts: {
        is_stable: undefined as boolean | undefined,
        e_above_hull: 0 as number | undefined,
      },
      expected_stable: 1,
    },
    {
      name: `counts stable when e_above_hull < 1e-6`,
      opts: {
        is_stable: undefined as boolean | undefined,
        e_above_hull: 1e-7 as number | undefined,
      },
      expected_stable: 1,
    },
    {
      name: `counts unstable when e_above_hull === 1e-6 (strict <)`,
      opts: {
        is_stable: undefined as boolean | undefined,
        e_above_hull: 1e-6 as number | undefined,
      },
      expected_stable: 0,
    },
  ])(`$name`, ({ opts, expected_stable }) => {
    const entries = [
      {
        composition: { Li: 1 },
        energy: 0,
        is_stable: opts.is_stable,
        e_above_hull: opts.e_above_hull,
      },
    ] as PhaseData[]
    const stats = get_phase_diagram_stats(entries, [`Li`], 3)
    expect(stats).not.toBeNull()
    expect(stats?.stable ?? -1).toBe(expected_stable)
    expect(stats?.unstable ?? -1).toBe(entries.length - expected_stable)
  })
})

describe(`4D convex hull for quaternary phase diagrams`, () => {
  test(`compute_quickhull_4d returns tetrahedra for 4D points`, () => {
    // Create a simple 4D point cloud
    const points: Point4D[] = [
      { x: 0, y: 0, z: 0, w: 0 },
      { x: 1, y: 0, z: 0, w: 0 },
      { x: 0, y: 1, z: 0, w: 0 },
      { x: 0, y: 0, z: 1, w: 0 },
      { x: 0, y: 0, z: 0, w: 1 },
      { x: 0.5, y: 0.5, z: 0.5, w: 0.5 },
    ]

    const hull = compute_quickhull_4d(points)
    expect(hull.length).toBeGreaterThan(0)

    for (const tet of hull) {
      expect(tet.vertices.length).toBe(4)
      expect(tet.normal).toBeDefined()
      expect(tet.centroid).toBeDefined()
    }
  })

  test(`compute_lower_hull_4d filters for lower faces`, () => {
    // Create points with varying w (formation energy) values
    const points: Point4D[] = [
      { x: 0, y: 0, z: 0, w: 0 }, // Origin
      { x: 1, y: 0, z: 0, w: -0.5 },
      { x: 0, y: 1, z: 0, w: -0.3 },
      { x: 0, y: 0, z: 1, w: -0.4 },
      { x: 0.5, y: 0.5, z: 0.5, w: -0.1 },
      { x: 0.25, y: 0.25, z: 0.25, w: 0.2 }, // Above hull
    ]

    const all_faces = compute_quickhull_4d(points)
    const lower_faces = compute_lower_hull_4d(points)

    expect(lower_faces.length).toBeGreaterThan(0)
    expect(lower_faces.length).toBeLessThanOrEqual(all_faces.length)

    // Verify all lower faces have normal.w < 0
    for (const face of lower_faces) {
      expect(face.normal.w).toBeLessThan(0)
    }
  })

  test(`compute_e_above_hull_4d calculates distances correctly`, () => {
    const points: Point4D[] = [
      { x: 0, y: 0, z: 0, w: 0 },
      { x: 1, y: 0, z: 0, w: 0 },
      { x: 0, y: 1, z: 0, w: 0 },
      { x: 0, y: 0, z: 1, w: 0 },
      { x: 0.25, y: 0.25, z: 0.25, w: -0.1 }, // On or below hull (evaluates to zero distance)
      { x: 0.25, y: 0.25, z: 0.25, w: 0.1 }, // Above hull
    ]

    const hull = compute_lower_hull_4d(points)
    const distances = compute_e_above_hull_4d(points, hull)

    expect(distances.length).toBe(points.length)

    // Points on or below the hull should have ~0 distance
    expect(distances[4]).toBeCloseTo(0, 6)

    // Point above hull should have positive distance
    expect(distances[5]).toBeGreaterThan(0)
  })
})

describe(`edge cases and error handling`, () => {
  test(`process_pd_entries handles empty input`, () => {
    const result = process_pd_entries([])
    expect(result.entries).toEqual([])
    expect(result.stable_entries).toEqual([])
    expect(result.unstable_entries).toEqual([])
    expect(result.elements).toEqual([])
    expect(result.el_refs).toEqual({})
  })

  test(`process_pd_entries handles entries without e_above_hull`, () => {
    const entries: PhaseData[] = [
      { composition: { Li: 1 }, energy: 0 },
      { composition: { O: 2 }, energy: 0, is_stable: true },
    ]
    const result = process_pd_entries(entries)
    expect(result.stable_entries.length).toBe(1) // Only explicitly stable
    expect(result.unstable_entries.length).toBe(1)
  })

  test(`get_phase_diagram_stats returns null for empty entries`, () => {
    const stats = get_phase_diagram_stats([], [], 3)
    expect(stats).toBeNull()
  })

  test(`get_phase_diagram_stats handles entries without energies`, () => {
    const entries: PhaseData[] = [
      { composition: { Li: 1 }, energy: 0 },
    ]
    const stats = get_phase_diagram_stats(entries, [`Li`], 3)
    expect(stats).not.toBeNull()
    expect(stats?.energy_range.min).toBe(0)
    expect(stats?.energy_range.max).toBe(0)
  })

  test(`compute_e_form_per_atom handles zero atoms`, () => {
    const entry_zero_atoms = entry({ Li: 0 }, -1.0)
    const refs = { Li: entry({ Li: 1 }, -1.0) }
    expect(compute_e_form_per_atom(entry_zero_atoms, refs)).toBeNull()
  })

  test(`compute_e_form_per_atom handles missing energy field`, () => {
    const entry_no_energy = { composition: { Li: 1 } } as PhaseData
    const refs = { Li: entry({ Li: 1 }, -1.0) }
    const result = compute_e_form_per_atom(entry_no_energy, refs)
    // Should handle gracefully, likely returning null or using default
    expect(result === null || typeof result === `number`).toBe(true)
  })

  test(`find_lowest_energy_unary_refs handles entries with zero composition`, () => {
    const entries: PhaseData[] = [
      entry({ Li: 0 }, -1.0), // Zero amount
      entry({ Li: 1 }, -0.5),
    ]
    const refs = find_lowest_energy_unary_refs(entries)
    expect(refs.Li).toBeDefined()
    expect(refs.Li.energy).toBe(-0.5)
  })

  test(`e_hull_at_xy returns null for point outside all triangles`, () => {
    const face: ConvexHullTriangle = {
      vertices: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      normal: { x: 0, y: 0, z: -1 },
      centroid: { x: 1 / 3, y: 1 / 3, z: 0 },
    }
    const models = build_lower_hull_model([face])

    // Test points well outside the triangle
    expect(e_hull_at_xy(models, 10, 10)).toBeNull()
    expect(e_hull_at_xy(models, -5, -5)).toBeNull()
  })

  test(`compute_e_above_hull_for_points handles empty hull model`, () => {
    const points = [{ x: 0.5, y: 0.5, z: 0 }]
    const distances = compute_e_above_hull_for_points(points, [])
    expect(distances).toEqual([0]) // Should return 0 when hull is empty
  })

  test(`compute_quickhull_triangles handles degenerate cases`, () => {
    // All points on a line
    const collinear = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
    ]
    expect(compute_quickhull_triangles(collinear)).toEqual([])

    // All points on a plane
    const coplanar = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 1, z: 0 },
    ]
    expect(compute_quickhull_triangles(coplanar)).toEqual([])
  })

  test(`compute_lower_hull_triangles filters correctly`, () => {
    // Create a simple pyramid with both upper and lower faces
    const pyramid = [
      { x: 0, y: 0, z: 0 }, // Base corners
      { x: 1, y: 0, z: 0 },
      { x: 0.5, y: 1, z: 0 },
      { x: 0.5, y: 0.5, z: 1 }, // Top (positive z)
      { x: 0.5, y: 0.5, z: -1 }, // Bottom (negative z)
    ]
    const lower_hull = compute_lower_hull_triangles(pyramid)

    // All lower hull faces should have negative z normal
    for (const tri of lower_hull) {
      expect(tri.normal.z).toBeLessThan(0)
    }
  })
})

describe(`4D hull edge cases`, () => {
  test(`compute_quickhull_4d returns empty for insufficient points`, () => {
    const points: Point4D[] = [
      { x: 0, y: 0, z: 0, w: 0 },
      { x: 1, y: 0, z: 0, w: 0 },
      { x: 0, y: 1, z: 0, w: 0 },
      { x: 0, y: 0, z: 1, w: 0 },
    ]
    const hull = compute_quickhull_4d(points) // Only 4 points, need 5
    expect(hull).toEqual([])
  })

  test(`compute_quickhull_4d handles coplanar points in 4D`, () => {
    // All points on a 3D hyperplane
    const coplanar: Point4D[] = [
      { x: 0, y: 0, z: 0, w: 0 },
      { x: 1, y: 0, z: 0, w: 0 },
      { x: 0, y: 1, z: 0, w: 0 },
      { x: 0, y: 0, z: 1, w: 0 },
      { x: 0.5, y: 0.5, z: 0, w: 0 },
      { x: 0.25, y: 0.25, z: 0.25, w: 0 },
    ]
    const hull = compute_quickhull_4d(coplanar)
    // May return empty or minimal hull depending on implementation
    expect(Array.isArray(hull)).toBe(true)
  })

  test(`compute_e_above_hull_4d handles empty hull`, () => {
    const points: Point4D[] = [
      { x: 0.25, y: 0.25, z: 0.25, w: 0.1 },
    ]
    const distances = compute_e_above_hull_4d(points, [])
    expect(distances).toEqual([0]) // Empty hull should return 0
  })

  test(`compute_e_above_hull_4d handles point not projecting onto any hull facet`, () => {
    // Create a simple hull
    const hull_points: Point4D[] = [
      { x: 0, y: 0, z: 0, w: 0 },
      { x: 1, y: 0, z: 0, w: 0 },
      { x: 0, y: 1, z: 0, w: 0 },
      { x: 0, y: 0, z: 1, w: 0 },
      { x: 0.25, y: 0.25, z: 0.25, w: -0.1 },
    ]
    const hull = compute_lower_hull_4d(hull_points)

    // Point with composition outside the hull's barycentric range
    const test_points: Point4D[] = [
      { x: 2, y: 0, z: 0, w: 0 }, // Outside barycentric simplex
    ]
    const distances = compute_e_above_hull_4d(test_points, hull)
    expect(distances[0]).toBe(0) // Should return 0 when not projecting onto hull
  })
})

describe(`4D hull validation against quaternary phase diagram data`, () => {
  const load_quaternary_data = (filename: string): PhaseData[] => {
    const path = `src/site/phase-diagrams/quaternaries/${filename}`
    const buffer = readFileSync(path)
    const data = gunzipSync(buffer).toString()
    return JSON.parse(data) as PhaseData[]
  }

  test.each([
    `Li-Co-Ni-O.json.gz`,
    `Na-Fe-P-O.json.gz`,
  ])(`validates 4D hull against precomputed values in %s`, (filename) => {
    const entries = load_quaternary_data(filename)

    // Filter entries that have both e_above_hull and e_form_per_atom
    const testable_entries = entries.filter(
      (e): e is typeof e & { e_above_hull: number; e_form_per_atom: number } =>
        typeof e.e_above_hull === `number` &&
        typeof e.e_form_per_atom === `number`,
    )

    expect(testable_entries.length).toBeGreaterThan(0)

    const elements = Array.from(
      new Set(testable_entries.flatMap((entry) => Object.keys(entry.composition))),
    ).sort() as ElementSymbol[]

    expect(elements.length).toBe(4) // Should be quaternary

    // Convert to 4D points (barycentric x,y,z + formation energy w)
    const points_4d: Point4D[] = testable_entries.map((entry) => {
      const amounts = elements.map((el) => entry.composition[el] || 0)
      const total = amounts.reduce((sum, amt) => sum + amt, 0)
      const normalized = amounts.map((amt) => amt / total)

      return {
        x: normalized[0],
        y: normalized[1],
        z: normalized[2],
        w: entry.e_form_per_atom,
      }
    })

    // Compute hull
    const hull = compute_lower_hull_4d(points_4d)
    expect(hull.length).toBeGreaterThan(0)

    // Compute distances
    const computed_distances = compute_e_above_hull_4d(points_4d, hull)

    // Compare with precomputed values
    let total_error = 0
    let max_error = 0
    let matches_within_tolerance = 0
    const tolerance = 1e-3 // 1 meV/atom tolerance

    for (let idx = 0; idx < testable_entries.length; idx++) {
      const precomputed = testable_entries[idx].e_above_hull
      const computed = computed_distances[idx]
      const error = Math.abs(precomputed - computed)

      total_error += error
      max_error = Math.max(max_error, error)

      if (error < tolerance) {
        matches_within_tolerance++
      }
    }

    const avg_error = total_error / testable_entries.length
    const match_rate = (matches_within_tolerance / testable_entries.length) * 100

    // We expect very high agreement
    expect(match_rate).toBeGreaterThan(95)
    expect(avg_error).toBeLessThan(0.01) // Average error < 10 meV/atom
  })
})
