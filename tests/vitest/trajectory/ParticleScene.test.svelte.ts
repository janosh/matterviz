import ParticleScene from '$lib/trajectory/ParticleScene.svelte'
import TrajectoryParticleView from '$lib/trajectory/TrajectoryParticleView.svelte'
import { atom_range, ATOM_BATCH_SIZE, type ReadAtoms } from '$lib/trajectory/atom-batches'
import * as hotspots from '$lib/trajectory/hotspots'
import { make_run } from '../test-fixtures'
import { flushSync, mount, tick, unmount } from 'svelte'
import { readable } from 'svelte/store'
import { BufferGeometry, PerspectiveCamera, PointsNodeMaterial, Vector3 } from 'three/webgpu'
import { expect, it, vi } from 'vitest'
import { threlte_stub } from '../isosurface/threlte-stub'

const test_camera = new PerspectiveCamera(45, 1, 0.01, 100)
test_camera.position.set(0, 0, 10)

vi.mock(`@threlte/core`, async () => ({
  T: (await import(`../isosurface/threlte-stub`)).threlte_stub.T,
  Canvas: (anchor: Node, props: { children: (anchor: Node) => void }) =>
    props.children(anchor),
}))
vi.mock(`$lib/scene`, async () => ({
  webgpu_available: () => true,
  create_renderer: vi.fn(),
  SceneCamera: () => ({}),
  build_orbit_props: () => ({}),
  bind_renderer: () => ({
    camera: readable(test_camera),
    invalidate: vi.fn(),
    size: {
      subscribe: (callback: (size: { width: number; height: number }) => void) => {
        callback({ width: 800, height: 600 })
        return () => {}
      },
    },
  }),
}))

