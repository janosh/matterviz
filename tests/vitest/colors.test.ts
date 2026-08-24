import type { Paint } from '$lib/colors'
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
} from '$lib/colors'
import { ELEM_SYMBOLS } from '$lib/labels'
import * as d3_sc from 'd3-scale-chromatic'
import { beforeEach, describe, expect, it, test, vi } from 'vitest'

// Generate expected element symbols from atomic numbers 1-109 (first 109 elements)
const EXPECTED_ELEMENTS = Array.from({ length: 109 }, (_, idx) => ELEM_SYMBOLS[idx])

test.each([
  [`interpolateViridis`, true],
  [`schemeViridis`, false],
] as const)(`is_d3_interpolate_name(%s) is %s`, (name, expected) => {
  expect(is_d3_interpolate_name(name)).toBe(expected)
})

test(`every d3-scale-chromatic interpolate* export is a registered interpolator`, () => {
  const names = Object.keys(d3_sc).filter((name) => name.startsWith(`interpolate`))
  expect(names.length).toBeGreaterThan(20)
  for (const name of names) {
    expect(is_d3_interpolate_name(name)).toBe(true)
    if (is_d3_interpolate_name(name)) expect(get_d3_interpolator(name)).toBeTypeOf(`function`)
  }
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

  test(`all color scheme values are valid hex colors`, () => {
    for (const [scheme_name, colors] of Object.entries(ELEMENT_COLOR_SCHEMES)) {
      for (const [element, color] of Object.entries(colors)) {
        expect(color, `${scheme_name}.${element} should be a valid hex color`).toMatch(
          /^#[0-9a-f]{6}$/i,
        )
      }
    }
  })

  test(`pastel scheme has pastel characteristics`, () => {
    const pastel_colors = ELEMENT_COLOR_SCHEMES.Pastel
    const sample_elements = [`H`, `C`, `O`, `Fe`, `Au`]

    for (const element of sample_elements) {
      const color = pastel_colors[element]
      const red = parseInt(color.slice(1, 3), 16)
      const green = parseInt(color.slice(3, 5), 16)
      const blue = parseInt(color.slice(5, 7), 16)

      const lightness = (Math.max(red, green, blue) + Math.min(red, green, blue)) / 2
      expect(
        lightness,
        `${element} in Pastel scheme should have high lightness (got ${lightness})`,
      ).toBeGreaterThan(120)
    }
  })
})

describe(`color constants`, () => {
  it.each([
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
    [`#F00`, true],
    [`#00ff00ab`, true], // 8-digit hex with alpha

    // Valid CSS color functions
    [`rgb(255, 0, 0)`, true],
    [`rgb(255,0,0)`, true],
    [`rgba(255, 0, 0, 0.5)`, true],
    [`rgba(255,0,0,0.5)`, true],
    [`hsl(120, 100%, 50%)`, true],
    [`hsl(120,100%,50%)`, true],
    [`hsla(120, 100%, 50%, 0.8)`, true],
    [`hsla(120,100%,50%,0.8)`, true],
    [`var(--my-color)`, true],
    [`var(--primary-color)`, true],
    [`color(srgb 1 0 0)`, true],
    [`color(display-p3 1 0.5 0)`, true],

    // Valid named colors
    [`red`, true],
    [`blue`, true],
    [`green`, true],
    [`rebeccapurple`, true],
    [`RED`, true], // named colors are case-insensitive
    [`transparent`, true],
    [`currentcolor`, true],

    [`pending`, false], // arbitrary words are not colors

    // Invalid patterns - incomplete functions
    [`rgb`, false],
    [`hsl`, false],
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
    [undefined, false],
    [{}, false],
    [[], false],

    // Edge cases
    [` #ff0000 `, true], // whitespace should be trimmed
    [`RGB(255, 0, 0)`, true], // case insensitive
    [`HSL(120, 100%, 50%)`, true], // case insensitive
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

describe(`css_color_to_hex`, () => {
  const fallback = `#000000`

  test.each([
    // Valid hex colors pass through
    [`#ff0000`, `#ff0000`],
    [`#FF0000`, `#ff0000`], // lowercase output
    [`#f00`, `#ff0000`], // short hex expanded
    [`#00ff00`, `#00ff00`],
    // CSS color functions are parsed
    [`rgb(255, 0, 0)`, `#ff0000`],
    [`rgb(0 128 255)`, `#0080ff`],
    [`rgb(0, 128, 255)`, `#0080ff`],
    [`rgba(255, 0, 0, 0.5)`, `#ff0000`], // alpha ignored for hex
    [`rgba(255, 0, 0, 0)`, `#ff0000`],
    [`hsl(0, 100%, 50%)`, `#ff0000`],
    [`hsl(120, 100%, 50%)`, `#00ff00`],
    [`hsla(240, 100%, 50%, 0.8)`, `#0000ff`],
    // Named colors
    [`red`, `#ff0000`],
    [`blue`, `#0000ff`],
    [`green`, `#008000`], // CSS green is #008000, not #00ff00
    [`white`, `#ffffff`],
    [`black`, `#000000`],
    [`orange`, `#ffa500`],
  ] as const)(`converts %s to %s`, (input, expected) => {
    expect(css_color_to_hex(input, fallback)).toBe(expected)
  })

  test.each([
    // Undefined and empty
    [undefined, fallback, fallback, `returns fallback for undefined`],
    [``, fallback, fallback, `returns fallback for empty string`],
    // CSS variables
    [`var(--primary-color)`, fallback, fallback, `returns fallback for CSS variable`],
    [`var(--bg)`, fallback, fallback, `returns fallback for CSS variable shorthand`],
    [`var(--color)`, `#abcdef`, `#abcdef`, `uses custom fallback for CSS variable`],
    // Invalid colors
    [`not-a-color`, fallback, fallback, `returns fallback for invalid color name`],
    [`#gggggg`, fallback, fallback, `returns fallback for invalid hex`],
    [`rgb(invalid)`, fallback, fallback, `returns fallback for malformed rgb`],
    // Special cases
    [`transparent`, fallback, `#ffffff`, `returns #ffffff for transparent`],
    [`TRANSPARENT`, fallback, `#ffffff`, `handles uppercase transparent`],
    [` Transparent `, fallback, `#ffffff`, `handles padded mixed-case transparent`],
    [undefined, `#abcdef`, `#abcdef`, `uses custom fallback for undefined`],
    // Element color scheme values
    [ELEMENT_COLOR_SCHEMES.Jmol.H, fallback, `#ffffff`, `parses Jmol H color`],
  ] as const)(`%s: %s`, (input, fb, expected, _description) => {
    expect(css_color_to_hex(input, fb)).toBe(expected)
  })
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
  [`rgb(255, 0, 0)`, 0.299],
  [`hsl(0, 100%, 50%)`, 0.299],
])(`perceived_brightness(%s) = %s`, (color, expected_brightness) => {
  expect(perceived_brightness(color)).toBeCloseTo(expected_brightness, 3)
})

describe(`pick_contrast_color`, () => {
  it.each<[Paint, string]>([
    [{ background: `#000000` }, `white`],
    [{ background: `#4fc3f7` }, `black`], // black has 10.48:1 contrast vs white's 2.00:1
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

  it(`watch_dark_mode fires when the root scheme changes and stops after cleanup`, async () => {
    const calls: boolean[] = []
    const cleanup = watch_dark_mode((dark) => calls.push(dark))
    document.documentElement.style.colorScheme = `dark`
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls.at(-1)).toBe(true)
    cleanup()
    const count = calls.length
    document.documentElement.style.colorScheme = `light`
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toHaveLength(count)
  })
})
