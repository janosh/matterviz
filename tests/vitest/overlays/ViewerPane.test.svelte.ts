import type { ShowControlsProp } from '#lib/controls.js'
import ControlPane from '#lib/overlays/ControlPane.svelte'
import ViewerPane from '#lib/overlays/ViewerPane.svelte'
import { createRawSnippet, flushSync, mount, tick, unmount } from 'svelte'
import { Expand } from 'svelte-widgets/icons'
import { expect, onTestFinished, test, vi } from 'vitest'
import {
  bind_props,
  doc_query,
  fire,
  mock_fullscreen,
  mount_in_test,
  trigger_resize_observer,
} from '../setup'

test.each([
  [-600, -300, 4, 4],
  [700, 600, 676, 496],
  [4, 8, 580, 143],
])(
  `manual placement survives resizing; fullscreen keeps it visible (delta=%s,%s)`,
  async (delta_x, delta_y, fullscreen_left, fullscreen_top) => {
    mock_fullscreen()
    vi.stubGlobal(`innerWidth`, 1000)
    vi.stubGlobal(`innerHeight`, 700)
    const container = document.createElement(`div`)
    container.style.cssText = `position: relative; container-type: inline-size`
    document.body.append(container)
    vi.spyOn(container, `getBoundingClientRect`).mockReturnValue(
      new DOMRect(100, 100, 800, 500),
    )
    Object.defineProperties(container, {
      clientWidth: { value: 800 },
      offsetWidth: { value: 800 },
      offsetHeight: { value: 500 },
    })
    const component = mount(ViewerPane, {
      target: container,
      props: { pane_name: `export`, class_prefix: `test-export`, closed_icon: Expand },
    })
    onTestFinished(async () => {
      await unmount(component)
      container.remove()
      vi.unstubAllGlobals()
    })
    flushSync()
    const pane = doc_query(`.test-export-pane`)
    const toggle = doc_query<HTMLButtonElement>(`.test-export-toggle`)
    const control_tab = doc_query(`.test-export-pane > .control-tab`)
    const handle = doc_query(`.test-export-pane .drag-handle`)
    Object.defineProperties(pane, {
      offsetParent: { get: () => container },
      offsetLeft: { get: () => Math.round(Number(pane.style.left.slice(0, -2))) },
      offsetTop: { get: () => Math.round(Number(pane.style.top.slice(0, -2))) },
    })
    let scale = 1
    let origin = 100
    vi.spyOn(pane, `getBoundingClientRect`).mockImplementation(
      () =>
        new DOMRect(
          origin + Number(pane.style.left.slice(0, -2)) * scale,
          origin + Number(pane.style.top.slice(0, -2)) * scale,
          300 * scale,
          200 * scale,
        ),
    )
    vi.spyOn(control_tab, `getBoundingClientRect`).mockImplementation(() => {
      const { right, top } = pane.getBoundingClientRect()
      return new DOMRect(right, top, 20 * scale, 60 * scale)
    })
    vi.spyOn(toggle, `getBoundingClientRect`).mockReturnValue(new DOMRect(870, 100, 30, 30))
    await fire(toggle)
    trigger_resize_observer(container)
    const anchored_left = pane.offsetLeft
    expect(control_tab.getBoundingClientRect().right).toBe(896)
    // A delayed anchor update can follow the last ResizeObserver delivery.
    pane.style.left = `800px`
    await vi.waitFor(() => expect(control_tab.getBoundingClientRect().right).toBe(896))

    const pointer = (type: string, client_x: number, client_y = 150) =>
      fire(
        handle,
        new PointerEvent(type, {
          bubbles: true,
          isPrimary: true,
          button: 0,
          pointerId: 1,
          clientX: client_x,
          clientY: client_y,
        }),
      )
    await pointer(`pointerdown`, 890)
    await pointer(`pointermove`, 890 + delta_x, 150 + delta_y)
    const manual_left = `${anchored_left + delta_x}px`
    expect(pane.style.left).toBe(manual_left)
    await pointer(`pointerup`, 890 + delta_x, 150 + delta_y)
    await tick()
    expect(pane.style.left).toBe(manual_left)

    trigger_resize_observer(container)
    trigger_resize_observer(pane)
    await tick()
    expect(pane.style.left).toBe(manual_left)
    await fire(toggle)
    await fire(toggle)
    expect(pane.style.left).toBe(manual_left)

    // A different viewer entering fullscreen must not reposition this pane.
    const other_viewer = document.createElement(`div`)
    document.body.append(other_viewer)
    await other_viewer.requestFullscreen()
    await tick()
    expect(pane.style.left).toBe(manual_left)
    other_viewer.remove()

    // Fullscreen may belong to an outer viewer, as with Structure inside Trajectory.
    await document.body.requestFullscreen()
    await vi.waitFor(() => {
      const { left, top } = pane.getBoundingClientRect()
      expect([left, top]).toEqual([fullscreen_left, fullscreen_top])
      expect(control_tab.getBoundingClientRect().right).toBeLessThanOrEqual(996)
      expect(pane.getBoundingClientRect().bottom).toBeLessThanOrEqual(696)
    })
    // Responsive props can rewrite inline styles after the initial fullscreen layout.
    pane.style.left = `1100px`
    pane.style.top = `800px`
    await vi.waitFor(() => {
      const { left, top } = pane.getBoundingClientRect()
      expect([left, top]).toEqual([676, 496])
    })
    // Fractional insets under a scaled ancestor must converge, not bounce between rounded
    // offsetLeft/Top values on every MutationObserver delivery.
    scale = 3
    origin = 100.75
    vi.mocked(container.getBoundingClientRect).mockReturnValue(
      new DOMRect(origin, origin, 800 * scale, 500 * scale),
    )
    pane.style.left = `-1000.75px`
    pane.style.top = `-1000.75px`
    await vi.waitFor(() => {
      const { left, top } = pane.getBoundingClientRect()
      expect([left, top]).toEqual([4, 4])
    })
    scale = 1
    origin = 100
    vi.mocked(container.getBoundingClientRect).mockReturnValue(new DOMRect(100, 100, 800, 500))
    const corrected = [pane.style.left, pane.style.top]
    await document.exitFullscreen()
    trigger_resize_observer(container)
    await tick()
    expect([pane.style.left, pane.style.top]).toEqual(corrected)
    expect(pane.querySelector(`.reset-button`)).not.toBeNull()
    pane.style.left = `2000px`
    trigger_resize_observer(pane)
    await tick()
    expect(pane.style.left).toBe(`2000px`)

    await fire(doc_query(`.test-export-pane .reset-button`))
    trigger_resize_observer(container)
    expect(pane.style.left).toBe(`${anchored_left}px`)
    expect(pane.querySelector(`.reset-button`)).toBeNull()
  },
)

