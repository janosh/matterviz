import type { D3SymbolName } from '$lib/labels'
import type DraggablePane from '$lib/overlays/DraggablePane.svelte'
import type { SimulationNodeDatum } from 'd3-force'
import type { ComponentProps, Snippet } from 'svelte'
import type { HTMLAttributes } from 'svelte/elements'
import type ColorBar from './ColorBar.svelte'
import type PlotLegend from './PlotLegend.svelte'
import type { TicksOption } from './scales'

// TODO restore: import { type TweenedOptions } from 'svelte/motion'
// pending https://github.com/sveltejs/svelte/issues/16151
export interface TweenedOptions<T> {
  delay?: number
  duration?: number | ((from: T, to: T) => number)
  easing?: (t: number) => number
  interpolate?: (a: T, b: T) => (t: number) => T
}

export type XyObj = { x: number; y: number }
export type XyShift = { x?: number; y?: number } // For optional shift/offset values
export type Sides = { t?: number; b?: number; l?: number; r?: number }

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
  // Highlight support for phase diagrams and other use cases
  is_highlighted?: boolean
  highlight_color?: string
  highlight_effect?: `pulse` | `glow` | `size` | `color` | `both`
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

export interface BarStyle {
  color?: string
  opacity?: number
  stroke_width?: number
  stroke_color?: string
  stroke_opacity?: number
  border_radius?: number // Shorthand: sets both rx and ry to this value (lower priority than explicit rx/ry)
  rx?: number // SVG rx attribute for horizontal corner radius (overrides border_radius)
  ry?: number // SVG ry attribute for vertical corner radius (overrides border_radius)
  [key: string]: unknown
}

