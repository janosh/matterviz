import {
  element_color_schemes,
  get_bg_color,
  get_page_background,
  is_color,
  luminance,
  pick_contrast_color,
} from '$lib/colors'
import { ELEM_SYMBOLS } from '$lib/labels'
import { describe, expect, test, vi } from 'vitest'

// Generate expected element symbols from atomic numbers 1-109 (first 109 elements)
const EXPECTED_ELEMENTS = Array.from(
  { length: 109 },
  (_, idx) => ELEM_SYMBOLS[idx],
)

// Test if a string is a valid hex color
function is_valid_hex_color(color: string): boolean {
  const hex_regex = /^#[0-9A-Fa-f]{6}$/
  return hex_regex.test(color)
}

describe(`Element Color Schemes`, () => {
  test(`all schemes exist and are objects`, () => {
    expect(element_color_schemes).toBeDefined()
    expect(typeof element_color_schemes).toBe(`object`)

    const schemes = Object.keys(element_color_schemes)
    expect(schemes.length).toBeGreaterThanOrEqual(6)
    expect(schemes).toContain(`Vesta`)
    expect(schemes).toContain(`Jmol`)
    expect(schemes).toContain(`Alloy`)
    expect(schemes).toContain(`Pastel`)
    expect(schemes).toContain(`Muted`)
    expect(schemes).toContain(`Dark Mode`)
  })

  test(`each scheme has complete element coverage`, () => {
    for (const [scheme_name, colors] of Object.entries(element_color_schemes)) {
      const scheme_elements = Object.keys(colors)

      // Check minimum element count
      expect(
        scheme_elements.length,
        `${scheme_name} should have at least 109 elements`,
      ).toBeGreaterThanOrEqual(109)

      // Check that all expected elements are present
      for (const element of EXPECTED_ELEMENTS) {
        expect(
          colors[element],
          `${scheme_name} should contain element ${element}`,
        ).toBeDefined()
      }
    }
  })

  test(`all schemes have identical element coverage`, () => {
    const schemes = Object.entries(element_color_schemes)
    const [first_scheme_name, first_scheme] = schemes[0]
    const first_elements = new Set(Object.keys(first_scheme))

    for (const [scheme_name, colors] of schemes.slice(1)) {
      const scheme_elements = new Set(Object.keys(colors))

      // Check same number of elements
      expect(
        scheme_elements.size,
        `${scheme_name} should have same number of elements as ${first_scheme_name}`,
      ).toBe(first_elements.size)

      // Check for missing elements
      const missing_elements = [...first_elements].filter(
        (el) => !scheme_elements.has(el),
      ).join(`, `)
      expect(
        missing_elements,
        `${scheme_name} is missing elements from ${first_scheme_name}: ${missing_elements}`,
      ).toHaveLength(0)

      // Check for extra elements
      const extra_elements = [...scheme_elements].filter((el) => !first_elements.has(el))
        .join(`, `)
      const fail_msg =
        `${scheme_name} has extra elements not in ${first_scheme_name}: ${extra_elements}`
      expect(extra_elements, fail_msg).toHaveLength(0)
    }
  })

  test(`validates color scheme properties`, () => {
    for (const [scheme_name, colors] of Object.entries(element_color_schemes)) {
      // Check all colors are valid hex format
      for (const [element, color] of Object.entries(colors)) {
        expect(
          typeof color,
          `${scheme_name}.${element} should be a string`,
        ).toBe(`string`)
        expect(
          is_valid_hex_color(color),
          `${scheme_name}.${element} should be valid hex color (got: ${color})`,
        ).toBe(true)
      }

      // Check color uniqueness within scheme
      const color_values = Object.values(colors)
      const unique_colors = new Set(color_values)

      // Allow some duplicates but not too many (some elements might share colors intentionally)
      // Alloy scheme inherits from VESTA so may have more duplicates
      // Muted scheme uses desaturated colors that can result in similar hex values
      // Dark Mode scheme uses bright colors that can result in similar hex values
      const max_duplicates = {
        Alloy: 15,
        Muted: 15,
        'Dark Mode': 25,
        Pastel: 10,
        Vesta: 10,
        Jmol: 10,
      }[scheme_name] ?? Infinity
      const duplicate_count = color_values.length - unique_colors.size
      expect(
        duplicate_count,
        `${scheme_name} too many duplicate colors`,
      ).toBeLessThan(max_duplicates)

      // Check key elements are present
      const key_elements = [`H`, `C`, `N`, `O`, `Fe`, `Au`, `U`]
      for (const element of key_elements) {
        expect(
          colors[element],
          `${scheme_name} should have color for ${element}`,
        ).toBeDefined()
        expect(
          is_valid_hex_color(colors[element]),
          `${scheme_name}.${element} should be valid hex`,
        ).toBe(true)
      }
    }
  })

  test(`pastel scheme has pastel characteristics`, () => {
    const pastel_colors = element_color_schemes.Pastel

    // Check a few elements to ensure they have pastel characteristics (high lightness)
    const sample_elements = [`H`, `C`, `O`, `Fe`, `Au`]

    for (const element of sample_elements) {
      const color = pastel_colors[element]
      expect(
        color,
        `Pastel scheme should have color for ${element}`,
      ).toBeDefined()

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
    [`transparent`, true],
    [`currentcolor`, true],

    // Invalid patterns - incomplete functions
    [`rgb`, false],
    [`hsl`, false],
    [`var`, false],
    [`color`, false],

    // Invalid patterns - malformed
    [`rgb(255, 0)`, true], // incomplete rgb values but still matches our relaxed pattern
    [`#gg0000`, false],
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
    expect(is_color(element_color_schemes.Jmol.H)).toBe(true)
    expect(is_color(element_color_schemes.Vesta.He)).toBe(true)
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
  [
    document.createElement(`div`),
    undefined,
    `rgba(0, 0, 0, 0)`,
    `transparent background`,
  ],
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
  [`#ffffff`, `black`, `light background`],
  [`#000000`, `white`, `dark background`],
  [`#808080`, `black`, `custom threshold`],
  [`#ffffff`, `black`, `null element`],
])(`pick_contrast_color: %s → %s (%s)`, (bg_color, expected, description) => {
  if (description === `custom threshold`) {
    expect(pick_contrast_color({ bg_color, luminance_threshold: 0.5 })).toBe(expected)
  } else if (description === `null element`) {
    expect(pick_contrast_color({ bg_color })).toBe(expected)
  } else {
    expect(pick_contrast_color({ bg_color })).toBe(expected)
  }
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
  ])(
    `$4`,
    (html_bg, body_bg, prefers_dark, expected) => {
      let call_idx = 0
      vi.stubGlobal(`getComputedStyle`, (_elem: Element) => {
        const bg = call_idx++ === 0 ? html_bg : body_bg
        return { backgroundColor: bg } as CSSStyleDeclaration
      })
      vi.stubGlobal(
        `matchMedia`,
        (query: string) => ({ matches: prefers_dark, media: query }),
      )
      expect(get_page_background()).toBe(expected)
      vi.unstubAllGlobals()
    },
  )

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
