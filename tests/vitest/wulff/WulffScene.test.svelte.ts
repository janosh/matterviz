// Mounts WulffScene against the recording Threlte stub (every facet edge is one instance of a
// single InstancedMesh, rewritten in place when the energies change) and WulffShape's states
import { euclidean_dist } from '#lib/math.js'
import {
  compute_wulff_shape,
  type WulffFacetInput,
  type WulffShapeData,
  WulffScene,
  WulffShape,
} from '#lib/wulff/index.js'
import { wulff_examples } from '#site/wulff.js'
import { flushSync, mount, unmount } from 'svelte'
import { InstancedMesh, Matrix4, Vector3 } from 'three/webgpu'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { threlte_stub } from '../isosurface/threlte-stub'

vi.mock(`@threlte/core`, async (original) =>
  (await import(`../isosurface/threlte-stub`)).mock_threlte_core(original),
)
vi.mock(`@threlte/extras`, async () =>
  (await import(`../isosurface/threlte-stub`)).mock_threlte_extras(),
)
// a scene's camera always draws the gizmo, which needs a real Threlte parent
vi.mock(`#lib/scene/Gizmo.svelte`, () => ({ default: () => ({}) }))

afterEach(() => threlte_stub.reset())

test(`edges are one InstancedMesh, reused and rewritten when the energies change`, () => {
  const [example] = wulff_examples
  const facets = example.facets
  const shape_at = (energy: number) =>
    compute_wulff_shape(example.lattice, facets.with(2, { ...facets[2], energy }))
  const props = $state({
    wulff: shape_at(2.2845),
    colors: facets.map(() => `red`),
    lattice: example.lattice,
  })
  const component = mount(WulffScene, { target: document.body, props })
  flushSync()
  const edge_meshes = () =>
    threlte_stub.nodes.flatMap(({ props: node_props }) =>
      node_props.is instanceof InstancedMesh ? [node_props.is] : [],
    )
  // the instance's center is its edge's midpoint
  const expect_edges_written = (mesh: InstancedMesh, { vertices, edges }: WulffShapeData) => {
    expect(mesh.count).toBe(edges.length)
    const matrix = new Matrix4()
    for (const [idx, [from, to]] of edges.entries()) {
      mesh.getMatrixAt(idx, matrix)
      const center = new Vector3().setFromMatrixPosition(matrix).toArray()
      const midpoint = vertices[from].map((val, axis) => (val + vertices[to][axis]) / 2)
      expect(euclidean_dist(center, midpoint)).toBeLessThan(1e-6) // f32 instance matrices
    }
  }
  const [mesh] = edge_meshes()
  expect(edge_meshes()).toHaveLength(1)
  expect_edges_written(mesh, props.wulff)

  const n_edges = props.wulff.edges.length
  props.wulff = shape_at(2.45) // a different set of facets, so a different edge count
  flushSync()
  expect(props.wulff.edges).not.toHaveLength(n_edges)
  expect(edge_meshes()).toEqual([mesh])
  expect_edges_written(mesh, props.wulff)
  void unmount(component)
})

const cube_facets: WulffFacetInput[] = [{ miller: [1, 0, 0], energy: 1 }]
// [props, viewer error (null: the shape and its legend render)]
test.each([
  [{ facets: cube_facets }, /needs a lattice, or a structure with one/],
  [
    { facets: cube_facets, lattice: wulff_examples[0].lattice, structure: { sites: [] } },
    /either lattice or structure, not both/,
  ],
  [
    { facets: [{ miller: [0, 0, 1], energy: 1 }], lattice: wulff_examples[1].lattice },
    /Wulff shape is unbounded/,
  ],
  [{ facets: cube_facets, lattice: wulff_examples[0].lattice }, null],
])(`WulffShape %#`, (props, error) => {
  const component = mount(WulffShape, { target: document.body, props: props as never })
  flushSync()
  const message = document.querySelector(`.viewer-error`)?.textContent ?? null
  if (error) expect(message).toMatch(error)
  else {
    expect(message).toBeNull()
    expect(document.querySelector(`.legend`)?.textContent).toContain(`{100}`)
  }
  void unmount(component)
})

test(`legend lists families by area fraction, largest first`, () => {
  // {111} listed second but cheaper, so it covers most of the surface
  const facets: WulffFacetInput[] = [
    { miller: [1, 0, 0], energy: 1.15 },
    { miller: [1, 1, 1], energy: 1 },
  ]
  const props = { facets, lattice: wulff_examples[0].lattice }
  const component = mount(WulffShape, { target: document.body, props: props as never })
  flushSync()
  const items = [...document.querySelectorAll(`.legend li`)]
  expect(items.map((item) => /\{\d+\}/.exec(item.textContent ?? ``)?.[0])).toEqual([
    `{111}`,
    `{100}`,
  ])
  // percentages like `66.9%`
  const fractions = items.map((item) =>
    Number(item.querySelector(`small`)?.textContent?.replace(`%`, ``)),
  )
  expect(fractions.every(Number.isFinite)).toBe(true)
  expect(fractions).toEqual(fractions.toSorted((one, two) => two - one))
  void unmount(component)
})

// ω-Ti's c axis is short: scaled with a it ended inside the shape. Every axis must clear the
// surface along its own direction by the same margin, with its label just past the tip. (The
// labels' occlusion needs a real bind:ref to the shape group, which this stub never fills.)
test(`axes clear the shape along their own direction, labels just past the tips`, () => {
  const example = wulff_examples[1]
  const wulff = compute_wulff_shape(example.lattice, example.facets)
  const radius = Math.max(...wulff.vertices.map((vert) => Math.hypot(...vert)))
  const component = mount(WulffScene, {
    target: document.body,
    props: {
      wulff,
      colors: wulff.families.map(() => `red`),
      lattice: example.lattice,
      show_axes: true,
    },
  })
  flushSync()
  const labels = threlte_stub.nodes.filter(({ tag }) => tag === `HTML`)
  expect(labels).toHaveLength(3)
  for (const [axis_idx, { props }] of labels.entries()) {
    const position = props.position as number[]
    const unit = example.lattice[axis_idx].map(
      (coord) => coord / Math.hypot(...example.lattice[axis_idx]),
    )
    const reach = Math.max(
      ...wulff.vertices.map((vert) =>
        vert.reduce((sum, coord, idx) => sum + coord * unit[idx], 0),
      ),
    )
    // 0.3 r past the surface to the tip, 0.11 r more to the label
    expect(Math.hypot(...position) - reach).toBeCloseTo(0.41 * radius, 10)
  }
  void unmount(component)
})
