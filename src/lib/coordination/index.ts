export * from './calc-coordination'
export { default as CoordinationBarPlot } from './CoordinationBarPlot.svelte'

export const COORDINATION_SPLIT_MODES = {
  by_element: `By Element`,
  by_structure: `By Structure`,
  none: `Combined`,
} as const
export type CoordinationSplitMode = keyof typeof COORDINATION_SPLIT_MODES
