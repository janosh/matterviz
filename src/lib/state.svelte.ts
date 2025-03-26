import type { Category, ChemicalElement } from '$lib'
import { default_category_colors, default_element_colors } from './colors'

export const selected = $state<{
  category: Category | null
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
  category: typeof default_category_colors
  element: typeof default_element_colors
}>({
  category: { ...default_category_colors },
  element: { ...default_element_colors },
})
