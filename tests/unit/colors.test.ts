import { element_color_schemes } from '$lib/colors'
import { elem_symbols } from '$lib/labels'
import { describe, expect, test } from 'vitest'

// Generate expected element symbols from atomic numbers 1-109 (first 109 elements)
const EXPECTED_ELEMENTS = Array.from(
  { length: 109 },
  (_, idx) => elem_symbols[idx],
)

/**
 * Test if a string is a valid hex color
 */
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
      )
      expect(
        missing_elements,
        `${scheme_name} is missing elements from ${first_scheme_name}: ${missing_elements.join(`, `)}`,
      ).toHaveLength(0)

      // Check for extra elements
      const extra_elements = [...scheme_elements].filter(
        (el) => !first_elements.has(el),
      )
      expect(
        extra_elements,
        `${scheme_name} has extra elements not in ${first_scheme_name}: ${extra_elements.join(`, `)}`,
      ).toHaveLength(0)
    }
  })

  test(`all color values are valid hex format`, () => {
    for (const [scheme_name, colors] of Object.entries(element_color_schemes)) {
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
    }
  })

  test(`color values are unique within each scheme`, () => {
    for (const [scheme_name, colors] of Object.entries(element_color_schemes)) {
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
      expect(
        duplicate_count,
        `${scheme_name} too many duplicate colors`,
      ).toBeLessThan(max_duplicates)
    }
  })

  test(`specific elements have defined colors`, () => {
    // Test some key elements that should definitely be present
    const key_elements = [`H`, `C`, `N`, `O`, `Fe`, `Au`, `U`]

    for (const [scheme_name, colors] of Object.entries(element_color_schemes)) {
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
