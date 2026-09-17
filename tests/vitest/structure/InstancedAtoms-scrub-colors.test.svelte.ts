// Trajectories reuse instance slots; a slot must repaint when its element changes.
import type { AtomInstances, InstancedAtom } from '$lib/structure/atom-instances'
import InstancedAtoms from '$lib/structure/InstancedAtoms.svelte'
import ColorFieldVolume from '$lib/structure/ColorFieldVolume.svelte'
import {
  AtomFieldMaterial,
  ColorFieldTexture,
  type AtomColorField,
} from '$lib/structure/atom-color-field'
import { flushSync, mount, unmount } from 'svelte'
import { useThrelte } from '@threlte/core'
import {
  Color,
  Data3DTexture,
  DataUtils,
  FloatType,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  type InstancedBufferGeometry,
  PerspectiveCamera,
  SphereGeometry,
} from 'three/webgpu'
import { afterEach, expect, test, vi } from 'vitest'
import { threlte_stub } from '../isosurface/threlte-stub'

const frame_task = vi.hoisted(() => ({ update: () => {} }))
vi.mock(`@threlte/core`, async () => {
  const { PerspectiveCamera: MockCamera } = await import(`three/webgpu`)
  const camera = new MockCamera(50, 1, 0.1, 1000)
  const size = {
    current: { height: 600 },
    subscribe: (run: (size: { height: number }) => void) => {
      run(size.current)
      return () => {}
    },
  }
  return {
    T: (await import(`../isosurface/threlte-stub`)).threlte_stub.T,
    useTask: (update: () => void) => {
      frame_task.update = update
    },
    useThrelte: () => ({
      invalidate: () => {},
      camera: { current: camera },
      size,
    }),
  }
})

const atom = (color: string, x_pos: number): InstancedAtom => ({
  position: [x_pos, 0, 0],
  radius: 0.5,
  color,
})

// frame 0 of a varying-atom-count run: 5 atoms, slot 0 black
const ch4 = (offset = 0): InstancedAtom[] => [
  atom(`#000000`, offset),
  ...Array.from({ length: 4 }, (_unused, idx) => atom(`#ffffff`, idx + 1 + offset)),
]
// frame 5: 3 atoms, slot 0 now red. The mesh is grow-only, so slots 0-2 are reused.
const h2o = (offset = 0): InstancedAtom[] => [
  atom(`#ff0000`, offset),
  atom(`#ffffff`, 1 + offset),
  atom(`#ffffff`, 2 + offset),
]

let teardown: (() => Promise<void>) | undefined
afterEach(async () => {
  await teardown?.()
  teardown = undefined
  vi.restoreAllMocks()
  threlte_stub.reset()
  const { camera, size } = useThrelte()
  camera.current.copy(new PerspectiveCamera(50, 1, 0.1, 1000))
  size.current.height = 600
})

const mount_atoms = (atoms: InstancedAtom[]) => {
  const props = $state({
    atoms,
    ghost: false,
    opacity: 1,
    sphere_segments: 20,
    color_field: undefined as AtomColorField | undefined,
  })
  const component = mount(InstancedAtoms, { target: document.body, props })
  teardown = () => unmount(component)
  flushSync()
  return props
}

const current_mesh = (): AtomInstances => threlte_stub.nodes.at(-1)?.props.is as AtomInstances

const slot_color = (slot_idx: number): number[] =>
  Array.from(current_mesh().colors.array.slice(slot_idx * 3, slot_idx * 3 + 3))

