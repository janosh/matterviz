import { ColorBar } from '$lib'
import { type SimulationNodeDatum } from 'd3-force'
import type { ComponentProps } from 'svelte'
import { type TweenedOptions } from 'svelte/motion'
import PlotLegend from './PlotLegend.svelte'

export { default as ColorBar } from './ColorBar.svelte'
export { default as ColorScaleSelect } from './ColorScaleSelect.svelte'
export { default as ElementScatter } from './ElementScatter.svelte'
export { default as Line } from './Line.svelte'
export { default as PlotLegend } from './PlotLegend.svelte'
export { default as ScatterPlot } from './ScatterPlot.svelte'

export { default as ScatterPoint } from './ScatterPoint.svelte'

export type XyObj = { x: number; y: number }
export type Sides = { t?: number; b?: number; l?: number; r?: number }

// Define available marker types based on d3-shape symbols
export const marker_types = [
  `circle`,
  `cross`,
  `diamond`,
  `square`,
  `star`,
  `triangle`,
  `wye`,
] as const
export type MarkerType = (typeof marker_types)[number]

export const line_types = [`solid`, `dashed`, `dotted`] as const
export type LineType = (typeof line_types)[number]

export type Point = {
  x: number
  y: number
  metadata?: { [key: string]: unknown }
  offset?: XyObj
}

export interface PointStyle {
  fill?: string
  radius?: number
  stroke?: string
  stroke_width?: number
  stroke_opacity?: number
  fill_opacity?: number
  marker_type?: MarkerType
  marker_size?: number | null // Optional override for marker size
  shape?: string // Add optional shape (string for flexibility)
}

export interface HoverStyle {
  enabled?: boolean
  scale?: number
  stroke?: string
  stroke_width?: number
}

export interface LabelStyle {
  text?: string
  offset?: XyObj // Replace offset_x and offset_y with a single offset object
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
  point_offset?: XyObj // Individual point offset (distinct from label offset)
  point_tween?: TweenedOptions<XyObj>
}

// Define the structure for a data series in the plot
export interface DataSeries {
  x: readonly number[]
  y: readonly number[]
  // Optional marker display type override for this specific series
  markers?: `line` | `points` | `line+points`
  color_values?: (number | null)[] | null
  size_values?: readonly (number | null)[] | null
  metadata?: Record<string, unknown>[] | Record<string, unknown> // Can be array or single object
  point_style?: PointStyle[] | PointStyle // Can be array or single object
  point_hover?: HoverStyle[] | HoverStyle // Can be array or single object
  point_label?: LabelStyle[] | LabelStyle // Can be array or single object
  point_offset?: XyObj[] | XyObj // Can be array or single object
  point_tween?: TweenedOptions<XyObj>
  visible?: boolean // Optional visibility flag
  label?: string // Optional series label for legend
}

// Represents the internal structure used within ScatterPlot, merging series-level and point-level data
export interface InternalPoint extends PlotPoint {
  series_idx: number // Index of the series this point belongs to
  point_idx: number // Index of the point within its series
  size_value?: number | null // Size value for the point
}

export type TooltipProps = {
  x: number
  y: number
  cx: number
  cy: number
  x_formatted: string
  y_formatted: string
  metadata?: Record<string, unknown>
  color_value?: number | null
  label?: string | null
}

export type TimeInterval = `day` | `month` | `year`
export type ScaleType = `linear` | `log`
export type QuadrantCounts = {
  top_left: number
  top_right: number
  bottom_left: number
  bottom_right: number
}

// Type for nodes used in the d3-force simulation for label placement
export interface LabelNode extends SimulationNodeDatum {
  id: string // unique identifier, e.g., series_idx-point_idx
  anchor_x: number // Original x coordinate of the point (scaled)
  anchor_y: number // Original y coordinate of the point (scaled)
  point_node: InternalPoint // Reference to the original data point
  label_width: number // Estimated width for collision
  label_height: number // Estimated height for collision
  // x, y, vx, vy are added by d3-force
}

// Configuration for the label auto-placement simulation
export interface LabelPlacementConfig {
  collision_strength: number // Strength of the collision force (prevents overlap)
  link_strength: number // Strength of the link force (pulls label to point)
  link_distance: number // Target distance for the link force
  placement_ticks: number // Number of simulation ticks to run
  link_distance_range?: [number | null, number | null] // Optional [min, max] range for distance between label and anchor
}
export type HoverConfig = {
  threshold_px: number // Max screen distance (pixels) to trigger hover
}

// Type for anchor nodes used in simulation, now including point radius
export interface AnchorNode extends SimulationNodeDatum {
  id: string
  fx: number
  fy: number
  point_radius: number // Radius of the corresponding scatter point
  show_color_bar?: boolean // Whether to show the color bar when color scaling is active
  color_bar?: ComponentProps<typeof ColorBar> | null
  // Label auto-placement simulation parameters
  label_placement_config?: Partial<LabelPlacementConfig>
}

// Type for PlotLegend props forwarded from ScatterPlot props
export type LegendConfig = Omit<
  ComponentProps<typeof PlotLegend>,
  `series_data` | `on_toggle`
> & {
  margin?: number | Sides
  tween?: TweenedOptions<XyObj>
  responsive?: boolean // Allow legend to move if density changes (default: false)
}

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

// attributes for each item passed to the legend
export interface LegendItem {
  label: string
  visible: boolean
  series_idx: number
  display_style: {
    marker_shape?: MarkerType // Allow various shapes
    marker_color?: string
    line_type?: LineType // Allow various styles
    line_color?: string
  }
}
