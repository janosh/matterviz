import { fire, bind_props, mock_fullscreen, mount_in_test, mount_sized } from '../setup'
import { normalize_show_controls, type ShowControlsProp } from '#lib/controls'
import FullscreenButton from '#lib/layout/FullscreenButton.svelte'
import PanelsFullscreenButton from '#lib/layout/PanelsFullscreenButton.svelte'
import ViewerChrome from '#lib/layout/ViewerChrome.svelte'
import ScatterPlot from '#lib/plot/scatter/ScatterPlot.svelte'
import Sankey from '#lib/plot/sankey/Sankey.svelte'
import { createRawSnippet, flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, type Mock, test, vi } from 'vite-plus/test'

// Buttons keep a window keydown listener for the `f` shortcut, so one left mounted would
// answer a later test's keypress and fullscreen its own stale wrapper
const mounted: ReturnType<typeof mount>[] = []
beforeEach(() => mock_fullscreen())
afterEach(async () => {
  for (const component of mounted.splice(0)) await unmount(component)
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

const create_wrapper = (parent = document.body) => {
  const wrapper = document.createElement(`div`)
  parent.append(wrapper)
  return wrapper
}

// Mount with a two-way bound `fullscreen` flag like every viewer does
const mount_button = (wrapper?: HTMLElement) => {
  const state = $state({ fullscreen: false, hidden: false })
  const on_change = vi.fn<(fullscreen: boolean) => void>()
  mounted.push(
    mount(FullscreenButton, {
      target: document.body,
      props: bind_props({ wrapper, on_change }, state),
    }),
  )
  flushSync()
  const button = document.querySelector(`button.fullscreen-btn`)
  if (!(button instanceof HTMLButtonElement)) throw new TypeError(`fullscreen button missing`)
  return { state, on_change, button }
}

describe(`FullscreenButton`, () => {
  test(`without a wrapper the flag is the state and every flip is reported`, async () => {
    const { state, on_change, button } = mount_button()
    const view_box = () => button.querySelector(`svg`)?.getAttribute(`viewBox`)
    expect(button.getAttribute(`aria-pressed`)).toBe(`false`)
    // no wrapper, so no key to advertise
    expect(button.title).toBe(`Enter fullscreen`)
    expect(button.hasAttribute(`aria-keyshortcuts`)).toBe(false)
    const enter_view_box = view_box()
    button.click()
    flushSync()
    await tick()
    expect(state.fullscreen).toBe(true)
    expect(button.getAttribute(`aria-pressed`)).toBe(`true`)
    expect(button.title).toBe(`Exit fullscreen`)
    expect(view_box()).not.toBe(enter_view_box) // the icon swaps to the exit glyph
    button.click()
    flushSync()
    await tick()
    expect(state.fullscreen).toBe(false)
    expect(on_change.mock.calls).toEqual([[true], [false]])
  })

  test(`with a wrapper only real browser transitions are reported`, async () => {
    const wrapper = create_wrapper()
    vi.spyOn(console, `error`).mockImplementation(() => undefined)
    const request_fullscreen = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error(`denied`))
    wrapper.requestFullscreen = request_fullscreen
    const { state, on_change, button } = mount_button(wrapper)

    // rejected request: the flag flips back and the host hears nothing
    button.click()
    await vi.waitFor(() => expect(request_fullscreen).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(state.fullscreen).toBe(false))
    expect(on_change).not.toHaveBeenCalled()

    // granted request (the setup's requestFullscreen stub fires fullscreenchange)
    request_fullscreen.mockImplementation(() =>
      HTMLElement.prototype.requestFullscreen.call(wrapper),
    )
    button.click()
    await vi.waitFor(() => expect(on_change).toHaveBeenLastCalledWith(true))
    expect(document.fullscreenElement).toBe(wrapper)

    // A hidden active controller still observes exit, but has neither a button nor shortcut.
    state.hidden = true
    flushSync()
    expect(button.hidden).toBe(true)
    wrapper.dispatchEvent(new PointerEvent(`pointerenter`))
    await fire(globalThis, new KeyboardEvent(`keydown`, { key: `f` }))
    expect(state.fullscreen).toBe(true)

    // Esc/F11: the browser leaves fullscreen, the flag follows and the host is told once
    Object.defineProperty(document, `fullscreenElement`, { configurable: true, value: null })
    await fire(document, new Event(`fullscreenchange`))
    expect(state.fullscreen).toBe(false)
    expect(on_change.mock.calls).toEqual([[true], [false]])
  })

  test.each([`cartesian`, `chart`] as const)(
    `%s keeps an active fullscreen controller when chrome hides, then removes it on exit`,
    async (kind) => {
      const state = $state<{
        fullscreen: boolean
        show_controls: ShowControlsProp<`fullscreen`>
      }>({
        fullscreen: false,
        show_controls: true,
      })
      const on_mount = (component: ReturnType<typeof mount>) => void mounted.push(component)
      const sankey_data = {
        nodes: [{ label: `A` }, { label: `B` }],
        links: [{ source: 0, target: 1, value: 1 }],
      }
      const series = [{ x: [0, 1], y: [0, 1] }]
      const plot =
        kind === `cartesian`
          ? await mount_sized(ScatterPlot, bind_props({ series }, state), {
              selector: `.scatter`,
              on_mount,
            })
          : await mount_sized(Sankey, bind_props({ data: sankey_data }, state), {
              selector: `.sankey`,
              on_mount,
            })
      const button = () => plot.querySelector<HTMLButtonElement>(`.fullscreen-btn`)
      for (const hidden of [false, { hidden: [`fullscreen` as const] }]) {
        state.show_controls = true
        flushSync()
        button()?.click()
        await vi.waitFor(() => expect(document.fullscreenElement).toBe(plot))
        state.show_controls = hidden
        flushSync()
        expect(button()?.hidden).toBe(true)
        await document.exitFullscreen()
        flushSync()
        expect(state.fullscreen).toBe(false)
        expect(plot.classList.contains(`fullscreen`)).toBe(false)
        expect(button()).toBeNull()
      }
      // An external request still works while chrome starts hidden.
      state.show_controls = false
      state.fullscreen = true
      flushSync()
      await vi.waitFor(() => expect(document.fullscreenElement).toBe(plot))
      expect(button()?.hidden).toBe(true)
      await document.exitFullscreen()
      flushSync()
      expect(button()).toBeNull()
    },
  )

  // a host app (e.g. a slide deck) owning fullscreen around an embedded viewer
  test(`fullscreen owned by another element is neither reported nor taken over`, async () => {
    const host = create_wrapper()
    const wrapper = create_wrapper(host)
    const exit_fullscreen = vi.spyOn(document, `exitFullscreen`)
    const { state, on_change } = mount_button(wrapper)

    // mounting inside an already-fullscreen host leaves it alone
    await host.requestFullscreen()
    await tick()
    expect(document.fullscreenElement).toBe(host)
    expect(state.fullscreen).toBe(false)
    expect(on_change).not.toHaveBeenCalled()
    expect(exit_fullscreen).not.toHaveBeenCalled()
  })

  // `f` (svelte-widgets' hotkey, tested there) is the one fullscreen shortcut of every viewer
  test(`plain f fullscreens the hovered viewer and flashes its button`, async () => {
    const wrapper = create_wrapper()
    const { state, button } = mount_button(wrapper)
    wrapper.dispatchEvent(new PointerEvent(`pointerenter`))
    await fire(globalThis, new KeyboardEvent(`keydown`, { key: `f` }))
    expect(state.fullscreen).toBe(true)
    expect(button.style.boxShadow).toContain(`1px`)
    expect([button.title, button.getAttribute(`aria-keyshortcuts`)]).toEqual([
      `Exit fullscreen (F)`,
      `F`,
    ])
  })
})

// The two wrappers every viewer and multi-panel component use around FullscreenButton. Each
// mounts with a bound `fullscreen` and returns its on-change spy, if it takes one.
type MountChrome = (
  show_controls: ShowControlsProp,
  state: { fullscreen: boolean },
) => Mock<(fullscreen: boolean) => void> | null
describe.each([
  [
    `ViewerChrome`,
    (show_controls, state) => {
      const on_fullscreen_change = vi.fn<(fullscreen: boolean) => void>()
      const controls_config = normalize_show_controls(show_controls)
      const props = {
        controls_config,
        on_fullscreen_change,
        wrapper: create_wrapper(),
      }
      mount_in_test(ViewerChrome, bind_props(props, state))
      return on_fullscreen_change
    },
  ],
  [
    `PanelsFullscreenButton`,
    (controls, state) => {
      const props = { controls, wrapper: create_wrapper() }
      mount_in_test(PanelsFullscreenButton, bind_props(props, state))
      return null
    },
  ],
] satisfies [string, MountChrome][])(`%s fullscreen toggle`, (_name, mount_chrome) => {
  test.each([
    [`hover`, false, `shown`],
    [{ hidden: [`fullscreen`] }, false, `absent`],
    // hidden chrome keeps the active controller mounted so Esc still syncs the flag
    [{ hidden: [`fullscreen`] }, true, `hidden`],
    [`never`, true, `hidden`],
  ] satisfies [ShowControlsProp, boolean, `shown` | `hidden` | `absent`][])(
    `show_controls=%j fullscreen=%s: button %s`,
    async (show_controls, fullscreen, expected) => {
      const state = $state({ fullscreen })
      const on_change = mount_chrome(show_controls, state)
      flushSync()
      const button = document.querySelector<HTMLButtonElement>(`button.fullscreen-btn`)
      expect(!button ? `absent` : button.hidden ? `hidden` : `shown`).toBe(expected)
      if (expected !== `shown`) return
      await fire(button)
      expect(state.fullscreen).toBe(true)
      if (on_change) expect(on_change.mock.calls).toEqual([[true]])
    },
  )
})

test.each([
  [`hover`, true, true],
  [{ hidden: [`filename`] }, false, true],
  [`never`, false, false],
] satisfies [ShowControlsProp, boolean, boolean][])(
  `ViewerChrome with show_controls=%j: filename %s, viewer controls %s`,
  (show_controls, filename_shown, children_shown) => {
    const target = mount_in_test(ViewerChrome, {
      controls_config: normalize_show_controls(show_controls),
      filename: `cell.cif`,
      children: createRawSnippet(() => ({ render: () => `<button class="extra">x</button>` })),
    })
    flushSync()
    expect(target.querySelector(`.filename`)?.textContent ?? null).toBe(
      filename_shown ? `cell.cif` : null,
    )
    expect(target.querySelector(`.extra`) !== null).toBe(children_shown)
  },
)