test(`volume cloud reuses its mesh and texture across opacity and cell changes`, async () => {
  const update_texture = vi.spyOn(ColorFieldTexture.prototype, `update`)
  const encode = vi.spyOn(DataUtils, `toHalfFloat`)
  const dispose_texture = vi.spyOn(Data3DTexture.prototype, `dispose`)
  const colors = new Float32Array([1, 0, 0, 0.5, 0, 0, 0, 0])
  const field: AtomColorField = {
    colors,
    dims: [2, 1, 1],
    cartesian_to_fractional: new Matrix4(),
    pbc: [true, false, false],
  }
  const props = $state({ field, opacity: 0.35 })
  const component = mount(ColorFieldVolume, { target: document.body, props })
  teardown = () => unmount(component)
  flushSync()
  const texture = update_texture.mock.contexts[0]
  if (!(texture instanceof ColorFieldTexture)) throw new Error(`Expected color field texture`)
  const texels = texture.image.data
  const texture_version = texture.version
  expect(texture).toMatchObject({
    type: HalfFloatType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
  })
  const mesh = threlte_stub.nodes.at(-1)?.props.is
  if (!(mesh instanceof Mesh)) throw new Error(`Expected cloud mesh`)
  expect(mesh.name).toBe(`ColorFieldVolume`)
  expect(mesh.geometry.index?.count).toBe(36)
  expect(mesh.material).toMatchObject({
    transparent: true,
    depthWrite: false,
    depthTest: false,
  })
  expect(encode.mock.calls.map(([value]) => value)).toEqual([0.5, 0, 0, 0.5, 0, 0, 0, 0])
  encode.mockClear()
  dispose_texture.mockClear()
  props.opacity = 0
  flushSync()
  expect(mesh.visible).toBe(false)
  props.field = { ...field, colors: new Float32Array([0, 1, 0, 0.5, 0, 0, 0, 0]) }
  flushSync()
  expect(encode).not.toHaveBeenCalled()
  expect(texture.version).toBe(texture_version)
  props.opacity = 0.8
  props.field = { ...props.field, cartesian_to_fractional: new Matrix4().makeScale(0.5, 1, 1) }
  flushSync()
  expect(mesh.visible).toBe(true)
  expect(mesh.matrix.elements[0]).toBe(2)
  expect(encode.mock.calls.map(([value]) => value)).toEqual([0, 0.5, 0, 0.5, 0, 0, 0, 0])
  expect(texture.version).toBe(texture_version + 1)
  expect(texture.image.data).toBe(texels)
  encode.mockClear()
  props.field = { ...field, colors: new Float32Array(colors) }
  flushSync()
  expect(encode).toHaveBeenCalledTimes(8)
  expect(dispose_texture).not.toHaveBeenCalled()
  expect(texture.image.data).toBe(texels)
  props.field = { ...props.field, dims: [1, 2, 1] }
  flushSync()
  expect(dispose_texture).toHaveBeenCalledTimes(1)
  expect(texture.image).toMatchObject({ data: texels, width: 1, height: 2, depth: 1 })
  props.field = { ...field, dims: [1, 3, 1], colors: new Float32Array(12) }
  flushSync()
  expect(texture.image.data).not.toBe(texels)
  expect(texture.image.data).toHaveLength(12)
  expect(threlte_stub.nodes.at(-1)?.props.is).toBe(mesh)
  const dispose_geometry = vi.spyOn(mesh.geometry, `dispose`)
  await teardown?.()
  teardown = undefined
  expect(dispose_texture).toHaveBeenCalledTimes(3)
  expect(dispose_geometry).toHaveBeenCalledTimes(1)
})

test(`heatmap updates and toggles preserve atom meshes, buffers, and geometry`, async () => {
  const update = vi.spyOn(AtomFieldMaterial.prototype, `update`)
  const props = mount_atoms(ch4())
  const mesh = current_mesh()
  const geometry = mesh.geometry
  const versions = [mesh.positions.version, mesh.colors.version]
  expect(update).not.toHaveBeenCalled()
  const field: AtomColorField = {
    colors: new Float32Array([1, 0, 0, 1]),
    dims: [1, 1, 1],
    cartesian_to_fractional: new Matrix4(),
    pbc: [true, true, true],
  }
  props.color_field = field
  flushSync()
  const controller = update.mock.contexts[0]
  if (
    !(controller instanceof AtomFieldMaterial) ||
    !(mesh.material instanceof MeshStandardNodeMaterial)
  )
    throw new Error(`Expected atom field material`)
  const texture = controller.texture
  expect(texture.type).toBe(FloatType)
  expect(texture.image.data).toBe(field.colors)
  const version = texture.version
  const color_node = mesh.material.colorNode
  const material_version = mesh.material.version
  // Frame changes only update the transform, not the texture or the shader program.
  props.color_field = { ...field, cartesian_to_fractional: new Matrix4().makeScale(0.5, 1, 1) }
  flushSync()
  expect(texture.version).toBe(version)
  expect(controller.transform.value.elements[0]).toBe(0.5)
  expect(mesh.material.version).toBe(material_version)
  const texture_dispose = vi.spyOn(texture, `dispose`)
  props.color_field = { ...field, colors: new Float32Array([0, 1, 0, 1]) }
  flushSync()
  expect(texture.version).toBe(version + 1)
  expect(texture_dispose).not.toHaveBeenCalled()
  props.color_field = { ...field, dims: [2, 1, 1], colors: new Float32Array(8) }
  flushSync()
  expect(texture_dispose).toHaveBeenCalledTimes(1)
  expect(texture.image).toMatchObject({ width: 1, height: 1, depth: 2 })
  props.color_field = undefined
  flushSync()
  expect(mesh.material.colorNode).not.toBe(color_node)
  props.color_field = field
  flushSync()
  expect(mesh.material.colorNode).toBe(color_node)
  expect(current_mesh()).toBe(mesh)
  expect(mesh.geometry).toBe(geometry)
  expect([mesh.positions.version, mesh.colors.version]).toEqual(versions)
  expect(mesh.count).toBe(5)
  await teardown?.()
  teardown = undefined
  expect(texture_dispose).toHaveBeenCalledTimes(3)
})