// Clipping hosts would cut the pane's bottom off out of reach, so it ends above the tightest
// one that contains it: not one an absolute viewer escapes, nor any above a fixed viewer or a
// scroller (the user can reach the rest). The body clips like an app shell, at the viewport.
// A clipping edge stays a hard limit however little room it leaves. Fullscreen on the outer
// host drops its cap and all above it.
test.each([
  [`visible`, `hidden`, `relative`, `426px`, `376px`, `26px`, `426px`],
  [`visible`, `clip`, `relative`, `426px`, `376px`, `26px`, `426px`],
  [`hidden`, `hidden`, `relative`, `326px`, `276px`, `0px`, `426px`],
  [`hidden`, `auto`, `relative`, ``, ``, ``, ``],
  [`visible`, `visible`, `relative`, `526px`, `526px`, `526px`, ``],
  [`visible`, `hidden`, `absolute`, `526px`, `526px`, `526px`, ``],
  [`hidden`, `hidden`, `fixed`, ``, ``, ``, ``],
])(
  `pane cap with outer overflow-y: %s, card overflow-y: %s, viewer %s`,
  async (
    outer_y,
    card_y,
    viewer_position,
    clamp,
    shrunk_clamp,
    tight_clamp,
    fullscreen_clamp,
  ) => {
    mock_fullscreen()
    vi.stubGlobal(`innerWidth`, 1000)
    vi.stubGlobal(`innerHeight`, 700)
    const target = mount_in_test(ViewerPane, {
      pane_name: `export`,
      class_prefix: `test-export`,
      closed_icon: Expand,
    })
    let shrink = 0
    const [outer, card] = [500, 600].map((bottom, idx) => {
      const host = document.createElement(`div`)
      host.style.overflowY = [outer_y, card_y][idx]
      vi.spyOn(host, `getBoundingClientRect`).mockImplementation(
        () => new DOMRect(0, 0, 800, bottom - shrink),
      )
      return host
    })
    document.body.append(outer)
    outer.append(card)
    card.append(target)
    document.body.style.overflowY = `hidden`
    onTestFinished(() => {
      outer.remove()
      document.body.style.overflowY = ``
      vi.unstubAllGlobals()
    })
    target.style.cssText = `position: ${viewer_position}; container-type: inline-size`
    // an absolute viewer's containing block is the outer host, past the card
    Object.defineProperty(target, `offsetParent`, { get: () => outer })
    vi.spyOn(target, `getBoundingClientRect`).mockReturnValue(new DOMRect(0, 50, 800, 400))
    flushSync()
    const pane = doc_query(`.test-export-pane`)
    const pane_clamp = () => pane.style.getPropertyValue(`--pane-viewport-clamp`)
    Object.defineProperty(pane, `offsetParent`, { get: () => target })
    vi.spyOn(pane, `getBoundingClientRect`).mockReturnValue(new DOMRect(400, 170, 300, 900))
    await fire(doc_query<HTMLButtonElement>(`.test-export-toggle`))
    expect(pane_clamp()).toBe(clamp)

    // the card is observed whenever it clips, so shrinking it re-caps the pane
    shrink = 50
    trigger_resize_observer(card)
    expect(pane_clamp()).toBe(shrunk_clamp)
    // a clipping edge just below the pane top is a hard limit: no 150px floor past it
    shrink = 400
    trigger_resize_observer(card)
    expect(pane_clamp()).toBe(tight_clamp)

    shrink = 0
    await outer.requestFullscreen()
    trigger_resize_observer(target)
    expect(pane_clamp()).toBe(fullscreen_clamp)
  },
)

