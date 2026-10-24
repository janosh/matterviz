// WheelZoomGate: plain wheels over an idle embedded viewer scroll the page, ⌘/Ctrl + wheel or
// an activated viewer zooms
import {
  PAGE_SCROLL_GAP_MS,
  WHEEL_ZOOM_HINT_MS,
  WheelZoomGate,
} from '#lib/scene/wheel-zoom.svelte.js'
import { host, type WheelZoomMode } from '#lib/host.js'
import { flushSync } from 'svelte'
import { afterEach, describe, expect, onTestFinished, test, vi } from 'vitest'
import { mock_fullscreen } from '../setup'

// Wheel timestamps a second apart unless a test passes its own, so no wheel reads as the tail
// of the previous test's page scroll
let wheel_clock = 0

// A viewer root holding a zoom surface (stands in for OrbitControls' dom element, whose
// bubble-phase listener prevents the default and zooms) and a pane beside it, in `parent`
function make_viewer(
  mode: WheelZoomMode = `active`, // set app-wide on host.wheel_zoom, reset after each test
  zoomable = () => true,
  parent: ParentNode = document.body,
) {
  const root = document.createElement(`div`)
  const surface = document.createElement(`div`)
  const canvas = document.createElement(`canvas`)
  const pane = document.createElement(`div`)
  surface.append(canvas)
  root.append(surface, pane)
  parent.append(root)
  let zooms = 0
  surface.addEventListener(`wheel`, (event) => {
    event.preventDefault()
    zooms++
  })
  host.wheel_zoom = mode
  const gate = new WheelZoomGate()
  const unregister = gate.register_surface(surface, zoomable)
  // idempotent, as tests detach before the cleanup does (svelte warns on a double unmount)
  let cleanup: (() => void) | null = gate.attach(root)
  const detach = () => {
    cleanup?.()
    cleanup = null
  }
  onTestFinished(() => {
    detach()
    root.remove()
  })
  // dispatches a wheel at `target` and reports whether it zoomed and was default-prevented
  const wheel = (
    target: Element = canvas,
    init: WheelEventInit = {},
    time_stamp = (wheel_clock += 1000),
  ) => {
    const before = zooms
    const event = new WheelEvent(`wheel`, {
      deltaY: 100,
      bubbles: true,
      cancelable: true,
      ...init,
    })
    // happy-dom's WheelEvent drops the modifier keys of its init dict
    const { ctrlKey = false, metaKey = false } = init
    Object.defineProperties(event, {
      ctrlKey: { value: ctrlKey },
      metaKey: { value: metaKey },
      timeStamp: { value: time_stamp },
    })
    target.dispatchEvent(event)
    return { zoomed: zooms > before, prevented: event.defaultPrevented }
  }
  return { root, surface, canvas, pane, gate, wheel, unregister, detach }
}

type Viewer = ReturnType<typeof make_viewer>
const pointer = (type: string) => new PointerEvent(type, { bubbles: true, composed: true })

// gestures between viewer creation and the wheel that is checked
const ACTIONS: Record<string, (viewer: Viewer) => void> = {
  click: ({ canvas }) => canvas.dispatchEvent(pointer(`pointerdown`)),
  'click pane': ({ pane }) => pane.dispatchEvent(pointer(`pointerdown`)),
  // keyboard focus (focus-visible), then a mouse click's (focusin without focus-visible)
  focus: ({ root }) => {
    root.tabIndex = 0
    root.focus()
  },
  'mouse focus': ({ root }) =>
    root.dispatchEvent(new FocusEvent(`focusin`, { bubbles: true })),
  enter: ({ root }) =>
    root.dispatchEvent(new PointerEvent(`pointerenter`, { pointerType: `mouse` })),
  leave: ({ root }) =>
    root.dispatchEvent(new PointerEvent(`pointerleave`, { pointerType: `mouse` })),
  'touch leave': ({ root }) =>
    root.dispatchEvent(new PointerEvent(`pointerleave`, { pointerType: `touch` })),
  escape: () =>
    document.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true })),
  // a popover closing on Escape hands focus back to its trigger inside the viewer
  'escape refocus': ({ pane }) => {
    const trigger = document.createElement(`button`)
    pane.append(trigger)
    const refocus = () => trigger.focus()
    document.addEventListener(`keydown`, refocus)
    document.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true }))
    document.removeEventListener(`keydown`, refocus)
  },
  // Tab moves focus on to an element outside the viewer, or to one inside it
  'tab out': ({ root }) =>
    root.dispatchEvent(
      new FocusEvent(`focusout`, { bubbles: true, relatedTarget: document.body }),
    ),
  'tab within': ({ root, pane }) =>
    root.dispatchEvent(new FocusEvent(`focusout`, { bubbles: true, relatedTarget: pane })),
  'other key': () =>
    document.dispatchEvent(new KeyboardEvent(`keydown`, { key: `a`, bubbles: true })),
  'click outside': () => document.body.dispatchEvent(pointer(`pointerdown`)),
}