export interface LineStyle {
  color?: string
  width?: number
  dash?: string
  [key: string]: unknown
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

export type Markers = `line` | `points` | `line+points` | `none`

// Define the structure for a data series in the plot
export interface DataSeries {
  id?: string | number // Optional stable identifier for the series (used for keying)
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
  legend_group?: string // Optional group name for legend grouping (like Plotly's legendgroup)
  unit?: string // Optional unit for the series (e.g., "eV", "eV/Å", "GPa")
  line_style?: {
    stroke?: string
    stroke_width?: number
    line_dash?: string
  }
  // Internal fields used after processing (not provided by users)
  filtered_data?: InternalPoint[]
  _id?: string | number
  orig_series_idx?: number // Original series index for consistent auto-cycling colors/symbols
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

export interface HandlerProps<Metadata = Record<string, unknown>> {
  x: number
  y: number
  metadata?: Metadata | null
  label?: string | null
  series_idx: number
  x_axis: AxisConfig
  y_axis: AxisConfig
  y2_axis?: AxisConfig
  fullscreen?: boolean
}

export interface ScatterHandlerProps<Metadata = Record<string, unknown>>
  extends HandlerProps<Metadata> {
  cx: number
  cy: number
  x_formatted: string
  y_formatted: string
  color_value?: number | null
  colorbar?: {
    value?: number | null
    title?: string | null
    scale?: unknown
    tick_format?: string | null
  }
}
export type ScatterHandlerEvent<Metadata = Record<string, unknown>> =
  & ScatterHandlerProps<Metadata>
  & { event: MouseEvent; point: InternalPoint }

export interface BarHandlerProps<Metadata = Record<string, unknown>>
  extends HandlerProps<Metadata> {
  bar_idx: number
  orient_x: number
  orient_y: number
  active_y_axis: `y1` | `y2`
  color: string
}

export interface HistogramHandlerProps<Metadata = Record<string, unknown>>
  extends HandlerProps<Metadata> {
  value: number
  count: number
  property: string
  active_y_axis: `y1` | `y2`
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

// attributes for each item passed to the legend
export interface LegendItem {
  label: string
  visible: boolean
  series_idx: number
  legend_group?: string // Optional group name for grouped legend rendering
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
  y2_scale_fn?: (y: number) => number
  pad: Required<Sides>
  x_range: [number, number]
  y_range: [number, number]
  y2_range?: [number, number]
  fullscreen: boolean
}

export type Orientation = `vertical` | `horizontal`
export type BarMode = `overlay` | `stacked` | `grouped`

export interface BarSeries {
  id?: string | number // Optional stable identifier for the series (used for keying)
  x: readonly number[]
  y: readonly number[]
  label?: string
  legend_group?: string // Optional group name for legend grouping (like Plotly's legendgroup)
  color?: string
  bar_width?: number | readonly number[]
  visible?: boolean
  metadata?: Record<string, unknown>[] | Record<string, unknown>
  labels?: readonly (string | null | undefined)[]
  render_mode?: `bar` | `line` // Render as bars (default) or as a line
  // Specify which y-axis to use: 'y1' (left, default) or 'y2' (right)
  y_axis?: `y1` | `y2`
  line_style?: {
    stroke_width?: number
    line_dash?: string
  }
  // Marker-related fields for line series (matching DataSeries)
  markers?: Markers // 'line' | 'points' | 'line+points' | 'none'
  color_values?: (number | null)[] | null
  size_values?: readonly (number | null)[] | null
  point_style?: PointStyle[] | PointStyle
  point_hover?: HoverStyle[] | HoverStyle
  point_label?: LabelStyle[] | LabelStyle
  point_offset?: XyObj[] | XyObj
}

// Tick label configuration
export interface TickLabelConfig {
  inside?: boolean // Render tick labels inside the plot area (default: false/outside)
  shift?: XyShift
  rotation?: number // Rotation angle in degrees
}

// Tick configuration
export interface TickConfig {
  label?: TickLabelConfig
}

// Axis configuration type for grouping related axis properties
export interface AxisConfig {
  label?: string
  format?: string
  ticks?: TicksOption
  tick?: TickConfig
  scale_type?: ScaleType
  range?: [number | null, number | null]
  unit?: string
  label_shift?: XyShift
  grid_style?: HTMLAttributes<SVGLineElement>
  color?: string | null // Color for axis label, tick labels, and axis line
}

// Display configuration for grid lines and zero lines
export interface DisplayConfig {
  x_grid?: boolean
  y_grid?: boolean
  y2_grid?: boolean
  x_zero_line?: boolean
  y_zero_line?: boolean
}

// Style overrides for point and line properties
export interface StyleOverrides {
  point?: {
    size?: number
    color?: string
    opacity?: number
    stroke_width?: number
    stroke_color?: string
    stroke_opacity?: number
  }
  line?: {
    width?: number
    color?: string
    opacity?: number
    dash?: string
  }
  show_points?: boolean
  show_lines?: boolean
}

export interface PlotConfig { // Grouped configuration for plot axes and display settings
  x_axis?: AxisConfig
  y_axis?: AxisConfig
  y2_axis?: AxisConfig
  display?: DisplayConfig
}

// Controls configuration
export interface ControlsConfig {
  show?: boolean
  open?: boolean
  toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
  pane_props?: ComponentProps<typeof DraggablePane>[`pane_props`]
}

export type ControlsState = Required<PlotConfig> & {
  show_controls: boolean
  controls_open: boolean
  range_inputs: Record<string, [number | null, number | null]>
}

export interface PlotControlsProps extends PlotConfig {
  // Control pane visibility
  show_controls?: boolean
  controls_open?: boolean
  // Custom snippets for additional controls
  children?: Snippet<[ControlsState]>
  post_children?: Snippet<[ControlsState]>
  // Auto ranges for reset functionality
  auto_x_range?: [number, number]
  auto_y_range?: [number, number]
  auto_y2_range?: [number, number]
  // Helper flags
  has_y2_points?: boolean
  show_ticks?: boolean
  // Component props
  controls_title?: string
  controls_class?: string
  toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
  pane_props?: ComponentProps<typeof DraggablePane>[`pane_props`]
}

// Base props shared across plot components (non-bindable props only)
// Components should declare x_axis, y_axis, display, etc. as $bindable() grouped configs
export interface BasePlotProps {
  // Axis limits (non-bindable - used for auto-range calculation)
  x_range?: [number | null, number | null]
  y_range?: [number | null, number | null]
  y2_range?: [number | null, number | null]
  range_padding?: number // Factor to pad auto-detected ranges before nicing (e.g. 0.05 = 5%)
  padding?: Sides
  // State
  hovered?: boolean
  // Controls
  show_controls?: boolean
  controls_open?: boolean
  controls_toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
  controls_pane_props?: ComponentProps<typeof DraggablePane>[`pane_props`]
  // Fullscreen
  fullscreen?: boolean
  fullscreen_toggle?: boolean // default: true
  // Callbacks
  change?: (data: Record<string, unknown> | null) => void
  // Children
  children?: Snippet<[{ height: number; width: number; fullscreen?: boolean }]>
}
export const LINE_TYPES = [`solid`, `dashed`, `dotted`] as const
export type LineType = (typeof LINE_TYPES)[number]

// Define grid cell identifiers
export const CELLS_3X3 = [
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
export const CORNER_CELLS = [
  `top-left`,
  `top-right`,
  `bottom-left`,
  `bottom-right`,
] as const

// Define the structure for GridCell and GridCellCounts for 3x3 grid
export type Cell3x3 = (typeof CELLS_3X3)[number]
export type Corner = (typeof CORNER_CELLS)[number]

// Default grid line style (SSOT for all plot components)
export const DEFAULT_GRID_STYLE = {
  'stroke': `var(--border-color, gray)`,
  'stroke-dasharray': `4`,
  'stroke-width': `1`,
} as const

export const DEFAULT_MARKERS = `line+points` as const

// Default series colors for auto-differentiation (similar to d3 schemeTableau10)
export const DEFAULT_SERIES_COLORS = [
  `#4e79a7`, // blue
  `#f28e2c`, // orange
  `#e15759`, // red
  `#76b7b2`, // teal
  `#59a14f`, // green
  `#edc949`, // yellow
  `#af7aa1`, // purple
  `#ff9da7`, // pink
  `#9c755f`, // brown
  `#bab0ab`, // gray
] as const

// Default series symbols for auto-differentiation (cycling through distinct shapes)
export const DEFAULT_SERIES_SYMBOLS = [
  `Circle`,
  `Square`,
  `Triangle`,
  `Cross`,
  `Diamond`,
  `Star`,
  `Wye`,
] as const satisfies readonly D3SymbolName[]
