import app_css from '$lib/app.css?raw'
import type { ThemeMode, ThemeName } from '$lib/theme'
import {
  apply_theme_to_dom,
  COLOR_THEMES,
  get_system_mode,
  get_theme_preference,
  is_valid_theme_mode,
  is_valid_theme_name,
  save_theme_preference,
  THEME_TYPE,
} from '$lib/theme'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mock_match_media = (matches: boolean) => {
  Object.defineProperty(window, `matchMedia`, {
    writable: true,
    value: vi.fn(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  })
}

describe(`Theme System`, () => {
  beforeEach(() => {
    document.documentElement.removeAttribute(`style`)
    delete document.documentElement.dataset.theme
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
      ...Object.keys(COLOR_THEMES).map((theme) => [theme, true, true] as const),
      [`auto`, false, true],
      [`invalid`, false, false],
      [``, false, false],
      [`toString`, false, false], // inherited object keys are not themes
      [null, false, false],
      [undefined, false, false],
    ] as const)(
      `"%s": is_valid_theme_name=%s, is_valid_theme_mode=%s`,
      (input, is_name, is_mode) => {
        expect(is_valid_theme_name(input as string)).toBe(is_name)
        expect(is_valid_theme_mode(input as string)).toBe(is_mode)
      },
    )
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

    test(`get_theme_preference defaults to auto when nothing is stored or localStorage throws`, () => {
      expect(get_theme_preference()).toBe(`auto`)
      const orig_localStorage = globalThis.localStorage
      Object.defineProperty(globalThis, `localStorage`, {
        get() {
          throw new Error(`localStorage not available`)
        },
        configurable: true,
      })
      expect(get_theme_preference()).toBe(`auto`)
      const attrs = { writable: true, configurable: true, value: orig_localStorage }
      Object.defineProperty(globalThis, `localStorage`, attrs)
    })
  })

  describe(`DOM theme application`, () => {
    // The whole runtime contract: the palette name and the scheme light-dark() resolves against
    test.each(Object.keys(COLOR_THEMES))(
      `apply_theme_to_dom("%s") sets data-theme and color-scheme and nothing else`,
      (theme) => {
        apply_theme_to_dom(theme as ThemeName)
        const root = document.documentElement
        expect(root.dataset.theme).toBe(theme)
        expect(root.style.colorScheme).toBe(THEME_TYPE[theme as ThemeName])
        expect(root.style).toHaveLength(1)
      },
    )

    test(`app.css defines every token once as light-dark() with white/black overrides`, () => {
      const tokens = /:root,\s*:host \{(?<body>[^}]+)\}/.exec(app_css)?.groups?.body ?? ``
      expect(tokens).toContain(`color-scheme: light dark;`)
      expect(tokens).toContain(
        `--btn-bg: light-dark(rgba(0, 0, 0, 0.12), rgba(255, 255, 255, 0.09));`,
      )
      expect(tokens).toContain(`--text-color: light-dark(#374151, #eee);`)
      // same in both schemes: a plain value, not a light-dark() pair
      expect(tokens).toContain(`--plot-bg: transparent;`)
      for (const [variant, page_bg] of [
        [`white`, `#ffffff`],
        [`black`, `#000000`],
      ]) {
        const override = new RegExp(
          `:root\\[data-theme='${variant}'\\],\\s*:host\\(\\[data-theme='${variant}'\\]\\) \\{[^}]*--page-bg: ${page_bg};`,
        )
        expect(app_css).toMatch(override)
      }
      // no token is defined twice at the root
      const names = [...tokens.matchAll(/^\s+(?<name>--[\w-]+):/gm)].map((m) => m.groups?.name)
      expect(new Set(names).size).toBe(names.length)
    })

    test.each([
      [true, `dark`],
      [false, `light`],
    ] as const)(
      `OS prefers dark=%s: get_system_mode and apply_theme_to_dom("auto") resolve to "%s"`,
      (dark_preference, expected_theme) => {
        mock_match_media(dark_preference)
        expect(get_system_mode()).toBe(expected_theme)
        apply_theme_to_dom(`auto`)
        expect(document.documentElement.dataset.theme).toBe(expected_theme)
        expect(document.documentElement.style.colorScheme).toBe(expected_theme)
      },
    )

    test(`apply_theme_to_dom throws error for unknown themes`, () => {
      expect(() => apply_theme_to_dom(`unknown` as ThemeName)).toThrow(
        `Invalid theme mode: unknown`,
      )
    })
  })
})
