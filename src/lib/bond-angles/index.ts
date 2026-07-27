export * from './calc-bond-angles'
export * from './series'
export { default as BondAnglePlot } from './BondAnglePlot.svelte'

export const SPLIT_MODES = {
  by_triplet: `By Triplet`,
  by_structure: `By Structure`,
  none: `Combined`,
} as const
export type SplitMode = keyof typeof SPLIT_MODES

// Raw counts scale with cell size, so several structures are only comparable as densities
export const NORMALIZE_MODES = {
  counts: `Counts`,
  density: `Density`,
} as const
export type NormalizeMode = keyof typeof NORMALIZE_MODES
