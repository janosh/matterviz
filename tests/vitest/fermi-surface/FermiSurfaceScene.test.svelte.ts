// Mounts FermiSurfaceScene against the recording Threlte stub: the materials handed to the
// meshes must survive an opacity-slider tick (they are shared per surface and recompiled on
// rebuild) and a surface whose geometry cannot be built must not get a mesh.
import FermiSurfaceScene from '#lib/fermi-surface/FermiSurfaceScene.svelte'
import type { BZHoverData } from '#lib/brillouin/index.js'
import type { FermiHoverData, FermiIsosurface } from '#lib/fermi-surface/types.js'
import type * as threlte_core from '@threlte/core'
import { type ComponentProps, flushSync, mount, unmount } from 'svelte'
import {
  type BufferGeometry,
  DoubleSide,
  type InstancedMesh,
  type MeshStandardMaterial,
  Vector3,
} from 'three/webgpu'
import { centered_cell_edges } from '#lib/fermi-surface/compute.js'
import type { Matrix3x3, Vec3 } from '#lib/math.js'
import { afterEach, expect, test, vi } from 'vitest'
import { threlte_stub } from '../isosurface/threlte-stub'
import { bind_props } from '../setup'
import { make_fermi_surface } from '../test-fixtures'

const invalidate = vi.hoisted(() => vi.fn())
vi.mock(`@threlte/core`, async (original) => {
  const core = await original<typeof threlte_core>()
  return {
    ...core,
    T: (await import(`../isosurface/threlte-stub`)).threlte_stub.T,
    useThrelte: () => ({
      invalidate,
      scene: { name: `scene` },
      camera: core.currentWritable({ id: 1 }),
      // SceneCamera re-applies its view-offset pan on resize
      size: core.currentWritable({ width: 800, height: 600 }),
      renderer: { domElement: document.createElement(`canvas`) },
    }),
  }
})
// OrbitControls is a Threlte component; interactivity() registers pointer plugins on a renderer,
// so it is replaced by a recording `enabled` switch that also records the hit filter
const hover_enabled = vi.hoisted(() => ({ set: vi.fn() }))
const interactivity = vi.hoisted(() =>
  vi.fn((_options?: unknown) => ({ enabled: hover_enabled })),
)
vi.mock(`@threlte/extras`, async () => ({
  OrbitControls: Reflect.get(
    (await import(`../isosurface/threlte-stub`)).threlte_stub.T,
    `OrbitControls`,
  ),
  interactivity,
}))

let teardown: (() => void) | undefined
afterEach(() => {
  teardown?.()
  teardown = undefined
  threlte_stub.reset()
  vi.clearAllMocks()
})

// One triangle per surface; `empty` has no vertices, so build_isosurface_geometry returns null
const sheet = (band_index: number, n_vertices = 3): FermiIsosurface => ({
  positions: new Float32Array(
    Array.from({ length: n_vertices * 3 }, (_, idx) => (idx % 3 === 0 ? band_index : idx)),
  ),
  normals: new Float32Array(
    Array.from({ length: n_vertices * 3 }, (_, idx) => Number(idx % 3 === 2)),
  ),
  indices: new Uint32Array(n_vertices >= 3 ? [0, 1, 2] : []),
  band_index,
  spin: null,
})
const fermi_data = make_fermi_surface([sheet(0), sheet(1, 0), sheet(2)])

const mount_scene = (props: ComponentProps<typeof FermiSurfaceScene>) => {
  const component = mount(FermiSurfaceScene, {
    target: document.body,
    props: bind_props(
      { fermi_data, tile_bz: false, show_bz: false, show_vectors: false, gizmo: false },
      props,
    ),
  })
  teardown = () => void unmount(component)
  flushSync()
}

// Materials of the sheet meshes in mount order (surface-major)
const mesh_materials = () =>
  threlte_stub.nodes
    .filter(({ tag }) => tag === `Mesh`)
    .map(({ props }) => props.material as MeshStandardMaterial)

