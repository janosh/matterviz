import { resolve_plot_display, sync_category_zero_display } from '$lib/plot/core/display'
import { DEFAULTS } from '$lib/settings'
import { describe, expect, test } from 'vitest'

describe(`resolve_plot_display`, () => {
  test.each([
    [`x category`, {}, `x`, { x_zero_line: false, x2_zero_line: false, y_zero_line: true }],
    [`y category`, {}, `y`, { x_zero_line: true, y_zero_line: false, y2_zero_line: false }],
    [
      `partial override`,
      { x_grid: false },
      `x`,
      { x_grid: false, x_zero_line: false, y_zero_line: true },
    ],
    [`explicit category line`, { x_zero_line: true }, `x`, { x_zero_line: true }],
    [`numeric plot`, {}, null, { x_zero_line: true, y_zero_line: true }],
  ] as const)(`resolves %s`, (_case, display, axis, expected) => {
    expect(resolve_plot_display(display, DEFAULTS.plot.display, axis)).toMatchObject(expected)
  })
})

describe(`sync_category_zero_display`, () => {
  test(`restores only helper-owned category zeros on orientation flips`, () => {
    let display = { ...DEFAULTS.plot.display }
    let previous = sync_category_zero_display(display, DEFAULTS.plot.display, `x`, {
      axis: null,
      disabled_keys: [],
    })
    expect(display).toMatchObject({ x_zero_line: false, x2_zero_line: false })
    previous = sync_category_zero_display(display, DEFAULTS.plot.display, `y`, previous)
    expect(display).toMatchObject({
      x_zero_line: true,
      y_zero_line: false,
      y2_zero_line: false,
    })
    expect(display).toHaveProperty(`x2_zero_line`, undefined)

    display.x_zero_line = false
    previous = sync_category_zero_display(display, DEFAULTS.plot.display, `x`, previous)
    sync_category_zero_display(display, DEFAULTS.plot.display, `y`, previous)
    expect(display.x_zero_line).toBe(false)
    expect(display).toHaveProperty(`x2_zero_line`, undefined)

    display = { ...DEFAULTS.plot.display, x_zero_line: false }
    previous = sync_category_zero_display(display, DEFAULTS.plot.display, `x`, previous)
    sync_category_zero_display(display, DEFAULTS.plot.display, `y`, previous)
    expect(display.x_zero_line).toBe(false)
  })

  test.each([
    [`unchanged axis`, { ...DEFAULTS.plot.display, x_zero_line: true }, `x`],
    [`explicit first mount`, { x_zero_line: true, y_zero_line: false }, null],
  ] as const)(`preserves an explicit category line on %s`, (_case, display, axis) => {
    sync_category_zero_display(display, DEFAULTS.plot.display, `x`, {
      axis,
      disabled_keys: [],
    })
    expect(display.x_zero_line).toBe(true)
  })
})
