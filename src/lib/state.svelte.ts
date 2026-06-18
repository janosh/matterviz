import type { ChemicalElement, ElementCategory } from '$lib/element/types'
import { AUTO_THEME, COLOR_THEMES, THEME_TYPE } from '$lib/theme/index'
import { DEFAULT_CATEGORY_COLORS, default_element_colors } from './colors'
import { get_theme_preference, type ThemeMode, type ThemeType } from './theme'

export const selected = $state<{
  category: ElementCategory | null
  element: ChemicalElement | null
  last_element: ChemicalElement | null
  heatmap_key: keyof ChemicalElement | null
}>({
  category: null,
  element: null,
  last_element: null,
  heatmap_key: null,
})

export const colors = $state<{
  category: typeof DEFAULT_CATEGORY_COLORS
  element: typeof default_element_colors
}>({
  category: { ...DEFAULT_CATEGORY_COLORS },
  element: { ...default_element_colors },
})

// Theme state with safe initialization (get_theme_preference handles SSR +
// missing/invalid localStorage, falling back to AUTO_THEME)
const initial_theme_mode: ThemeMode = get_theme_preference()
const initial_system_mode: ThemeType = COLOR_THEMES.light

export const theme_state = $state<{
  mode: ThemeMode
  system_mode: ThemeType
  type: ThemeType
}>({
  mode: initial_theme_mode,
  system_mode: initial_system_mode,
  get type() {
    // For AUTO_THEME, use system_mode, otherwise lookup the mode in THEME_TYPE
    const effective_mode = this.mode === AUTO_THEME ? this.system_mode : this.mode
    return THEME_TYPE[effective_mode as keyof typeof THEME_TYPE]
  },
})
