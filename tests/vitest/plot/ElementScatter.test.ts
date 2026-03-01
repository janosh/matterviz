import { ElementScatter } from '$lib'
import { mount, tick } from 'svelte'
import { describe, expect, test } from 'vitest'

// Atomic radii for first 10 elements (H through Ne)
const y_values = [53, 31, 167, 112, 87, 77, 75, 73, 71, 69]

describe(`ElementScatter`, () => {
  const tooltip_text = async (
    props: Record<string, unknown>,
  ): Promise<string> => {
    document.body.replaceChildren()
    mount(ElementScatter, {
      target: document.body,
      props: { y: y_values, hovered: true, ...props },
    })
    await tick()
    return document.querySelector(`.plot-tooltip`)?.textContent ?? ``
  }

  test(`tooltip shows atomic number, symbol, and name`, async () => {
    const text = await tooltip_text({
      tooltip_point: { x: 6, y: 77, series_idx: 0, point_idx: 5 },
    })
    // should contain "6 C - Carbon" (number, symbol, separator, name)
    expect(text).toMatch(/6\s+C\s+-\s+Carbon/)
  })

  test(`tooltip shows y-axis label + unit, falls back to "Value"`, async () => {
    const with_label = await tooltip_text({
      y_axis: { label: `Atomic Radius` },
      y_unit: ` pm`,
      tooltip_point: { x: 1, y: 53, series_idx: 0, point_idx: 0 },
    })
    expect(with_label).toContain(`Atomic Radius`)
    expect(with_label).toContain(`pm`)

    const without = await tooltip_text({
      tooltip_point: { x: 1, y: 53, series_idx: 0, point_idx: 0 },
    })
    expect(without).toContain(`Value`)
  })

  test(`renders without errors`, () => {
    mount(ElementScatter, {
      target: document.body,
      props: { y: y_values },
    })
    expect(document.querySelector(`.scatter`)).toBeTruthy()
  })
})
