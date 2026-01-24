import type { D3SymbolName } from '$lib/labels'
import type { Vec3 } from '$lib/math'
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

export type Point<Metadata = Record<string, unknown>> = {
  x: number
  y: number
  metadata?: Metadata
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
export interface PlotPoint<Metadata = Record<string, unknown>> extends Point<Metadata> {
  color_value?: number | null
  point_style?: PointStyle
  point_hover?: HoverStyle
  point_label?: LabelStyle
  point_offset?: XyObj // Individual point offset (distinct from label offset)
  point_tween?: TweenedOptions<XyObj>
}

export type Markers = `line` | `points` | `line+points` | `none`

// Define the structure for a data series in the plot
export interface DataSeries<Metadata = Record<string, unknown>> {
  id?: string | number // Optional stable identifier for the series (used for keying)
  x: readonly number[]
  y: readonly number[]
  // Optional marker display type override for this specific series
  markers?: Markers
  // Specify which y-axis to use: 'y1' (left, default) or 'y2' (right)
  y_axis?: `y1` | `y2`
  color_values?: (number | null)[] | null
  size_values?: readonly (number | null)[] | null
  metadata?: Metadata[] | Metadata // Can be array or single object
  point_style?: PointStyle[] | PointStyle // Can be array or single object
  point_hover?: HoverStyle[] | HoverStyle // Can be array or single object
  point_label?: LabelStyle[] | LabelStyle // Can be array or single object
  point_offset?: XyObj[] | XyObj // Can be array or single object
  point_tween?: TweenedOptions<XyObj>
  visible?: boolean // Optional visibility flag
  label?: string // Optional series label for legend
  // Group name for organizing legend items. Series with the same legend_group
  // are displayed together under a collapsible header. Click the header to toggle
  // visibility of all series in the group, or the chevron to collapse/expand.
  legend_group?: string
  unit?: string // Optional unit for the series (e.g. "eV", "eV/Å", "GPa")
  line_style?: {
    stroke?: string
    stroke_width?: number
    line_dash?: string
  }
  // Internal fields used after processing (not provided by users)
  filtered_data?: InternalPoint<Metadata>[]
  _id?: string | number
  orig_series_idx?: number // Original series index for consistent auto-cycling colors/symbols
}

// Represents the internal structure used within ScatterPlot, merging series-level and point-level data
export interface InternalPoint<Metadata = Record<string, unknown>>
  extends PlotPoint<Metadata> {
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
  & { event: MouseEvent; point: InternalPoint<Metadata> }

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

// Base scale type names
export type ScaleTypeName = `linear` | `log` | `arcsinh` | `time`

// Arcsinh scale configuration with optional threshold parameter
// threshold controls where linear→log transition occurs (default: 1)
// For |x| << threshold: behaves linearly
// For |x| >> threshold: behaves logarithmically
export interface ArcsinhScaleConfig {
  type: `arcsinh`
  threshold?: number // default: 1
}

// Scale type can be a simple string or arcsinh config object
export type ScaleType = `linear` | `log` | `arcsinh` | `time` | ArcsinhScaleConfig

// Helper to normalize ScaleType to base type name
export function get_scale_type_name(scale_type: ScaleType | undefined): ScaleTypeName {
  if (!scale_type) return `linear`
  if (typeof scale_type === `string`) return scale_type
  return scale_type.type
}

// Helper to get arcsinh threshold (returns 1 as default for non-arcsinh scales)
export function get_arcsinh_threshold(scale_type: ScaleType | undefined): number {
  if (!scale_type) return 1
  if (typeof scale_type === `object` && scale_type.type === `arcsinh`) {
    const threshold = scale_type.threshold ?? 1
    if (!Number.isFinite(threshold) || threshold <= 0) {
      throw new Error(
        `arcsinh threshold must be a positive finite number, got ${threshold}`,
      )
    }
    return threshold
  }
  return 1 // default threshold
}

// Helper to detect time scale - checks explicit scale_type or falls back to format heuristic
// Prefer explicit scale_type: 'time' for new code; format heuristic kept for backwards compatibility
export function is_time_scale(
  scale_type: ScaleType | undefined,
  format: string | undefined,
): boolean {
  if (get_scale_type_name(scale_type) === `time`) return true
  // Fallback: d3 time format strings start with '%'
  return format?.startsWith(`%`) ?? false
}

export type QuadrantCounts = {
  top_left: number
  top_right: number
  bottom_left: number
  bottom_right: number
}

// Type for nodes used in the d3-force simulation for label placement
export interface LabelNode<Metadata = Record<string, unknown>>
  extends SimulationNodeDatum {
  id: string // unique identifier, e.g. series_idx-point_idx
  anchor_x: number // Original x coordinate of the point (scaled)
  anchor_y: number // Original y coordinate of the point (scaled)
  point_node: InternalPoint<Metadata> // Reference to the original data point
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
    // Minimum distance from plot edges to avoid axis label overlap (default: 40)
    axis_clearance?: number
  }

// attributes for each item passed to the legend
export interface LegendItem {
  label: string
  visible: boolean
  series_idx: number
  legend_group?: string // Optional group name for grouped legend rendering
  // Type of item: 'series' for data series (default), 'fill' for fill regions
  item_type?: `series` | `fill`
  // For fill regions, the index in the computed_fills array (for unique keying)
  fill_idx?: number
  // For fill regions, the source type and index (for toggle handlers)
  fill_source_type?: `fill_region` | `error_band`
  fill_source_idx?: number
  display_style: {
    symbol_type?: D3SymbolName
    symbol_color?: string
    line_color?: string
    line_dash?: string
    // Fill region styling
    fill_color?: string
    fill_opacity?: number
    edge_color?: string
    // Gradient fill for legend swatch (when fill is a gradient, not a solid color)
    fill_gradient?: FillGradient
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

export interface BarSeries<Metadata = Record<string, unknown>> {
  id?: string | number // Optional stable identifier for the series (used for keying)
  x: readonly number[]
  y: readonly number[]
  label?: string
  // Group name for organizing legend items. Series with the same legend_group
  // are displayed together under a collapsible header. Click the header to toggle
  // visibility of all series in the group, or the chevron to collapse/expand.
  legend_group?: string
  color?: string
  bar_width?: number | readonly number[]
  visible?: boolean
  metadata?: Metadata[] | Metadata
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

// Option for axis property dropdown (enables interactive axis switching)
export interface AxisOption {
  key: string // unique identifier (e.g., 'energy', 'volume')
  label: string // display name (e.g., 'Total Energy')
  unit?: string // optional unit (e.g., 'eV', 'Å³')
}

// Y2 axis synchronization modes
// - 'none': Independent axes (default)
// - 'proportional': Y2 follows Y1 zoom/pan with same scale factor and center shift
// - 'align_zero': Keep zero (or align_value) at same vertical position on both axes
export type Y2SyncMode = `none` | `proportional` | `align_zero`

export interface Y2SyncConfig {
  mode: Y2SyncMode
  // For align_zero: optionally specify which value to align (default: 0)
  align_value?: number
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
  // Interactive axis options (enables clickable axis labels)
  options?: AxisOption[] // available properties for this axis
  selected_key?: string // currently selected property key
  // Synchronization with y1 axis (only applicable when used as y2_axis)
  // - 'proportional': Y2 follows Y1 zoom/pan with same scale factor
  // - 'align_zero': Keeps zero (or align_value) at same vertical position on both axes.
  //   Note: if align_value is outside the data range, axes expand to include it.
  // - 'none' or undefined: Independent axes (default)
  // Shorthand: 'proportional' | 'align_zero' | 'none'
  // Full config: { mode: Y2SyncMode, align_value?: number }
  sync?: Y2SyncConfig | Y2SyncMode
}

// Result from data loader - returns complete series array
// SeriesType defaults to DataSeries but can be BarSeries for bar plots
export interface DataLoaderResult<
  Metadata = Record<string, unknown>,
  SeriesType = DataSeries<Metadata>,
> {
  series: SeriesType[] // full replacement series
  axis_label?: string // optional new axis label
  axis_unit?: string // optional axis unit
}

// Callback to fetch data for a property change
// Called when user selects a new property from the axis dropdown
// SeriesType defaults to DataSeries but can be BarSeries for bar plots
export type DataLoaderFn<
  Metadata = Record<string, unknown>,
  SeriesType = DataSeries<Metadata>,
> = (
  axis: AxisKey,
  property_key: string,
  current_series: readonly SeriesType[], // passed for context
) => Promise<DataLoaderResult<Metadata, SeriesType>>

// Error event for axis data loading failures
export interface AxisLoadError {
  axis: AxisKey
  key: string
  message: string
}

// Option for color scale dropdown in ColorBar
export interface ColorScaleOption {
  key: string // e.g., 'viridis', 'plasma'
  label: string // e.g., 'Viridis', 'Plasma'
  scale: string | ((t: number) => string) // d3 interpolator name or function
}

// Data loader for ColorBar property changes
export type ColorBarDataLoaderFn = (
  property_key: string,
) => Promise<{ range: [number, number]; title?: string }>

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

export type AxisKey = `x` | `y` | `y2`
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

// Pan configuration for 2D plot components
export interface PanConfig {
  enabled?: boolean // default: true - whether panning is enabled
  wheel_sensitivity?: number // default: 1 - multiplier for wheel delta
  drag_sensitivity?: number // default: 1 - multiplier for drag delta
  touch_enabled?: boolean // default: true - whether touch gestures are enabled
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

export type XyzObj = { x: number; y: number; z: number }

// 3D point extending base Point with z coordinate (prefixed to avoid conflict with convex-hull)
export interface ScatterPoint3D<Metadata = Record<string, unknown>>
  extends Point<Metadata> {
  z: number
}

// 3D data series extending DataSeries with z array
// Omit filtered_data since it uses 2D InternalPoint type, redeclare with 3D type
export interface DataSeries3D<Metadata = Record<string, unknown>>
  extends Omit<DataSeries<Metadata>, `x` | `y` | `y_axis` | `filtered_data`> {
  x: readonly number[]
  y: readonly number[]
  z: readonly number[]
  filtered_data?: InternalPoint3D<Metadata>[]
}

// Internal 3D point for processing within ScatterPlot3D
export interface InternalPoint3D<Metadata = Record<string, unknown>>
  extends ScatterPoint3D<Metadata> {
  series_idx: number
  point_idx: number
  color_value?: number | null
  size_value?: number | null
  point_style?: PointStyle
}

// Surface types for 3D visualization
export type SurfaceType = `grid` | `parametric` | `triangulated`

// Configuration for 3D surfaces
export interface Surface3DConfig {
  id?: string | number
  type: SurfaceType
  // For grid surfaces: regular grid with z values
  x_range?: [number, number]
  y_range?: [number, number]
  resolution?: number | [number, number] // grid resolution (x, y)
  z_fn?: (x: number, y: number) => number
  // For parametric surfaces: u,v parameterization
  u_range?: [number, number]
  v_range?: [number, number]
  parametric_fn?: (u: number, v: number) => XyzObj
  // For triangulated surfaces: explicit geometry (only x,y,z needed, not scatter-specific fields)
  points?: XyzObj[]
  triangles?: Vec3[] // indices into points array
  // Appearance
  color?: string
  color_fn?: (x: number, y: number, z: number) => string
  opacity?: number
  wireframe?: boolean
  wireframe_color?: string
  wireframe_width?: number
  visible?: boolean
  // Double-sided rendering
  double_sided?: boolean
}

// Extended axis config for 3D (same as 2D but can add 3D-specific options)
export interface AxisConfig3D extends AxisConfig {
  // 3D-specific axis options can be added here
  show_plane?: boolean // Show grid plane for this axis
  plane_opacity?: number
}

// Display config extended for 3D
export interface DisplayConfig3D extends DisplayConfig {
  z_grid?: boolean
  z_zero_line?: boolean
  show_axes?: boolean
  show_axis_labels?: boolean
  show_bounding_box?: boolean
  show_grid?: boolean
}

// 3D scatter handler props
export interface Scatter3DHandlerProps<Metadata = Record<string, unknown>> {
  x: number
  y: number
  z: number
  metadata?: Metadata | null
  label?: string | null
  series_idx: number
  x_axis: AxisConfig3D
  y_axis: AxisConfig3D
  z_axis: AxisConfig3D
  x_formatted: string
  y_formatted: string
  z_formatted: string
  color_value?: number | null
  fullscreen?: boolean
}

export type Scatter3DHandlerEvent<Metadata = Record<string, unknown>> =
  & Scatter3DHandlerProps<Metadata>
  & { event?: MouseEvent; point: InternalPoint3D<Metadata> }

// Camera projection types for 3D
export type CameraProjection3D = `perspective` | `orthographic`

// 3D plot config extending base
export interface PlotConfig3D {
  x_axis?: AxisConfig3D
  y_axis?: AxisConfig3D
  z_axis?: AxisConfig3D
  display?: DisplayConfig3D
}

// 3D style overrides
export interface StyleOverrides3D extends StyleOverrides {
  point?: StyleOverrides[`point`] & {
    sphere_segments?: number // Level of detail for sphere geometry
  }
}

// Controls config for 3D
export interface ControlsConfig3D extends ControlsConfig {
  show_camera_controls?: boolean
  show_surface_controls?: boolean
}

// FillBoundary - references to data sources for fill regions
// Can reference series by index, by id, or specify constant/axis/function/data values
export type FillBoundary =
  | { type: `series`; series_idx: number }
  | { type: `series`; series_id: string | number }
  | { type: `constant`; value: number }
  | { type: `axis`; axis: `x` | `y` | `y2`; value?: number }
  | { type: `function`; fn: (coord: number) => number }
  | { type: `data`; values: readonly number[] }
  | number // Shorthand for constant value

// Styling types for fill regions

// Gradient configuration for fill regions
export interface FillGradient {
  type: `linear` | `radial`
  // For linear gradients: angle in degrees (0 = horizontal left-to-right, 90 = vertical top-to-bottom)
  angle?: number
  // For radial gradients: center position (0-1 normalized)
  center?: { x: number; y: number }
  // Color stops: array of [offset (0-1), color] pairs
  stops: readonly [number, string][]
}

// Edge/stroke styling for fill region boundaries
export interface FillEdgeStyle {
  color?: string
  width?: number
  dash?: string
  opacity?: number
}

// Hover state styling for fill regions
export interface FillHoverStyle {
  fill?: string
  fill_opacity?: number
  edge?: FillEdgeStyle
  cursor?: string
  scale?: number // Scale factor for hover effect
}

// Event type for fill region interactions
export interface FillHandlerEvent {
  event: MouseEvent | KeyboardEvent
  region_idx: number
  region_id?: string | number
  x: number // Data x-coordinate
  y: number // Data y-coordinate
  px: number // Pixel x-coordinate
  py: number // Pixel y-coordinate
  label?: string
  metadata?: Record<string, unknown>
}

// z-index positions for rendering order (used by fill regions and reference lines)
export type LayerZIndex = `below-grid` | `below-lines` | `below-points` | `above-all`

// Curve types supported for fill path generation (matching d3-shape curves)
export const FILL_CURVE_TYPES = [
  `linear`,
  `monotoneX`,
  `monotoneY`,
  `step`,
  `stepBefore`,
  `stepAfter`,
  `basis`,
  `cardinal`,
  `catmullRom`,
  `natural`,
] as const
export type FillCurveType = (typeof FILL_CURVE_TYPES)[number]

// Main configuration for a fill region
export interface FillRegion {
  // Identity
  id?: string | number
  label?: string

  // Boundaries - define the top and bottom of the fill area
  upper: FillBoundary
  lower: FillBoundary

  // Optional range constraints
  x_range?: [number | null, number | null]
  y_range?: [number | null, number | null]

  // Conditional fill: only fill where condition is true
  // Example: where: (x, y_upper, y_lower) => y_upper > y_lower
  where?: (x: number, y_upper: number, y_lower: number) => boolean

  // Styling
  fill?: string | FillGradient
  fill_opacity?: number
  edge_upper?: FillEdgeStyle
  edge_lower?: FillEdgeStyle
  curve?: FillCurveType
  step_position?: number // For step curves: 0 = step, 0.5 = stepMiddle, 1 = stepEnd

  // Rendering
  z_index?: LayerZIndex
  visible?: boolean

  // Interactions
  hover_style?: FillHoverStyle
  on_click?: (event: FillHandlerEvent) => void
  on_hover?: (event: FillHandlerEvent | null) => void

  // Legend
  show_in_legend?: boolean
  legend_group?: string

  // Metadata for user data
  metadata?: Record<string, unknown>
}

// Convenience type for error bands (symmetric or asymmetric around a series)
export interface ErrorBand {
  // Reference to the central series
  series: { type: `series`; series_idx: number } | {
    type: `series`
    series_id: string | number
  }

  // Error values - can be symmetric (single value/array) or asymmetric (upper/lower)
  error:
    | number // Symmetric constant error
    | readonly number[] // Symmetric per-point error
    | { upper: number | readonly number[]; lower: number | readonly number[] } // Asymmetric

  // Styling (defaults applied if not specified)
  fill?: string // Defaults to series color with reduced opacity
  fill_opacity?: number // Defaults to 0.3
  edge_style?: FillEdgeStyle

  // Identity
  id?: string | number
  label?: string
  show_in_legend?: boolean
}

// Reference line styling
export interface RefLineStyle {
  color?: string // default: 'currentColor'
  width?: number // default: 1
  dash?: string // SVG stroke-dasharray, default: none (solid)
  opacity?: number // default: 1
}

// Annotation/label for reference lines
export interface RefLineAnnotation {
  text: string
  position?: `start` | `center` | `end` // position along the line
  side?: `above` | `below` | `left` | `right` // which side of line
  offset?: { x?: number; y?: number }
  gap?: number // pixels between line and annotation text, default: 8
  edge_padding?: number // pixels inward from plot edge at start/end, default: 4
  font_size?: string
  font_family?: string
  color?: string
  background?: string
  padding?: number
  rotate?: boolean // rotate text to follow line angle
}

// Event type for reference line interactions
export interface RefLineEvent {
  event: MouseEvent | KeyboardEvent | FocusEvent
  line_idx: number
  line_id?: string | number
  type: RefLine[`type`]
  label?: string
  metadata?: Record<string, unknown>
}

// Base properties shared by all reference line types
export interface RefLineBase {
  id?: string | number
  x_span?: [number | null, number | null]
  y_span?: [number | null, number | null]
  coord_mode?: `data` | `relative` // default: 'data'
  y_axis?: `y1` | `y2` // for horizontal lines with dual axes
  style?: RefLineStyle
  annotation?: RefLineAnnotation
  z_index?: LayerZIndex
  visible?: boolean
  hover_style?: RefLineStyle
  on_click?: (event: RefLineEvent) => void
  on_hover?: (event: RefLineEvent | null) => void
  show_in_legend?: boolean
  label?: string
  legend_group?: string
  metadata?: Record<string, unknown>
}

// Reference line value type - supports numbers, Dates, and ISO date strings
export type RefLineValue = number | Date | string

// Flat discriminated union - type determines required fields
export type RefLine =
  & RefLineBase
  & (
    | { type: `horizontal`; y: RefLineValue }
    | { type: `vertical`; x: RefLineValue }
    | { type: `diagonal`; slope: number; intercept: number }
    | {
      type: `segment`
      p1: [RefLineValue, RefLineValue]
      p2: [RefLineValue, RefLineValue]
    }
    | { type: `line`; p1: [RefLineValue, RefLineValue]; p2: [RefLineValue, RefLineValue] }
  )

// Default style values for reference lines
export const REF_LINE_STYLE_DEFAULTS: Required<RefLineStyle> = {
  color: `currentColor`,
  width: 1,
  dash: ``,
  opacity: 1,
} as const

// Base properties shared by all 3D reference line types
// Aligned with RefLineBase for future feature parity (interactions, annotations, etc.)
export interface RefLine3DBase {
  id?: string | number
  x_span?: [number | null, number | null]
  y_span?: [number | null, number | null]
  z_span?: [number | null, number | null]
  style?: RefLineStyle
  visible?: boolean
  label?: string
  metadata?: Record<string, unknown>
  // Future parity with RefLineBase (currently unused, reserved for future features)
  hover_style?: RefLineStyle
  on_click?: (event: { line_idx: number; line_id?: string | number }) => void
  on_hover?: (event: { line_idx: number; line_id?: string | number } | null) => void
  z_index?: LayerZIndex
  show_in_legend?: boolean
  legend_group?: string
  annotation?: RefLineAnnotation
}

// 3D reference line - discriminated union
export type RefLine3D =
  & RefLine3DBase
  & (
    | { type: `x-axis`; y: number; z: number } // line parallel to x-axis
    | { type: `y-axis`; x: number; z: number } // line parallel to y-axis
    | { type: `z-axis`; x: number; y: number } // line parallel to z-axis
    | { type: `segment`; p1: Vec3; p2: Vec3 }
    | { type: `line`; p1: Vec3; p2: Vec3 }
  )

// 3D reference plane styling
export interface RefPlaneStyle {
  color?: string
  opacity?: number
  wireframe?: boolean
  wireframe_color?: string
  double_sided?: boolean
}

// Base properties shared by all 3D reference plane types
export interface RefPlaneBase {
  id?: string | number
  x_span?: [number | null, number | null]
  y_span?: [number | null, number | null]
  z_span?: [number | null, number | null]
  style?: RefPlaneStyle
  visible?: boolean
  label?: string
  show_in_legend?: boolean
  metadata?: Record<string, unknown>
}

// 3D reference plane - discriminated union
export type RefPlane =
  & RefPlaneBase
  & (
    | { type: `xy`; z: number } // horizontal plane at z
    | { type: `xz`; y: number } // vertical plane at y
    | { type: `yz`; x: number } // vertical plane at x
    | { type: `normal`; normal: Vec3; point: Vec3 }
    | { type: `points`; p1: Vec3; p2: Vec3; p3: Vec3 } // plane through 3 points
  )

// --- Data Cleaning Types ---

// Oscillation detection weights (all default to 1.0)
export interface OscillationWeights {
  derivative_variance?: number // Weight for derivative variance method
  amplitude_growth?: number // Weight for exponential amplitude growth
  sign_changes?: number // Weight for derivative sign change frequency
}

// How to handle invalid values (NaN, Infinity)
export type InvalidValueMode = `remove` | `propagate` | `interpolate`

// Truncation strategy when instability detected
export type TruncationMode = `hard_cut` | `mark_unstable`

// Physical bounds configuration
export interface PhysicalBounds {
  min?: number | ((x: number) => number) // Static or x-dependent minimum
  max?: number | ((x: number) => number) // Static or x-dependent maximum
  mode?: `clamp` | `filter` | `null` // How to handle violations
}

// Smoothing algorithm configuration (discriminated union for type safety)
export type SmoothingConfig =
  | { type: `moving_avg`; window: number }
  | { type: `savgol`; window: number; polynomial_order?: number } // window must be odd
  | { type: `gaussian`; sigma: number } // sigma controls Gaussian kernel width

// Local outlier detection config (sliding window approach)
export interface LocalOutlierConfig {
  window_half?: number // Points on each side for local context (default: 7)
  mad_threshold?: number // MADs from local median to flag outlier (default: 2.0)
  max_iterations?: number // Iterative passes to catch clustered outliers (default: 5)
}

// Result of local outlier detection
export interface LocalOutlierResult {
  kept_indices: number[]
  removed_indices: number[]
  iterations_used: number
}

// Main cleaning configuration
export interface CleaningConfig {
  // Oscillation detection
  oscillation_threshold?: number // Combined score threshold (default: 3.0)
  oscillation_weights?: OscillationWeights // Method weights
  window_size?: number // Rolling window for detection (default: 5)

  // Data handling
  invalid_values?: InvalidValueMode // NaN/Infinity handling (default: 'remove')
  bounds?: PhysicalBounds // Physical constraints
  smooth?: SmoothingConfig // Optional smoothing
  local_outliers?: LocalOutlierConfig // Local sliding window outlier removal

  // Truncation
  truncation_mode?: TruncationMode // 'hard_cut' or 'mark_unstable' (default: 'mark_unstable')

  // Performance
  in_place?: boolean // Mutate input arrays (default: true)
}

// Quality report from cleaning operation
export interface CleaningQuality {
  points_removed: number
  invalid_values_found: number // NaN/Infinity count
  oscillation_detected: boolean
  oscillation_score?: number // Combined weighted score
  bounds_violations: number
  outliers_removed?: number // Count of local outliers removed
  stable_range?: [number, number] // [start_x, end_x] if mark_unstable mode
  truncated_at_x?: number // x value if hard_cut mode
}

// Result of a cleaning operation
export interface CleaningResult<T = DataSeries> {
  series: T // Cleaned data (same ref if in_place)
  quality: CleaningQuality
}

// Instability detection result
export interface InstabilityResult {
  detected: boolean
  onset_index: number
  onset_x: number
  combined_score: number
  method_scores: {
    derivative_variance: number
    amplitude_growth: number
    sign_changes: number
  }
}
