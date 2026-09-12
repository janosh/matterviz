// Unit tests for controls visibility configuration
import { describe, expect, expectTypeOf, it } from 'vitest'
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
      [`__proto__`]: { opacity: 0.5 },
    }
    const tracked = track_settings(() => values, `initial`)
    expect(tracked.changed_keys).toEqual([])
    ;(values.range as number[])[1] = 20
    values.nested = { opacity: 1 }
    values.added = undefined
    expect(tracked.changed_keys).toEqual([`range`, `nested`, `added`])
    const initial = tracked.snapshot(tracked.changed_keys)
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
    const nested_snapshot = tracked.snapshot([`nested`, `missing`])
    expect(nested_snapshot).toEqual({ nested: { opacity: 0.5 } })
    values.nested = nested_snapshot.nested
    expect(values.nested).toEqual({ opacity: 0.5 })
    ;(values.nested as { opacity: number }).opacity = 0.9
    expect(tracked.snapshot([`nested`])).toEqual({ nested: { opacity: 0.5 } })
    expect(tracked.snapshot([`optional`])).toEqual({ optional: undefined })
    const own_key_snapshot = tracked.snapshot([`__proto__`])
    expect(Object.hasOwn(own_key_snapshot, `__proto__`)).toBe(true)
    expect(Object.getPrototypeOf(own_key_snapshot)).toBe(Object.prototype)
    expect(own_key_snapshot.__proto__).toEqual({ opacity: 0.5 })
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
    const tracked = track_settings(() => values, `initial`)
    values.value = current
    expect(tracked.changed_keys).toEqual(changed ? [`value`] : [])
  })

  it(`compares only visible keys against caller-provided defaults`, () => {
    const values = { color: `blue` }
    const defaults = { color: `red`, hidden: true }
    const tracked = track_settings(() => values, defaults)
    defaults.color = `green`
    expect(tracked.changed_keys).toEqual([`color`])
    values.color = tracked.snapshot([`color`]).color
    expectTypeOf(tracked.snapshot().color).toEqualTypeOf<string>()
    expect(values.color).toBe(`red`)
    expect(tracked.changed_keys).toEqual([])

    const count_values = () => ({ count: 1 })
    const absent = track_settings(count_values, {}).snapshot()
    expect(absent).toEqual({})
    expectTypeOf(absent.count).toEqualTypeOf<number | undefined>()
    const optional: { count?: number } = {}
    const optional_reference = track_settings(count_values, optional).snapshot()
    expectTypeOf(optional_reference.count).toEqualTypeOf<number | undefined>()
    const dictionary: Record<string, number> = {}
    const dictionary_reference = track_settings(count_values, dictionary).snapshot()
    expect(dictionary_reference).toEqual({})
    expectTypeOf(dictionary_reference.count).toEqualTypeOf<number | undefined>()
    const undefined_reference = track_settings(count_values, { count: undefined }).snapshot()
    expect(undefined_reference).toEqual({ count: undefined })
    expectTypeOf(undefined_reference.count).toEqualTypeOf<number | undefined>()
    const string_defaults: Record<string, string> = { count: `broken` }
    const string_reference = track_settings(count_values, string_defaults).snapshot()
    expect(string_reference).toEqual({ count: `broken` })
    expectTypeOf(string_reference.count).toEqualTypeOf<number | string | undefined>()
    const optional_values = track_settings(() => optional, { count: 0 }).snapshot()
    expect(optional_values).toEqual({})
    expectTypeOf(optional_values.count).toEqualTypeOf<number | undefined>()
    expectTypeOf(
      track_settings(count_values, `initial`).snapshot().count,
    ).toEqualTypeOf<number>()
    // @ts-expect-error A numeric setting cannot reset to a string.
    track_settings(count_values, { count: `broken` })
  })
})
