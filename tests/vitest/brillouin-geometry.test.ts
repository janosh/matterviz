import {
  cartesian_to_fractional,
  k_lattice_inverse,
  polyhedron_geometry,
} from '$lib/brillouin'
import type { Matrix3x3, Vec3 } from '$lib/math'
import { describe, expect, test } from 'vitest'

const cube_vertices: Vec3[] = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
]

describe(`polyhedron_geometry`, () => {
  test(`returns null for empty faces`, () => {
    expect(polyhedron_geometry(cube_vertices, [])).toBeNull()
  })

  test(`fan-triangulates polygons with per-face normals`, () => {
    const geometry = polyhedron_geometry(cube_vertices, [[0, 1, 2, 3]])
    expect(geometry).not.toBeNull()
    // quad -> 2 triangles -> 6 vertices, 3 components each
    expect(geometry?.getAttribute(`position`).count).toBe(6)
    const normals = geometry?.getAttribute(`normal`)
    expect(normals?.count).toBe(6)
    // CCW quad in xy-plane -> +z normal for every vertex
    for (let idx = 0; idx < 6; idx++) {
      expect([normals?.getX(idx), normals?.getY(idx), normals?.getZ(idx)]).toEqual([0, 0, 1])
    }
    expect(geometry?.boundingSphere).not.toBeNull()
    geometry?.dispose()
  })

  test(`skips degenerate faces and out-of-bounds indices`, () => {
    const geometry = polyhedron_geometry(cube_vertices, [
      [0, 1], // fewer than 3 vertices
      [0, 1, 99], // out-of-bounds index
      [0, 1, 2], // valid triangle
    ])
    expect(geometry?.getAttribute(`position`).count).toBe(3)
    geometry?.dispose()
  })
})

describe(`k_lattice_inverse + cartesian_to_fractional`, () => {
  const k_lattice: Matrix3x3 = [
    [2, 0, 0],
    [0, 4, 0],
    [0, 0, 8],
  ]

  test(`round-trips Cartesian to fractional coordinates`, () => {
    const inv = k_lattice_inverse(k_lattice)
    expect(inv).not.toBeNull()
    expect(cartesian_to_fractional(inv, [2, 4, 8])).toEqual([1, 1, 1])
    expect(cartesian_to_fractional(inv, [1, 1, 1])).toEqual([0.5, 0.25, 0.125])
  })

  test(`returns null for missing or singular lattice`, () => {
    expect(k_lattice_inverse(undefined)).toBeNull()
    const singular: Matrix3x3 = [
      [1, 0, 0],
      [2, 0, 0],
      [0, 0, 1],
    ]
    expect(k_lattice_inverse(singular)).toBeNull()
    expect(cartesian_to_fractional(null, [1, 2, 3])).toBeNull()
  })
})