it.each([333_200, 1_000_000])(
  `renders all %i atoms and reuses hotspot values across frames`,
  async (total_atoms) => {
    const read_atoms = vi.fn<ReadAtoms>((options) => {
      const { start, stride, count } = atom_range(total_atoms, options)
      const positions = new Float64Array(count * 3)
      // One empty bin and one out-of-grid atom must remain invisible.
      if (start === 0) {
        positions[3] = 1.5
        positions[6] = 2.5
      }
      return {
        positions,
        atomic_numbers: new Uint8Array(count),
        total_atoms,
        start,
        stride,
        step: options.frame_idx,
        origin: [0, 0, 0],
        pbc: [false, false, false],
      }
    })
    const result: hotspots.HotspotResult = {
      grid: {
        dims: [2, 1, 1],
        origin: [0, 0, 0],
        cell: [
          [2, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
        pbc: [false, false, false],
      },
      energy: new Float64Array([4, 0]),
      population: new Float64Array([2, 0]),
      dof: new Float64Array([6, 0]),
      occupied_frames: new Uint32Array([1, 0]),
      time_weight: 1,
      frames: 1,
      first_step: 0,
      last_step: 0,
      weighting: `MD steps`,
      excluded_atoms: 0,
      reserved_buffer_bytes: 0,
      options: {},
    }
    const values = vi.spyOn(hotspots, `hotspot_values`)
    const props = $state({
      run: { ...make_run(), atom_count: total_atoms, read_atoms },
      frame_idx: 0,
      get result() {
        return result
      },
      min_atoms: 1,
    })
    const component = mount(TrajectoryParticleView, { target: document.body, props })
    const heat = () => {
      const geometry = threlte_stub.nodes.find(({ tag }) => tag === `Points`)?.props.geometry
      if (!(geometry instanceof BufferGeometry)) throw new Error(`Missing particle geometry`)
      return geometry.getAttribute(`heat`).array
    }
    try {
      await vi.waitFor(() => expect(heat()).toHaveLength(total_atoms))
      expect(heat().slice(0, 3)).toEqual(new Float32Array([2, -1, -1]))
      expect(document.querySelector(`.particle-controls`)?.textContent).toContain(
        `${total_atoms} atoms`,
      )
      expect(
        document.querySelectorAll(`.particle-controls input[type="checkbox"]`),
      ).toHaveLength(1)
      expect(read_atoms.mock.calls.map(([options]) => options.start)).toEqual(
        Array.from(
          { length: Math.ceil(total_atoms / ATOM_BATCH_SIZE) },
          (_unused, idx) => idx * ATOM_BATCH_SIZE,
        ),
      )
      expect(read_atoms.mock.calls.every(([options]) => (options.stride ?? 1) === 1)).toBe(
        true,
      )
      const signal = new AbortController().signal
      await component.wait_for_frame(0, signal)
      read_atoms.mockRejectedValueOnce(new Error(`Frame 1 unavailable`))
      props.frame_idx = 1
      await tick()
      await expect(component.wait_for_frame(1, signal)).rejects.toThrow(`Frame 1 unavailable`)
      await tick()
      expect(document.querySelector(`.particle-controls`)?.textContent).toContain(`0 atoms`)
      props.frame_idx = 2
      await tick()
      await component.wait_for_frame(2, signal)
      await tick()
      expect(heat().slice(0, 3)).toEqual(new Float32Array([2, -1, -1]))
      expect(values).toHaveBeenCalledTimes(1)
      props.min_atoms = 3
      await tick()
      expect(heat().slice(0, 3)).toEqual(new Float32Array([-1, -1, -1]))
      expect(values).toHaveBeenCalledTimes(2)
    } finally {
      await unmount(component)
      values.mockRestore()
    }
  },
)

// Evaluate the scalar nodes emitted by the actual material, including its live uniforms.
const scalar_value = (node: unknown, heat: number): number => {
  if (!node || typeof node !== `object`) throw new Error(`Missing scalar node`)
  if (`value` in node && typeof node.value === `number`) return node.value
  if (`_attributeName` in node && node._attributeName === `heat`) return heat
  if (`node` in node) return scalar_value(node.node, heat)
  if (`condNode` in node && `ifNode` in node && `elseNode` in node)
    return scalar_value(scalar_value(node.condNode, heat) ? node.ifNode : node.elseNode, heat)
  if (`op` in node && node.op === `>=` && `aNode` in node && `bNode` in node)
    return Number(scalar_value(node.aNode, heat) >= scalar_value(node.bNode, heat))
  throw new Error(`Unsupported scalar node ${node.constructor.name}`)
}

it(`preserves distant atom separations, reuses GPU buffers, and hides missing data`, async () => {
  const props = $state({
    positions: new Float64Array([1e8, 0, 0, 1e8 + 1, 0, 0]),
    scalars: new Float32Array([-1, 0]),
    only_hot: false,
    threshold: 1.25,
    mean: 1,
  })
  const component = mount(ParticleScene, { target: document.body, props })
  try {
    flushSync()
    const points = threlte_stub.nodes.find(({ tag }) => tag === `Points`)
    const geometry = points?.props.geometry
    const material = points?.props.material
    if (!(geometry instanceof BufferGeometry) || !(material instanceof PointsNodeMaterial))
      throw new Error(`Missing particle geometry/material`)
    const position = geometry.getAttribute(`position`)
    const heat = geometry.getAttribute(`heat`)
    const dispose = vi.spyOn(geometry, `dispose`)
    expect([...position.array]).toEqual([0, 0, 0, 1, 0, 0])
    expect(geometry.boundingSphere?.radius).toBe(0.5)
    test_camera.updateMatrixWorld()
    const screen_center = new Vector3(0.5, 0, 0).project(test_camera)
    expect(Math.abs(screen_center.x)).toBeLessThan(4 * Number.EPSILON)
    expect(Math.abs(screen_center.y)).toBeLessThan(4 * Number.EPSILON)
    expect([-1, 0, 2].map((value) => scalar_value(material.opacityNode, value))).toEqual([
      0, 1, 1,
    ])
    props.only_hot = true
    props.positions = new Float64Array([1e8 + 2, 0, 0, 1e8 + 3, 0, 0])
    props.scalars = new Float32Array([2, -1])
    flushSync()
    expect(points?.props.geometry).toBe(geometry)
    expect(geometry.getAttribute(`position`)).toBe(position)
    expect(geometry.getAttribute(`heat`)).toBe(heat)
    expect([...position.array]).toEqual([2, 0, 0, 3, 0, 0])
    expect([...heat.array]).toEqual([2, -1])
    expect(dispose).not.toHaveBeenCalled()
    expect([-1, 0, 2].map((value) => scalar_value(material.opacityNode, value))).toEqual([
      0, 0.04, 1,
    ])
    props.positions = new Float64Array([1e8 + 4, 0, 0])
    props.scalars = new Float32Array([1])
    flushSync()
    expect(points?.props.geometry).not.toBe(geometry)
    expect(dispose).toHaveBeenCalledTimes(1)
  } finally {
    await unmount(component)
    threlte_stub.reset()
  }
})
