// Stand-in for Threlte's `<T.*>` components: records every mounted node's tag and live
// props so tests can assert what Isosurface.svelte would hand to the scene graph
// without a WebGPU renderer. `threlte_stub.T` is the drop-in for `@threlte/core`'s `T`:
// `<T.Mesh>` records under the tag `Mesh`, the bare `<T is={object}>` form under `T`.
import type * as threlte_core from '@threlte/core'
import { BufferGeometry, PerspectiveCamera } from 'three/webgpu'
import { keydown, type PinStep, pin_spot } from '../setup'
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

// `vi.mock` factories for a scene mounted without a renderer: core's recording `T` and
// <Canvas> (which renders its scene, so a viewer can mount one with navigator.gpu stubbed) plus
// the useThrelte() fields scenes read (a camera on +z looking at the origin, as scene_pointer
// projects through it), and extras' components as recorded stubs. interactivity()
// would register pointer plugins on a renderer, so it defaults to an inert `enabled` switch.
export const mock_threlte_core = async (
  import_original: <Module>() => Promise<Module>,
  invalidate = () => {},
) => {
  const core = await import_original<typeof threlte_core>()
  return {
    ...core,
    T: threlte_stub.T,
    Canvas: Reflect.get(threlte_stub.T, `Canvas`),
    useThrelte: () => ({
      invalidate,
      scene: { name: `scene` },
      camera: core.currentWritable(new PerspectiveCamera().translateZ(10)),
      size: core.currentWritable({ width: 800, height: 600 }),
      dom: document.createElement(`div`),
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

// The mounted HoverHighlight's fill (scene/HoverHighlight.svelte): its geometry and the colour
// its material paints, null when none is drawn
export function hover_highlight(): { geometry: BufferGeometry; color: string } | null {
  const idx = stub_state.nodes.findIndex(({ props }) => props.name === `hover-highlight`)
  if (idx === -1) return null
  const { geometry } = stub_state.nodes[idx].props
  const { color } = stub_state.nodes[idx + 1].props
  if (!(geometry instanceof BufferGeometry) || typeof color !== `string`)
    throw new Error(`hover-highlight mesh without a geometry and material colour`)
  return { geometry, color }
}

// A touch tap on an object as threlte dispatches it to the object's handlers (a
// scene_interactivity touch_hover target): its press, the window's pointerup, then its click.
// `event` adds the intersection's fields (point, ...), `init` the DOM events'.
export const touch_tap = (
  props: Record<string, unknown>,
  event: Record<string, unknown> = {},
  init: PointerEventInit = {},
): void => {
  const dispatch = (type: string) =>
    (props[`on${type}`] as (event: unknown) => void)({
      ...event,
      nativeEvent: new PointerEvent(type, { pointerType: `touch`, ...init }),
    })
  dispatch(`pointerdown`)
  globalThis.dispatchEvent(new PointerEvent(`pointerup`, { pointerType: `touch`, ...init }))
  dispatch(`click`)
}

// pin_cycle driver for a viewer whose scene is mounted on this stub. Mark 0 or 1 is a recorded
// object's `props` (a touch_hover target) and the intersection fields of a hit on it: a hover
// is a pointermove there, a click its click after one, a click on empty space reaches the
// objects as onpointermissed. Escape and the keyboard walk's keys go to the viewer root
// `wrapper`: Enter on mark 0 or 1 after one or two ArrowRight, so the marks lead its walk.
type StubMark = { props: Record<string, unknown>; hit: Record<string, unknown> }
export const scene_pin_driver =
  (wrapper: HTMLElement, marks: [StubMark, StubMark]) =>
  (step: PinStep, mark_idx: 0 | 1 | null): void => {
    const { props, hit } = marks[mark_idx ?? 0]
    const handler = (name: string) => props[name] as (event: unknown) => void
    const nativeEvent = new PointerEvent(`pointermove`, pin_spot(mark_idx, step))
    if (step === `escape`) wrapper.dispatchEvent(keydown(`Escape`))
    else if (step === `leave`) handler(`onpointerleave`)({ ...hit, nativeEvent })
    else if (step === `enter`) {
      wrapper.focus()
      for (const key of [...Array((mark_idx ?? 0) + 1).fill(`ArrowRight`), `Enter`])
        wrapper.dispatchEvent(keydown(key))
    } else if (mark_idx !== null) handler(`onpointermove`)({ ...hit, nativeEvent })
    if (step !== `click`) return
    const click = new MouseEvent(`click`, pin_spot(mark_idx, step))
    if (mark_idx === null) handler(`onpointermissed`)(click)
    else handler(`onclick`)({ ...hit, nativeEvent: click })
  }
