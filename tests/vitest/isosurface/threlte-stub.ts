// Stand-in for Threlte's `<T.*>` components: records every mounted node's tag and live
// props so tests can assert what Isosurface.svelte would hand to the scene graph
// without a WebGPU renderer. `threlte_stub.T` is the drop-in for `@threlte/core`'s `T`.
import ThrelteStub from './ThrelteStub.svelte'

export type StubNode = { tag: string; props: Record<string, unknown> }
export const stub_state = { nodes: [] as StubNode[], pending_tag: `` }

export const threlte_stub = {
  nodes: stub_state.nodes,
  reset: () => stub_state.nodes.splice(0),
  T: new Proxy(
    {},
    {
      get:
        (_target, tag) =>
        (
          anchor: Parameters<typeof ThrelteStub>[0],
          props: Record<string, unknown>,
        ): unknown => {
          stub_state.pending_tag = String(tag)
          return ThrelteStub(anchor, props)
        },
    },
  ),
}
