// Tests for indexed BufferGeometry construction and colouring of Fermi isosurfaces
import {
  apply_vertex_colors,
  build_isosurface_geometry,
  nearest_vertex_index,
} from '$lib/fermi-surface/geometry'
import type { VertexColorSpec } from '$lib/fermi-surface/geometry'
import type { FermiIsosurface } from '$lib/fermi-surface/types'
import { css_to_linear_rgb } from '$lib/scene/colors'
import { get_d3_interpolator } from '$lib/colors'
import type { Vec3 } from '$lib/math'
import type { BufferAttribute } from 'three/webgpu'
import { describe, expect, test } from 'vitest'
import { make_fermi_isosurface } from '../setup'

// Unit-square sheet at z=0 plus one vertex lifted to z=1
const vertices: Vec3[] = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0.5, 0.5, 1],
]
const make_surface = (overrides: Partial<FermiIsosurface> = {}): FermiIsosurface =>
  make_fermi_isosurface(
    vertices,
    [
      [0, 1, 2],
      [0, 2, 3],
    ],
    overrides,
  )
const viridis: VertexColorSpec = { colormap: `interpolateViridis`, color_range: [0, 1] }

describe(`build_isosurface_geometry`, () => {
  test(`wraps the surface buffers without copying`, () => {
    const surface = make_surface()
    const geometry = build_isosurface_geometry(surface)
    if (!geometry) throw new Error(`expected geometry`)
    expect(geometry.getAttribute(`position`).count).toBe(5)
    expect(geometry.getAttribute(`position`).array).toBe(surface.positions)
    expect(geometry.getAttribute(`normal`).array).toBe(surface.normals)
    expect(geometry.getIndex()?.array).toBe(surface.indices)
    expect(geometry.hasAttribute(`color`)).toBe(false)
    expect(geometry.boundingSphere?.radius).toBeGreaterThan(0.7)
    geometry.dispose()
  })

  test.each([
    { label: `no vertices`, overrides: { positions: new Float32Array(0) } },
    { label: `no triangles`, overrides: { indices: new Uint32Array(0) } },
  ])(`returns null for $label`, ({ overrides }) => {
    expect(build_isosurface_geometry(make_surface(overrides))).toBeNull()
  })
})

describe(`apply_vertex_colors`, () => {
  test(`maps per-vertex properties through the colormap once per vertex (linear RGB)`, () => {
    const properties = Float32Array.from([0, 0.25, 0.5, 0.75, 1])
    const surface = make_surface({ properties })
    const geometry = build_isosurface_geometry(surface)
    if (!geometry) throw new Error(`expected geometry`)
    apply_vertex_colors(geometry, surface, viridis)
    const colors = geometry.getAttribute(`color`)
    expect(colors.count).toBe(5)
    const interpolator = get_d3_interpolator(`interpolateViridis`)
    for (const [idx, prop] of properties.entries()) {
      const [red, green, blue] = css_to_linear_rgb(interpolator(prop))
      // 256-entry LUT quantization: measured max per-channel deviation 0.0065 in linear RGB
      expect(Math.abs(colors.array[3 * idx] - red)).toBeLessThan(0.01)
      expect(Math.abs(colors.array[3 * idx + 1] - green)).toBeLessThan(0.01)
      expect(Math.abs(colors.array[3 * idx + 2] - blue)).toBeLessThan(0.01)
    }
    geometry.dispose()
  })

  test(`recolours in place and removes the attribute when colouring is switched off`, () => {
    const surface = make_surface({ properties: Float32Array.from([0, 0.25, 0.5, 0.75, 1]) })
    const geometry = build_isosurface_geometry(surface)
    if (!geometry) throw new Error(`expected geometry`)
    apply_vertex_colors(geometry, surface, viridis)
    const first = geometry.getAttribute(`color`) as BufferAttribute
    const before = Array.from(first.array)
    const version_before = first.version
    apply_vertex_colors(geometry, surface, {
      colormap: `interpolateMagma`,
      color_range: [0, 1],
    })
    // Same buffer, new values, flagged for re-upload — the mesh buffers are untouched
    expect(geometry.getAttribute(`color`)).toBe(first)
    expect(Array.from(first.array)).not.toEqual(before)
    expect(first.version).toBeGreaterThan(version_before) // needsUpdate bumped the version
    expect(geometry.getAttribute(`position`).array).toBe(surface.positions)
    apply_vertex_colors(geometry, surface, null)
    expect(geometry.hasAttribute(`color`)).toBe(false)
    geometry.dispose()
  })

  test(`skips the colour attribute when properties do not cover every vertex`, () => {
    const surface = make_surface({ properties: Float32Array.from([1, 2]) })
    const geometry = build_isosurface_geometry(surface)
    if (!geometry) throw new Error(`expected geometry`)
    apply_vertex_colors(geometry, surface, viridis)
    expect(geometry.hasAttribute(`color`)).toBe(false)
    geometry.dispose()
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
