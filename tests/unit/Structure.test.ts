import { Structure } from '$lib'
import { structures } from '$site'
import { tick } from 'svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { doc_query } from '.'

const structure = structures[0]

describe(`Structure`, () => {
  let struct: Structure

  beforeEach(() => {
    struct = new Structure({
      target: document.body,
      props: { structure },
    })
  })

  test(`open control panel when clicking toggle button`, async () => {
    expect(struct.controls_open).toBe(false)
    doc_query(`button.controls-toggle`).click()
    await tick()

    expect(struct.controls_open).toBe(true)
  })

  test(`JSON file download when clicking download button`, async () => {
    window.URL.createObjectURL = vi.fn()

    const struct = new Structure({
      target: document.body,
      props: { structure },
    })
    const spy = vi.spyOn(document.body, `appendChild`)

    doc_query(`button[title='${struct.save_json_btn_text}']`).click()
    await tick()

    expect(window.URL.createObjectURL).toHaveBeenCalledOnce()
    expect(window.URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(spy).toHaveBeenCalledOnce()
    expect(spy).toHaveBeenCalledWith(expect.any(HTMLAnchorElement))

    spy.mockRestore()
    // @ts-expect-error - function is mocked
    window.URL.createObjectURL.mockRestore()
  })

  test(`toggle fullscreen mode`, async () => {
    const requestFullscreenMock = vi.fn().mockResolvedValue(undefined)
    const exitFullscreenMock = vi.fn()

    struct.wrapper = { requestFullscreen: requestFullscreenMock }
    document.exitFullscreen = exitFullscreenMock

    await struct.toggle_fullscreen()
    expect(requestFullscreenMock).toHaveBeenCalledOnce()

    // Simulate fullscreen mode
    Object.defineProperty(document, `fullscreenElement`, {
      value: struct.wrapper,
      configurable: true,
    })

    await struct.toggle_fullscreen()
    expect(exitFullscreenMock).toHaveBeenCalledOnce()

    // Reset fullscreenElement
    Object.defineProperty(document, `fullscreenElement`, {
      value: null,
      configurable: true,
    })
  })
})
