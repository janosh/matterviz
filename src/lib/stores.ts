import { extent } from 'd3-array'
import type { ScaleLinear } from 'd3-scale'
import { scaleLinear } from 'd3-scale'
import { writable } from 'svelte/store'
import elements from './element-data.ts'
import type { ChemicalElement } from './types'

export const active_category = writable<string | null>(null)

export const active_element = writable<ChemicalElement | null>(null)

export const last_element = writable<ChemicalElement | null>(null)
active_element.subscribe((el) => {
  if (el !== null) last_element.set(el)
})

export const heatmap = writable<keyof ChemicalElement | null>(null)

export const color_scale = writable<ScaleLinear<number, number, never> | null>(
  null
)

heatmap.subscribe((heatmap_val) => {
  if (!heatmap_val) return
  const heatmap_range = extent(elements.map((el) => el[heatmap_val] as number))
  const scale = scaleLinear().domain(heatmap_range).range([`blue`, `red`])
  color_scale.set(scale)
})
