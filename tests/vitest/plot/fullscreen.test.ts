import { BarPlot } from '$lib'
import { mount, tick } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'

describe(`Plot Fullscreen Toggle`, () => {
  afterEach(() => {
    // Reset mocked dimensions
    Object.defineProperty(HTMLElement.prototype, `clientWidth`, {
      configurable: true,
      value: 0,
    })
    Object.defineProperty(HTMLElement.prototype, `clientHeight`, {
      configurable: true,
      value: 0,
    })
  })

  test(`toggles fullscreen class and aria-label on button click`, async () => {
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
      props: { series: [{ x: [1], y: [1] }], fullscreen: false },
    })

    await tick()

    const plot_div = document.querySelector(`.bar-plot`)
    expect(plot_div).toBeTruthy()
    expect(plot_div?.classList.contains(`fullscreen`)).toBe(false)

    const toggle_btn = document.querySelector(
      `button.fullscreen-toggle`,
    ) as HTMLButtonElement
    expect(toggle_btn).toBeTruthy()
    expect(toggle_btn.getAttribute(`aria-label`)).toBe(`Enter fullscreen`)

    // Click to enter fullscreen
    toggle_btn.click()
    await tick()

    expect(plot_div?.classList.contains(`fullscreen`)).toBe(true)
    expect(toggle_btn.getAttribute(`aria-label`)).toBe(`Exit fullscreen`)

    // Click again to exit fullscreen
    toggle_btn.click()
    await tick()

    expect(plot_div?.classList.contains(`fullscreen`)).toBe(false)
    expect(toggle_btn.getAttribute(`aria-label`)).toBe(`Enter fullscreen`)
  })
})
