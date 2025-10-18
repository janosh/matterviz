export * from './calc-coordination'
export { default as CoordinationBarPlot } from './CoordinationBarPlot.svelte'

export const SPLIT_MODES = {
  by_element: `By Element`,
  by_structure: `By Structure`,
  none: `Combined`,
} as const
export type SplitMode = keyof typeof SPLIT_MODES
