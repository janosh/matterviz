import { DEFAULT_CATEGORY_COLORS, default_element_colors } from '$lib/colors'
import { colors, theme_state } from '$lib/state.svelte'
import { AUTO_THEME, COLOR_THEMES } from '$lib/theme'
import { expect, test } from 'vitest'

test(`theme_state starts in auto mode with a light system fallback`, () => {
  expect(theme_state.mode).toBe(AUTO_THEME)
  expect(theme_state.system_mode).toBe(COLOR_THEMES.light)
})

test(`colors state starts from the default palettes as independent copies`, () => {
  expect(colors).toEqual({
    category: DEFAULT_CATEGORY_COLORS,
    element: default_element_colors,
  })
  expect(colors.element).not.toBe(default_element_colors)
})
