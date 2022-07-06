import { extent } from 'd3-array'
import { ScaleLinear, scaleLinear } from 'd3-scale'
import { writable } from 'svelte/store'
import elements from './periodic-table-data.ts'
import { ChemicalElement } from './types'

export const active_category = writable<string | null>(null)

export const active_element = writable<ChemicalElement | null>(null)
export const last_element = writable<ChemicalElement | null>(null)
active_element.subscribe((el) => {
  if (el) last_element.set(el)
})

export const heatmap = writable<keyof ChemicalElement | null>(null)

export const color_scale = writable<ScaleLinear<number, number, never> | null>(
  null
)

heatmap.subscribe((heatmap_val) => {
  const heatmap_range = extent(elements.map((el) => el[heatmap_val]))
  const scale = scaleLinear().domain(heatmap_range).range([`blue`, `red`])
  color_scale.set(scale)
})
