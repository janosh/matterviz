export * from './calc-bond-angles'
export * from './series'
export { default as BondAnglePlot } from './BondAnglePlot.svelte'

export const BOND_ANGLE_SPLIT_MODES = {
  by_triplet: `By Triplet`,
  by_structure: `By Structure`,
  none: `Combined`,
} as const
export type BondAngleSplitMode = keyof typeof BOND_ANGLE_SPLIT_MODES

// Raw counts scale with cell size, so several structures are only comparable as densities
export const BOND_ANGLE_NORMALIZE_MODES = {
  counts: `Counts`,
  density: `Density`,
} as const
export type BondAngleNormalizeMode = keyof typeof BOND_ANGLE_NORMALIZE_MODES
