import {
  css_color_to_hex,
  ELEMENT_COLOR_SCHEMES,
  get_bg_color,
  get_page_background,
  is_color,
  luminance,
  pick_contrast_color,
} from '$lib/colors'
import { ELEM_SYMBOLS } from '$lib/labels'
import { describe, expect, test, vi } from 'vitest'

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
      const r = parseInt(color.slice(1, 3), 16)
      const g = parseInt(color.slice(3, 5), 16)
      const b = parseInt(color.slice(5, 7), 16)

      // Pastel colors should generally have high lightness values
      const lightness = (Math.max(r, g, b) + Math.min(r, g, b)) / 2
      expect(
        lightness,
        `${element} in Pastel scheme should have high lightness (got ${lightness})`,
      ).toBeGreaterThan(120)
    }
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
    [`#12345`, false], // 5-digit hex is invalid (regression vs old COLOR_FN_REGEX)
    [`#1234567`, false], // 7-digit hex is invalid (regression vs old COLOR_FN_REGEX)
    [`hello world`, false],
    [``, false],
    [123, false],
    [null, false],
    [undefined, false],

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

test.each([
  [null, undefined, `rgba(0, 0, 0, 0)`, `null element`],
  [document.createElement(`div`), `#ff0000`, `#ff0000`, `explicit bg_color`],
  [document.createElement(`div`), undefined, `rgba(0, 0, 0, 0)`, `transparent background`],
])(`get_bg_color: %s`, (elem, bg_color, expected, description) => {
  if (description === `transparent background`) {
    Object.defineProperty(window, `getComputedStyle`, {
      value: () => ({ backgroundColor: `rgba(0, 0, 0, 0)` }),
      writable: true,
    })
  }
  expect(get_bg_color(elem, bg_color)).toBe(expected)
})

test.each([
  [`#ffffff`, undefined, `black`], // light background
  [`#000000`, undefined, `white`], // dark background
  [`#808080`, 0.5, `black`], // custom threshold
])(`pick_contrast_color: %s (threshold %s) → %s`, (bg_color, threshold, expected) => {
  expect(pick_contrast_color({ bg_color, luminance_threshold: threshold })).toBe(expected)
})

test(`pick_contrast_color uses custom colors`, () => {
  expect(
    pick_contrast_color({
      bg_color: `#000000`,
      luminance_threshold: 0.7,
      choices: [`blue`, `yellow`],
    }),
  ).toBe(`yellow`)
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
    vi.stubGlobal(`matchMedia`, (q: string) => ({
      matches: q.includes(`dark`),
      media: q,
    }))
    expect(get_page_background(`#000`, `#fff`)).toBe(`#000`)
    vi.unstubAllGlobals()
  })
})