test.each([
  [`hover`, true],
  [`never`, false],
  [{ hidden: [`controls`] }, false],
  [{ mode: `always`, hidden: [`fullscreen`] }, true],
] satisfies [ShowControlsProp, boolean][])(
  `ControlPane with show_controls=%j renders its toggle: %s`,
  (show_controls, shown) => {
    const target = mount_in_test(ControlPane, { show_controls, controls_name: `test` })
    flushSync()
    expect(target.querySelector(`.test-controls-toggle`) !== null).toBe(shown)
  },
)

// Closed panes cost nothing, but once opened their controls keep state across close/reopen
test(`ControlPane mounts children on first open and keeps them mounted`, async () => {
  const state = $state({ controls_open: false })
  const children = createRawSnippet(() => ({ render: () => `<input class="pane-input" />` }))
  mount_in_test(ControlPane, bind_props({ controls_name: `test`, children }, state))
  flushSync()
  const toggle = doc_query<HTMLButtonElement>(`.test-controls-toggle`)
  expect(document.querySelector(`.pane-input`)).toBeNull()

  await fire(toggle)
  expect([state.controls_open, toggle.getAttribute(`aria-expanded`)]).toEqual([true, `true`])
  const input = doc_query<HTMLInputElement>(`.pane-input`)
  input.value = `edited`

  await fire(toggle)
  expect([state.controls_open, toggle.getAttribute(`aria-expanded`)]).toEqual([false, `false`])
  state.controls_open = true
  flushSync()
  expect(doc_query<HTMLInputElement>(`.pane-input`)).toBe(input)
  expect(input.value).toBe(`edited`)
})
