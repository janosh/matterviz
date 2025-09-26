import {
  compute_lower_hull_triangles,
  compute_quickhull_triangles,
} from '$lib/phase-diagram/convex-hull'
import { build_lower_hull_model, e_hull_at_xy } from '$lib/phase-diagram/energies'
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