test(`uploads changed color slots and preserves pending ranges mid-scrub`, () => {
  const props = mount_atoms(ch4())
  const mesh = current_mesh()
  expect(`instanceColor` in mesh).toBe(false)
  expect(`isInstancedMesh` in mesh).toBe(false)
  expect(mesh.geometry.getAttribute(`atomColor`)).toBe(mesh.colors)
  expect(slot_color(0)).toEqual([0, 0, 0])
  expect(mesh.colors.updateRanges).toEqual([{ start: 0, count: 15 }])

  // scrub to a frame with fewer atoms: same mesh, slot 0 is a different element now
  props.atoms = h2o()
  flushSync()
  expect(current_mesh()).toBe(mesh) // grow-only capacity, so no new mesh hides the staleness
  expect(mesh.count).toBe(3)
  expect(slot_color(0)).toEqual([1, 0, 0])
  // A partial repaint before the first render must keep the earlier full-buffer upload.
  expect(mesh.colors.updateRanges).toEqual([
    { start: 0, count: 15 },
    { start: 0, count: 3 },
  ])

  const color_version = mesh.colors.version
  props.atoms = h2o(0.5)
  flushSync()
  expect(mesh.colors.version).toBe(color_version)
  expect(mesh.positions.array[0]).toBe(0.5)
  props.atoms[0].radius = 1
  flushSync()
  expect(mesh.colors.version).toBe(color_version)
  expect(mesh.positions.array[3]).toBe(1)

  const instance_colors = mesh.colors
  instance_colors.clearUpdateRanges() // Simulate the renderer consuming the initial upload.
  const matrix_version = mesh.positions.version
  props.atoms[2].color = `blue`
  flushSync()
  expect(instance_colors.updateRanges).toEqual([{ start: 6, count: 3 }])
  expect(slot_color(2)).toEqual([0, 0, 1])
  props.atoms[1].color = `green`
  flushSync()
  expect(instance_colors.updateRanges).toEqual([
    { start: 6, count: 3 },
    { start: 3, count: 3 },
  ])
  expect(mesh.positions.version).toBe(matrix_version)

  // measure mode desaturates the same way mid-scrub
  props.ghost = true
  flushSync()
  expect(mesh.material).toMatchObject({ transparent: true, opacity: 0.5 })
  const ghosted = new Color(1, 0, 0).lerp(new Color(0x999999), 0.4)
  // colors is a f32 buffer, so the readback rounds the f64 expectation
  expect(slot_color(0)).toEqual(ghosted.toArray().map(Math.fround))

  // Opacity is a uniform: slider changes must not rebuild geometry, upload colors or
  // recompile an already-transparent material, including while edit-mode ghosting is on.
  if (Array.isArray(mesh.material)) throw new Error(`Expected a single atom material`)
  const material_version = mesh.material.version
  const buffer_versions = [mesh.positions.version, mesh.colors.version]
  for (const opacity of [0.5, 0, 0.8, 1]) {
    props.opacity = opacity
    flushSync()
    expect(current_mesh()).toBe(mesh)
    expect(mesh.material).toMatchObject({ opacity: opacity * 0.5, visible: opacity > 0 })
    expect(mesh.material.version).toBe(material_version)
    expect([mesh.positions.version, mesh.colors.version]).toEqual(buffer_versions)
  }
  props.opacity = 0.5
  props.ghost = false
  flushSync()
  expect(mesh.material).toMatchObject({ transparent: true, opacity: 0.5 })
  expect(slot_color(0)).toEqual([1, 0, 0])
  props.opacity = 1
  props.ghost = true
  flushSync()

  // A newly occupied slot with an omitted color must not reuse its retired color.
  props.atoms = []
  flushSync()
  props.atoms = [{ position: [0, 0, 0], radius: 0.5 }]
  flushSync()
  expect(current_mesh()).toBe(mesh)
  expect(slot_color(0)).toEqual(new Color(0x999999).toArray().map(Math.fround))
  const default_color_version = mesh.colors.version
  props.atoms[0].color = `#999999`
  flushSync()
  expect(mesh.colors.version).toBe(default_color_version)
  props.ghost = false
  flushSync()
  expect(mesh.material).toMatchObject({ transparent: false, opacity: 1 })
  const captured = mesh.clone()
  const blue = [atom(`blue`, 0)]
  captured.update_colors(blue)
  captured.colors.copy(mesh.colors)
  captured.update_colors(blue)
  expect(captured.colors.array.slice(0, 3)).toEqual(new Float32Array([0, 0, 1]))
  expect(slot_color(0)).toEqual(new Color(0x999999).toArray().map(Math.fround))
  captured.dispose()
})