test(`opacity ticks and re-extracted sheets reuse the materials; crossing opaque rebuilds them`, () => {
  const props = $state({ surface_opacity: 0.6, fermi_data })
  mount_scene(props)

  // One double-sided mesh per renderable surface (the empty sheet gets none)
  const transparent = mesh_materials()
  expect(transparent).toHaveLength(2)
  expect(new Set(transparent).size).toBe(2)
  for (const material of transparent) {
    expect(material.side).toBe(DoubleSide)
    // depth writes stay on: they hide an outer sheet behind an inner one instead of blending it
    expect(material).toMatchObject({ transparent: true, opacity: 0.6, depthWrite: true })
    expect(material.polygonOffset).toBe(true)
    expect(Number.isInteger(material.polygonOffsetUnits)).toBe(true) // WebGPU truncates the bias
    expect(material.stencilWrite).toBe(false)
  }
  // Coincident sheets (spin-up/-down copies of one band) must not z-fight: each surface sits at
  // its own depth bias with a shared slope factor so genuinely different sheets keep their
  // order at grazing angles
  const [sheet_0, sheet_1] = transparent
  expect(sheet_1.polygonOffsetUnits - sheet_0.polygonOffsetUnits).toBeGreaterThanOrEqual(4)
  expect(sheet_0.polygonOffsetFactor).toBe(sheet_1.polygonOffsetFactor)
  // three's WebGPU pipeline cache key ignores the polygon offset (mrdoob/three.js#34405); a
  // per-surface stencil read mask (keyed but inert) keeps the surfaces from sharing one pipeline
  expect(sheet_0.stencilFuncMask).not.toBe(sheet_1.stencilFuncMask)
  const dispose_spies = transparent.map((material) => vi.spyOn(material, `dispose`))

  invalidate.mockClear()
  props.surface_opacity = 0.7
  flushSync()
  // Same instances, written in place
  expect(mesh_materials()).toEqual(transparent)
  expect(transparent.map((material) => material.opacity)).toEqual([0.7, 0.7])
  expect(invalidate).toHaveBeenCalled() // on-demand renderer repaints the new uniform
  for (const spy of dispose_spies) expect(spy).not.toHaveBeenCalled()

  // A re-extraction (new fermi_data, same bands, e.g. every frame of a band-plot hover) keeps
  // the materials: each new one costs three a node-builder pass on its first render
  props.fermi_data = make_fermi_surface([sheet(0), sheet(1, 0), sheet(2)])
  flushSync()
  expect(mesh_materials()).toEqual(transparent)
  for (const spy of dispose_spies) expect(spy).not.toHaveBeenCalled()
  // a sheet of another band at the same slot gets its own colour, so a new material, and the
  // one no sheet uses any more is disposed
  props.fermi_data = make_fermi_surface([sheet(0), sheet(1, 0), sheet(3)])
  flushSync()
  const [kept, replaced] = mesh_materials()
  expect(kept).toBe(transparent[0])
  expect(replaced).not.toBe(transparent[1])
  expect(dispose_spies.map((spy) => spy.mock.calls.length)).toEqual([0, 1])
  props.fermi_data = fermi_data
  flushSync()
  const restored = mesh_materials()

  // Fully opaque rebuilds fresh (non-transparent) materials
  props.surface_opacity = 1
  flushSync()
  const opaque = mesh_materials()
  expect(opaque).toHaveLength(2)
  for (const material of opaque) {
    expect([...transparent, ...restored]).not.toContain(material)
    expect(material).toMatchObject({ transparent: false, opacity: 1, depthWrite: true })
  }
  for (const spy of dispose_spies) expect(spy).toHaveBeenCalledTimes(1)
  // unmounting disposes the materials still in use
  const opaque_spies = opaque.map((material) => vi.spyOn(material, `dispose`))
  teardown?.()
  teardown = undefined
  for (const spy of opaque_spies) expect(spy).toHaveBeenCalledOnce()
})

// lattice_point_group_matrices memoized into a module-level SvelteMap inside the `symmetry_ops`
// $derived, which Svelte 5 rejects. Must stay the only tiled mount here: a warm cache hides it.
test(`tiling the BZ mounts one mesh set per point-group operation`, () => {
  mount_scene({ tile_bz: true })
  // cubic (identity) k_lattice: 48 Oh operations × 2 renderable surfaces
  expect(mesh_materials()).toHaveLength(48 * 2)
})

// A drag or wheel zoom used to keep raycasting the sheets on every pointermove, and the tooltip
// popping in and out under the cursor flickered over the surface
test(`orbiting disables hover raycasts and drops the tooltip until the gesture ends`, () => {
  // only nullness of the tooltip is asserted, so a stub stands in for the full hover record
  const props = $state<{
    hover_data: FermiHoverData | null
    kpath_hover_data: BZHoverData | null
  }>({
    hover_data: { band_index: 0 } as FermiHoverData,
    kpath_hover_data: { bz_order: 1 } as BZHoverData,
  })
  mount_scene(props)

  const orbit = threlte_stub.nodes.find(({ tag }) => tag === `OrbitControls`)
  if (!orbit) throw new Error(`OrbitControls not mounted`)
  const { onstart, onchange, onend } = orbit.props as Record<string, () => void>
  hover_enabled.set.mockClear()

  onstart()
  // raycasts switch off once the camera moves, so the press that started the orbit still hits
  expect(hover_enabled.set).not.toHaveBeenCalled()
  onchange()
  flushSync()
  expect(hover_enabled.set).toHaveBeenLastCalledWith(false)
  expect([props.hover_data, props.kpath_hover_data]).toEqual([null, null])

  onend()
  expect(hover_enabled.set).toHaveBeenLastCalledWith(true)
  expect(hover_enabled.set).toHaveBeenCalledTimes(2)
})

