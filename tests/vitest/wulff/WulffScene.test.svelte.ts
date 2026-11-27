// Mounts WulffScene against the recording Threlte stub (every facet edge is one instance of a
// single InstancedMesh, rewritten in place when the energies change) and WulffShape's states
import { euclidean_dist } from '#lib/math'
import {
  compute_wulff_shape,
  type WulffFacetInput,
  type WulffShapeData,
  WulffScene,
  WulffShape,
} from '#lib/wulff/index'
import { wulff_examples } from '#site/wulff'
import { flushSync, mount, unmount } from 'svelte'
import { InstancedMesh, Matrix4, Vector3 } from 'three/webgpu'
import { afterEach, beforeAll, expect, test, vi } from 'vite-plus/test'
import { threlte_stub } from '../isosurface/threlte-stub'
import { init_moyo_for_tests } from '../test-fixtures'

vi.mock(`@threlte/core`, async (original) =>
  (await import(`../isosurface/threlte-stub`)).mock_threlte_core(original),
)
vi.mock(`@threlte/extras`, async () =>
  (await import(`../isosurface/threlte-stub`)).mock_threlte_extras(),
)
// a scene's camera always draws the gizmo, which needs a real Threlte parent
vi.mock(`#lib/scene/Gizmo.svelte`, () => ({ default: () => ({}) }))

beforeAll(init_moyo_for_tests)
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
// {111} listed second but cheaper, so it covers most of the surface and leads the legend
const two_families: WulffFacetInput[] = [...cube_facets, { miller: [1, 1, 1], energy: 0.87 }]
// [props, viewer error (null: the shape renders, its legend sorted by area fraction)]
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
  [{ facets: two_families, lattice: wulff_examples[0].lattice }, null],
  // the crystal's own point group, from an async moyo analysis
  [{ facets: two_families, structure: wulff_examples[0].structure }, null],
])(`WulffShape %#`, async (props, error) => {
  const component = mount(WulffShape, { target: document.body, props: props as never })
  await vi.waitFor(() =>
    expect(document.querySelector(`.viewer-error, .legend`)).not.toBeNull(),
  )
  const message = document.querySelector(`.viewer-error`)?.textContent ?? null
  if (error) expect(message).toMatch(error)
  else {
    expect(message).toBeNull()
    const items = [...document.querySelectorAll(`.legend li`)]
    expect(items.map((item) => /\{\d+\}/.exec(item.textContent ?? ``)?.[0])).toEqual([
      `{111}`,
      `{100}`,
    ])
    const fractions = items.map((item) =>
      Number(item.querySelector(`small`)?.textContent?.replace(`%`, ``)),
    )
    expect(fractions[0]).toBeGreaterThan(fractions[1]) // percentages like `66.9%`
  }
  void unmount(component)
})

// The shared viewer chrome: show_controls drops named controls (all of them for false), and
// scene_controls reach the scene's camera
test.each([
  [
    undefined,
    [`wulff-info-toggle`, `export-toggle`, `wulff-controls-toggle`, `fullscreen-btn`],
  ],
  [{ hidden: [`fullscreen`, `info-pane`] }, [`export-toggle`, `wulff-controls-toggle`]],
  [{ hidden: [`export-pane`, `controls`] }, [`wulff-info-toggle`, `fullscreen-btn`]],
  [false, []],
] as const)(
  `WulffShape show_controls=%j shows %j, tracks hover and gates the i key`,
  async (show_controls, shown) => {
    Object.defineProperty(navigator, `gpu`, { value: {}, configurable: true })
    const onpointerenter = vi.fn()
    const props = $state({
      facets: two_families,
      lattice: wulff_examples[0].lattice,
      show_controls,
      scene_controls: { fov: 23 },
      hovered: false,
      onpointerenter,
    })
    const component = mount(WulffShape, { target: document.body, props })
    try {
      await vi.waitFor(() => expect(document.querySelector(`.legend`)).not.toBeNull())
      const buttons = document.querySelectorAll(`.wulff-shape section.control-buttons button`)
      const classes = [...buttons].map((button) =>
        shown.find((name) => button.classList.contains(name)),
      )
      expect(classes.filter(Boolean)).toEqual(shown)
      const camera = threlte_stub.nodes.find(({ tag }) => tag === `PerspectiveCamera`)
      expect(camera?.props.fov).toBe(23)
      // `i` opens the info pane (marking the viewer active) only while its toggle shows
      const viewer = document.querySelector(`.wulff-shape`)
      viewer?.dispatchEvent(new KeyboardEvent(`keydown`, { key: `i`, bubbles: true }))
      flushSync()
      const has_info = document.querySelector(`.wulff-info-toggle`) !== null
      expect(viewer?.classList.contains(`active`)).toBe(has_info)
      // hovered follows the pointer without displacing a caller's own handler
      viewer?.dispatchEvent(new PointerEvent(`pointerenter`))
      flushSync()
      expect([props.hovered, onpointerenter.mock.calls.length]).toEqual([true, 1])
    } finally {
      Reflect.deleteProperty(navigator, `gpu`)
      void unmount(component)
    }
  },
)

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
      show_vectors: true,
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
