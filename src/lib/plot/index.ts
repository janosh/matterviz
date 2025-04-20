import type { Point } from '$lib'

export { default as ColorBar } from './ColorBar.svelte'
export { default as ColorScaleSelect } from './ColorScaleSelect.svelte'
export { default as ElementScatter } from './ElementScatter.svelte'
export { default as Line } from './Line.svelte'
export { default as ScatterPlot } from './ScatterPlot.svelte'
export { default as ScatterPoint } from './ScatterPoint.svelte'

// Define available marker types based on d3-shape symbols
export type MarkerType =
  | `circle`
  | `cross`
  | `diamond`
  | `square`
  | `star`
  | `triangle`
  | `wye`

export interface PointStyle {
  fill?: string
  radius?: number
  stroke?: string
  stroke_width?: number
  stroke_opacity?: number
  fill_opacity?: number
  marker_type?: MarkerType
  marker_size?: number | null // Optional override for marker size
}

export interface HoverStyle {
  enabled?: boolean
  scale?: number
  stroke?: string
  stroke_width?: number
}

export interface LabelStyle {
  text?: string
  offset_x?: number // Default offset if auto_placement is false
  offset_y?: number // Default offset if auto_placement is false
  font_size?: string
  font_family?: string
  auto_placement?: boolean // Enable/disable auto-placement
}

// Extend the base Point type to include optional styling and metadata
export interface PlotPoint extends Point {
  color_value?: number | null
  metadata?: Record<string, unknown>
  point_style?: PointStyle
  point_hover?: HoverStyle
  point_label?: LabelStyle
  point_offset?: { x: number; y: number } // Individual point offset (distinct from label offset)
  point_tween_duration?: number
}

// Define the structure for a data series in the plot
export interface DataSeries {
  x: number[]
  y: number[]
  color_values?: (number | null)[] | null
  metadata?: Record<string, unknown>[] | Record<string, unknown> // Can be array or single object
  point_style?: PointStyle[] | PointStyle // Can be array or single object
  point_hover?: HoverStyle[] | HoverStyle // Can be array or single object
  point_label?: LabelStyle[] | LabelStyle // Can be array or single object
  point_offset?: { x: number; y: number }[] | { x: number; y: number } // Can be array or single object
  point_tween_duration?: number
}

// Represents the internal structure used within ScatterPlot, merging series-level and point-level data
export interface InternalPoint extends PlotPoint {
  series_idx: number // Index of the series this point belongs to
  point_idx: number // Index of the point within its series
  // Inherits all properties from PlotPoint
}
