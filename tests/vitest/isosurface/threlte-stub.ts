// Stand-in for Threlte's `<T.*>` components: records every mounted node's tag and live
// props so tests can assert what Isosurface.svelte would hand to the scene graph
// without a WebGPU renderer. `threlte_stub.T` is the drop-in for `@threlte/core`'s `T`:
// `<T.Mesh>` records under the tag `Mesh`, the bare `<T is={object}>` form under `T`.
import ThrelteStub from './ThrelteStub.svelte'

export type StubNode = { tag: string; props: Record<string, unknown> }
export const stub_state = { nodes: [] as StubNode[], pending_tag: `` }

const record_as =
  (tag: string) =>
  (anchor: Parameters<typeof ThrelteStub>[0], props: Record<string, unknown>): unknown => {
    stub_state.pending_tag = tag
    return ThrelteStub(anchor, props)
  }

export const threlte_stub = {
  nodes: stub_state.nodes,
  reset: () => stub_state.nodes.splice(0),
  T: new Proxy(record_as(`T`), { get: (_target, tag) => record_as(String(tag)) }),
}
