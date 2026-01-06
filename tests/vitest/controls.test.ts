// Unit tests for controls visibility configuration
import { describe, expect, it } from 'vitest'
import { normalize_show_controls } from '$lib/controls'

describe(`normalize_show_controls`, () => {
  it(`returns hover mode with empty hidden set when undefined`, () => {
    const config = normalize_show_controls(undefined)
    expect(config.mode).toBe(`hover`)
    expect(config.hidden.size).toBe(0)
    expect(config.style).toBeUndefined()
    expect(config.class).toBe(`hover-visible`)
  })

  it.each([
    // Boolean inputs
    [true, `always`, `always-visible`],
    [false, `never`, ``],
    // String inputs
    [`always` as const, `always`, `always-visible`],
    [`hover` as const, `hover`, `hover-visible`],
    [`never` as const, `never`, ``],
    // Object inputs
    [{}, `hover`, `hover-visible`],
    [{ mode: `always` as const }, `always`, `always-visible`],
    [{ mode: `never` as const }, `never`, ``],
  ])(`maps %j to mode=%s, class=%s`, (input, expected_mode, expected_class) => {
    const config = normalize_show_controls(
      input as Parameters<typeof normalize_show_controls>[0],
    )
    expect(config.mode).toBe(expected_mode)
    expect(config.class).toBe(expected_class)
  })

  it(`preserves style and hidden from object config`, () => {
    const config = normalize_show_controls({
      mode: `always`,
      hidden: [`controls`, `fullscreen`],
      style: `top: 10px;`,
    })
    expect(config.style).toBe(`top: 10px;`)
    expect(config.hidden).toEqual(new Set([`controls`, `fullscreen`]))
  })

  it.each([
    // [hidden_controls, control_to_check, expected_visible]
    [[`fullscreen`], `fullscreen`, false],
    [[`fullscreen`], `reset-camera`, true],
    [[`a`, `b`], `a`, false],
    [[`a`, `b`], `c`, true],
    [[], `any-control`, true],
  ])(`visible() with hidden=%j returns %s for %s`, (hidden, control, expected) => {
    const config = normalize_show_controls({ hidden })
    expect(config.visible(control)).toBe(expected)
  })
})
