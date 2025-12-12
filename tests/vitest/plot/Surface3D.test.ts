import type { Surface3DConfig } from '$lib/plot/types'
import { describe, expect, test } from 'vitest'

// Tests for surface configuration logic that affects material properties.
// The actual Three.js rendering is validated via Playwright visual tests.

describe(`Surface3D configuration logic`, () => {
  describe(`opacity and transparency`, () => {
    test.each([
      { opacity: 1, expected_transparent: false },
      { opacity: 0.9, expected_transparent: true },
      { opacity: 0.5, expected_transparent: true },
      { opacity: 0.1, expected_transparent: true },
      { opacity: 0, expected_transparent: true },
      { opacity: undefined, expected_transparent: false }, // defaults to 1
    ])(
      `opacity $opacity -> transparent: $expected_transparent`,
      ({ opacity, expected_transparent }) => {
        const is_transparent = (opacity ?? 1) < 1
        expect(is_transparent).toBe(expected_transparent)
      },
    )
  })

  describe(`double-sided rendering`, () => {
    test.each([
      // Explicit double_sided overrides auto behavior
      { double_sided: true, opacity: 1, expected: true },
      { double_sided: false, opacity: 1, expected: false },
      { double_sided: true, opacity: 0.5, expected: true },
      { double_sided: false, opacity: 0.5, expected: false },
      // Auto behavior: transparent surfaces default to double-sided
      { double_sided: undefined, opacity: 1, expected: false },
      { double_sided: undefined, opacity: 0.5, expected: true },
    ])(
      `double_sided=$double_sided, opacity=$opacity -> $expected`,
      ({ double_sided, opacity, expected }) => {
        const is_transparent = (opacity ?? 1) < 1
        const is_double_sided = double_sided ?? is_transparent
        expect(is_double_sided).toBe(expected)
      },
    )
  })

  describe(`grid surface z-value sampling`, () => {
    test(`samples z values correctly for paraboloid`, () => {
      const z_fn = (x_coord: number, y_coord: number) =>
        x_coord * x_coord + y_coord * y_coord

      // Test corners, center, and intermediate points
      expect(z_fn(-1, -1)).toBe(2)
      expect(z_fn(1, 1)).toBe(2)
      expect(z_fn(-1, 1)).toBe(2)
      expect(z_fn(1, -1)).toBe(2)
      expect(z_fn(0, 0)).toBe(0)
      expect(z_fn(0.5, 0.5)).toBe(0.5)
      expect(z_fn(0.5, 0)).toBe(0.25)
      expect(z_fn(0, 0.5)).toBe(0.25)

      // Verify symmetry: f(x,y) = f(-x,y) = f(x,-y) = f(-x,-y)
      expect(z_fn(0.3, 0.7)).toBe(z_fn(-0.3, 0.7))
      expect(z_fn(0.3, 0.7)).toBe(z_fn(0.3, -0.7))
      expect(z_fn(0.3, 0.7)).toBe(z_fn(-0.3, -0.7))
    })

    test(`handles saddle surface with positive and negative z`, () => {
      const z_fn = (x_coord: number, y_coord: number) =>
        x_coord * x_coord - y_coord * y_coord

      expect(z_fn(2, 0)).toBe(4)
      expect(z_fn(0, 2)).toBe(-4)
      expect(z_fn(0, 0)).toBe(0)
      expect(z_fn(1, 1)).toBe(0) // saddle point along diagonal
      expect(z_fn(-1, -1)).toBe(0)

      // Verify the saddle shape: positive along x-axis, negative along y-axis
      expect(z_fn(1, 0)).toBeGreaterThan(0)
      expect(z_fn(0, 1)).toBeLessThan(0)
      expect(z_fn(2, 1)).toBe(3) // 4 - 1
      expect(z_fn(1, 2)).toBe(-3) // 1 - 4
    })

    test(`handles sinusoidal wave surface`, () => {
      const z_fn = (x_coord: number, y_coord: number) =>
        Math.sin(x_coord * Math.PI) * Math.cos(y_coord * Math.PI)

      expect(z_fn(0, 0)).toBeCloseTo(0, 10)
      expect(z_fn(0.5, 0)).toBeCloseTo(1, 10) // sin(π/2) * cos(0) = 1
      expect(z_fn(0, 0.5)).toBeCloseTo(0, 10) // sin(0) * cos(π/2) = 0
      expect(z_fn(0.5, 0.5)).toBeCloseTo(0, 10) // sin(π/2) * cos(π/2) = 0
      expect(z_fn(1, 0)).toBeCloseTo(0, 10) // sin(π) = 0
    })
  })

  describe(`parametric surface sampling`, () => {
    test(`torus parametric function with multiple sample points`, () => {
      const major_radius = 0.4
      const minor_radius = 0.15
      const parametric_fn = (u_param: number, v_param: number) => ({
        x: (major_radius + minor_radius * Math.cos(v_param)) * Math.cos(u_param),
        y: (major_radius + minor_radius * Math.cos(v_param)) * Math.sin(u_param),
        z: minor_radius * Math.sin(v_param),
      })

      // At u=0, v=0: point is at (major+minor, 0, 0)
      const pt1 = parametric_fn(0, 0)
      expect(pt1.x).toBeCloseTo(major_radius + minor_radius, 10)
      expect(pt1.y).toBeCloseTo(0, 10)
      expect(pt1.z).toBeCloseTo(0, 10)

      // At u=0, v=PI: point is at (major-minor, 0, 0)
      const pt2 = parametric_fn(0, Math.PI)
      expect(pt2.x).toBeCloseTo(major_radius - minor_radius, 10)
      expect(pt2.y).toBeCloseTo(0, 10)
      expect(pt2.z).toBeCloseTo(0, 10)

      // At u=0, v=PI/2: point is at (major, 0, minor)
      const pt3 = parametric_fn(0, Math.PI / 2)
      expect(pt3.x).toBeCloseTo(major_radius, 10)
      expect(pt3.y).toBeCloseTo(0, 10)
      expect(pt3.z).toBeCloseTo(minor_radius, 10)

      // At u=PI/2, v=0: rotated 90° around z-axis
      const pt4 = parametric_fn(Math.PI / 2, 0)
      expect(pt4.x).toBeCloseTo(0, 10)
      expect(pt4.y).toBeCloseTo(major_radius + minor_radius, 10)
      expect(pt4.z).toBeCloseTo(0, 10)

      // At u=PI, v=0: opposite side of torus
      const pt5 = parametric_fn(Math.PI, 0)
      expect(pt5.x).toBeCloseTo(-(major_radius + minor_radius), 10)
      expect(pt5.y).toBeCloseTo(0, 10)
      expect(pt5.z).toBeCloseTo(0, 10)

      // Verify torus bounds: |z| <= minor_radius
      for (const v_val of [0, Math.PI / 4, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        const pt = parametric_fn(0, v_val)
        expect(Math.abs(pt.z)).toBeLessThanOrEqual(minor_radius + 1e-10)
      }
    })

    test(`sphere parametric function with full coverage`, () => {
      const radius = 2
      const parametric_fn = (u_param: number, v_param: number) => ({
        x: radius * Math.sin(v_param) * Math.cos(u_param),
        y: radius * Math.sin(v_param) * Math.sin(u_param),
        z: radius * Math.cos(v_param),
      })

      // At v=0 (north pole): z = radius
      const north = parametric_fn(0, 0)
      expect(north.x).toBeCloseTo(0, 10)
      expect(north.y).toBeCloseTo(0, 10)
      expect(north.z).toBeCloseTo(radius, 10)

      // At v=PI (south pole): z = -radius
      const south = parametric_fn(0, Math.PI)
      expect(south.x).toBeCloseTo(0, 10)
      expect(south.y).toBeCloseTo(0, 10)
      expect(south.z).toBeCloseTo(-radius, 10)

      // At v=PI/2, u=0: x = radius (on equator)
      const equator_x = parametric_fn(0, Math.PI / 2)
      expect(equator_x.x).toBeCloseTo(radius, 10)
      expect(equator_x.y).toBeCloseTo(0, 10)
      expect(equator_x.z).toBeCloseTo(0, 10)

      // At v=PI/2, u=PI/2: y = radius (on equator)
      const equator_y = parametric_fn(Math.PI / 2, Math.PI / 2)
      expect(equator_y.x).toBeCloseTo(0, 10)
      expect(equator_y.y).toBeCloseTo(radius, 10)
      expect(equator_y.z).toBeCloseTo(0, 10)

      // Verify all points lie on sphere: x² + y² + z² = radius²
      const test_points = [
        [0, 0],
        [0, Math.PI / 4],
        [Math.PI / 4, Math.PI / 4],
        [Math.PI / 2, Math.PI / 2],
        [Math.PI, Math.PI / 3],
      ]
      for (const [u_val, v_val] of test_points) {
        const pt = parametric_fn(u_val, v_val)
        const dist_squared = pt.x * pt.x + pt.y * pt.y + pt.z * pt.z
        expect(dist_squared).toBeCloseTo(radius * radius, 10)
      }
    })

    test(`cylinder parametric function`, () => {
      const radius = 1.5
      const height = 3
      const parametric_fn = (u_param: number, v_param: number) => ({
        x: radius * Math.cos(u_param),
        y: radius * Math.sin(u_param),
        z: v_param * height,
      })

      // Bottom circle at v=0
      const bottom = parametric_fn(0, 0)
      expect(bottom.x).toBeCloseTo(radius, 10)
      expect(bottom.y).toBeCloseTo(0, 10)
      expect(bottom.z).toBeCloseTo(0, 10)

      // Top circle at v=1
      const top = parametric_fn(0, 1)
      expect(top.x).toBeCloseTo(radius, 10)
      expect(top.y).toBeCloseTo(0, 10)
      expect(top.z).toBeCloseTo(height, 10)

      // Verify all points on surface have same radius from z-axis
      for (const u_val of [0, Math.PI / 4, Math.PI / 2, Math.PI]) {
        for (const v_val of [0, 0.25, 0.5, 0.75, 1]) {
          const pt = parametric_fn(u_val, v_val)
          const xy_radius = Math.sqrt(pt.x * pt.x + pt.y * pt.y)
          expect(xy_radius).toBeCloseTo(radius, 10)
        }
      }
    })

    test(`cone parametric function`, () => {
      const base_radius = 2
      const height = 4
      const parametric_fn = (u_param: number, v_param: number) => ({
        x: base_radius * (1 - v_param) * Math.cos(u_param),
        y: base_radius * (1 - v_param) * Math.sin(u_param),
        z: v_param * height,
      })

      // Base at v=0 has full radius
      const base = parametric_fn(0, 0)
      expect(base.x).toBeCloseTo(base_radius, 10)
      expect(base.z).toBeCloseTo(0, 10)

      // Apex at v=1 has zero radius
      const apex = parametric_fn(0, 1)
      expect(apex.x).toBeCloseTo(0, 10)
      expect(apex.y).toBeCloseTo(0, 10)
      expect(apex.z).toBeCloseTo(height, 10)

      // Mid-height has half radius
      const mid = parametric_fn(0, 0.5)
      expect(mid.x).toBeCloseTo(base_radius / 2, 10)
      expect(mid.z).toBeCloseTo(height / 2, 10)
    })
  })

  describe(`resolution configuration`, () => {
    test.each<{
      resolution: number | [number, number] | undefined
      expected: [number, number]
    }>([
      { resolution: 10, expected: [10, 10] },
      { resolution: [20, 15], expected: [20, 15] },
      { resolution: [5, 30], expected: [5, 30] },
      { resolution: undefined, expected: [20, 20] }, // default
    ])(`resolution $resolution -> $expected`, ({ resolution, expected }) => {
      const [res_x, res_y] = Array.isArray(resolution)
        ? resolution
        : [resolution ?? 20, resolution ?? 20]
      expect([res_x, res_y]).toEqual(expected)
    })
  })

  describe(`color function`, () => {
    test(`color_fn computes position-based colors correctly`, () => {
      // HSL color function
      const hsl_fn = (x_coord: number, _y: number, z_coord: number) =>
        `hsl(${(x_coord + 1) * 180}, 50%, ${(z_coord + 1) * 25}%)`

      expect(hsl_fn(0, 0, 0)).toBe(`hsl(180, 50%, 25%)`)
      expect(hsl_fn(-1, 0, 1)).toBe(`hsl(0, 50%, 50%)`)
      expect(hsl_fn(1, 0, -1)).toBe(`hsl(360, 50%, 0%)`)
      expect(hsl_fn(0.5, 0, 0.5)).toBe(`hsl(270, 50%, 37.5%)`)
      expect(hsl_fn(-0.5, 0, -0.5)).toBe(`hsl(90, 50%, 12.5%)`)

      // z-value gradient (simulates default behavior in Surface3D.svelte)
      const min_z = -2
      const max_z = 2
      const gradient_fn = (z_coord: number) => {
        const z_norm = (z_coord - min_z) / (max_z - min_z)
        return 0.66 - z_norm * 0.66 // hue from blue (0.66) to red (0)
      }
      expect(gradient_fn(min_z)).toBeCloseTo(0.66, 10) // blue at minimum
      expect(gradient_fn(max_z)).toBeCloseTo(0, 10) // red at maximum
      expect(gradient_fn(0)).toBeCloseTo(0.33, 10) // green at midpoint
    })
  })

  describe(`triangulated surface validation`, () => {
    test(`triangle indices must reference valid points`, () => {
      const surface: Surface3DConfig = {
        type: `triangulated`,
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 0.5, y: 1, z: 0.5 },
          { x: 0.5, y: 0.5, z: 1 },
        ],
        triangles: [
          [0, 1, 2],
          [0, 2, 3],
          [1, 2, 3],
          [0, 1, 3],
        ],
      }

      expect(surface.points).toHaveLength(4)
      expect(surface.triangles).toHaveLength(4)

      // Verify all triangle indices are within bounds and non-degenerate
      const num_points = surface.points?.length ?? 0
      for (const triangle of surface.triangles ?? []) {
        expect(triangle).toHaveLength(3)
        for (const vertex_idx of triangle) {
          expect(vertex_idx).toBeGreaterThanOrEqual(0)
          expect(vertex_idx).toBeLessThan(num_points)
        }
        // Verify no degenerate triangles (same vertex repeated)
        expect(new Set(triangle).size).toBe(3)
      }
    })

    test(`tetrahedron has correct geometry`, () => {
      const surface: Surface3DConfig = {
        type: `triangulated`,
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 0.5, y: Math.sqrt(3) / 2, z: 0 },
          { x: 0.5, y: Math.sqrt(3) / 6, z: Math.sqrt(2 / 3) },
        ],
        triangles: [
          [0, 1, 2], // base
          [0, 1, 3],
          [1, 2, 3],
          [0, 2, 3],
        ],
      }

      // Verify all 6 edges have same length (equilateral tetrahedron)
      const points = surface.points ?? []
      expect(points).toHaveLength(4)
      type Point3D = (typeof points)[0]
      const distance = (p1: Point3D, p2: Point3D) =>
        Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2 + (p1.z - p2.z) ** 2)

      // All 6 edges of a tetrahedron
      const edges = [
        [0, 1],
        [0, 2],
        [0, 3], // edges from vertex 0
        [1, 2],
        [1, 3], // edges from vertex 1
        [2, 3], // edge from vertex 2
      ] as const

      for (const [idx_a, idx_b] of edges) {
        expect(distance(points[idx_a], points[idx_b])).toBeCloseTo(1, 5)
      }
    })
  })
})
