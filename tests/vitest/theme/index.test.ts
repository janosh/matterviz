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
    test(`COLOR_THEMES contains all expected themes`, () => {
      expect(COLOR_THEMES).toEqual({
        light: `light`,
        dark: `dark`,
        white: `white`,
        black: `black`,
      })
    })

    test(`THEME_TYPE provides single source of truth for color-scheme`, () => {
      expect(THEME_TYPE).toEqual({
        light: `light`,
        dark: `dark`,
        white: `light`,
        black: `dark`,
      })
    })

    test(`THEME_TYPE covers all COLOR_THEMES`, () => {
      const theme_names = Object.keys(COLOR_THEMES)
      const type_keys = Object.keys(THEME_TYPE)

      expect(type_keys).toEqual(expect.arrayContaining(theme_names))
      expect(type_keys).toHaveLength(theme_names.length)
    })

    test.each(
      [
        ...Object.keys(COLOR_THEMES).map((theme) => [theme, true] as const),
        [`auto`, true],
        [`invalid`, false],
        [``, false],
        [null, false],
        [undefined, false],
      ] as const,
    )(`is_valid_theme_mode("%s") returns %s`, (input, expected) => {
      expect(is_valid_theme_mode(input as string)).toBe(expected)
    })

    test.each(
      [
        ...Object.keys(COLOR_THEMES).map((theme) => [theme, true] as const),
        [`auto`, false],
        [`invalid`, false],
        [``, false],
        [null, false],
        [undefined, false],
      ] as const,
    )(`is_valid_theme_name("%s") returns %s`, (input, expected) => {
      expect(is_valid_theme_name(input as string)).toBe(expected)
    })
  })

  describe(`Theme resolution`, () => {
    test.each(
      [
        [`auto`, `light`, `light`],
        [`auto`, `dark`, `dark`],
        [`light`, `dark`, `light`],
        [`dark`, `light`, `dark`],
        [`white`, `dark`, `white`],
        [`black`, `light`, `black`],
      ] as const,
    )(
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
      `save_theme_preference stores "%s" in localStorage`,
      (theme) => {
        save_theme_preference(theme as ThemeMode)
        expect(localStorage.getItem(`matterviz-theme`)).toBe(theme)
      },
    )

    test.each([...Object.keys(COLOR_THEMES), `auto`])(
      `get_theme_preference retrieves stored theme "%s"`,
      (theme) => {
        localStorage.setItem(`matterviz-theme`, theme)
        expect(get_theme_preference()).toBe(theme)
      },
    )

    test(`get_theme_preference defaults to auto when no preference stored`, () => {
      expect(get_theme_preference()).toBe(`auto`)
    })

    test(`get_theme_preference handles localStorage errors gracefully`, () => {
      // Mock localStorage.getItem to throw
      const original_get_item = localStorage.getItem
      localStorage.getItem = vi.fn().mockImplementation(() => {
        throw new Error(`localStorage not available`)
      })

      expect(get_theme_preference()).toBe(`auto`)

      // Restore
      localStorage.getItem = original_get_item
    })
  })

  describe(`DOM theme application`, () => {
    test.each(Object.keys(COLOR_THEMES))(
      `apply_theme_to_dom("%s") sets CSS variables correctly`,
      (theme) => {
        apply_theme_to_dom(theme as ThemeName)

        const root = document.documentElement
        const expected = globalThis.MATTERVIZ_THEMES[theme as ThemeName] as {
          surface_bg: string
          text_color: string
        }
        expect(root.style.getPropertyValue(`--surface-bg`)).toBe(expected.surface_bg)
        expect(root.style.getPropertyValue(`--text-color`)).toBe(expected.text_color)
      },
    )

    test.each(Object.keys(COLOR_THEMES))(
      `apply_theme_to_dom("%s") sets data-theme attribute`,
      (theme) => {
        apply_theme_to_dom(theme as ThemeName)
        expect(document.documentElement.getAttribute(`data-theme`)).toBe(theme)
      },
    )

    test.each([[true, `dark`], [false, `light`]])(
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

    test(`apply_theme_to_dom handles missing theme data gracefully`, () => {
      globalThis.MATTERVIZ_THEMES = {
        light: {},
        dark: {},
        white: {},
        black: {},
      }
      globalThis.MATTERVIZ_CSS_MAP = {}

      expect(() => apply_theme_to_dom(`light`)).not.toThrow()
    })

    test(`apply_theme_to_dom handles missing global data gracefully`, () => {
      // @ts-expect-error - setting bad types for testing
      globalThis.MATTERVIZ_THEMES = undefined
      // @ts-expect-error - setting bad types for testing
      globalThis.MATTERVIZ_CSS_MAP = undefined

      expect(() => apply_theme_to_dom(`light`)).not.toThrow()
    })
  })

  describe(`Color scheme mapping consistency`, () => {
    test(`THEME_TYPE maps all COLOR_THEMES to valid color-scheme values`, () => {
      const theme_names = Object.keys(COLOR_THEMES) as ThemeName[]
      const valid_schemes = [`light`, `dark`]

      for (const theme of theme_names) {
        expect(valid_schemes).toContain(THEME_TYPE[theme])
      }
    })

    test(`adding new themes requires updating THEME_TYPE`, () => {
      const theme_names = Object.keys(COLOR_THEMES)
      const type_keys = Object.keys(THEME_TYPE)

      expect(type_keys.sort()).toEqual(theme_names.sort())
    })
  })

  describe(`Integration workflows`, () => {
    test.each(Object.keys(COLOR_THEMES))(`full workflow for theme "%s"`, (theme) => {
      save_theme_preference(theme as ThemeMode)
      expect(get_theme_preference()).toBe(theme)

      apply_theme_to_dom(theme as ThemeName)

      const root = document.documentElement
      expect(root.getAttribute(`data-theme`)).toBe(theme)
      const expected = globalThis.MATTERVIZ_THEMES[theme as ThemeName] as {
        surface_bg: string
        text_color: string
      }
      expect(root.style.getPropertyValue(`--surface-bg`)).toBe(expected.surface_bg)
      expect(root.style.getPropertyValue(`--text-color`)).toBe(expected.text_color)
      expect(root.style.getPropertyValue(`color-scheme`)).toBe(
        THEME_TYPE[theme as ThemeName],
      )
    })

    test.each([
      [true, `dark`],
      [false, `light`],
    ])(
      `auto mode workflow with system preference %s`,
      (dark_preference, expected_theme) => {
        Object.defineProperty(window, `matchMedia`, {
          writable: true,
          value: vi.fn().mockImplementation(() => ({
            matches: dark_preference,
            addEventListener: vi.fn(),
          })),
        })

        save_theme_preference(`auto`)
        apply_theme_to_dom(`auto`)

        expect(document.documentElement.getAttribute(`data-theme`)).toBe(expected_theme)
        expect(document.documentElement.style.getPropertyValue(`color-scheme`)).toBe(
          THEME_TYPE[expected_theme as ThemeName],
        )
      },
    )
  })

  describe(`Theme data integrity`, () => {
    test(`all theme keys have complete variant coverage`, () => {
      const theme_names = Object.keys(globalThis.MATTERVIZ_THEMES)
      const first_theme = globalThis.MATTERVIZ_THEMES[theme_names[0] as ThemeName]
      const expected_keys = Object.keys(first_theme)
      const missing_variants: string[] = []

      for (const theme_name of theme_names) {
        const theme_keys = Object.keys(
          globalThis.MATTERVIZ_THEMES[theme_name as ThemeName],
        )
        for (const key of expected_keys) {
          if (!theme_keys.includes(key)) {
            missing_variants.push(`${key} missing from theme: ${theme_name}`)
          }
        }
      }

      expect(missing_variants).toEqual([])
    })

    test(`all theme variants have consistent keys`, () => {
      const theme_names = Object.keys(globalThis.MATTERVIZ_THEMES)
      const first_theme = globalThis.MATTERVIZ_THEMES[theme_names[0] as ThemeName]
      const expected_keys = Object.keys(first_theme)

      for (const theme_name of theme_names) {
        const theme_keys = Object.keys(
          globalThis.MATTERVIZ_THEMES[theme_name as ThemeName],
        )
        expect(theme_keys).toEqual(expected_keys)
      }
    })
  })
})
