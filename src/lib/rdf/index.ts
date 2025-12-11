import type { Pbc } from '$lib/structure'

export { calculate_all_pair_rdfs, calculate_rdf } from './calc-rdf'
export { default as RdfPlot } from './RdfPlot.svelte'

export type RdfPattern = {
  r: number[]
  g_r: number[]
  element_pair?: [string, string]
}

export interface RdfEntry {
  label: string
  pattern: RdfPattern
  color?: string
  legend_group?: string // Group name for legend grouping (e.g., structure name)
}

export interface RdfOptions {
  center_species?: string
  neighbor_species?: string
  cutoff?: number
  n_bins?: number
  pbc?: Pbc
  auto_expand?: boolean
  expansion_factor?: number
}