afterEach(() => {
  host.wheel_zoom = `active`
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe(`WheelZoomGate`, () => {
  // oxfmt-ignore
  test.each<[WheelZoomMode, string[], WheelEventInit, boolean]>([
    [`active`, [], {}, false],
    [`active`, [], { ctrlKey: true }, true], // trackpad pinch arrives as ctrl+wheel
    [`active`, [], { metaKey: true }, true],
    [`active`, [`click`], {}, true],
    [`active`, [`click pane`], {}, true],
    [`active`, [`focus`], {}, true],
    [`active`, [`mouse focus`], {}, false], // a window regaining focus re-fires focusin
    [`active`, [`click`, `touch leave`], {}, true], // touch leaves right after every tap
    [`active`, [`click`, `leave`], {}, false],
    [`active`, [`click`, `escape`], {}, false],
    [`active`, [`click`, `escape refocus`], {}, false],
    [`active`, [`focus`, `tab out`], {}, false],
    [`active`, [`focus`, `tab within`], {}, true],
    [`active`, [`click`, `other key`], {}, true],
    [`active`, [`click`, `click outside`], {}, false],
    [`active`, [`click`, `leave`, `focus`], {}, true],
    [`always`, [], {}, true],
    [`always`, [`leave`], {}, true],
    [`modifier`, [], {}, false],
    [`modifier`, [`click`], {}, false],
    [`modifier`, [`focus`], {}, false],
    [`modifier`, [`click`], { ctrlKey: true }, true],
  ])(`%s mode after %j, wheel %j zooms: %s`, (mode, actions, init, zooms) => {
    vi.useFakeTimers()
    const viewer = make_viewer(mode)
    for (const action of actions) ACTIONS[action](viewer)
    const { zoomed, prevented } = viewer.wheel(viewer.canvas, init)
    expect(zoomed).toBe(zooms)
    // a blocked wheel keeps its default so the page scrolls, and flashes the hint
    expect(prevented).toBe(zooms)
    expect(viewer.gate.hint_visible).toBe(!zooms)
    vi.advanceTimersByTime(WHEEL_ZOOM_HINT_MS - 1)
    expect(viewer.gate.hint_visible).toBe(!zooms)
    vi.advanceTimersByTime(1)
    expect(viewer.gate.hint_visible).toBe(false)
  })

  // a sideways swipe over the surface is stopped at the root (no zoom attempt), while a wheel
  // over a pane is not the gate's to block and propagates untouched
  test.each<[string, (viewer: Viewer) => Element, WheelEventInit, boolean]>([
    [`sideways swipe`, ({ canvas }) => canvas, { deltaX: 100, deltaY: 10 }, false],
    [`wheel over a pane`, ({ pane }) => pane, {}, true],
  ])(`%s scrolls the page without the hint`, (_label, pick_target, init, reaches_root) => {
    const viewer = make_viewer()
    let reached_root = false
    viewer.root.addEventListener(`wheel`, () => (reached_root = true))
    const result = viewer.wheel(pick_target(viewer), init)
    expect(result).toEqual({ zoomed: false, prevented: false })
    expect(reached_root).toBe(reaches_root)
    expect(viewer.gate.hint_visible).toBe(false)
  })

  test(`a viewer carried under the cursor by a page scroll stays quiet`, () => {
    const { pane, gate, wheel } = make_viewer()
    wheel_clock += 1000
    const start = wheel_clock
    wheel(pane, {}, start) // reaches the page: a page scroll
    // each blocked wheel inside the gap continues it, so the scroll never flashes the hint
    for (const offset of [100, 200, 300]) {
      expect(wheel(undefined, {}, start + offset).zoomed).toBe(false)
      expect(gate.hint_visible).toBe(false)
    }
    // a fresh wheel after a pause is aimed at the viewer
    wheel(undefined, {}, start + 300 + PAGE_SCROLL_GAP_MS)
    expect(gate.hint_visible).toBe(true)
  })

  test(`each blocked wheel restarts the hint timer`, () => {
    vi.useFakeTimers()
    const { gate, wheel } = make_viewer()
    wheel()
    vi.advanceTimersByTime(WHEEL_ZOOM_HINT_MS - 100)
    wheel()
    vi.advanceTimersByTime(WHEEL_ZOOM_HINT_MS - 100)
    expect(gate.hint_visible).toBe(true)
    vi.advanceTimersByTime(100)
    expect(gate.hint_visible).toBe(false)
  })

  test(`a surface with zoom disabled (zoom_speed 0) is not gated`, () => {
    let zoomable = false
    const { gate, wheel } = make_viewer(`active`, () => zoomable)
    // the mock surface zooms on whatever reaches it: OrbitControls would ignore it
    expect(wheel().zoomed).toBe(true)
    expect(gate.hint_visible).toBe(false)
    zoomable = true
    expect(wheel().zoomed).toBe(false)
  })

  test(`unregistered surfaces and detached gates no longer block`, () => {
    const viewer = make_viewer()
    expect(viewer.wheel().zoomed).toBe(false)
    const unregister_again = viewer.gate.register_surface(viewer.surface)
    viewer.unregister() // a stale handle leaves the newer registration in place
    expect(viewer.wheel().zoomed).toBe(false)
    unregister_again()
    expect(viewer.wheel().zoomed).toBe(true)
    const other = make_viewer()
    other.canvas.dispatchEvent(pointer(`pointerdown`))
    expect(other.gate.active).toBe(true)
    other.detach()
    expect(other.gate.active).toBe(false)
    other.gate.register_surface(other.canvas)
    expect(other.wheel().zoomed).toBe(true)
  })

  test.each<WheelZoomMode>([`active`, `modifier`])(
    `%s mode zooms on plain wheels while fullscreen`,
    async (mode) => {
      onTestFinished(mock_fullscreen())
      const viewer = make_viewer(mode)
      await viewer.root.requestFullscreen()
      expect(viewer.wheel().zoomed).toBe(true)
      await document.exitFullscreen()
      expect(viewer.wheel().zoomed).toBe(false)
    },
  )

  test.each<[string, WheelZoomMode, string]>([
    [`MacIntel`, `active`, `⌘ + scroll to zoom · click to interact`],
    [`iPhone`, `modifier`, `⌘ + scroll to zoom`],
    [`Win32`, `active`, `Ctrl + scroll to zoom · click to interact`],
    [`Linux x86_64`, `modifier`, `Ctrl + scroll to zoom`],
  ])(`on %s, %s mode hint reads %s`, (platform, mode, hint) => {
    vi.spyOn(navigator, `platform`, `get`).mockReturnValue(platform)
    host.wheel_zoom = mode
    expect(new WheelZoomGate().hint).toBe(hint)
  })

  // Hover-only chrome (the gizmo) shows while the pointer is over the viewer or focus is in it
  test.each<[string[], boolean]>([
    [[], false],
    [[`enter`], true],
    [[`enter`, `leave`], false],
    [[`enter`, `touch leave`], false],
    [[`mouse focus`], true],
    [[`mouse focus`, `tab within`], true],
    [[`mouse focus`, `tab out`], false],
    [[`enter`, `mouse focus`, `leave`], true],
    [[`enter`, `mouse focus`, `leave`, `tab out`], false],
  ])(`after %j the viewer is engaged: %s`, async (actions, engaged) => {
    const viewer = make_viewer()
    for (const action of actions) ACTIONS[action](viewer)
    await Promise.resolve() // focus changes land a microtask later
    expect(viewer.gate.engaged).toBe(engaged)
    viewer.detach()
    expect(viewer.gate.engaged).toBe(false)
  })

  test(`attaching renders the hint in the root, detaching removes it`, () => {
    const { root, gate, wheel, detach } = make_viewer()
    const hint_el = () => root.querySelector(`.wheel-zoom-hint`)
    expect(hint_el()?.getAttribute(`aria-live`)).toBe(`polite`)
    expect(hint_el()?.textContent).toBe(``)
    wheel()
    flushSync()
    expect(hint_el()?.textContent).toBe(gate.hint)
    detach()
    flushSync()
    expect(hint_el()).toBeNull()
  })

  test(`a click inside a viewer in a shadow root activates it, as does its fullscreen`, () => {
    const shadow_host = document.createElement(`div`)
    document.body.append(shadow_host)
    onTestFinished(() => shadow_host.remove())
    const shadow = shadow_host.attachShadow({ mode: `open` })
    const { root, canvas, gate, wheel } = make_viewer(`active`, () => true, shadow)
    // document.fullscreenElement would be the shadow host, which does not contain the root
    Object.defineProperty(shadow, `fullscreenElement`, { value: root, configurable: true })
    expect(wheel().zoomed).toBe(true)
    Object.defineProperty(shadow, `fullscreenElement`, { value: null })
    expect(wheel().zoomed).toBe(false)
    canvas.dispatchEvent(pointer(`pointerdown`))
    expect(gate.active).toBe(true)
    expect(wheel().zoomed).toBe(true)
    shadow_host.dispatchEvent(pointer(`pointerdown`))
    expect(gate.active).toBe(false)
    expect(wheel().zoomed).toBe(false)
  })
})
