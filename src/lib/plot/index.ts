import type { Point } from '$lib'

export { default as ColorBar } from './ColorBar.svelte'
export { default as ColorScaleSelect } from './ColorScaleSelect.svelte'
export { default as ElementScatter } from './ElementScatter.svelte'
export { default as Line } from './Line.svelte'
export { default as ScatterPlot } from './ScatterPlot.svelte'
export { default as ScatterPoint } from './ScatterPoint.svelte'

// Types for ScatterPoint
export type PointStyle = {
  fill?: string
  stroke?: string
  radius?: number
  fill_opacity?: number
  stroke_opacity?: number
  stroke_width?: number
}

export type HoverStyle = {
  enabled?: boolean
  scale?: number
  stroke?: string
  stroke_width?: number
}

export type LabelStyle = {
  text?: string
  offset_x?: number
  offset_y?: number
  font_size?: string
  font_family?: string
}

export type DataSeries<T = unknown> = {
  x: number[]
  y: number[]
  metadata?: T
  point_style?: PointStyle
  point_hover?: HoverStyle
  point_label?: LabelStyle
  point_offset?: Point[`offset`]
  point_tween_duration?: number
}
