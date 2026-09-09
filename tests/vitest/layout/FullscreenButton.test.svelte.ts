import { fire, bind_props, mock_fullscreen, mount_sized } from '../setup'
import FullscreenButton from '$lib/layout/FullscreenButton.svelte'
import ScatterPlot from '$lib/plot/scatter/ScatterPlot.svelte'
import Sankey from '$lib/plot/sankey/Sankey.svelte'
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

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
  if (!(button instanceof HTMLButtonElement)) throw new Error(`fullscreen button missing`)
  return { state, on_change, button }
}

describe(`FullscreenButton`, () => {
  test(`without a wrapper the flag is the state and every flip is reported`, async () => {
    const { state, on_change, button } = mount_button()
    expect(button.getAttribute(`aria-pressed`)).toBe(`false`)
    expect(button.title).toBe(`Enter fullscreen`)
    button.click()
    flushSync()
    await tick()
    expect(state.fullscreen).toBe(true)
    expect(button.getAttribute(`aria-pressed`)).toBe(`true`)
    expect(button.title).toBe(`Exit fullscreen`)
    button.click()
    flushSync()
    await tick()
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
    expect(button.style.display).toBe(`none`)
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
      const state = $state({ fullscreen: false, show_controls: true, fullscreen_toggle: true })
      const plot =
        kind === `cartesian`
          ? await mount_sized(
              ScatterPlot,
              bind_props({ series: [{ x: [0, 1], y: [0, 1] }] }, state),
              { selector: `.scatter`, on_mount: (component) => mounted.push(component) },
            )
          : await mount_sized(
              Sankey,
              bind_props(
                {
                  data: {
                    nodes: [{ label: `A` }, { label: `B` }],
                    links: [{ source: 0, target: 1, value: 1 }],
                  },
                },
                state,
              ),
              { selector: `.sankey`, on_mount: (component) => mounted.push(component) },
            )
      const button = () => plot.querySelector<HTMLButtonElement>(`.fullscreen-btn`)
      for (const key of [`show_controls`, `fullscreen_toggle`] as const) {
        state[key] = true
        flushSync()
        button()?.click()
        await vi.waitFor(() => expect(document.fullscreenElement).toBe(plot))
        state[key] = false
        flushSync()
        expect(button()?.style.display).toBe(`none`)
        await document.exitFullscreen()
        flushSync()
        expect(state.fullscreen).toBe(false)
        expect(plot.classList.contains(`fullscreen`)).toBe(false)
        expect(button()).toBeNull()
        state[key] = true
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

  // `f` is the one fullscreen shortcut across every viewer, claimed only while the pointer
  // is over that viewer. Chords stay with the browser, notably Cmd/Ctrl+F for find-in-page.
  test.each([
    [`plain f toggles`, { key: `f` }, true],
    [`Cmd+F stays find-in-page`, { key: `f`, metaKey: true }, false],
    [`Ctrl+F stays find-in-page`, { key: `f`, ctrlKey: true }, false],
    [`Alt+F is left alone`, { key: `f`, altKey: true }, false],
    [`an autorepeat does not re-toggle`, { key: `f`, repeat: true }, false],
    [`other keys are ignored`, { key: `g` }, false],
    [`f outside the viewer is ignored`, { key: `f` }, false, false],
  ])(`%s`, async (_name, init, toggles, hovered = true) => {
    const wrapper = create_wrapper()
    const { state } = mount_button(wrapper)
    if (hovered) wrapper.dispatchEvent(new PointerEvent(`pointerenter`))
    await fire(globalThis, new KeyboardEvent(`keydown`, init))
    expect(state.fullscreen).toBe(toggles)
  })

  // A Structure inside a Trajectory is hovered at the same time as its host, so both would
  // fullscreen their own root on one press. The inner viewer defers; its button still works.
  test(`a viewer nested in another leaves f to the outer one`, async () => {
    const outer = create_wrapper()
    const inner = create_wrapper(outer)
    const host = mount_button(outer)
    const nested = mount_button(inner)

    for (const node of [outer, inner]) node.dispatchEvent(new PointerEvent(`pointerenter`))
    await fire(globalThis, new KeyboardEvent(`keydown`, { key: `f` }))
    expect([host.state.fullscreen, nested.state.fullscreen]).toEqual([true, false])
  })
})
