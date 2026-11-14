// Mounts TernaryPrismScene against the recording Threlte stub to drive the cutting plane's
// pointer handlers: a click on the plane pins a composition, a drag never does, a touch tap
// also shows the composition tooltip a hover there would, and lights up its tie triangle.
// From the focused viewer root, the keyboard walks the rods.
import { clamp, type Vec2 } from '#lib/math.js'
import {
  compute_section,
  compute_ternary_phase_diagram,
  prepare_diagram,
  prism_position,
} from '#lib/phase-diagram/ternary/compute.js'
import TernaryPrismScene from '#lib/phase-diagram/ternary/TernaryPrismScene.svelte'
import { TERNARY_COLORS, TERNARY_DISPLAY_DEFAULTS } from '#lib/phase-diagram/ternary/types.js'
import { brighten_hex } from '#lib/scene/index.js'
import { flushSync, unmount } from 'svelte'
import { Vector3 } from 'three/webgpu'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { hover_highlight, threlte_stub, touch_tap } from '../../isosurface/threlte-stub'
import { mount_with_keys } from '../../scene/mount'
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
  const state = $state({
    temperature,
    pinned_composition: null as Vec2 | null,
    hovered_phase: null as number | null,
    selected_phase: null as number | null,
  })
  const [on_section_hover, on_hover] = [vi.fn(), vi.fn()]
  const { keys, mounted } = mount_with_keys(
    TernaryPrismScene,
    bind_props(
      {
        diagram,
        section: compute_section(model, temperature),
        settings: TERNARY_DISPLAY_DEFAULTS,
        on_section_hover,
        on_hover,
      },
      state,
    ),
  )
  teardown = () => void unmount(mounted)
  flushSync()
  const pin: Vec2 = [0.4, 0.25]
  // the plane: rods (ranked) render before it and pin nothing on a press
  const plane = threlte_stub.nodes.find(({ props }) => props.onpointerdown && !props.userData)
  if (!plane) throw new Error(`cutting plane not mounted`)
  const press = () => {
    ;(plane.props.onpointerdown as Handler)(pointer(pin, 100))
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

  touch_tap(plane.props, pointer(pin, 100), { clientX: 100, clientY: 100 })
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

  // by keyboard: the first rod where the plane crosses its stability window (else at its
  // nearer end) shows the rod tooltip, Enter selects its phase like a click
  const phase = diagram.phases.findIndex(({ idx }) => diagram.stability_windows[idx].length)
  const [lower, upper] = diagram.stability_windows[phase][0]
  expect(keys.press(`ArrowDown`)).toBe(true)
  expect([state.hovered_phase, keys.message]).toEqual([phase, diagram.phases[phase].label])
  expect(on_hover).toHaveBeenLastCalledWith(expect.objectContaining({ phase }))
  expect(on_hover.mock.lastCall?.[0].temperature).toBeCloseTo(
    clamp(state.temperature, lower, upper),
    6,
  )
  keys.press(`Enter`)
  expect(state.selected_phase).toBe(phase)

  // a touch tap on a rod selects its phase but pins nothing: touch makes no hover before the
  // press, so the rod itself says it pins nothing (the tap lands on the pin and would clear it)
  keys.press(`Escape`)
  expect(state.hovered_phase).toBeNull()
  const rod = threlte_stub.nodes.find(
    ({ props }) => (props.userData as { pick_rank?: number } | undefined)?.pick_rank === 1,
  )
  touch_tap(rod?.props ?? {}, pointer(pin, 100), { clientX: 100, clientY: 100 })
  flushSync()
  expect(state.pinned_composition).toEqual(pin)
  expect(state.selected_phase).not.toBe(phase)
})
