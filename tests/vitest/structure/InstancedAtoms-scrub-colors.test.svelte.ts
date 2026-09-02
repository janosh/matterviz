// Trajectory scrubbing sets InstancedAtoms' `positions_only` fast path. A run whose frames
// differ in composition reuses the grow-only mesh's instance slots, so the fast path must
// still notice that the atom in a slot changed element - otherwise the sphere keeps the
// previous frame's color until the scrub settles (~80ms after the drag stops).
import type { Vec3 } from '$lib/math'
import { set_linear_css_color } from '$lib/scene/colors'
import InstancedAtoms from '$lib/structure/InstancedAtoms.svelte'
import { flushSync, mount, unmount } from 'svelte'
import { Color, type InstancedMesh } from 'three/webgpu'
import { afterEach, expect, test, vi } from 'vitest'
import { threlte_stub } from '../isosurface/threlte-stub'

const invalidate = vi.hoisted(() => vi.fn())
vi.mock(`@threlte/core`, async () => ({
  T: (await import(`../isosurface/threlte-stub`)).threlte_stub.T,
  useThrelte: () => ({ invalidate }),
}))

type Atom = { position: Vec3; radius: number; color?: string }
const atom = (color: string, x_pos: number): Atom => ({
  position: [x_pos, 0, 0],
  radius: 0.5,
  color,
})

// frame 0 of a varying-atom-count run: 5 atoms, slot 0 black
const ch4 = (offset = 0): Atom[] => [
  atom(`#000000`, offset),
  ...Array.from({ length: 4 }, (_unused, idx) => atom(`#ffffff`, idx + 1 + offset)),
]
// frame 5: 3 atoms, slot 0 now red. The mesh is grow-only, so slots 0-2 are reused.
const h2o = (offset = 0): Atom[] => [
  atom(`#ff0000`, offset),
  atom(`#ffffff`, 1 + offset),
  atom(`#ffffff`, 2 + offset),
]

let teardown: (() => void) | undefined
afterEach(() => {
  teardown?.()
  teardown = undefined
  threlte_stub.reset()
  invalidate.mockClear()
})

const mount_atoms = (atoms: Atom[]) => {
  const props = $state({ atoms, positions_only: true, ghost: false })
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

const linear_color = (css: string): Color => {
  const color = new Color()
  set_linear_css_color(css, color)
  return color
}

test(`re-colors reused instance slots when the composition changes mid-scrub`, () => {
  const props = mount_atoms(ch4())
  const mesh = current_mesh()
  expect(slot_color(0)).toEqual(linear_color(`#000000`).toArray())

  // scrub to a frame with fewer atoms: same mesh, slot 0 is a different element now
  props.atoms = h2o()
  flushSync()
  expect(current_mesh()).toBe(mesh) // grow-only capacity, so no new mesh hides the staleness
  expect(mesh.count).toBe(3)
  expect(slot_color(0)).toEqual(linear_color(`#ff0000`).toArray())

  // measure mode desaturates the same way mid-scrub
  props.ghost = true
  flushSync()
  const ghosted = linear_color(`#ff0000`).lerp(new Color(0x999999), 0.4)
  // instanceColor is a f32 buffer, so the readback rounds the f64 expectation
  expect(slot_color(0)).toEqual(ghosted.toArray().map(Math.fround))
})

test(`skips the color upload while only positions move`, () => {
  const props = mount_atoms(h2o())
  const uploads = () => current_mesh().instanceColor?.version ?? 0
  const before = uploads()

  props.atoms = h2o(0.5)
  flushSync()
  expect(uploads()).toBe(before)
})
