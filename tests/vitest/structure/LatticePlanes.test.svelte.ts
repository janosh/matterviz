// Mounts LatticePlanes against the recording Threlte stub: one fill mesh and one outline per
// family, disposed when the families change
import type { Matrix3x3, Vec3 } from '$lib/math'
import LatticePlanes from '$lib/structure/LatticePlanes.svelte'
import Lattice from '$lib/structure/Lattice.svelte'
import SymmetryElements from '$lib/symmetry/SymmetryElements.svelte'
import {
  type ShowSymmetryKinds,
  type SymmetryElement,
  SYM_ELEM_COLORS,
  tile_symmetry_elements,
} from '$lib/symmetry'
import type { LatticePlane } from '$lib/structure/lattice-planes'
import type * as threlte_core from '@threlte/core'
import { flushSync, mount, unmount } from 'svelte'
import type { BufferGeometry } from 'three/webgpu'
import { afterEach, expect, test, vi } from 'vitest'
import { threlte_stub } from '../isosurface/threlte-stub'

vi.mock(`@threlte/core`, async (original) => ({
  ...(await original<typeof threlte_core>()),
  T: (await import(`../isosurface/threlte-stub`)).threlte_stub.T,
  useThrelte: () => ({ invalidate: vi.fn() }),
}))
vi.mock(`@threlte/extras`, async () => ({
  HTML: (await import(`../isosurface/ThrelteStub.svelte`)).default,
}))

const cubic: Matrix3x3 = [
  [4, 0, 0],
  [0, 4, 0],
  [0, 0, 4],
]

let teardown: (() => void) | undefined
afterEach(() => {
  teardown?.()
  teardown = undefined
  threlte_stub.reset()
})

const mount_planes = (planes: LatticePlane[]) => {
  const props = $state({ planes, lattice: cubic, tiling: [1, 1, 1] as Vec3 })
  const component = mount(LatticePlanes, { target: document.body, props })
  teardown = () => void unmount(component)
  flushSync()
  return { props, component }
}

const vertex_counts = (tag: string) =>
  threlte_stub.nodes
    .filter((node) => node.tag === tag)
    .map((node) => (node.props.geometry as BufferGeometry).getAttribute(`position`).count)

test(`cell surfaces reuse unchanged geometry and dispose replaced blocks independently`, async () => {
  const props = $state({ matrix: cubic, tiling: [2, 1, 1] as Vec3, show_cell_vectors: false })
  const component = mount(Lattice, { target: document.body, props })
  teardown = () => void unmount(component)
  flushSync()
  const geometries = () =>
    threlte_stub.nodes
      .filter((node) => node.tag === `Mesh`)
      .map((node) => node.props.geometry as BufferGeometry)
  const [block, origin] = geometries()
  const disposed = [block, origin].map((geometry) => vi.spyOn(geometry, `dispose`))
  props.matrix = structuredClone(cubic)
  props.tiling = [2, 1, 1]
  flushSync()
  expect(geometries()).toEqual([block, origin])
  expect(disposed.map((spy) => spy.mock.calls.length)).toEqual([0, 0])
  props.tiling = [3, 1, 1]
  flushSync()
  const [new_block, same_origin] = geometries()
  new_block.computeBoundingBox()
  expect(new_block.boundingBox?.max.toArray()).toEqual([6, 2, 2])
  expect(same_origin).toBe(origin)
  expect(disposed.map((spy) => spy.mock.calls.length)).toEqual([1, 0])
  const dispose_block = vi.spyOn(new_block, `dispose`)
  await unmount(component)
  teardown = undefined
  expect(dispose_block).toHaveBeenCalledOnce()
  expect(disposed.map((spy) => spy.mock.calls.length)).toEqual([1, 1])
})

