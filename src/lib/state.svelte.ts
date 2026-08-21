import type { ChemicalElement, ElementCategory } from '$lib/element/types'
import { DEFAULT_CATEGORY_COLORS, default_element_colors } from './colors'
import { COLOR_THEMES, get_theme_preference, type ThemeMode, type ThemeType } from './theme'

// Periodic-table hover/selection state shared between the table, its controls and
// the element detail pages
export const selected = $state<{
  category: ElementCategory | null
  element: ChemicalElement | null
  heatmap_key: keyof ChemicalElement | null
}>({ category: null, element: null, heatmap_key: null })

export const colors = $state({
  category: { ...DEFAULT_CATEGORY_COLORS },
  element: { ...default_element_colors },
})

// get_theme_preference handles SSR + missing/invalid localStorage (falls back to AUTO_THEME)
export const theme_state = $state<{ mode: ThemeMode; system_mode: ThemeType }>({
  mode: get_theme_preference(),
  system_mode: COLOR_THEMES.light,
})