// Threlte hands a pointer event to every sheet under the cursor, nearest first: without the
// filter the outer sheet behind an inner one overwrote the tooltip, and a clipped-off sheet
// (raycasts ignore clipping) could win the pick
test(`hover picks the front-most sheet that survives the clip plane`, () => {
  const props = $state({ clip_enabled: false, clip_axis: `z` as const, clip_position: 0 })
  mount_scene(props)
  type Hit = { point: Vector3; object: { userData: Record<string, unknown> } }
  const { filter } = interactivity.mock.calls[0][0] as { filter: (hits: Hit[]) => unknown[] }
  const hit = (z_coord: number, userData = {}) => ({
    point: new Vector3(0, 0, z_coord),
    object: { userData },
  })
  const [inner, outer] = [hit(-1), hit(1)]
  expect(filter([inner, outer])).toStrictEqual([inner])
  // a k-path drawn through the zone wins over a sheet in front of it
  const path = hit(0.5, { kpath_proxy: true })
  expect(filter([inner, path, outer])).toStrictEqual([path])
  props.clip_enabled = true // keeps z >= 0
  flushSync()
  expect(filter([inner, outer])).toStrictEqual([outer])
})

// Property mode colours each sheet by the selected named property (the first when none is
// named); a sheet without it keeps its flat colour, and the tooltip carries every property at
// the hit vertex
test(`colours by the selected property and reports all properties on hover`, () => {
  const f32 = (values: number[]) => Float32Array.from(values)
  const data = make_fermi_surface([
    { ...sheet(0), properties: { λ: f32([0, 0.5, 1]), Δ: f32([1, 2, NaN]) } },
    { ...sheet(2), properties: { λ: f32([0.2, 0.2, 0.2]) } },
  ])
  const props = $state<ComponentProps<typeof FermiSurfaceScene>>({
    fermi_data: data,
    color_property: `property`,
    property_name: undefined,
    hover_data: null,
  })
  mount_scene(props)
  const vertex_colors = () => mesh_materials().map((material) => material.vertexColors)
  expect(vertex_colors()).toEqual([true, true]) // first property λ: both sheets have it
  // equal colouring still needs a material per sheet: depth bias and stencil mask differ
  const [mat_0, mat_1] = mesh_materials()
  expect(mat_0).not.toBe(mat_1)
  expect(mat_0.stencilFuncMask).not.toBe(mat_1.stencilFuncMask)
  props.property_name = `Δ`
  flushSync()
  expect(vertex_colors()).toEqual([true, false]) // band 2 has no Δ
  props.property_name = `λ`
  flushSync()
  expect(vertex_colors()).toEqual([true, true])

  const mesh = threlte_stub.nodes.find(({ tag }) => tag === `Mesh`)
  const on_move = mesh?.props.onpointermove as (event: unknown) => void
  // nearest corner of face (0, 1, 2) to a point on vertex 1 of band 0's sheet (0, 4, 5)
  on_move({
    point: new Vector3(0, 4, 5),
    face: { a: 0, b: 1, c: 2 },
    nativeEvent: { clientX: 1, clientY: 2 },
  })
  expect(props.hover_data).toMatchObject({
    property_name: `λ`,
    property_value: 0.5,
    property_values: { λ: 0.5, Δ: 2 },
  })
})

