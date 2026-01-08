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
export { default as ElementScatter } from './ElementScatter.svelte'
export * from './fill-utils'
export { default as FillArea } from './FillArea.svelte'
export { default as Histogram } from './Histogram.svelte'
export { default as HistogramControls } from './HistogramControls.svelte'
export * from './layout'
export { default as Line } from './Line.svelte'
export { default as PlotControls } from './PlotControls.svelte'
export { default as PlotLegend } from './PlotLegend.svelte'
export { default as PlotTooltip } from './PlotTooltip.svelte'
export * from './reference-line'
export { default as ReferenceLine } from './ReferenceLine.svelte'
export { default as ReferenceLine3D } from './ReferenceLine3D.svelte'
export { default as ReferencePlane } from './ReferencePlane.svelte'
export * from './scales'
export { default as ScatterPlot } from './ScatterPlot.svelte'
export { default as ScatterPlot3D } from './ScatterPlot3D.svelte'
export { default as ScatterPlot3DControls } from './ScatterPlot3DControls.svelte'
export { default as ScatterPlot3DScene } from './ScatterPlot3DScene.svelte'
export { default as ScatterPlotControls } from './ScatterPlotControls.svelte'
export { default as ScatterPoint } from './ScatterPoint.svelte'
export { default as SpacegroupBarPlot } from './SpacegroupBarPlot.svelte'
export { default as Surface3D } from './Surface3D.svelte'
export * from './svg'
export * from './types'
