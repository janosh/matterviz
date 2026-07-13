import type { ContrastOptions } from '$lib/colors'
import {
  add_alpha,
  css_color_to_hex,
  DEFAULT_CATEGORY_COLORS,
  ELEMENT_COLOR_SCHEMES,
  get_bg_color,
  get_page_background,
  is_color,
  is_dark_mode,
  luminance,
  pick_contrast_color,
  PLOT_COLORS,
  watch_dark_mode,
} from '$lib/colors'
import { ELEM_SYMBOLS } from '$lib/labels'
import { beforeEach, describe, expect, it, test, vi } from 'vitest'

// Generate expected element symbols from atomic numbers 1-109 (first 109 elements)
const EXPECTED_ELEMENTS = Array.from({ length: 109 }, (_, idx) => ELEM_SYMBOLS[idx])

describe(`Element Color Schemes`, () => {
  test(`all schemes have identical, complete element coverage`, () => {
    expect(Object.keys(ELEMENT_COLOR_SCHEMES).sort()).toEqual([
      `Alloy`,
      `Dark Mode`,
      `Jmol`,
      `Muted`,
      `Pastel`,
      `Vesta`,
    ])
    const expected_keys = Object.keys(ELEMENT_COLOR_SCHEMES.Vesta).sort()
    expect(expected_keys.length).toBeGreaterThanOrEqual(109)
    expect(expected_keys).toEqual(expect.arrayContaining(EXPECTED_ELEMENTS))
    for (const [scheme_name, colors] of Object.entries(ELEMENT_COLOR_SCHEMES)) {
      expect(Object.keys(colors).sort(), `${scheme_name} coverage`).toEqual(expected_keys)
    }
  })

  test(`validates color scheme properties`, () => {
    for (const [scheme_name, colors] of Object.entries(ELEMENT_COLOR_SCHEMES)) {
      // Check all colors are valid hex format
      for (const [element, color] of Object.entries(colors)) {
        expect(color, `${scheme_name}.${element} should be a valid hex color`).toMatch(
          /^#[0-9a-f]{6}$/i,
        )
      }

      // Check color uniqueness within scheme
      const color_values = Object.values(colors)
      const unique_colors = new Set(color_values)

      // Allow some duplicates but not too many (some elements might share colors intentionally)
      // Alloy scheme inherits from VESTA so may have more duplicates
      // Muted scheme uses desaturated colors that can result in similar hex values
      // Dark Mode scheme uses bright colors that can result in similar hex values
      const max_duplicates =
        {
          Alloy: 15,
          Muted: 15,
          'Dark Mode': 25,
          Pastel: 10,
          Vesta: 10,
          Jmol: 10,
        }[scheme_name] ?? Infinity
      const duplicate_count = color_values.length - unique_colors.size
      expect(duplicate_count, `${scheme_name} too many duplicate colors`).toBeLessThan(
        max_duplicates,
      )
    }
  })

  test(`pastel scheme has pastel characteristics`, () => {
    const pastel_colors = ELEMENT_COLOR_SCHEMES.Pastel

    // Check a few elements to ensure they have pastel characteristics (high lightness)
    const sample_elements = [`H`, `C`, `O`, `Fe`, `Au`]

    for (const element of sample_elements) {
      const color = pastel_colors[element]
      expect(color, `Pastel scheme should have color for ${element}`).toBeDefined()

      // Convert hex to RGB and check lightness
      const red = parseInt(color.slice(1, 3), 16)
      const green = parseInt(color.slice(3, 5), 16)
      const blue = parseInt(color.slice(5, 7), 16)

      // Pastel colors should generally have high lightness values
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

  test(`works with actual color scheme values`, () => {
    expect(is_color(ELEMENT_COLOR_SCHEMES.Jmol.H)).toBe(true)
    expect(is_color(ELEMENT_COLOR_SCHEMES.Vesta.He)).toBe(true)
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
    [`rgb(0, 128, 255)`, `#0080ff`],
    [`rgba(255, 0, 0, 0.5)`, `#ff0000`], // alpha ignored for hex
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
    [undefined, `#abcdef`, `#abcdef`, `uses custom fallback for undefined`],
    // Element color scheme values
    [ELEMENT_COLOR_SCHEMES.Jmol.H, fallback, `#ffffff`, `parses Jmol H color`],
  ] as const)(`%s: %s`, (input, fb, expected, _description) => {
    expect(css_color_to_hex(input, fb)).toBe(expected)
  })
})

test.each([
  [`#000000`, 0, `black`],
  [`#ffffff`, 1, `white`],
  [`#ff0000`, 0.299, `red`],
  [`#00ff00`, 0.587, `green`],
  [`#0000ff`, 0.114, `blue`],
  [`#808080`, 0.502, `gray`],
  [`#ff8000`, 0.594, `orange`],
  [`red`, 0.299, `named color`],
  [`rgb(255, 0, 0)`, 0.299, `rgb format`],
  [`hsl(0, 100%, 50%)`, 0.299, `hsl format`],
])(`luminance(%s) = %s (%s)`, (color, expected) => {
  expect(luminance(color)).toBeCloseTo(expected, 3)
})

describe(`get_bg_color`, () => {
  it(`handles various scenarios`, () => {
    expect(get_bg_color(null, `#ff0000`)).toBe(`#ff0000`) // provided bg_color
    expect(get_bg_color(null)).toBe(`rgba(0, 0, 0, 0)`) // no element, no bg_color

    // Mock element with background color
    const mock_element = { style: {}, parentElement: null } as HTMLElement
    const mock_get_computed_style = vi.fn().mockReturnValue({
      backgroundColor: `#ff0000`,
    })
    Object.defineProperty(globalThis, `getComputedStyle`, {
      value: mock_get_computed_style,
      writable: true,
    })

    expect(get_bg_color(mock_element)).toBe(`#ff0000`)
    expect(mock_get_computed_style).toHaveBeenCalledWith(mock_element)
  })

  it(`recurses up DOM tree for transparent backgrounds`, () => {
    const mock_parent = { style: {}, parentElement: null } as HTMLElement
    const mock_element = { style: {}, parentElement: mock_parent } as HTMLElement
    const mock_get_computed_style = vi
      .fn()
      .mockReturnValueOnce({ backgroundColor: `rgba(0, 0, 0, 0)` })
      .mockReturnValueOnce({ backgroundColor: `#00ff00` })

    Object.defineProperty(globalThis, `getComputedStyle`, {
      value: mock_get_computed_style,
      writable: true,
    })

    expect(get_bg_color(mock_element)).toBe(`#00ff00`)
    expect(mock_get_computed_style).toHaveBeenCalledTimes(2)
  })
})

describe(`pick_contrast_color`, () => {
  it.each<[ContrastOptions | undefined, string]>([
    [{ bg_color: `#ffffff`, luminance_threshold: 0.7, choices: [`black`, `white`] }, `black`],
    [{ bg_color: `#000000`, luminance_threshold: 0.7, choices: [`black`, `white`] }, `white`],
    [{ bg_color: `#404040`, luminance_threshold: 0.5, choices: [`black`, `white`] }, `white`],
    [{ bg_color: `#ffffff`, luminance_threshold: 0.7, choices: [`red`, `blue`] }, `red`],
    [{ bg_color: `#ffffff` }, `black`], // defaults (threshold 0.7, black/white)
    [undefined, `black`], // no options -> bg defaults to 'white' -> black text
  ])(`pick_contrast_color(%o) = %s`, (options, expected) => {
    expect(pick_contrast_color(options)).toBe(expected)
  })
})

describe(`add_alpha`, () => {
  it.each([
    [`#ff0000`, 0.5, `rgba(255, 0, 0, 0.5)`],
    [`#abc`, 0.3, `rgba(170, 187, 204, 0.3)`],
    [`rgb(100, 150, 200)`, 0.8, `rgba(100, 150, 200, 0.8)`],
    [`rgba(100, 150, 200, 0.2)`, 0.9, `rgba(100, 150, 200, 0.9)`],
    [`rgba(100, 100, 100, 1e-5)`, 0.6, `rgba(100, 100, 100, 0.6)`], // scientific notation
    [`rgba(50, 50, 50, 1.5E+2)`, 0.1, `rgba(50, 50, 50, 0.1)`], // uppercase E with +
    [`unknown-format`, 0.5, `unknown-format`], // passthrough unknown
  ])(`add_alpha(%s, %s) = %s`, (color, alpha, expected) => {
    expect(add_alpha(color, alpha)).toBe(expected)
  })
})

describe(`get_page_background`, () => {
  test(`returns empty string in SSR context`, () => {
    const win = globalThis.window
    // @ts-expect-error - SSR simulation
    globalThis.window = undefined
    expect(get_page_background()).toBe(``)
    globalThis.window = win
  })

  test.each([
    [`#f5f5f5`, `rgba(0, 0, 0, 0)`, false, `#f5f5f5`, `html background`],
    [`transparent`, `#e0e0e0`, false, `#e0e0e0`, `body background`],
    [`transparent`, `transparent`, true, `#1a1a1a`, `dark mode fallback`],
    [`transparent`, `transparent`, false, `#ffffff`, `light mode fallback`],
  ])(`$4`, (html_bg, body_bg, prefers_dark, expected) => {
    let call_idx = 0
    vi.stubGlobal(`getComputedStyle`, (_elem: Element) => {
      const bg = call_idx++ === 0 ? html_bg : body_bg
      return { backgroundColor: bg } as CSSStyleDeclaration
    })
    vi.stubGlobal(`matchMedia`, (query: string) => ({
      matches: prefers_dark,
      media: query,
    }))
    expect(get_page_background()).toBe(expected)
    vi.unstubAllGlobals()
  })

  test(`custom fallback values`, () => {
    vi.stubGlobal(
      `getComputedStyle`,
      () => ({ backgroundColor: `transparent` }) as CSSStyleDeclaration,
    )
    vi.stubGlobal(`matchMedia`, (query: string) => ({
      matches: query.includes(`dark`),
      media: query,
    }))
    expect(get_page_background(`#000`, `#fff`)).toBe(`#000`)
    vi.unstubAllGlobals()
  })
})

// Regression: is_dark_mode/watch_dark_mode used to read the wrong localStorage
// key (`theme`) instead of `matterviz-theme`, and ignored white/black themes.
describe(`is_dark_mode + watch_dark_mode use matterviz-theme key`, () => {
  beforeEach(() => {
    delete document.documentElement.dataset.theme
    localStorage.clear()
  })

  it(`ignores the legacy 'theme' key, reads 'matterviz-theme'`, () => {
    localStorage.setItem(`theme`, `dark`) // legacy key must be ignored now
    expect(is_dark_mode()).toBe(false) // falls back to OS (mocked light)
    localStorage.setItem(`matterviz-theme`, `dark`)
    expect(is_dark_mode()).toBe(true)
  })

  it.each([
    [`dark`, true],
    [`light`, false],
    [`black`, true],
    [`white`, false],
  ])(`resolves stored theme %s -> dark=%s`, (mode, expected) => {
    localStorage.setItem(`matterviz-theme`, mode)
    expect(is_dark_mode()).toBe(expected)
  })

  it.each([
    [`black`, true],
    [`white`, false],
  ])(`data-theme=%s takes precedence -> dark=%s`, (theme, expected) => {
    document.documentElement.dataset.theme = theme
    // opposite stored mode to prove the attribute wins
    localStorage.setItem(`matterviz-theme`, expected ? `light` : `dark`)
    expect(is_dark_mode()).toBe(expected)
  })

  it(`watch_dark_mode fires on matterviz-theme storage events only`, () => {
    const calls: boolean[] = []
    const cleanup = watch_dark_mode((dark) => calls.push(dark))
    localStorage.setItem(`matterviz-theme`, `dark`)
    globalThis.dispatchEvent(new StorageEvent(`storage`, { key: `matterviz-theme` }))
    expect(calls.at(-1)).toBe(true)
    const count_before = calls.length
    globalThis.dispatchEvent(new StorageEvent(`storage`, { key: `theme` }))
    expect(calls).toHaveLength(count_before) // legacy key ignored
    cleanup()
  })
})
