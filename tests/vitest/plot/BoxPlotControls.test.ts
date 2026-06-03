import { BoxPlotControls } from '$lib/plot'
import { mount, tick } from 'svelte'
import { describe, expect, test } from 'vitest'

describe(`BoxPlotControls`, () => {
  const checkbox_by_label = (label: string): HTMLInputElement | undefined =>
    [...document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"]`)].find((box) =>
      box.parentElement?.textContent?.includes(label),
    )

  test(`Box / Violin reset reverts changed settings to defaults`, async () => {
    mount(BoxPlotControls, {
      target: document.body,
      props: { show_controls: true, controls_open: true },
    })

    const mean = checkbox_by_label(`Show mean`)
    const outliers = checkbox_by_label(`Show outliers`)
    if (!mean || !outliers) throw new Error(`box/violin controls not found`)
    expect([mean.checked, outliers.checked]).toEqual([false, true])

    // flip both settings so the section's reset button appears
    mean.click()
    outliers.click()
    await tick()
    expect([mean.checked, outliers.checked]).toEqual([true, false])

    const heading = [...document.querySelectorAll(`h4`)].find((el) =>
      el.textContent?.includes(`Box / Violin`),
    )
    const reset_btn = heading?.querySelector<HTMLButtonElement>(`button.reset-button`)
    // a missing/no-op reset (the original bug) would leave the flipped values in place
    if (!reset_btn) throw new Error(`reset button not rendered`)
    reset_btn.click()
    await tick()

    expect([mean.checked, outliers.checked]).toEqual([false, true])
  })
})