test.each([
  [[1, 1, 1], false],
  [[0.5, -1, 1.9], false],
  [[2, 1, 1], true],
] as [Vec3, boolean][])(
  `symmetry overlays normalize %j, explain oversized tiling, and recover (shared=%s)`,
  async (tiling, shared) => {
    const read_point = vi.fn((): Vec3 => [0, 0, 0])
    const element: SymmetryElement = {
      kind: `rotation`,
      order: 2,
      label: `2`,
      locus: `z-axis`,
      get point() {
        return read_point()
      },
      axis: [0, 0, 1],
      translation: null,
    }
    const elements: SymmetryElement[] = [
      element,
      { ...element, kind: `mirror`, point: [0.5, 0, 0], axis: [1, 0, 0], locus: `plane-x` },
      { ...element, kind: `inversion`, point: [0.5, 0.5, 0.5], axis: null, locus: `center` },
    ]
    const show_kinds: ShowSymmetryKinds = { rotation: true, mirror: true, inversion: true }
    const props = $state({
      elements,
      lattice: structuredClone(cubic),
      tiling,
      show_kinds,
      tiling_result: shared ? tile_symmetry_elements(elements, tiling, cubic) : undefined,
    })
    const update = () => {
      if (shared)
        props.tiling_result = tile_symmetry_elements(
          props.elements.filter((item) => props.show_kinds[item.kind]),
          props.tiling,
          props.lattice,
        )
      flushSync()
    }
    read_point.mockClear()
    const component = mount(SymmetryElements, { target: document.body, props })
    teardown = () => void unmount(component)
    flushSync()
    if (shared) expect(read_point).not.toHaveBeenCalled()
    const geometry = threlte_stub.nodes.find((node) => node.props.geometry)?.props
      .geometry as BufferGeometry
    // The stub records creation order; re-enabled planes mount after retained centers.
    const geometries = () =>
      threlte_stub.nodes
        .flatMap((node, idx) => {
          if (!node.props.geometry) return []
          const color = threlte_stub.nodes[idx + 1]?.props.color
          const rank =
            node.tag === `LineSegments`
              ? 2
              : color === SYM_ELEM_COLORS.inversion
                ? 3
                : color === SYM_ELEM_COLORS.mirror || color === SYM_ELEM_COLORS.glide
                  ? 1
                  : 0
          return [{ geometry: node.props.geometry as BufferGeometry, rank }]
        })
        .toSorted((left, right) => left.rank - right.rank)
        .map(({ geometry: item }) => item)
    const original = geometries()
    const disposed = original.map((item) => vi.spyOn(item, `dispose`))
    geometry.computeBoundingBox()
    expect(geometry.boundingBox?.max.z).toBe(4)
    props.lattice = structuredClone(cubic)
    props.tiling = [...tiling]
    props.elements = structuredClone($state.snapshot(props.elements))
    props.show_kinds = { ...props.show_kinds }
    update()
    expect(geometries().every((item, idx) => item === original[idx])).toBe(true)
    expect(disposed.map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0, 0])
    props.elements[1].point[0] = 0.25
    update()
    expect(geometries()[0]).toBe(original[0])
    expect(geometries()[3]).toBe(original[3])
    expect(disposed.map((spy) => spy.mock.calls.length)).toEqual([0, 1, 1, 0])
    const plane_disposed = geometries()
      .slice(1, 3)
      .map((item) => vi.spyOn(item, `dispose`))
    props.show_kinds.mirror = false
    update()
    expect(geometries()).toEqual([original[0], original[3]])
    expect(plane_disposed.map((spy) => spy.mock.calls.length)).toEqual([1, 1])
    props.show_kinds.mirror = true
    props.lattice[0][0] = 6
    update()
    expect(geometries().every((item, idx) => item !== original[idx])).toBe(true)
    expect(disposed.map((spy) => spy.mock.calls.length)).toEqual([1, 1, 1, 1])
    const retained_axis = geometries()[0]
    props.elements[1].kind = `glide`
    props.elements[1].translation = [0, 1, 0]
    props.show_kinds.glide = true
    update()
    const glide = geometries()[1]
    const original_uvs = Array.from(glide.getAttribute(`uv`).array)
    const glide_disposed = vi.spyOn(glide, `dispose`)
    props.elements[1].translation = [0, 0, 1]
    update()
    expect(geometries()[0]).toBe(retained_axis)
    expect(Array.from(geometries()[1].getAttribute(`uv`).array)).not.toEqual(original_uvs)
    expect(glide_disposed).toHaveBeenCalledOnce()
    const retained_plane = geometries()[1]
    const center = geometries()[3]
    const center_disposed = vi.spyOn(center, `dispose`)
    const center_source = shared
      ? props.tiling_result?.elements.find((item) => item.kind === `inversion`)
      : props.elements[2]
    if (!center_source) throw new Error(`Missing inversion center`)
    // Mutate the shared result directly as well as the ordinary input: no replacement array.
    center_source.point[0] += 0.125
    flushSync()
    expect(geometries()[0]).toBe(retained_axis)
    expect(geometries()[1]).toBe(retained_plane)
    expect(geometries()[3]).not.toBe(center)
    expect(center_disposed).toHaveBeenCalledOnce()
    const axis_disposed = vi.spyOn(retained_axis, `dispose`)
    props.elements[0].order = 6
    update()
    expect(geometries()[0]).not.toBe(retained_axis)
    expect(geometries()[1]).toBe(retained_plane)
    expect(axis_disposed).toHaveBeenCalledOnce()
    expect(
      threlte_stub.nodes.find((node) => node.tag === `MeshStandardMaterial`)?.props.color,
    ).toBe(SYM_ELEM_COLORS.axis_by_order[6])
    const resized_disposed = geometries().map((item) => vi.spyOn(item, `dispose`))
    props.tiling = [4001, 1, 1]
    update()
    expect(document.querySelector(`[role="status"]`)?.textContent).toContain(
      `exceeds 4000 unique elements`,
    )
    expect(threlte_stub.nodes.filter((node) => node.props.geometry)).toHaveLength(0)
    expect(resized_disposed.map((spy) => spy.mock.calls.length)).toEqual([1, 1, 1, 1])
    props.tiling = [1, 1, 1]
    update()
    expect(document.querySelector(`[role="status"]`)).toBeNull()
    expect(geometries()).toHaveLength(4)
    const recovered_disposed = geometries().map((item) => vi.spyOn(item, `dispose`))
    props.elements = [{ ...element, kind: `rotoinversion`, order: 4, label: `-4` }]
    props.show_kinds = { rotoinversion: true }
    props.tiling = [1, 1, 3]
    update()
    expect(recovered_disposed.map((spy) => spy.mock.calls.length)).toEqual([1, 1, 1, 1])
    expect(geometries()).toHaveLength(1)
    // One cylinder (48 triangles) and three octahedral centers (8 triangles each).
    expect(geometries()[0].index?.count).toBe(144 + 3 * 24)
    const positions = geometries()[0].getAttribute(`position`)
    const heights = Array.from({ length: positions.count }, (_unused, idx) =>
      positions.getZ(idx),
    )
    expect(heights).toEqual(expect.arrayContaining([0, 4, 8]))
    props.elements.push(
      { ...element, order: 4, label: `4` },
      { ...element, kind: `screw`, order: 4, label: `4_1` },
    )
    props.show_kinds = { rotoinversion: true, rotation: true, screw: true }
    update()
    // The coincident rotation reuses the solid cylinder; the screw retains its 34 dashes.
    expect(geometries()[0].index?.count).toBe(35 * 144 + 3 * 24)
    props.elements = [
      { ...props.elements[0], order: 3, label: `-3` },
      { ...props.elements[1], order: 6, label: `6` },
    ]
    update()
    // A higher-order axis hides sub-axis cylinders, but retains their center markers.
    expect(geometries().map((item) => item.index?.count)).toEqual([3 * 24, 144])
    const final_disposed = geometries().map((item) => vi.spyOn(item, `dispose`))
    await unmount(component)
    teardown = undefined
    expect(final_disposed.map((spy) => spy.mock.calls.length)).toEqual([1, 1])
  },
)

