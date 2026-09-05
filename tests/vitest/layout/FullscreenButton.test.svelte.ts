import { mock_fullscreen } from '../setup'
import FullscreenButton from '$lib/layout/FullscreenButton.svelte'
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

// Mount with a two-way bound `fullscreen` flag like every viewer does
const mount_button = (wrapper?: HTMLElement) => {
  const state = $state({ fullscreen: false })
  const on_change = vi.fn<(fullscreen: boolean) => void>()
  mounted.push(
    mount(FullscreenButton, {
      target: document.body,
      props: {
        wrapper,
        on_change,
        get fullscreen() {
          return state.fullscreen
        },
        set fullscreen(next: boolean) {
          state.fullscreen = next
        },
      },
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
    const wrapper = document.createElement(`div`)
    document.body.append(wrapper)
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

    // Esc/F11: the browser leaves fullscreen, the flag follows and the host is told once
    Object.defineProperty(document, `fullscreenElement`, { configurable: true, value: null })
    document.dispatchEvent(new Event(`fullscreenchange`))
    await tick()
    expect(state.fullscreen).toBe(false)
    expect(on_change.mock.calls).toEqual([[true], [false]])
  })

  // a host app (e.g. a slide deck) owning fullscreen around an embedded viewer
  test(`fullscreen owned by another element is neither reported nor taken over`, async () => {
    const host = document.createElement(`div`)
    const wrapper = document.createElement(`div`)
    host.append(wrapper)
    document.body.append(host)
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
  ])(`%s`, async (_name, init, toggles) => {
    const wrapper = document.createElement(`div`)
    document.body.append(wrapper)
    const { state } = mount_button(wrapper)
    wrapper.dispatchEvent(new PointerEvent(`pointerenter`))
    globalThis.dispatchEvent(new KeyboardEvent(`keydown`, init))
    await tick()
    expect(state.fullscreen).toBe(toggles)
  })

  test(`f is ignored until the pointer is over the viewer`, async () => {
    const wrapper = document.createElement(`div`)
    document.body.append(wrapper)
    const { state } = mount_button(wrapper)
    globalThis.dispatchEvent(new KeyboardEvent(`keydown`, { key: `f` }))
    await tick()
    expect(state.fullscreen).toBe(false)
  })

  // A Structure inside a Trajectory is hovered at the same time as its host, so both would
  // fullscreen their own root on one press. The inner viewer defers; its button still works.
  test(`a viewer nested in another leaves f to the outer one`, async () => {
    const outer = document.createElement(`div`)
    const inner = document.createElement(`div`)
    outer.append(inner)
    document.body.append(outer)
    const host = mount_button(outer)
    const nested = mount_button(inner)

    for (const node of [outer, inner]) node.dispatchEvent(new PointerEvent(`pointerenter`))
    globalThis.dispatchEvent(new KeyboardEvent(`keydown`, { key: `f` }))
    await tick()
    expect([host.state.fullscreen, nested.state.fullscreen]).toEqual([true, false])
  })
})
