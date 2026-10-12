// Tests for indexed BufferGeometry construction and colouring of Fermi isosurfaces
import {
  apply_vertex_colors,
  available_property_names,
  property_color_range,
  property_names,
  vertex_property,
  build_isosurface_geometry,
  nearest_face_vertex,
} from '#lib/fermi-surface/geometry.js'
import type { BandEnergyGrid, FermiIsosurface } from '#lib/fermi-surface/types.js'
import type { VertexColorOptions } from '#lib/isosurface/coloring.js'
import { css_to_linear_rgb } from '#lib/scene/colors.js'
import { get_d3_interpolator } from '#lib/colors/index.js'
import type { Vec3 } from '#lib/math.js'
import type { BufferAttribute } from 'three/webgpu'
import { describe, expect, onTestFinished, test } from 'vitest'
import { make_fermi_isosurface, make_fermi_surface } from '../test-fixtures'

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
const viridis: VertexColorOptions = { colormap: `interpolateViridis`, color_range: [0, 1] }

const make_geometry = (surface = make_surface()) => {
  const geometry = build_isosurface_geometry(surface)
  if (!geometry) throw new Error(`expected geometry`)
  onTestFinished(() => geometry.dispose())
  return geometry
}

describe(`build_isosurface_geometry`, () => {
  test(`wraps the surface buffers without copying`, () => {
    const surface = make_surface()
    const geometry = make_geometry(surface)
    expect(geometry.getAttribute(`position`).count).toBe(5)
    expect(geometry.getAttribute(`position`).array).toBe(surface.positions)
    expect(geometry.getAttribute(`normal`).array).toBe(surface.normals)
    expect(geometry.getIndex()?.array).toBe(surface.indices)
    expect(geometry.hasAttribute(`color`)).toBe(false)
    // bounding sphere sits at the box centre (0.5, 0.5, 0.5); the square's corners are the
    // farthest vertices at sqrt(3 * 0.5^2)
    expect(geometry.boundingSphere?.center.toArray()).toEqual([0.5, 0.5, 0.5])
    expect(geometry.boundingSphere?.radius).toBeCloseTo(Math.sqrt(0.75), 5)
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
    const geometry = make_geometry()
    apply_vertex_colors(geometry, properties, viridis)
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
  })

  test(`recolours in place and removes the attribute when colouring is switched off`, () => {
    const surface = make_surface()
    const values = Float32Array.from([0, 0.25, 0.5, 0.75, 1])
    const geometry = make_geometry(surface)
    apply_vertex_colors(geometry, values, viridis)
    const first = geometry.getAttribute(`color`) as BufferAttribute
    const before = Array.from(first.array)
    const version_before = first.version
    apply_vertex_colors(geometry, values, {
      colormap: `interpolateMagma`,
      color_range: [0, 1],
    })
    // Same buffer, new values, flagged for re-upload — the mesh buffers are untouched
    expect(geometry.getAttribute(`color`)).toBe(first)
    expect(Array.from(first.array)).not.toEqual(before)
    expect(first.version).toBeGreaterThan(version_before) // needsUpdate bumped the version
    expect(geometry.getAttribute(`position`).array).toBe(surface.positions)
    apply_vertex_colors(geometry, values, null)
    expect(geometry.hasAttribute(`color`)).toBe(false)
    apply_vertex_colors(geometry, values, viridis)
    apply_vertex_colors(geometry, undefined, viridis) // surface without the property
    expect(geometry.hasAttribute(`color`)).toBe(false)
  })
})

describe(`named vertex properties`, () => {
  const lambda = Float32Array.from([0.2, 0.4, NaN, 0.8, 1])
  const gap = Float32Array.from([1, 2, 3, 4, 5])
  const surfaces = [
    make_surface({ properties: { λ: lambda, short: Float32Array.from([1, 2]) } }),
    make_surface({ properties: { Δ: gap, λ: Float32Array.from([-0.6, 0, 0, 0, 0]) } }),
    make_surface(),
  ]

  // vertex_property only returns arrays with one value per vertex; property_names lists every
  // name once in first-seen order
  test(`vertex_property and property_names`, () => {
    expect(vertex_property(surfaces[0], `λ`)).toBe(lambda)
    // oxfmt-ignore
    for (const [surface, name] of [[0, `short`], [0, `Δ`], [2, `λ`], [0, undefined]] as const)
      expect(vertex_property(surfaces[surface], name)).toBeUndefined()
    expect(property_names(surfaces)).toEqual([`λ`, `short`, `Δ`])
    // a band grid's properties count before (and whatever) extraction yields
    const grid: BandEnergyGrid = {
      values: new Float64Array(1),
      dims: [1, 1, 1],
      order: `z_fastest`,
    }
    const properties = { A: [[grid]], B: [[grid]] }
    expect(available_property_names(make_fermi_surface([]), { properties })).toEqual([
      `A`,
      `B`,
    ])
  })

  // NaN vertices are skipped; the range stays [min, max] even when it straddles zero, so a gap
  // with a little negative solver noise does not spend half the scale on nothing
  test.each([
    [`λ`, [surfaces[0]], [0.2, 1]],
    [`λ`, surfaces, [-0.6, 1]],
    [`Δ`, surfaces, [1, 5]],
    [`missing`, surfaces, [0, 1]],
  ])(`property_color_range of %s`, (name, subset, expected) => {
    const [low, high] = property_color_range(subset, name)
    // Float32 storage: 0.2 round-trips as 0.20000000298
    expect(low).toBeCloseTo(expected[0], 6)
    expect(high).toBeCloseTo(expected[1], 6)
  })
})

describe(`nearest_face_vertex`, () => {
  // Only the hit triangle's corners are candidates: vertex 4 (lifted apex) is nearer to the
  // last point than any corner of face [0, 2, 3] but is not part of it
  test.each([
    { face: { a: 0, b: 1, c: 2 }, point: { x: 0.9, y: 0.1, z: 0 }, expected: 1 },
    { face: { a: 0, b: 2, c: 3 }, point: { x: -5, y: 10, z: 0 }, expected: 3 },
    { face: { a: 0, b: 2, c: 3 }, point: { x: 0.2, y: 0.7, z: 0.8 }, expected: 3 },
  ])(`picks corner $expected of $face nearest to $point`, ({ face, point, expected }) => {
    const geometry = make_geometry()
    expect(nearest_face_vertex(geometry, face, point)).toBe(expected)
  })
})
