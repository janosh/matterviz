// Unit tests for controls visibility configuration
import { describe, expect, it } from 'vitest'
import { normalize_show_controls, track_settings } from '$lib/controls'

describe(`normalize_show_controls`, () => {
  it(`returns hover mode with every control visible when undefined`, () => {
    const config = normalize_show_controls(undefined)
    expect(config.mode).toBe(`hover`)
    expect(config.visible(`fullscreen`)).toBe(true)
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
    const config = normalize_show_controls(input)
    expect(config.mode).toBe(expected_mode)
    expect(config.class).toBe(expected_class)
    expect(config.visible(`controls`)).toBe(expected_mode !== `never`)
  })

  it(`preserves style and hidden from object config`, () => {
    const config = normalize_show_controls({
      mode: `always`,
      hidden: [`controls`, `fullscreen`],
      style: `top: 10px;`,
    })
    expect(config.style).toBe(`top: 10px;`)
    expect([`controls`, `fullscreen`, `info-pane`].map(config.visible)).toEqual([
      false,
      false,
      true,
    ])
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

describe(`track_settings`, () => {
  it(`captures nested settings, restores independent copies and distinguishes absent keys`, () => {
    const values: Record<string, unknown> = {
      range: [0, 10],
      nested: { opacity: 0.5 },
      optional: undefined,
    }
    const tracked = track_settings(() => values)
    expect(tracked.changed_keys).toEqual([])
    ;(values.range as number[])[1] = 20
    values.nested = { opacity: 1 }
    values.added = undefined
    expect(tracked.changed_keys).toEqual([`range`, `nested`, `added`])
    const initial = tracked.initial
    for (const key of tracked.changed_keys) {
      if (Object.hasOwn(initial, key)) values[key] = initial[key]
      else Reflect.deleteProperty(values, key)
    }
    expect(tracked.changed_keys).toEqual([])
    expect(Object.hasOwn(values, `optional`)).toBe(true)
    expect(Object.hasOwn(values, `added`)).toBe(false)
    ;(values.range as number[])[0] = -1
    expect(tracked.changed_keys).toEqual([`range`])
    delete values.nested
    expect(tracked.changed_keys).toEqual([`range`, `nested`])
    values.nested = tracked.initial.nested
    expect(values.nested).toEqual({ opacity: 0.5 })
  })

  it.each([
    [{ min: 0, max: 1 }, { max: 1, min: 0 }, false],
    [[0, 1], [1, 0], true],
    [new Date(0), new Date(0), false],
    [new Date(0), new Date(1), true],
    [NaN, NaN, false],
    [null, undefined, true],
    [[], Object.assign([], { length: 2 }), true],
    [{}, new Map(), true],
    [{}, /pattern/, true],
    [{}, Object.create({ setting: true }), true],
  ])(`compares %j against %j (changed=%s)`, (initial, current, changed) => {
    const values: { value: unknown } = { value: initial }
    const tracked = track_settings(() => values)
    values.value = current
    expect(tracked.changed_keys).toEqual(changed ? [`value`] : [])
  })

  it(`compares only visible keys against caller-provided defaults`, () => {
    const values = { color: `blue` }
    const defaults = { color: `red`, hidden: true }
    const tracked = track_settings(() => values, defaults)
    defaults.color = `green`
    expect(tracked.changed_keys).toEqual([`color`])
    values.color = String(tracked.initial.color)
    expect(values.color).toBe(`red`)
    expect(tracked.changed_keys).toEqual([])
  })
})
