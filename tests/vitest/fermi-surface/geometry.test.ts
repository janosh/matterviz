// Tests for indexed BufferGeometry construction from Fermi isosurfaces
import { build_isosurface_geometry, nearest_vertex_index } from '$lib/fermi-surface/geometry'
import type { FermiIsosurface } from '$lib/fermi-surface/types'
import { css_to_linear_rgb } from '$lib/scene/colors'
import { get_d3_interpolator } from '$lib/colors'
import type { Vec3 } from '$lib/math'
import { describe, expect, test } from 'vitest'

// Unit-square sheet at z=0 plus one vertex lifted to z=1, so normals are non-trivial
const vertices: Vec3[] = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0.5, 0.5, 1],
]
const make_surface = (overrides: Partial<FermiIsosurface> = {}): FermiIsosurface => ({
  vertices,
  faces: [[0, 1, 2, 3]], // one quad → two triangles (0,1,2), (0,2,3)
  normals: vertices.map(() => [0, 0, 1]),
  band_index: 0,
  spin: null,
  ...overrides,
})

describe(`build_isosurface_geometry`, () => {
  test(`builds an indexed geometry: one position per vertex, fan-triangulated index`, () => {
    const geometry = build_isosurface_geometry(make_surface())
    if (!geometry) throw new Error(`expected geometry`)
    expect(geometry.getAttribute(`position`).count).toBe(5)
    expect(Array.from(geometry.getAttribute(`position`).array)).toEqual(vertices.flat())
    expect(Array.from(geometry.getIndex()?.array ?? [])).toEqual([0, 1, 2, 0, 2, 3])
    expect(geometry.getAttribute(`normal`).count).toBe(5)
    expect(geometry.hasAttribute(`color`)).toBe(false)
    expect(geometry.boundingSphere?.radius).toBeGreaterThan(0.7)
    geometry.dispose()
  })

  test.each([
    {
      label: `faces with out-of-range indices`,
      faces: [
        [0, 1, 2],
        [0, 2, 9],
        [-1, 0, 1],
      ],
      expected: [0, 1, 2],
    },
    {
      label: `degenerate sub-3 faces`,
      faces: [
        [0, 1],
        [1, 2, 3],
      ],
      expected: [1, 2, 3],
    },
  ])(`drops $label`, ({ faces, expected }) => {
    const geometry = build_isosurface_geometry(make_surface({ faces }))
    expect(Array.from(geometry?.getIndex()?.array ?? [])).toEqual(expected)
    geometry?.dispose()
  })

  test.each([
    { label: `no vertices`, overrides: { vertices: [] as Vec3[] } },
    { label: `no faces`, overrides: { faces: [] as number[][] } },
    { label: `only invalid faces`, overrides: { faces: [[7, 8, 9]] } },
  ])(`returns null for $label`, ({ overrides }) => {
    expect(build_isosurface_geometry(make_surface(overrides))).toBeNull()
  })

  test(`computes area-weighted vertex normals when the surface has none`, () => {
    // Tent: base quad plus four side triangles to the apex; apex normal points straight up
    const faces = [
      [0, 2, 1],
      [0, 3, 2], // base, wound to face −z
      [0, 1, 4],
      [1, 2, 4],
      [2, 3, 4],
      [3, 0, 4],
    ]
    const geometry = build_isosurface_geometry(make_surface({ faces, normals: [] }))
    if (!geometry) throw new Error(`expected geometry`)
    const normals = geometry.getAttribute(`normal`).array
    const apex = Array.from(normals.subarray(12, 15))
    expect(apex[0]).toBeCloseTo(0, 6)
    expect(apex[1]).toBeCloseTo(0, 6)
    expect(apex[2]).toBeCloseTo(1, 6)
    for (let idx = 0; idx < 5; idx++) {
      expect(
        Math.hypot(normals[3 * idx], normals[3 * idx + 1], normals[3 * idx + 2]),
      ).toBeCloseTo(1, 6)
    }
    geometry.dispose()
  })

  test(`maps per-vertex properties through the colormap once per vertex (linear RGB)`, () => {
    const properties = [0, 0.25, 0.5, 0.75, 1]
    const geometry = build_isosurface_geometry(make_surface({ properties }), {
      colormap: `interpolateViridis`,
      color_range: [0, 1],
    })
    if (!geometry) throw new Error(`expected geometry`)
    const colors = geometry.getAttribute(`color`)
    expect(colors.count).toBe(5)
    const viridis = get_d3_interpolator(`interpolateViridis`)
    for (const [idx, prop] of properties.entries()) {
      const [red, green, blue] = css_to_linear_rgb(viridis(prop))
      // 256-entry LUT quantization: measured max per-channel deviation 0.0065 in linear RGB
      expect(Math.abs(colors.array[3 * idx] - red)).toBeLessThan(0.01)
      expect(Math.abs(colors.array[3 * idx + 1] - green)).toBeLessThan(0.01)
      expect(Math.abs(colors.array[3 * idx + 2] - blue)).toBeLessThan(0.01)
    }
    geometry.dispose()
  })

  test(`skips the colour attribute when properties do not cover every vertex`, () => {
    const geometry = build_isosurface_geometry(make_surface({ properties: [1, 2] }), {
      colormap: `interpolateViridis`,
      color_range: [0, 1],
    })
    expect(geometry?.hasAttribute(`color`)).toBe(false)
    geometry?.dispose()
  })
})

describe(`nearest_vertex_index`, () => {
  test.each([
    { point: [0.9, 0.1, 0] as Vec3, expected: 1 },
    { point: [0.5, 0.5, 0.8] as Vec3, expected: 4 },
    { point: [-5, 10, 0] as Vec3, expected: 3 },
  ])(`finds vertex $expected nearest to $point`, ({ point, expected }) => {
    const geometry = build_isosurface_geometry(make_surface())
    if (!geometry) throw new Error(`expected geometry`)
    expect(nearest_vertex_index(geometry, point)).toBe(expected)
    geometry.dispose()
  })
})
