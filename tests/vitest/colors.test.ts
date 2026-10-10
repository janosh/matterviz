import type { Paint } from '#lib/colors/index.js'
import {
  add_alpha,
  composite_colors,
  CONTRAST_MEMO_LIMIT,
  contrast_color_memo,
  contrast_text_color,
  css_color_to_hex,
  DEFAULT_CATEGORY_COLORS,
  ELEMENT_COLOR_SCHEMES,
  get_d3_interpolator,
  is_color,
  is_concrete_color,
  is_dark_mode,
  is_d3_interpolate_name,
  is_opaque_color,
  perceived_brightness,
  pick_contrast_color,
  PLOT_COLORS,
  watch_dark_mode,
} from '#lib/colors/index.js'
import { ELEM_SYMBOLS } from '#lib/element/types.js'
import * as d3_sc from 'd3-scale-chromatic'
import { beforeEach, describe, expect, it, test, vi } from 'vitest'

// Generate expected element symbols from atomic numbers 1-109 (first 109 elements)
const EXPECTED_ELEMENTS = Array.from({ length: 109 }, (_, idx) => ELEM_SYMBOLS[idx])

test(`every d3-scale-chromatic interpolate* export is a registered interpolator`, () => {
  const names = Object.keys(d3_sc).filter((name) => name.startsWith(`interpolate`))
  expect(names.length).toBeGreaterThan(20)
  for (const name of names) {
    expect(is_d3_interpolate_name(name)).toBe(true)
    if (is_d3_interpolate_name(name)) expect(get_d3_interpolator(name)).toBeTypeOf(`function`)
  }
  expect(is_d3_interpolate_name(`schemeViridis`)).toBe(false)
  // @ts-expect-error exercise the runtime guard for JavaScript callers
  expect(() => get_d3_interpolator(`invalid`)).toThrow(
    `Unknown D3 color interpolator: invalid`,
  )
})

describe(`Element Color Schemes`, () => {
  test(`all schemes have identical, complete element coverage`, () => {
    expect(Object.keys(ELEMENT_COLOR_SCHEMES).toSorted()).toEqual([
      `Alloy`,
      `Dark Mode`,
      `Jmol`,
      `Muted`,
      `Pastel`,
      `Vesta`,
    ])
    const expected_keys = Object.keys(ELEMENT_COLOR_SCHEMES.Vesta).toSorted()
    expect(expected_keys.length).toBeGreaterThanOrEqual(109)
    expect(expected_keys).toEqual(expect.arrayContaining(EXPECTED_ELEMENTS))
    for (const [scheme_name, colors] of Object.entries(ELEMENT_COLOR_SCHEMES)) {
      expect(Object.keys(colors).toSorted(), `${scheme_name} coverage`).toEqual(expected_keys)
    }
  })

  test(`pastel scheme has pastel characteristics`, () => {
    for (const element of [`H`, `C`, `O`, `Fe`, `Au`]) {
      const color = ELEMENT_COLOR_SCHEMES.Pastel[element]
      const channels = [1, 3, 5].map((idx) => parseInt(color.slice(idx, idx + 2), 16))
      const lightness = (Math.max(...channels) + Math.min(...channels)) / 2
      expect(lightness, `${element} Pastel lightness`).toBeGreaterThan(120)
    }
  })
})

