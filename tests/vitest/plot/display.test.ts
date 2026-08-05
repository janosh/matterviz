import { resolve_plot_display, sync_category_zero_display } from '$lib/plot/core/display'
import type { DisplayConfig } from '$lib/plot/core/types'
import { DEFAULTS } from '$lib/settings'
import { describe, expect, test } from 'vitest'

describe(`resolve_plot_display`, () => {
  test.each([`x`, `y`] as const)(
    `turns off unset %s category zero lines while keeping value-axis defaults`,
    (axis) => {
      const display: DisplayConfig = {}
      const resolved = resolve_plot_display(display, DEFAULTS.bar.display, axis)
      if (axis === `x`) {
        expect(resolved).toMatchObject({
          x_zero_line: false,
          x2_zero_line: false,
          y_zero_line: true,
        })
      } else {
        expect(resolved).toMatchObject({
          x_zero_line: true,
          y_zero_line: false,
          y2_zero_line: false,
        })
      }
    },
  )

  test(`preserves partial overrides and fills value-axis defaults`, () => {
    const display: DisplayConfig = { x_grid: false }
    expect(resolve_plot_display(display, DEFAULTS.bar.display, `x`)).toMatchObject({
      x_grid: false,
      x_zero_line: false,
      y_zero_line: true,
    })
  })

  test(`honors explicit category zero line enable`, () => {
    expect(
      resolve_plot_display({ x_zero_line: true }, DEFAULTS.bar.display, `x`).x_zero_line,
    ).toBe(true)
  })

  test(`leaves numeric plots at library defaults`, () => {
    expect(resolve_plot_display({}, DEFAULTS.bar.display, null)).toMatchObject({
      x_zero_line: true,
      y_zero_line: true,
    })
  })
})

describe(`sync_category_zero_display`, () => {
  test(`clears category zeros and restores them on orientation flip`, () => {
    const display = { ...DEFAULTS.bar.display }
    const after_vertical = sync_category_zero_display(
      display,
      DEFAULTS.bar.display,
      `x`,
      null,
    )
    expect(after_vertical).toBe(`x`)
    expect(display.x_zero_line).toBe(false)
    expect(display.y_zero_line).toBe(true)

    sync_category_zero_display(display, DEFAULTS.bar.display, `y`, after_vertical)
    expect(display.x_zero_line).toBe(true)
    expect(display.y_zero_line).toBe(false)
  })

  test(`is a no-op when the category axis is unchanged`, () => {
    const display = { ...DEFAULTS.bar.display, x_zero_line: true }
    expect(sync_category_zero_display(display, DEFAULTS.bar.display, `x`, `x`)).toBe(`x`)
    expect(display.x_zero_line).toBe(true)
  })

  test(`leaves explicit category zero enables alone on first mount`, () => {
    const display: DisplayConfig = { x_zero_line: true, y_zero_line: false }
    sync_category_zero_display(display, DEFAULTS.bar.display, `x`, null)
    expect(display.x_zero_line).toBe(true)
  })
})
