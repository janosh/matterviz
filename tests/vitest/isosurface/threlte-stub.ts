// Stand-in for Threlte's `<T.*>` components: records every mounted node's tag and live
// props so tests can assert what Isosurface.svelte would hand to the scene graph
// without a WebGPU renderer. `threlte_stub.T` is the drop-in for `@threlte/core`'s `T`:
// `<T.Mesh>` records under the tag `Mesh`, the bare `<T is={object}>` form under `T`.
import type * as threlte_core from '@threlte/core'
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

// `vi.mock` factories for a scene mounted without a <Canvas>: core's recording `T` plus the
// useThrelte() fields scenes read, and extras' components as recorded stubs. interactivity()
// would register pointer plugins on a renderer, so it defaults to an inert `enabled` switch.
export const mock_threlte_core = async (
  import_original: <Module>() => Promise<Module>,
  invalidate = () => {},
) => {
  const core = await import_original<typeof threlte_core>()
  return {
    ...core,
    T: threlte_stub.T,
    useThrelte: () => ({
      invalidate,
      scene: { name: `scene` },
      camera: core.currentWritable({ id: 1 }),
      size: core.currentWritable({ width: 800, height: 600 }),
      renderer: { domElement: document.createElement(`canvas`) },
    }),
  }
}
export const mock_threlte_extras = (
  interactivity: (options?: unknown) => unknown = () => ({ enabled: { set: () => {} } }),
) => ({
  ...Object.fromEntries(
    [`OrbitControls`, `HTML`, `Billboard`].map((tag) => [
      tag,
      Reflect.get(threlte_stub.T, tag),
    ]),
  ),
  interactivity,
})
