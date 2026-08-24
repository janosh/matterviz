import { DEFAULT_CATEGORY_COLORS, default_element_colors } from '$lib/colors'
import { colors, theme_state } from '$lib/state.svelte'
import { AUTO_THEME } from '$lib/theme'
import { expect, test } from 'vitest'

test(`theme_state starts in auto mode`, () => {
  expect(theme_state).toEqual({ mode: AUTO_THEME })
})

test(`colors state starts from the default palettes as independent copies`, () => {
  expect(colors).toEqual({
    category: DEFAULT_CATEGORY_COLORS,
    element: default_element_colors,
  })
  expect(colors.element).not.toBe(default_element_colors)
})