test.each([
  [2, 3, 1],
  [2.9, 3.5, 0.5],
  [2, 3, -1],
] as Vec3[])(
  `draws and disposes one fill and outline per family, normalizing %sx%sx%s`,
  async (...tiling) => {
    const { props, component } = mount_planes([
      { hkl: [1, 0, 0] },
      { hkl: [1, 1, 1], offsets: [1.5] },
    ])
    // (100): two square faces = 2 × 2 triangles; (111) through the center: a hexagon = 4 triangles
    expect(vertex_counts(`Mesh`)).toEqual([12, 12])
    // 2 × 4 edges and 6 edges, two vertices each
    expect(vertex_counts(`LineSegments`)).toEqual([16, 12])
    const first_geometry = threlte_stub.nodes[0].props.geometry as BufferGeometry
    const dispose = vi.spyOn(first_geometry, `dispose`)
    props.planes = structuredClone($state.snapshot(props.planes))
    props.lattice = structuredClone(cubic)
    props.tiling = [1.9, 0.5, -1]
    flushSync()
    expect(threlte_stub.nodes[0].props.geometry).toBe(first_geometry)
    props.planes[0].color = `red`
    props.planes[0].opacity = 0.7
    flushSync()
    expect(threlte_stub.nodes[0].props.geometry).toBe(first_geometry)
    expect(dispose).not.toHaveBeenCalled()
    expect(
      threlte_stub.nodes.find((node) => node.tag === `MeshStandardMaterial`)?.props,
    ).toMatchObject({ color: `red`, opacity: 0.7 })
    props.planes[0].offsets = []
    flushSync()
    expect(vertex_counts(`Mesh`)).toEqual([0, 12])
    expect(dispose).toHaveBeenCalledOnce()
    const empty_geometry = threlte_stub.nodes[0].props.geometry as BufferGeometry
    const empty_disposed = vi.spyOn(empty_geometry, `dispose`)
    delete props.planes[0].offsets
    flushSync()
    expect(vertex_counts(`Mesh`)).toEqual([12, 12])
    expect(empty_disposed).toHaveBeenCalledOnce()
    props.planes = []
    flushSync()
    expect(vertex_counts(`Mesh`)).toEqual([])
    props.planes = [{ hkl: [1, 0, 0] }]
    flushSync()
    expect(dispose).toHaveBeenCalledOnce()
    expect(vertex_counts(`Mesh`)).toEqual([12])

    props.tiling = tiling
    flushSync()
    // Three full block faces at x = 0, 4, 8, each spanning y = 0..12.
    expect(vertex_counts(`Mesh`)).toEqual([18])
    expect(vertex_counts(`LineSegments`)).toEqual([24])
    const geometry = threlte_stub.nodes.find((node) => node.tag === `Mesh`)?.props
      .geometry as BufferGeometry
    geometry.computeBoundingBox()
    expect(geometry.boundingBox?.min.toArray()).toEqual([0, 0, 0])
    expect(geometry.boundingBox?.max.toArray()).toEqual([8, 12, 4])
    const disposed_block = vi.spyOn(geometry, `dispose`)
    props.planes[0].offsets = [0.5]
    flushSync()
    expect(disposed_block).toHaveBeenCalledOnce()
    expect(vertex_counts(`Mesh`)).toEqual([6])
    props.planes[0].hkl[0] = 2
    props.lattice[1][1] = 5
    flushSync()
    const final_geometries = threlte_stub.nodes
      .filter((node) => node.props.geometry)
      .map((node) => node.props.geometry as BufferGeometry)
    final_geometries[0].computeBoundingBox()
    expect(final_geometries[0].boundingBox?.min.toArray()).toEqual([1, 0, 0])
    expect(final_geometries[0].boundingBox?.max.toArray()).toEqual([1, 15, 4])
    const final_disposed = final_geometries.map((item) => vi.spyOn(item, `dispose`))
    await unmount(component)
    teardown = undefined
    expect(final_disposed.map((spy) => spy.mock.calls.length)).toEqual([1, 1])
    expect(disposed_block).toHaveBeenCalledOnce()
  },
)
