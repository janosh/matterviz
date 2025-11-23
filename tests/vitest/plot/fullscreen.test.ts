import { BarPlot } from '$lib'
import { mount, tick } from 'svelte'
import { describe, expect, test } from 'vitest'

describe(`Plot Fullscreen Toggle`, () => {
  test(`toggles fullscreen class on button click`, async () => {
    // Mock client dimensions to ensure content renders
    Object.defineProperty(HTMLElement.prototype, `clientWidth`, {
      configurable: true,
      value: 500,
    })
    Object.defineProperty(HTMLElement.prototype, `clientHeight`, {
      configurable: true,
      value: 300,
    })

    mount(BarPlot, {
      target: document.body,
      props: { series: [{ x: [1], y: [1] }] },
    })

    // Trigger a flush/tick? Svelte 5 mount might be sync or async.
    // In Svelte 5, effects run asynchronously. We might need `await tick()`?
    // But `mount` is synchronous.

    // Wait for next tick to allow effect to update width/height if needed?
    // With defined properties, the binding might pick it up.
    await tick()

    const plotDiv = document.querySelector(`.bar-plot`)
    expect(plotDiv).toBeTruthy()
    expect(plotDiv?.classList.contains(`fullscreen`)).toBe(false)

    const toggle_btn = document.querySelector(
      `button.fullscreen-toggle`,
    ) as HTMLButtonElement
    expect(toggle_btn).toBeTruthy()

    // Click the button
    toggle_btn.click()
    await tick()

    expect(plotDiv?.classList.contains(`fullscreen`)).toBe(true)
    expect(toggle_btn.getAttribute(`aria-label`)).toBe(`Exit fullscreen`)

    // Click again to exit
    toggle_btn.click()
    await tick()

    expect(plotDiv?.classList.contains(`fullscreen`)).toBe(false)
    expect(toggle_btn.getAttribute(`aria-label`)).toBe(`Enter fullscreen`)

    // cleanup happens in afterEach but we should ensure mocks are reset
    Object.defineProperty(HTMLElement.prototype, `clientWidth`, {
      configurable: true,
      value: 0,
    })
    Object.defineProperty(HTMLElement.prototype, `clientHeight`, {
      configurable: true,
      value: 0,
    })
  })

  test(`fullscreen state is bound`, async () => {
    // Mock dimensions
    Object.defineProperty(HTMLElement.prototype, `clientWidth`, {
      configurable: true,
      value: 500,
    })
    Object.defineProperty(HTMLElement.prototype, `clientHeight`, {
      configurable: true,
      value: 300,
    })

    const fullscreen = false
    mount(BarPlot, {
      target: document.body,
      props: { series: [{ x: [1], y: [1] }], fullscreen },
    })

    // Wait for mount and size update
    await new Promise((r) => setTimeout(r, 10))

    const plotDiv = document.querySelector(`.bar-plot`)
    expect(plotDiv?.classList.contains(`fullscreen`)).toBe(false)

    const toggle_btn = document.querySelector(
      `button.fullscreen-toggle`,
    ) as HTMLButtonElement
    expect(toggle_btn).toBeTruthy()
    toggle_btn.click()
    await tick()
    expect(plotDiv?.classList.contains(`fullscreen`)).toBe(true)
  })
})