describe(`color constants`, () => {
  it.each<[string, readonly string[]]>([
    ...Object.entries(ELEMENT_COLOR_SCHEMES).map(([scheme, colors]): [string, string[]] => [
      `${scheme} element`,
      Object.values(colors),
    ]),
    [`category`, Object.values(DEFAULT_CATEGORY_COLORS)],
    [`plot`, PLOT_COLORS],
  ])(`%s colors are all valid 6-digit hex`, (_label, colors) => {
    for (const color of colors) expect(color).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it(`PLOT_COLORS has 10 unique colors`, () => {
    expect(PLOT_COLORS).toHaveLength(10)
    expect(new Set(PLOT_COLORS).size).toBe(PLOT_COLORS.length)
  })
})

describe(`is_color function`, () => {
  test.each([
    // Valid hex colors
    [`#ff0000`, true],
    [`#FF0000`, true],
    [`#f00`, true],
    [`#00ff00ab`, true], // 8-digit hex with alpha

    // Valid CSS color functions
    [`rgb(255, 0, 0)`, true],
    [`rgb(255,0,0)`, true],
    [`rgba(255, 0, 0, 0.5)`, true],
    [`hsl(120, 100%, 50%)`, true],
    [`hsla(120, 100%, 50%, 0.8)`, true],
    [`var(--my-color)`, true],
    [`color(srgb 1 0 0)`, true],
    [`color(display-p3 1 0.5 0)`, true],

    // Valid named colors
    [`red`, true],
    [`rebeccapurple`, true],
    [`RED`, true], // named colors are case-insensitive
    [`transparent`, true],
    [`currentcolor`, true],

    [`pending`, false], // arbitrary words are not colors

    // Invalid patterns - incomplete functions
    [`rgb`, false],
    [`var`, false],
    [`color`, false],

    // Invalid patterns - malformed
    [`rgb(255, 0)`, false], // incomplete rgb values are rejected
    [`rgb(255, 0, 0, 0.5)`, false],
    [`#gg0000`, false],
    [`#12`, false],
    [`#12345`, false], // 5-digit hex is invalid (regression vs old COLOR_FN_REGEX)
    [`#1234567`, false], // 7-digit hex is invalid (regression vs old COLOR_FN_REGEX)
    [`hello world`, false],
    [``, false],
    [123, false],
    [null, false],

    // Edge cases
    [` #ff0000 `, true], // whitespace should be trimmed
    [`RGB(255, 0, 0)`, true], // case insensitive
  ])(`%s -> %s`, (input, expected) => {
    expect(is_color(input)).toBe(expected)
  })

  test.each([
    [`#4fc3f7`, true],
    [`rgb(79 195 247)`, true],
    [`rgb(79 195 247 / 50%)`, true],
    [`var(--accent)`, false],
    [`currentcolor`, false],
    [`transparent`, false],
  ])(`is_concrete_color(%s) is %s`, (color, expected) => {
    expect(is_concrete_color(color)).toBe(expected)
  })
  test.each([
    [`#4fc3f7`, true],
    [`rgb(79 195 247)`, true],
    [`rgb(79 195 247 / 50%)`, false],
    [`rgba(79, 195, 247, 0.5)`, false],
    [`transparent`, false],
    [`var(--accent)`, false],
  ])(`is_opaque_color(%s) is %s`, (color, expected) => {
    expect(is_opaque_color(color)).toBe(expected)
  })
})

test.each([
  // hex passes through lowercased, short hex expanded
  [`#ff0000`, `#ff0000`],
  [`#FF0000`, `#ff0000`],
  [`#f00`, `#ff0000`],
  // CSS color functions are parsed, alpha ignored
  [`rgb(255, 0, 0)`, `#ff0000`],
  [`rgb(0 128 255)`, `#0080ff`],
  [`rgb(0, 128, 255)`, `#0080ff`],
  [`rgba(255, 0, 0, 0.5)`, `#ff0000`],
  [`rgba(255, 0, 0, 0)`, `#ff0000`],
  [`hsl(0, 100%, 50%)`, `#ff0000`],
  [`hsl(120, 100%, 50%)`, `#00ff00`],
  [`hsla(240, 100%, 50%, 0.8)`, `#0000ff`],
  [`red`, `#ff0000`],
  [`green`, `#008000`], // CSS green is #008000, not #00ff00
  // transparent maps to white, whatever its case or padding
  [`transparent`, `#ffffff`],
  [` Transparent `, `#ffffff`],
  // unresolvable inputs (CSS vars included) return the fallback
  [undefined, `#abcdef`],
  [``, `#abcdef`],
  [`var(--color)`, `#abcdef`],
  [`not-a-color`, `#abcdef`],
  [`#gggggg`, `#abcdef`],
  [`rgb(invalid)`, `#abcdef`],
] as const)(`css_color_to_hex(%s) = %s`, (input, expected) => {
  expect(css_color_to_hex(input, `#abcdef`)).toBe(expected)
})

test.each([
  [`#000000`, 0],
  [`#ffffff`, 1],
  [`#ff0000`, 0.299],
  [`#00ff00`, 0.587],
  [`#0000ff`, 0.114],
  [`#808080`, 0.502],
  [`#ff8000`, 0.594],
  [`red`, 0.299],
])(`perceived_brightness(%s) = %s`, (color, expected_brightness) => {
  expect(perceived_brightness(color)).toBeCloseTo(expected_brightness, 3)
})

describe(`pick_contrast_color`, () => {
  it.each<[Paint, string]>([
    [{ background: `#000000` }, `white`],
    [{ background: `#4fc3f7` }, `black`], // light cyan: black wins under WCAG and APCA alike
    // mid-tones where the WCAG 2 ratio picks black (4.8:1 vs 4.4:1 on the steelblue) but the
    // pair reads worse than white: APCA flips near luminance 0.32 instead of 0.18
    [{ background: `#4e79a7` }, `white`], // PLOT_COLORS[0] steelblue, luminance 0.18
    [{ background: `#e15759` }, `white`], // PLOT_COLORS[2] red, luminance 0.24
    [{ background: `#59a14f` }, `white`], // PLOT_COLORS[4] green, luminance 0.28
    [{ background: `#f28e2c` }, `black`], // PLOT_COLORS[1] orange, luminance 0.38
    [{ background: `#808080` }, `white`], // mid gray, luminance 0.22
    [{ background: `#ffffff`, choices: [`red`, `blue`] }, `blue`],
    [{ background: `rgba(255, 255, 255, 0.1)`, backdrop: `black` }, `white`],
    [{ background: `rgba(0, 0, 0, 0.1)`, backdrop: `white` }, `black`],
    [{ background: `transparent`, backdrop: `black` }, `white`],
  ])(`pick_contrast_color(%o) = %s`, (paint, expected) => {
    expect(pick_contrast_color(paint)).toBe(expected)
  })

  it.each<[Paint, string]>([
    [{ background: `not-a-color` }, `Invalid color: not-a-color`],
    [{ background: `rgba(255, 255, 255, 0.1)` }, `Translucent background requires a backdrop`],
    [
      { background: `rgba(255, 255, 255, 0.1)`, backdrop: `rgba(0, 0, 0, 0.5)` },
      `backdrop must be opaque`,
    ],
  ])(`rejects invalid paint %o`, (paint, error) => {
    expect(() => pick_contrast_color(paint)).toThrow(error)
  })

  it.each<[Paint, string]>([
    // CSS vars cannot be resolved in JS, so inherit rather than guess
    [{ background: `var(--some-bg)` }, `currentColor`],
    [{ background: `#000000` }, `white`],
  ])(`contrast_text_color(%o) = %s`, (paint, expected) => {
    expect(contrast_text_color(paint)).toBe(expected)
  })

  it(`contrast_color_memo matches pick_contrast_color and follows backdrop/alpha changes`, () => {
    let backdrop = `white`
    let alpha = 0.1
    const memo = contrast_color_memo({ backdrop: () => backdrop, alpha: () => alpha })
    expect(memo(`var(--bg)`)).toBeNull()
    // a faint black wash over white reads as a light cell
    expect(memo(`#000000`)).toBe(`black`)
    // the cached answer is dropped when the backdrop changes
    backdrop = `black`
    expect(memo(`#000000`)).toBe(`white`)
    alpha = 1
    expect(memo(`#ffffff`)).toBe(`black`)
  })

  it(`contrast_color_memo evicts FIFO past the cap instead of dropping the whole cache`, () => {
    const pick = vi.fn(pick_contrast_color)
    const plain = contrast_color_memo({ pick })
    const color_at = (idx: number) => `rgb(${idx % 256}, ${Math.floor(idx / 256)}, 128)`
    const n_colors = CONTRAST_MEMO_LIMIT + 5
    const colors = Array.from({ length: n_colors }, (_, idx) => color_at(idx))
    // past the cache limit every answer still agrees with the unmemoized pick
    const mismatches = colors.filter(
      (color) => plain(color) !== pick_contrast_color({ background: color }),
    )
    expect(mismatches).toEqual([])
    expect(pick).toHaveBeenCalledTimes(n_colors)
    // the 5 oldest entries were evicted one by one; the rest are still hits. A clear-all
    // would have dropped everything up to the cap and made these all misses.
    for (const color of colors.slice(5)) plain(color)
    expect(pick).toHaveBeenCalledTimes(n_colors)
    for (const color of colors.slice(0, 5)) plain(color)
    expect(pick).toHaveBeenCalledTimes(n_colors + 5)
  })
})

test.each([
  [`rgba(255, 255, 255, 0.1)`, `black`, `rgb(26, 26, 26)`],
  [`transparent`, `red`, `rgb(255, 0, 0)`],
  [`red`, `transparent`, `rgb(255, 0, 0)`],
])(`composites %s over %s`, (foreground, backdrop, expected) => {
  expect(composite_colors(foreground, backdrop)).toBe(expected)
})

describe(`add_alpha`, () => {
  it.each([
    [`#ff0000`, 0.5, `rgba(255, 0, 0, 0.5)`],
    [`#abc`, 0.3, `rgba(170, 187, 204, 0.3)`],
    [`rgb(100, 150, 200)`, 0.8, `rgba(100, 150, 200, 0.8)`],
    [`rgba(100, 150, 200, 0.2)`, 0.9, `rgba(100, 150, 200, 0.9)`],
    [`rgba(255, 0, 0, 0)`, 0.5, `rgba(255, 0, 0, 0.5)`],
    [`rgba(100, 100, 100, 1e-5)`, 0.6, `rgba(100, 100, 100, 0.6)`], // scientific notation
    [`rgba(50, 50, 50, 1.5E+2)`, 0.1, `rgba(50, 50, 50, 0.1)`], // uppercase E with +
    [`unknown-format`, 0.5, `unknown-format`], // passthrough unknown
  ])(`add_alpha(%s, %s) = %s`, (color, alpha, expected) => {
    expect(add_alpha(color, alpha)).toBe(expected)
  })
})

describe(`is_dark_mode + watch_dark_mode`, () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0)) // observers report async
  beforeEach(() => {
    document.documentElement.removeAttribute(`style`)
    delete document.documentElement.dataset.theme
  })

  // The element's computed color-scheme is the single source: the root's inline scheme on the
  // site, a widget element's own scheme in a notebook; nothing declared → the OS preference
  it.each([
    [`dark`, true],
    [`light`, false],
    [`light dark`, false],
  ])(`reads a declared color-scheme %j -> dark=%s`, (scheme, expected) => {
    document.documentElement.style.colorScheme = scheme
    expect(is_dark_mode()).toBe(expected)
  })

  it(`a widget element's own scheme wins over the page root's`, () => {
    document.documentElement.style.colorScheme = `light`
    const widget = document.createElement(`div`)
    widget.style.colorScheme = `dark`
    document.body.append(widget)
    const canvas = document.createElement(`canvas`)
    widget.append(canvas)
    expect(is_dark_mode(canvas)).toBe(true)
    expect(is_dark_mode()).toBe(false)
    widget.remove()
  })

  it(`watch_dark_mode reports changes for the element's scheme, never on subscribe, and stops after cleanup`, async () => {
    // silent on subscribe: callers subscribe inside effects that write state in the callback
    const widget = document.createElement(`div`)
    document.body.append(widget)
    const widget_calls: boolean[] = []
    const stop_widget = watch_dark_mode((dark) => widget_calls.push(dark), widget)
    expect(widget_calls).toEqual([])
    widget.style.colorScheme = `dark` // the element's own scheme is not watched, its roots are
    document.documentElement.style.colorScheme = `light`
    await settle()
    expect(widget_calls.at(-1)).toBe(true) // re-read from the element, not the (light) root
    stop_widget()
    widget.remove()

    const calls: boolean[] = []
    const cleanup = watch_dark_mode((dark) => calls.push(dark))
    expect(calls).toEqual([])
    document.documentElement.style.colorScheme = `dark`
    await settle()
    expect(calls.at(-1)).toBe(true)
    cleanup()
    const count = calls.length
    document.documentElement.style.colorScheme = `light`
    await settle()
    expect(calls).toHaveLength(count)
  })
})
