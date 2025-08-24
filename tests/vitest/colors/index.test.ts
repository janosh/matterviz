import {
  default_category_colors,
  element_color_schemes,
  get_bg_color,
  is_color,
  luminance,
  pick_contrast_color,
  plot_colors,
} from '$lib/colors'
import { describe, expect, it, vi } from 'vitest'

describe(`colors module`, () => {
  describe(`color constants`, () => {
    it(`has valid hex colors in all schemes`, () => {
      // Test category colors
      Object.values(default_category_colors).forEach((color) => {
        expect(color).toMatch(/^#[0-9a-f]{6}$/i)
      })

      // Test plot colors
      expect(plot_colors).toHaveLength(10)
      plot_colors.forEach((color) => {
        expect(color).toMatch(/^#[0-9a-f]{6}$/i)
      })
      expect(new Set(plot_colors).size).toBe(plot_colors.length)

      // Test element color schemes
      Object.values(element_color_schemes).forEach((scheme) => {
        Object.values(scheme).forEach((color) => {
          expect(color).toMatch(/^#[0-9a-f]{6}$/i)
        })
      })
    })
  })

  describe(`is_color`, () => {
    it.each([
      `#ff0000`,
      `rgb(255, 0, 0)`,
      `rgba(255, 0, 0, 0.5)`,
      `hsl(0, 100%, 50%)`,
      `hsla(0, 100%, 50%, 0.5)`,
      `color(display-p3 1 0 0)`,
      `var(--my-color)`,
      `red`,
      `blue`,
      `green`,
      `transparent`,
      `  #ff0000  `,
      `  red  `,
    ])(`identifies valid color: %s`, (color) => {
      expect(is_color(color)).toBe(true)
    })

    it.each([
      `rgb`,
      `hsl`,
      `var`,
      `color`,
      `#gggggg`,
      `#12`,
      ``,
      null,
      undefined,
      123,
      {},
      [],
    ])(`rejects invalid color: %s`, (color) => {
      expect(is_color(color)).toBe(false)
    })
  })

  describe(`luminance`, () => {
    it(`calculates correct luminance values`, () => {
      expect(luminance(`#000000`)).toBeCloseTo(0, 3) // black
      expect(luminance(`#ffffff`)).toBeCloseTo(1, 3) // white
      expect(luminance(`#ff0000`)).toBeCloseTo(0.299, 3) // red
      expect(luminance(`#00ff00`)).toBeCloseTo(0.587, 3) // green
      expect(luminance(`#0000ff`)).toBeCloseTo(0.114, 3) // blue
      expect(luminance(`red`)).toBeCloseTo(0.299, 3) // named color
    })

    it(`returns values between 0 and 1`, () => {
      ;[`#000000`, `#ffffff`, `#ff0000`, `#00ff00`, `#0000ff`, `#808080`].forEach(
        (color) => {
          const lum = luminance(color)
          expect(lum).toBeGreaterThanOrEqual(0)
          expect(lum).toBeLessThanOrEqual(1)
        },
      )
    })
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
      const mock_get_computed_style = vi.fn()
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
    it(`selects appropriate colors based on background`, () => {
      expect(
        pick_contrast_color({
          bg_color: `#ffffff`,
          text_color_threshold: 0.7,
          choices: [`black`, `white`],
        }),
      ).toBe(
        `black`,
      )
      expect(
        pick_contrast_color({
          bg_color: `#000000`,
          text_color_threshold: 0.7,
          choices: [`black`, `white`],
        }),
      ).toBe(
        `white`,
      )
      expect(
        pick_contrast_color({
          bg_color: `#404040`,
          text_color_threshold: 0.5,
          choices: [`black`, `white`],
        }),
      ).toBe(
        `white`,
      )
      expect(
        pick_contrast_color({
          bg_color: `#ffffff`,
          text_color_threshold: 0.7,
          choices: [`red`, `blue`],
        }),
      ).toBe(`red`)
      expect(pick_contrast_color({ bg_color: `#ffffff` })).toBe(`black`) // defaults
      expect(pick_contrast_color()).toBe(`black`) // no options -> bg defaults to 'white' -> black text
    })
  })
})
