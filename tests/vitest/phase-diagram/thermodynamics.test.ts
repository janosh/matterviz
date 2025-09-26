import {
  build_lower_hull_model,
  compute_e_above_hull_for_points,
  compute_formation_energy_per_atom,
  compute_lower_hull_triangles,
  compute_quickhull_triangles,
  e_hull_at_xy,
  find_lowest_energy_unary_refs,
  process_pd_entries,
} from '$lib/phase-diagram/thermodynamics'
import type { ConvexHullTriangle, PhaseEntry } from '$lib/phase-diagram/types'
import { describe, expect, test } from 'vitest'

function make_paraboloid_points(): Array<{ x: number; y: number; z: number }> {
  const pts: Array<{ x: number; y: number; z: number }> = []
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
  opts: Partial<PhaseEntry> = {},
): PhaseEntry {
  return {
    composition,
    energy,
    entry_id: opts.entry_id,
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
    const entries: PhaseEntry[] = [
      { composition: { A: 1 }, energy: 0, e_above_hull: 0 },
      { composition: { B: 2 }, energy: 0, e_above_hull: 0 },
      { composition: { A: 1, B: 1 }, energy: -1, e_above_hull: 0.05 },
      { composition: { A: 1, B: 2 }, energy: -2, e_above_hull: 0 },
    ]
    const out = process_pd_entries(entries)
    expect(out.elements.sort()).toEqual([`A`, `B`])
    expect(out.stable_entries.length).toBe(3)
    expect(out.unstable_entries.length).toBe(1)
    expect(Object.keys(out.el_refs).sort()).toEqual([`A`, `B`])
  })
})

describe(`find_lowest_energy_unary_refs()`, () => {
  test(`picks lowest corrected unary per element`, () => {
    const entries: PhaseEntry[] = [
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
    const entries: PhaseEntry[] = [
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

describe(`compute_formation_energy_per_atom()`, () => {
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
    const e_form = compute_formation_energy_per_atom(comp, refs)
    expect(e_form).not.toBeNull()
    expect(e_form).toBeCloseTo(expected, 6)
  })

  test(`returns null when a needed elemental reference is missing`, () => {
    const comp = entry({ Li: 1, O: 1 }, -6.0)
    const refs = { Li: entry({ Li: 1 }, -1.0) } as Record<string, PhaseEntry>
    expect(compute_formation_energy_per_atom(comp, refs)).toBeNull()
  })

  test(`invariant to composition scaling (per-atom)`, () => {
    const comp1 = entry({ Li: 1, O: 1 }, -6.0)
    const comp2 = entry({ Li: 2, O: 2 }, -12.0) // scaled by 2
    const refs = { Li: entry({ Li: 1 }, -1.0), O: entry({ O: 2 }, -10.0) }
    const e1 = compute_formation_energy_per_atom(comp1, refs)
    const e2 = compute_formation_energy_per_atom(comp2, refs)
    expect(e1 ?? 0).toBeCloseTo(e2 ?? 0, 9)
  })
})