test.each([
  { fov: 50, height: 600, x_pos: 0, radius: 0.5, distant_segments: 8 },
  {
    fov: 150,
    height: 2000,
    x_pos: 90 * Math.tan((75 * Math.PI) / 180),
    radius: 2,
    distant_segments: 12,
  },
])(
  `Detail follows zoom, viewport and requests without uploading unchanged atoms at $fov degrees`,
  async ({ fov, height, x_pos, radius, distant_segments }) => {
    const dispose_geometry = vi.spyOn(SphereGeometry.prototype, `dispose`)
    const {
      camera: { current: camera },
      size,
    } = useThrelte()
    if (!(camera instanceof PerspectiveCamera)) throw new Error(`Expected perspective camera`)
    camera.fov = fov
    camera.position.z = 100
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld(true)
    size.current.height = height
    const props = mount_atoms(
      Array.from({ length: 2000 }, () => ({ ...atom(`red`, x_pos), radius })),
    )
    const segments = () => Math.sqrt(current_mesh().geometry.attributes.position.count) - 1
    expect(segments()).toBe(distant_segments)
    const mesh = current_mesh()
    const matrix_buffer = mesh.positions.array
    const matrix_values = matrix_buffer.slice()
    const matrix_version = mesh.positions.version
    const geometries = new Map<number, InstancedBufferGeometry>()
    const remember_geometry = () => {
      const geometry = current_mesh().geometry
      const detail = segments()
      const previous = geometries.get(detail)
      if (previous) expect(geometry).toBe(previous)
      else geometries.set(detail, geometry)
      // Three attaches disposal listeners that own the mesh's shared instance buffers.
      expect(dispose_geometry).not.toHaveBeenCalled()
    }
    remember_geometry()
    const unchanged_atoms = () => {
      expect(current_mesh()).toBe(mesh)
      expect(mesh.positions.array).toBe(matrix_buffer)
      expect(mesh.positions.array).toEqual(matrix_values)
      expect(mesh.positions.version).toBe(matrix_version)
      remember_geometry()
    }
    for (const [depth, expected] of [
      [1, 20],
      [100, distant_segments],
    ]) {
      camera.position.z = depth
      camera.updateMatrixWorld(true)
      frame_task.update()
      flushSync()
      expect(segments()).toBe(expected)
      unchanged_atoms()
    }
    camera.position.z = 1
    camera.updateMatrixWorld(true)
    for (const requested of [8, 32, 12, 20]) {
      props.sphere_segments = requested
      flushSync()
      frame_task.update()
      flushSync()
      expect(segments()).toBe(requested)
      unchanged_atoms()
    }
    props.atoms = h2o()
    flushSync()
    frame_task.update()
    flushSync()
    expect(segments()).toBe(20)
    remember_geometry()
    await teardown?.()
    teardown = undefined
    expect(dispose_geometry).toHaveBeenCalledTimes(geometries.size)
    expect(new Set(dispose_geometry.mock.contexts).size).toBe(geometries.size)
  },
)

test(`growing a trajectory reserves capacity without drawing spare slots`, () => {
  const props = mount_atoms([])
  expect(threlte_stub.nodes).toHaveLength(0)
  props.atoms = ch4()
  flushSync()
  props.atoms = [...ch4(), atom(`red`, 5)]
  flushSync()
  const grown = current_mesh()
  expect(grown.count).toBe(6)
  expect(grown.positions.count).toBe(8)
  props.atoms = [...props.atoms, atom(`blue`, 6)]
  flushSync()
  expect(current_mesh()).toBe(grown)
  expect(grown.count).toBe(7)
  expect(slot_color(6)).toEqual([0, 0, 1])
  props.atoms = []
  flushSync()
  expect(grown.count).toBe(0)
  props.atoms = h2o()
  flushSync()
  expect(current_mesh()).toBe(grown)
  expect(grown.count).toBe(3)
  expect(slot_color(0)).toEqual([1, 0, 0])
})
