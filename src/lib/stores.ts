import type { Category, ChemicalElement } from '$lib'
import { session_store } from 'svelte-zoo/stores'
import { writable } from 'svelte/store'
import { default_category_colors, default_element_colors } from './colors'

export const active_category = writable<Category | null>(null)

export const active_element = writable<ChemicalElement | null>(null)

export const last_element = writable<ChemicalElement | null>(null)
active_element.subscribe((el) => {
  if (el !== null) last_element.set(el)
})

export const heatmap_key = writable<keyof ChemicalElement | null>(null)

export const show_icons = session_store<boolean>(`show-icons`, true)

export const category_colors = session_store<Record<string, string>>(
  `category-colors`,
  { ...default_category_colors },
)

export const element_colors = session_store<typeof default_element_colors>(
  `element-colors`,
  { ...default_element_colors },
)
