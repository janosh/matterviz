import type { ChemicalElement, ElementCategory } from '#lib/element/types.js'
import { DEFAULT_CATEGORY_COLORS, default_element_colors } from './colors'
import { get_theme_preference, type ThemeMode } from './theme'

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
export const theme_state = $state<{ mode: ThemeMode }>({ mode: get_theme_preference() })

// The page's --text-color as a concrete color. The custom property reads back as specified
// (`light-dark(#374151, #eee)` under the default themes), so resolve it through a probe's
// computed `color`. Reads theme_state.mode so a $derived caller re-resolves when the theme
// flips. Undefined without a DOM or when no --text-color is set.
export const resolve_theme_text_color = (): string | undefined => {
  void theme_state.mode
  if (typeof document === `undefined`) return undefined
  const root = document.documentElement
  if (!getComputedStyle(root).getPropertyValue(`--text-color`).trim()) return undefined
  const probe = document.createElement(`span`)
  probe.style.color = `var(--text-color)`
  root.append(probe)
  const { color } = getComputedStyle(probe)
  probe.remove()
  return color || undefined
}