// The 2D slice shows up as a translucent plane plus outline, cut to the cell the data lives in:
// the Brillouin zone for a Wigner-Seitz mesh (here a 0.6-wide cube, so it differs from the
// unit cell), the Γ-centred unit cell for band-grid (parallelepiped) surfaces. Moving it
// rebuilds the geometry; (0 0 0) or a plane outside the cell draws nothing.
test(`marks the slice plane where it cuts the data's cell`, () => {
  // oxfmt-ignore
  const zone_lattice: Matrix3x3 = [[0.6, 0, 0], [0, 0.6, 0], [0, 0, 0.6]]
  const edges = centered_cell_edges(zone_lattice)
  const bz_data = {
    vertices: [],
    faces: [],
    order: 1,
    volume: 0.216,
    edges,
    k_lattice: zone_lattice,
  }
  const props = $state({
    fermi_data,
    bz_data,
    slice_plane: { miller_indices: [0, 0, 1] as Vec3, distance: 0.25 },
  })
  mount_scene(props)
  // flat [x, y, z, ...] outline positions and their values along one axis
  const outline = () => {
    const node = threlte_stub.nodes.findLast(({ tag }) => tag === `Line`)
    const geometry = node?.props.geometry as BufferGeometry | undefined
    return Array.from(geometry?.getAttribute(`position`).array ?? [])
  }
  const along = (axis: number) => outline().filter((_, idx) => idx % 3 === axis)
  const max_abs_x = () => Math.max(...along(0).map(Math.abs))
  // a closed Line (WebGPU has no LineLoop): the square z = 0.25 with its first corner repeated
  expect(along(2)).toEqual([0.25, 0.25, 0.25, 0.25, 0.25])
  expect(outline().slice(-3)).toEqual(outline().slice(0, 3))
  expect(max_abs_x()).toBeCloseTo(0.3, 6) // the zone's half-width, not the unit cell's
  props.fermi_data = { ...fermi_data, reciprocal_cell: `parallelepiped` }
  flushSync()
  expect(max_abs_x()).toBeCloseTo(0.5, 6) // band-grid surfaces fill the Γ-centred unit cell
  props.slice_plane = { miller_indices: [0, 0, 1], distance: -0.4 }
  flushSync()
  expect(along(2).every((coord) => Math.abs(coord + 0.4) < 1e-6)).toBe(true)
  // (0 0 0) defines no plane; (0 0 1) at 0.8 lies outside the cell
  // oxfmt-ignore
  for (const miller_indices of [[0, 0, 0], [0, 0, 1]] as Vec3[]) {
    props.slice_plane = { miller_indices, distance: 0.8 }
    flushSync()
    expect(threlte_stub.nodes.some(({ tag }) => tag === `Line`)).toBe(false)
  }
})

// The Scene hands k_path to the shared KPath (tints and disposal are covered in KPath.test)
// and draws the k_marker (e.g. the cursor on a FermiSlice) as the one on-top dot (KPath draws
// no sphere of its own here) until it clears with null. A hovered k-path point becomes zone
// hover data, fractional in the (sheared) k_lattice basis, and still reaches the caller.
test(`k_path mounts the band path and k_marker draws the on-top dot`, () => {
  // oxfmt-ignore
  const k_path_points: Vec3[] = [[0, 0, 0], [0.5, 0, 0], [0.5, 0.5, 0]]
  const on_kpath_hover = vi.fn()
  // oxfmt-ignore
  const sheared: Matrix3x3 = [[1, 0, 0], [1, 1, 0], [0, 0, 1]]
  const scene_props = $state<ComponentProps<typeof FermiSurfaceScene>>({
    fermi_data: { ...fermi_data, k_lattice: sheared },
    bz_data: { vertices: [], faces: [], edges: [], order: 1, volume: 1, k_lattice: sheared },
    k_path: {
      path: { points: k_path_points, labels: [null, null, null], branches: [[0, 2]] },
      on_kpath_hover,
    },
    k_marker: k_path_points[1],
    kpath_hover_data: null,
  })
  mount_scene(scene_props)
  // KPath's hover proxy has one instance per path segment
  const proxy = threlte_stub.nodes.find(
    ({ tag, props }) => tag === `T` && typeof props.onpointermove === `function`,
  )
  expect((proxy?.props.is as InstancedMesh | undefined)?.count).toBe(2)
  const hover_segment = proxy?.props.onpointermove as (event: unknown) => void
  // near the far end of segment 1: k-point 2 at (0.5, 0.5, 0) = 0.5 b₂
  hover_segment({
    point: new Vector3(0.5, 0.45, 0),
    instanceId: 1,
    nativeEvent: { clientX: 3, clientY: 4 },
  })
  flushSync()
  const screen_position = { x: 3, y: 4 }
  expect(scene_props.kpath_hover_data).toMatchObject({
    position_cartesian: k_path_points[2],
    position_fractional: [0, 0.5, 0],
    screen_position,
    bz_order: 1,
  })
  expect(on_kpath_hover).toHaveBeenCalledExactlyOnceWith(2, screen_position)
  const markers = threlte_stub.nodes.filter(
    ({ tag, props }) => tag === `Mesh` && props.position === scene_props.k_marker,
  )
  expect(markers.map(({ props }) => props.renderOrder)).toEqual([1001])
  scene_props.k_marker = null
  flushSync()
  expect(threlte_stub.nodes.some(({ props }) => props.renderOrder === 1001)).toBe(false)
})
