import type DraggablePane from '$lib/DraggablePane.svelte'
import type { SimulationNodeDatum } from 'd3-force'
import type { ComponentProps, Snippet } from 'svelte'
import type { HTMLAttributes } from 'svelte/elements'
import type ColorBar from './ColorBar.svelte'
import PlotLegend from './PlotLegend.svelte'
import type { D3SymbolName } from './formatting'
import type { TicksOption } from './scales'

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
export { default as Histogram } from './Histogram.svelte'
export { default as HistogramControls } from './HistogramControls.svelte'
export { default as Line } from './Line.svelte'
export { default as PlotControls } from './PlotControls.svelte'
export { default as PlotLegend } from './PlotLegend.svelte'
export { default as ScatterPlot } from './ScatterPlot.svelte'
export { default as ScatterPlotControls } from './ScatterPlotControls.svelte'
export { default as ScatterPoint } from './ScatterPoint.svelte'
export * from './data-transform'
export * from './formatting'
export * from './interactions'
export * from './layout'
export * from './scales'

export type XyObj = { x: number; y: number }
export type Sides = { t?: number; b?: number; l?: number; r?: number }

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
  symbol_type?: D3SymbolName
  symbol_size?: number | null // Optional override for marker size
  shape?: string // Add optional shape (string for flexibility)
  cursor?: string // Cursor style for the point
}

export interface HoverStyle {
  enabled?: boolean
  scale?: number
  stroke?: string
  stroke_width?: number
  brightness?: number
}

export interface LabelStyle {
  text?: string
  offset?: XyObj
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

export type Markers = `line` | `points` | `line+points`

// Define the structure for a data series in the plot
export interface DataSeries {
  x: readonly number[]
  y: readonly number[]
  // Optional marker display type override for this specific series
  markers?: Markers
  // Specify which y-axis to use: 'y1' (left, default) or 'y2' (right)
  y_axis?: `y1` | `y2`
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
  unit?: string // Optional unit for the series (e.g., "eV", "eV/Å", "GPa")
  line_style?: {
    stroke?: string
    stroke_width?: number
    line_dash?: string
  }
}

// Represents the internal structure used within ScatterPlot, merging series-level and point-level data
export interface InternalPoint extends PlotPoint {
  series_idx: number // Index of the series this point belongs to
  point_idx: number // Index of the point within its series
  size_value?: number | null // Size value for the point
}

export interface Tooltip {
  show: boolean
  x: number
  y: number
  title?: string
  items?: { label: string; value: string; color?: string }[]
}

export interface TooltipProps {
  x: number
  y: number
  metadata?: Record<string, unknown> | null
  color?: string | null
  label?: string | null
  series_idx: number
}

export interface ScatterTooltipProps extends TooltipProps {
  cx: number
  cy: number
  x_formatted: string
  y_formatted: string
}

export interface BarTooltipProps extends TooltipProps {
  bar_idx: number
  orient_x: number
  orient_y: number
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
export type LegendConfig =
  & Omit<
    ComponentProps<typeof PlotLegend>,
    `series_data` | `on_drag_start` | `on_drag` | `on_drag_end`
  >
  & {
    margin?: number | Sides
    tween?: TweenedOptions<XyObj>
    responsive?: boolean // Allow legend to move if density changes (default: false)
    draggable?: boolean // Allow legend to be dragged (default: true)
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
    symbol_type?: D3SymbolName
    symbol_color?: string
    line_color?: string
    line_dash?: string
  }
}

export type UserContentProps = {
  height: number
  width: number
  x_scale_fn: (x: number) => number
  y_scale_fn: (y: number) => number
  pad: Required<Sides>
  x_min: number
  y_min: number
  x_max: number
  y_max: number
}

export type Orientation = `vertical` | `horizontal`
export type BarMode = `overlay` | `stacked` | `grouped`

export interface BarSeries {
  x: readonly number[]
  y: readonly number[]
  label?: string
  color?: string
  bar_width?: number | readonly number[]
  visible?: boolean
  metadata?: Record<string, unknown>[] | Record<string, unknown>
  labels?: readonly (string | null | undefined)[]
  render_mode?: `bar` | `line` // Render as bars (default) or as a line
  line_style?: {
    stroke_width?: number
    line_dash?: string
  }
}

export interface PlotControlsProps {
  // Control pane visibility
  show_controls?: boolean
  controls_open?: boolean
  // Custom snippets for additional controls
  children?: Snippet<[]>
  post_children?: Snippet<[]>
  // Display controls
  show_x_zero_line?: boolean
  show_y_zero_line?: boolean
  show_x_grid?: boolean
  show_y_grid?: boolean
  show_y2_grid?: boolean
  x_grid_style?: HTMLAttributes<SVGLineElement>
  y_grid_style?: HTMLAttributes<SVGLineElement>
  y2_grid_style?: HTMLAttributes<SVGLineElement>
  has_y2_points?: boolean
  // Range controls
  x_range?: [number | null, number | null]
  y_range?: [number | null, number | null]
  y2_range?: [number | null, number | null]
  auto_x_range?: [number, number]
  auto_y_range?: [number, number]
  auto_y2_range?: [number, number]
  // Tick controls (optional - only shown if show_ticks is true)
  show_ticks?: boolean
  x_ticks?: TicksOption
  y_ticks?: TicksOption
  // Format controls
  x_format?: string
  y_format?: string
  y2_format?: string
  // Component props
  controls_title?: string
  controls_class?: string
  toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
  pane_props?: ComponentProps<typeof DraggablePane>[`pane_props`]
}

// Base props shared across plot components (non-bindable props only)
// Bindable props (x_range, y_range, formats, ticks, ...) must be declared in each component with $bindable()
export interface BasePlotProps {
  // Axis limits (non-bindable)
  x_lim?: [number | null, number | null]
  y_lim?: [number | null, number | null]
  range_padding?: number // Factor to pad auto-detected ranges *before* nicing (e.g. 0.05 = 5%)
  // Axis labels and styling (non-bindable)
  x_label?: string
  x_label_shift?: { x?: number; y?: number } // horizontal and vertical shift of x-axis label in px
  y_label?: string
  y_label_shift?: { x?: number; y?: number } // horizontal and vertical shift of y-axis label in px
  // Grid style (non-bindable)
  x_grid_style?: HTMLAttributes<SVGLineElement>
  y_grid_style?: HTMLAttributes<SVGLineElement>
  // Layout (non-bindable)
  padding?: Sides
  // Callbacks (non-bindable)
  change?: (...args: unknown[]) => void // Callback when hovered item changes
  // Control pane component props (non-bindable)
  controls_toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
  controls_pane_props?: ComponentProps<typeof DraggablePane>[`pane_props`]
  children?: Snippet<[]>
}
