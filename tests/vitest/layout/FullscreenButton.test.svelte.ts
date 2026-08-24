import FullscreenButton from '$lib/layout/FullscreenButton.svelte'
import { flushSync, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'

// Mount with a two-way bound `fullscreen` flag like every viewer does
const mount_button = (wrapper?: HTMLElement) => {
  const state = $state({ fullscreen: false })
  const on_change = vi.fn<(fullscreen: boolean) => void>()
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
  })
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
})
