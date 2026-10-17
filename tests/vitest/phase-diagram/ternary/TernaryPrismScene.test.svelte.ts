// Mounts TernaryPrismScene against the recording Threlte stub to drive the cutting plane's
// pointer handlers: a click on the plane pins a composition, a drag never does, a touch tap
// also shows the composition tooltip a hover there would, and lights up its tie triangle
import type { Vec2 } from '#lib/math.js'
import {
  compute_section,
  compute_ternary_phase_diagram,
  prepare_diagram,
  prism_position,
} from '#lib/phase-diagram/ternary/compute.js'
import TernaryPrismScene from '#lib/phase-diagram/ternary/TernaryPrismScene.svelte'
import { TERNARY_COLORS, TERNARY_DISPLAY_DEFAULTS } from '#lib/phase-diagram/ternary/types.js'
import { brighten_hex } from '#lib/scene/index.js'
import { flushSync, mount, unmount } from 'svelte'
import { Vector3 } from 'three/webgpu'
import { afterEach, expect, test, vi } from 'vitest'
import { hover_highlight, threlte_stub, touch_tap } from '../../isosurface/threlte-stub'
import { bind_props } from '../../setup'
import { toy_elements, toy_entries } from './fixtures'

vi.mock(`@threlte/core`, async (original) =>
  (await import(`../../isosurface/threlte-stub`)).mock_threlte_core(original),
)
vi.mock(`@threlte/extras`, async () =>
  (await import(`../../isosurface/threlte-stub`)).mock_threlte_extras(),
)

let teardown: (() => void) | undefined
afterEach(() => {
  teardown?.()
  teardown = undefined
  threlte_stub.reset()
})

const diagram = compute_ternary_phase_diagram(toy_entries, { elements: toy_elements })
const model = prepare_diagram(toy_entries, { elements: toy_elements })
type Handler = (event: unknown) => void
const handler = (name: string): Handler => {
  const node = threlte_stub.nodes.find(({ props }) => typeof props[name] === `function`)
  if (!node) throw new Error(`no stub node with ${name}`)
  return node.props[name] as Handler
}
// Threlte pointer event on the plane at composition coords_xy, the pointer at client_x
const pointer = (coords_xy: Vec2, client_x: number) => ({
  point: new Vector3(...prism_position(coords_xy)),
  nativeEvent: { button: 0, clientX: client_x, clientY: 100 },
  stopPropagation: () => {},
})
const release = (client_x: number) => {
  globalThis.dispatchEvent(new PointerEvent(`pointerup`, { clientX: client_x, clientY: 100 }))
  flushSync()
}

test(`a plane click pins its composition; a drag or a flick out of the canvas does not`, () => {
  const temperature = 600
  const state = $state({ temperature, pinned_composition: null as Vec2 | null })
  const on_section_hover = vi.fn()
  const component = mount(TernaryPrismScene, {
    target: document.body,
    props: bind_props(
      {
        diagram,
        section: compute_section(model, temperature),
        settings: TERNARY_DISPLAY_DEFAULTS,
        on_section_hover,
      },
      state,
    ),
  })
  teardown = () => void unmount(component)
  flushSync()
  const pin: Vec2 = [0.4, 0.25]
  const press = () => {
    handler(`onpointerdown`)(pointer(pin, 100))
    flushSync()
  }

  press()
  release(103) // within the 5 px slop: a click
  expect(state.pinned_composition).toEqual(pin)
  press()
  release(100) // clicking the pin removes it
  expect(state.pinned_composition).toBeNull()

  // released 60 px away without a pointermove reaching the scene (pointer left the canvas)
  press()
  release(160)
  expect(state.pinned_composition).toBeNull()

  // dragged through the catcher quad and back: the plane moves, nothing is pinned
  press()
  const catcher = threlte_stub.nodes.findLast(
    ({ tag, props }) => tag === `Mesh` && props.onpointermove,
  )
  if (!catcher) throw new Error(`drag catcher not mounted`)
  ;(catcher.props.onpointermove as Handler)({
    ...pointer(pin, 140),
    point: new Vector3(0, 0.3, 0),
  })
  expect(state.temperature).toBeGreaterThan(temperature)
  release(100)
  expect(state.pinned_composition).toBeNull()

  const plane = threlte_stub.nodes.find(({ props }) => props.onpointerdown && !props.userData)
  touch_tap(plane?.props ?? {}, pointer(pin, 100), { clientX: 100, clientY: 100 })
  flushSync()
  expect(state.pinned_composition).toEqual(pin)
  expect(on_section_hover).toHaveBeenLastCalledWith(
    expect.objectContaining({ kind: `composition`, position: [100, 100] }),
  )
  // the tie triangle the composition decomposes into lights up
  const { decomposition } = on_section_hover.mock.lastCall?.[0] ?? {}
  expect(decomposition?.phases).toHaveLength(3)
  const highlight = hover_highlight()
  expect(highlight?.color).toBe(brighten_hex(TERNARY_COLORS.face))
  const corners = Array.from(highlight?.geometry.getAttribute(`position`).array ?? [])
  const corner_keys = (coords: number[]) =>
    [0, 1, 2].map((idx) =>
      coords
        .slice(3 * idx, 3 * idx + 3)
        .map((val) => val.toFixed(5))
        .join(`,`),
    )
  expect(corner_keys(corners).toSorted()).toEqual(
    corner_keys(
      decomposition.phases.flatMap((idx: number) => prism_position(diagram.phases[idx].xy)),
    ).toSorted(),
  )
})
