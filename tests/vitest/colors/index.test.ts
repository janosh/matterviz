import type { ContrastOptions } from '$lib/colors'
import {
  add_alpha,
  DEFAULT_CATEGORY_COLORS,
  ELEMENT_COLOR_SCHEMES,
  get_bg_color,
  is_color,
  is_dark_mode,
  luminance,
  pick_contrast_color,
  PLOT_COLORS,
  watch_dark_mode,
} from '$lib/colors'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe(`colors module`, () => {
  describe(`color constants`, () => {
    it.each([
      [`category`, Object.values(DEFAULT_CATEGORY_COLORS)],
      [`plot`, PLOT_COLORS],
      [
        `element scheme`,
        Object.values(ELEMENT_COLOR_SCHEMES).flatMap((scheme) => Object.values(scheme)),
      ],
    ])(`%s colors are all valid 6-digit hex`, (_label, colors) => {
      for (const color of colors) expect(color).toMatch(/^#[0-9a-f]{6}$/i)
    })

    it(`PLOT_COLORS has 10 unique colors`, () => {
      expect(PLOT_COLORS).toHaveLength(10)
      expect(new Set(PLOT_COLORS).size).toBe(PLOT_COLORS.length)
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
    it.each([
      [`#000000`, 0], // black
      [`#ffffff`, 1], // white
      [`#ff0000`, 0.299], // red
      [`#00ff00`, 0.587], // green
      [`#0000ff`, 0.114], // blue
      [`red`, 0.299], // named color
      [`#808080`, 0.502], // mid gray
    ])(`luminance(%s) = %s, within [0, 1]`, (color, expected) => {
      const lum = luminance(color)
      expect(lum).toBeCloseTo(expected, 3)
      expect(lum).toBeGreaterThanOrEqual(0)
      expect(lum).toBeLessThanOrEqual(1)
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
      [
        { bg_color: `#ffffff`, luminance_threshold: 0.7, choices: [`black`, `white`] },
        `black`,
      ],
      [
        { bg_color: `#000000`, luminance_threshold: 0.7, choices: [`black`, `white`] },
        `white`,
      ],
      [
        { bg_color: `#404040`, luminance_threshold: 0.5, choices: [`black`, `white`] },
        `white`,
      ],
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
})
