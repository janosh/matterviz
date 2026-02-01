import { DEFAULT_CATEGORY_COLORS, default_element_colors } from '$lib/colors'
import { colors, theme_state } from '$lib/state.svelte'
import { AUTO_THEME, COLOR_THEMES, THEME_TYPE } from '$lib/theme'
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

    test(`preserves other colors when mutating specific ones`, () => {
      const orig_noble_gas = colors.category[`noble gas`]
      colors.category[`alkali metal`] = `#ff0000`
      expect(colors.category[`noble gas`]).toBe(orig_noble_gas)
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

    test.each([[`mode`, COLOR_THEMES.dark], [`system_mode`, COLOR_THEMES.dark]] as const)(
      `allows %s mutations`,
      (key, value) => {
        theme_state[key] = value
        expect(theme_state[key]).toBe(value)
      },
    )

    describe(`type getter`, () => {
      test.each([
        [COLOR_THEMES.light, COLOR_THEMES.light, `light`],
        [COLOR_THEMES.dark, COLOR_THEMES.light, `dark`],
        [COLOR_THEMES.white, COLOR_THEMES.light, `light`],
        [COLOR_THEMES.black, COLOR_THEMES.light, `dark`],
        [AUTO_THEME, COLOR_THEMES.light, `light`],
        [AUTO_THEME, COLOR_THEMES.dark, `dark`],
      ])(
        `returns %s for mode %s with system_mode %s`,
        (mode, system_mode, expected_type) => {
          Object.assign(theme_state, { mode, system_mode })
          expect(theme_state.type).toBe(expected_type)
        },
      )

      test.each([
        [AUTO_THEME, `uses system_mode when mode is AUTO_THEME`],
        [COLOR_THEMES.black, `uses mode when mode is not AUTO_THEME`],
      ])(`correctly handles %s`, (mode, _description) => {
        theme_state.mode = mode
        theme_state.system_mode = COLOR_THEMES.dark
        const expected = mode === AUTO_THEME
          ? `dark`
          : THEME_TYPE[mode as keyof typeof THEME_TYPE]
        expect(theme_state.type).toBe(expected)
      })

      test(`handles all theme modes correctly`, () => {
        Object.entries(THEME_TYPE).forEach(([theme_mode, expected_type]) => {
          theme_state.mode = theme_mode as keyof typeof THEME_TYPE
          theme_state.system_mode = COLOR_THEMES.light
          expect(theme_state.type).toBe(expected_type)
        })
      })
    })
  })
})
