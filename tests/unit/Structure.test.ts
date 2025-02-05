import { Structure } from '$lib'
import { structures } from '$site'
import { mount, tick } from 'svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { doc_query } from '.'

const structure = structures[0]

// Skip tests that require WebGL context
describe.skip(`Structure`, () => {
  let struct: ReturnType<typeof mount>

  beforeEach(() => {
    struct = mount(Structure, {
      target: document.body,
      props: { structure },
    })
  })

  test(`open control panel when clicking toggle button`, async () => {
    expect(struct.$state.controls_open).toBe(false)
    doc_query(`button.controls-toggle`).click()
    await tick()
    expect(struct.$state.controls_open).toBe(true)
  })

  test(`JSON file download when clicking download button`, async () => {
    window.URL.createObjectURL = vi.fn()

    mount(Structure, {
      target: document.body,
      props: { structure },
    })

    const spy = vi.spyOn(document.body, `appendChild`)
    doc_query(`button.download-json`).click()

    expect(spy).toHaveBeenCalledWith(expect.any(HTMLAnchorElement))

    spy.mockRestore()
    // @ts-expect-error - function is mocked
    window.URL.createObjectURL.mockRestore()
  })

  test(`toggle fullscreen mode`, async () => {
    const requestFullscreenMock = vi.fn().mockResolvedValue(undefined)
    const exitFullscreenMock = vi.fn()

    struct.$nodes.wrapper = { requestFullscreen: requestFullscreenMock }
    document.exitFullscreen = exitFullscreenMock

    await struct.$state.toggle_fullscreen()
    expect(requestFullscreenMock).toHaveBeenCalledOnce()

    // Simulate fullscreen mode
    Object.defineProperty(document, `fullscreenElement`, {
      value: struct.$nodes.wrapper,
      configurable: true,
    })

    await struct.$state.toggle_fullscreen()
    expect(exitFullscreenMock).toHaveBeenCalledOnce()

    // Reset fullscreenElement
    Object.defineProperty(document, `fullscreenElement`, {
      value: null,
      configurable: true,
    })
  })
})
