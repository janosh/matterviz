import { brighten_hex, highlight_edge_color } from '#lib/scene/colors.js'
import { positions_geometry } from '#lib/scene/geometry.svelte.js'
import HoverHighlight from '#lib/scene/HoverHighlight.svelte'
import { type ComponentProps, flushSync, mount, unmount } from 'svelte'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import type { BufferGeometry, InterleavedBufferAttribute } from 'three/webgpu'
import { BufferAttribute } from 'three/webgpu'
import { afterEach, expect, test, vi } from 'vitest'
import { hover_highlight, threlte_stub } from '../isosurface/threlte-stub'

vi.mock(`@threlte/core`, async (original) =>
  (await import(`../isosurface/threlte-stub`)).mock_threlte_core(original),
)

afterEach(() => threlte_stub.reset())

// Unit square in z=0 split along its 0-2 diagonal, as an indexed mesh and as a triangle soup
// whose shared corners differ by float noise (welded for the outline)
// oxfmt-ignore
const [p0, p1, p2, p3] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]
const indexed_quad = () =>
  positions_geometry([...p0, ...p1, ...p2, ...p3]).setIndex(
    new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1),
  )
const soup_quad = () =>
  positions_geometry([...p0, ...p1, ...p2, 1e-6, 0, 0, 1, 1 + 1e-6, 0, ...p3])
const key = (point: ArrayLike<number>) => Array.from(point, (val) => val.toFixed(3)).join(`,`)
const edge = (pt_a: ArrayLike<number>, pt_b: ArrayLike<number>) =>
  [key(pt_a), key(pt_b)].toSorted().join(`|`)
const square = [edge(p0, p1), edge(p1, p2), edge(p2, p3), edge(p3, p0)]

// Drawn triangles (non-indexed fill or the indexed source) as corner keys
const triangles = (geometry: BufferGeometry): string[][] => {
  const position = geometry.getAttribute(`position`)
  const corners = geometry.index
    ? Array.from(geometry.index.array)
    : [...Array(position.count).keys()]
  return Array.from({ length: corners.length / 3 }, (_, tri) =>
    corners
      .slice(3 * tri, 3 * tri + 3)
      .map((vtx) => key([position.getX(vtx), position.getY(vtx), position.getZ(vtx)])),
  )
}
const outline = (): LineSegments2 | undefined =>
  threlte_stub.nodes.find(({ props }) => props.is instanceof LineSegments2)?.props.is as
    | LineSegments2
    | undefined
const outline_edges = (line: LineSegments2): string[] => {
  const { array } = (line.geometry.getAttribute(`instanceStart`) as InterleavedBufferAttribute)
    .data
  return Array.from({ length: array.length / 6 }, (_, idx) =>
    edge(array.slice(6 * idx, 6 * idx + 3), array.slice(6 * idx + 3, 6 * idx + 6)),
  ).toSorted()
}

// The fill is the source triangles (all, drawn as is, or a `faces` copy) brightened in front of
// the source; the outline their boundary, or `edges` when given, in a darker shade. A colour
// change rebuilds only the outline, a faces change the copy too; unmounting disposes what was
// built here and never the caller's geometries.
// oxfmt-ignore
test.each([
  [`indexed, all faces`, indexed_quad(), undefined, [[p0, p1, p2], [p0, p2, p3]], square],
  [`indexed, one face`, indexed_quad(), [1], [[p0, p2, p3]],
    [edge(p0, p2), edge(p2, p3), edge(p3, p0)]],
  [`welded soup`, soup_quad(), [0, 1], [[p0, p1, p2], [p0, p2, p3]], square],
  [`edges only`, null, undefined, null, [edge(p0, p1)]],
] as const)(`%s`, (_label, geometry, faces, fill_tris, edges) => {
  const edges_geometry = geometry ? undefined : positions_geometry([...p0, ...p1])
  const props = $state<ComponentProps<typeof HoverHighlight>>({
    geometry,
    faces,
    color: `#3366cc`,
    edges: edges_geometry,
  })
  const component = mount(HoverHighlight, { target: document.body, props })
  flushSync()

  const fill = hover_highlight()
  if (fill_tris) {
    expect(fill?.color).toBe(brighten_hex(`#3366cc`))
    if (!fill) throw new Error(`no fill drawn`)
    if (!faces) expect(fill.geometry).toBe(geometry)
    expect(triangles(fill.geometry)).toEqual(fill_tris.map((tri) => tri.map(key)))
    const [mesh, material] = threlte_stub.nodes
    expect(mesh.props.renderOrder).toBe(100)
    // half opacity: the hovered surface's own shading still shows through the tint
    expect(material.props).toMatchObject({
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    })
  } else expect(fill).toBeNull()
  const line = outline()
  if (!line) throw new Error(`no outline drawn`)
  expect(outline_edges(line)).toEqual([...edges].toSorted())
  expect(`#${line.material.color.getHexString()}`).toBe(highlight_edge_color(`#3366cc`))

  // dispose() calls on what HoverHighlight built (the faces copy, the outline) and on the
  // caller's geometries (never), null where there is no such object
  const spy_on = (owners: ({ dispose: () => void } | null | undefined)[]) =>
    owners.map((owner) => (owner ? vi.spyOn(owner, `dispose`) : null))
  const n_calls = (spies: ReturnType<typeof spy_on>) =>
    spies.map((spy) => spy?.mock.calls.length ?? null)
  const built = () =>
    spy_on([faces && hover_highlight()?.geometry, outline()?.geometry, outline()?.material])
  const callers = spy_on([geometry, edges_geometry])
  const before_recolor = built()
  props.color = `#cc3333`
  flushSync()
  expect(n_calls(before_recolor)).toEqual([faces ? 0 : null, 1, 1])
  expect(`#${outline()?.material.color.getHexString()}`).toBe(highlight_edge_color(`#cc3333`))
  if (faces) {
    const before_refaces = built()
    props.faces = [0]
    flushSync()
    expect(n_calls(before_refaces)).toEqual([1, 1, 1])
  }
  const before_unmount = built()
  void unmount(component)
  flushSync()
  expect(n_calls(before_unmount)).toEqual([faces ? 1 : null, 1, 1])
  expect(n_calls(callers)).toEqual([geometry ? 0 : null, edges_geometry ? 0 : null])
  expect(threlte_stub.nodes).toEqual([])
})
