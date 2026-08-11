import { DEFAULT_CATEGORY_COLORS, default_element_colors } from '$lib/colors'
import { colors, theme_state } from '$lib/state.svelte'
import { AUTO_THEME, COLOR_THEMES } from '$lib/theme'
import { describe, expect, test } from 'vitest'

test(`theme_state has correct initial values`, () => {
  // This test checks the actual initial values without any beforeEach reset
  // to catch breaking changes to the default theme mode
  expect(theme_state.mode).toBe(AUTO_THEME)
  expect(theme_state.system_mode).toBe(COLOR_THEMES.light)
})

describe(`State Management`, () => {
  describe(`colors state`, () => {
    test(`has correct initial values`, () => {
      expect(colors).toEqual({
        category: DEFAULT_CATEGORY_COLORS,
        element: default_element_colors,
      })
    })
  })

  describe(`theme_state`, () => {
    test(`handles localStorage errors gracefully`, async () => {
      // Mock localStorage to throw an error
      const orig_localStorage = globalThis.localStorage
      Object.defineProperty(globalThis, `localStorage`, {
        value: {
          getItem: () => {
            throw new Error(`localStorage not available`)
          },
        },
      })

      // Re-import the module to trigger the error handling
      const { theme_state: new_theme_state } = await import(`$lib/state.svelte`)

      // Should fall back to default values
      expect(new_theme_state.mode).toBe(AUTO_THEME)
      expect(new_theme_state.system_mode).toBe(COLOR_THEMES.light)

      // Restore original localStorage
      Object.defineProperty(globalThis, `localStorage`, {
        value: orig_localStorage,
        writable: true,
      })
    })

    describe(`type getter`, () => {
      test.each([
        [COLOR_THEMES.light, COLOR_THEMES.light, `light`],
        [COLOR_THEMES.dark, COLOR_THEMES.light, `dark`],
        [COLOR_THEMES.white, COLOR_THEMES.light, `light`],
        [COLOR_THEMES.black, COLOR_THEMES.light, `dark`],
        [AUTO_THEME, COLOR_THEMES.light, `light`],
        [AUTO_THEME, COLOR_THEMES.dark, `dark`],
      ])(`returns %s for mode %s with system_mode %s`, (mode, system_mode, expected_type) => {
        Object.assign(theme_state, { mode, system_mode })
        expect(theme_state.type).toBe(expected_type)
      })
    })
  })
})
