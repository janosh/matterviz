import type { ThemeMode, ThemeName } from '$lib/theme'
import {
  apply_theme_to_dom,
  COLOR_THEMES,
  get_system_mode,
  get_theme_preference,
  is_valid_theme_mode,
  is_valid_theme_name,
  resolve_theme_mode,
  save_theme_preference,
  THEME_TYPE,
} from '$lib/theme'
import { beforeEach, describe, expect, test, vi } from 'vitest'

describe(`Theme System`, () => {
  beforeEach(() => {
    // Mock global theme data
    globalThis.MATTERVIZ_THEMES = {
      light: { surface_bg: `#ffffff`, text_color: `#000000` },
      dark: { surface_bg: `#1a1a1a`, text_color: `#ffffff` },
      white: { surface_bg: `#ffffff`, text_color: `#000000` },
      black: { surface_bg: `#000000`, text_color: `#ffffff` },
    }

    globalThis.MATTERVIZ_CSS_MAP = {
      surface_bg: `--surface-bg`,
      text_color: `--text-color`,
    }
  })

  describe(`Theme constants and validation`, () => {
    test(`COLOR_THEMES and THEME_TYPE cover the same themes`, () => {
      expect(COLOR_THEMES).toEqual({
        light: `light`,
        dark: `dark`,
        white: `white`,
        black: `black`,
      })
      expect(THEME_TYPE).toEqual({
        light: `light`,
        dark: `dark`,
        white: `light`,
        black: `dark`,
      })
    })

    test.each([
      ...Object.keys(COLOR_THEMES).map((theme) => [theme, true] as const),
      [`auto`, true],
      [`invalid`, false],
      [``, false],
      [null, false],
      [undefined, false],
    ] as const)(`is_valid_theme_mode("%s") returns %s`, (input, expected) => {
      expect(is_valid_theme_mode(input as string)).toBe(expected)
    })

    test.each([
      ...Object.keys(COLOR_THEMES).map((theme) => [theme, true] as const),
      [`auto`, false],
      [`invalid`, false],
      [``, false],
      [null, false],
      [undefined, false],
    ] as const)(`is_valid_theme_name("%s") returns %s`, (input, expected) => {
      expect(is_valid_theme_name(input as string)).toBe(expected)
    })
  })

  describe(`Theme resolution`, () => {
    test.each([
      [`auto`, `light`, `light`],
      [`auto`, `dark`, `dark`],
      [`light`, `dark`, `light`],
      [`dark`, `light`, `dark`],
      [`white`, `dark`, `white`],
      [`black`, `light`, `black`],
    ] as const)(
      `resolve_theme_mode("%s", "%s") returns "%s"`,
      (theme_mode, system_mode, expected) => {
        expect(resolve_theme_mode(theme_mode, system_mode)).toBe(expected)
      },
    )
  })

  describe(`System preference detection`, () => {
    test.each([
      [true, `dark`],
      [false, `light`],
    ])(`get_system_mode with matchMedia.matches=%s returns "%s"`, (matches, expected) => {
      Object.defineProperty(window, `matchMedia`, {
        writable: true,
        value: vi.fn().mockImplementation(() => ({
          matches,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      })

      expect(get_system_mode()).toBe(expected)
    })
  })

  describe(`Theme preference storage`, () => {
    test.each([...Object.keys(COLOR_THEMES), `auto`])(
      `save/get_theme_preference round-trips "%s"`,
      (theme) => {
        save_theme_preference(theme as ThemeMode)
        // Source uses bracket notation: localStorage[key] = mode
        expect(localStorage[`matterviz-theme`]).toBe(theme)
        expect(get_theme_preference()).toBe(theme)
      },
    )

    test(`get_theme_preference defaults to auto when no preference stored`, () => {
      expect(get_theme_preference()).toBe(`auto`)
    })

    test(`get_theme_preference handles localStorage errors gracefully`, () => {
      // Temporarily replace localStorage with a throwing proxy
      const orig_localStorage = globalThis.localStorage
      Object.defineProperty(globalThis, `localStorage`, {
        get() {
          throw new Error(`localStorage not available`)
        },
        configurable: true,
      })

      expect(get_theme_preference()).toBe(`auto`)

      // Restore
      const attrs = { writable: true, configurable: true, value: orig_localStorage }
      Object.defineProperty(globalThis, `localStorage`, attrs)
    })
  })

  describe(`DOM theme application`, () => {
    test.each(Object.keys(COLOR_THEMES))(
      `apply_theme_to_dom("%s") sets CSS variables, data-theme and color-scheme`,
      (theme) => {
        apply_theme_to_dom(theme as ThemeName)

        const root = document.documentElement
        const expected = globalThis.MATTERVIZ_THEMES?.[theme as ThemeName] as {
          surface_bg: string
          text_color: string
        }
        expect(root.style.getPropertyValue(`--surface-bg`)).toBe(expected.surface_bg)
        expect(root.style.getPropertyValue(`--text-color`)).toBe(expected.text_color)
        expect(root.getAttribute(`data-theme`)).toBe(theme)
        expect(root.style.getPropertyValue(`color-scheme`)).toBe(
          THEME_TYPE[theme as ThemeName],
        )
      },
    )

    test.each([
      [true, `dark`],
      [false, `light`],
    ])(
      `apply_theme_to_dom("auto") with system preference %s resolves to "%s"`,
      (dark_preference, expected_theme) => {
        Object.defineProperty(window, `matchMedia`, {
          writable: true,
          value: vi.fn().mockImplementation(() => ({
            matches: dark_preference,
            addEventListener: vi.fn(),
          })),
        })

        apply_theme_to_dom(`auto`)
        expect(document.documentElement.getAttribute(`data-theme`)).toBe(expected_theme)
        expect(document.documentElement.style.getPropertyValue(`color-scheme`)).toBe(
          THEME_TYPE[expected_theme as ThemeName],
        )
      },
    )

    test(`apply_theme_to_dom throws error for unknown themes`, () => {
      expect(() => apply_theme_to_dom(`unknown` as ThemeName)).toThrow(
        `Invalid theme mode: unknown`,
      )
    })

    test(`apply_theme_to_dom still sets data-theme when global theme data is missing`, () => {
      globalThis.MATTERVIZ_THEMES = undefined
      globalThis.MATTERVIZ_CSS_MAP = undefined

      apply_theme_to_dom(`light`)
      expect(document.documentElement.getAttribute(`data-theme`)).toBe(`light`)
    })
  })
})
