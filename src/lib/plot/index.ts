// TODO restore: import { type TweenedOptions } from 'svelte/motion'
// pending https://github.com/sveltejs/svelte/issues/16151
export interface TweenedOptions<T> {
  delay?: number
  duration?: number | ((from: T, to: T) => number)
  easing?: (t: number) => number
  interpolate?: (a: T, b: T) => (t: number) => T
}

export { default as BarPlot } from './BarPlot.svelte'
export { default as BarPlotControls } from './BarPlotControls.svelte'
export { default as ColorBar } from './ColorBar.svelte'
export { default as ColorScaleSelect } from './ColorScaleSelect.svelte'
export * from './data-transform'
export { default as ElementScatter } from './ElementScatter.svelte'
export * from './formatting'
export { default as Histogram } from './Histogram.svelte'
export { default as HistogramControls } from './HistogramControls.svelte'
export * from './interactions'
export * from './layout'
export { default as Line } from './Line.svelte'
export { default as PlotControls } from './PlotControls.svelte'
export { default as PlotLegend } from './PlotLegend.svelte'
export * from './scales'
export { default as ScatterPlot } from './ScatterPlot.svelte'
export { default as ScatterPlotControls } from './ScatterPlotControls.svelte'
export { default as ScatterPoint } from './ScatterPoint.svelte'
export { default as SpacegroupBarPlot } from './SpacegroupBarPlot.svelte'
export * from './types'

export const line_types = [`solid`, `dashed`, `dotted`] as const
export type LineType = (typeof line_types)[number]

// Define grid cell identifiers
export const cells_3x3 = [
  `top-left`,
  `top-center`,
  `top-right`,
  `middle-left`,
  `middle-center`,
  `middle-right`,
  `bottom-left`,
  `bottom-center`,
  `bottom-right`,
] as const
export const corner_cells = [
  `top-left`,
  `top-right`,
  `bottom-left`,
  `bottom-right`,
] as const

// Define the structure for GridCell and GridCellCounts for 3x3 grid
export type Cell3x3 = (typeof cells_3x3)[number]
export type Corner = (typeof corner_cells)[number]

// Default grid line style (SSOT for all plot components)
export const DEFAULT_GRID_STYLE = {
  'stroke': `var(--border-color, gray)`,
  'stroke-dasharray': `4`,
  'stroke-width': `1`,
} as const
