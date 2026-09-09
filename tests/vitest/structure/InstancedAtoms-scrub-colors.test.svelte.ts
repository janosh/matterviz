// Trajectories reuse instance slots; a slot must repaint when its element changes.
import type { InstancedAtom } from '$lib/structure/atom-instances'
import InstancedAtoms from '$lib/structure/InstancedAtoms.svelte'
import { flushSync, mount, unmount } from 'svelte'
import { useThrelte } from '@threlte/core'
import {
  Color,
  type InstancedMesh,
  PerspectiveCamera,
  type SphereGeometry,
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

let teardown: (() => void) | undefined
afterEach(() => {
  teardown?.()
  teardown = undefined
  threlte_stub.reset()
  const { camera, size } = useThrelte()
  camera.current.copy(new PerspectiveCamera(50, 1, 0.1, 1000))
  size.current.height = 600
})

const mount_atoms = (atoms: InstancedAtom[]) => {
  const props = $state({ atoms, ghost: false })
  const component = mount(InstancedAtoms, { target: document.body, props })
  teardown = () => void unmount(component)
  flushSync()
  return props
}

const current_mesh = (): InstancedMesh => threlte_stub.nodes.at(-1)?.props.is as InstancedMesh

const slot_color = (slot_idx: number): number[] => {
  const color = new Color()
  current_mesh().getColorAt(slot_idx, color)
  return color.toArray()
}

test(`uploads colors only when composition or ghost mode changes mid-scrub`, () => {
  const props = mount_atoms(ch4())
  const mesh = current_mesh()
  expect(slot_color(0)).toEqual([0, 0, 0])

  // scrub to a frame with fewer atoms: same mesh, slot 0 is a different element now
  props.atoms = h2o()
  flushSync()
  expect(current_mesh()).toBe(mesh) // grow-only capacity, so no new mesh hides the staleness
  expect(mesh.count).toBe(3)
  expect(slot_color(0)).toEqual([1, 0, 0])

  const color_version = mesh.instanceColor?.version
  props.atoms = h2o(0.5)
  flushSync()
  expect(mesh.instanceColor?.version).toBe(color_version)
  expect(mesh.instanceMatrix.array[12]).toBe(0.5)
  props.atoms[0].radius = 1
  flushSync()
  expect(mesh.instanceColor?.version).toBe(color_version)
  expect(mesh.instanceMatrix.array[0]).toBe(1)

  // measure mode desaturates the same way mid-scrub
  props.ghost = true
  flushSync()
  const ghosted = new Color(1, 0, 0).lerp(new Color(0x999999), 0.4)
  // instanceColor is a f32 buffer, so the readback rounds the f64 expectation
  expect(slot_color(0)).toEqual(ghosted.toArray().map(Math.fround))
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
  `Detail follows zoom, viewport and off-axis bounds at $fov degrees`,
  ({ fov, height, x_pos, radius, distant_segments }) => {
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
    const segments = () => (current_mesh().geometry as SphereGeometry).parameters.widthSegments
    expect(segments()).toBe(distant_segments)
    for (const [depth, expected] of [
      [1, 20],
      [100, distant_segments],
    ]) {
      camera.position.z = depth
      camera.updateMatrixWorld(true)
      frame_task.update()
      flushSync()
      expect(segments()).toBe(expected)
    }
    props.atoms = h2o()
    flushSync()
    frame_task.update()
    flushSync()
    expect(segments()).toBe(20)
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
  expect(grown.instanceMatrix.count).toBe(8)
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
