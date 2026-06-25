import type { PaneProps, PaneToggleProps } from '$lib/overlays'
import type { D3ColorSchemeName, D3InterpolateName } from '$lib/colors'
import type { D3SymbolName } from '$lib/labels'
import type { Point2D, Vec2 } from '$lib/math'
import type { ComponentProps, Snippet } from 'svelte'
import type { HTMLAttributes } from 'svelte/elements'
import type { TweenOptions } from 'svelte/motion'
import type { Sides } from '$lib/plot/core/layout'
import type PlotLegend from '$lib/plot/core/components/PlotLegend.svelte'
import type { TicksOption } from '$lib/plot/core/scales'
import type { FillGradient } from '$lib/plot/core/types/fills'

export type { TweenOptions } from 'svelte/motion'

// Chart-family types live next to their chart code; re-exported here (type-only,
// erased at runtime) so existing `$lib/plot/core/types` import paths keep working.
export type {
  BandwidthOption,
  BoxHandlerProps,
  BoxPlotSeries,
  ViolinKind,
  ViolinSide,
  WhiskerMode,
} from '$lib/plot/box/box-plot'
export type {
  CleaningConfig,
  CleaningQuality,
  CleaningResult,
  InstabilityResult,
  InvalidValueMode,
  LocalOutlierConfig,
  LocalOutlierResult,
  OscillationWeights,
  PhysicalBounds,
  SmoothingConfig,
  TruncationMode,
} from '$lib/plot/core/data-cleaning'
export type {
  SankeyData,
  SankeyHandlerProps,
  SankeyLink,
  SankeyLinkColorMode,
  SankeyLinkHandlerProps,
  SankeyNode,
  SankeyNodeAlign,
  SankeyNodeHandlerProps,
  SankeyOrientation,
} from '$lib/plot/sankey/sankey-types'
export type {
  SunburstLabelRotation,
  SunburstLabelText,
  SunburstNode,
  SunburstNodeHandlerProps,
  SunburstShape,
  SunburstSort,
  SunburstValueMode,
} from '$lib/plot/sunburst/sunburst'

export type XyShift = { x?: number; y?: number } // For optional shift/offset values

// Snapshot of axis ranges at interaction start (shared by pan/zoom/touch handlers)
export type InitialRanges = {
  initial_x_range: Vec2
  initial_x2_range: Vec2
  initial_y_range: Vec2
  initial_y2_range: Vec2
}

// Current [min, max] range of each of the four axes
export type AxisRanges = { x: Vec2; x2: Vec2; y: Vec2; y2: Vec2 }

export type Point<Metadata = Record<string, unknown>> = {
  x: number
  y: number
  metadata?: Metadata
  offset?: Point2D
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
  offset?: Point2D
  font_size?: string
  font_family?: string
  auto_placement?: boolean // Enable/disable auto-placement
  size?: { width: number; height: number }
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

// d3-shape curve used to connect series points; `linear` draws straight segments
export type LineCurve = `linear` | `monotone` | `natural` | `step` | `basis` | `catmull-rom`

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
  point_offset?: Point2D // Individual point offset (distinct from label offset)
  point_tween?: TweenOptions<Point2D>
}

export type Markers = `line` | `points` | `line+points` | `none`

// Define the structure for a data series in the plot
export interface DataSeries<Metadata = Record<string, unknown>> {
  id?: string | number // Optional stable identifier for the series (used for keying)
  x: readonly number[]
  y: readonly number[]
  // Optional marker display type override for this specific series
  markers?: Markers
  // Specify which x-axis to use: 'x1' (bottom, default) or 'x2' (top)
  x_axis?: `x1` | `x2`
  // Specify which y-axis to use: 'y1' (left, default) or 'y2' (right)
  y_axis?: `y1` | `y2`
  color_values?: (number | null)[] | null
  size_values?: readonly (number | null)[] | null
  metadata?: Metadata[] | Metadata // Can be array or single object
  point_style?: PointStyle[] | PointStyle // Can be array or single object
  point_hover?: HoverStyle[] | HoverStyle // Can be array or single object
  point_label?: LabelStyle[] | LabelStyle // Can be array or single object
  point_offset?: Point2D[] | Point2D // Can be array or single object
  point_tween?: TweenOptions<Point2D>
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
    curve?: LineCurve // d3-shape curve for the connecting line; `linear` = straight segments
  }
  // Internal fields used after processing (not provided by users)
  filtered_data?: InternalPoint<Metadata>[]
  _id?: string | number
  orig_series_idx?: number // Original series index for consistent auto-cycling colors/symbols
}

// Represents the internal structure used within ScatterPlot, merging series-level and point-level data
export interface InternalPoint<
  Metadata = Record<string, unknown>,
> extends PlotPoint<Metadata> {
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
  x2_axis?: AxisConfig
  y_axis: AxisConfig
  y2_axis?: AxisConfig
  fullscreen?: boolean
}

export interface ScatterHandlerProps<
  Metadata = Record<string, unknown>,
> extends HandlerProps<Metadata> {
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
  ScatterHandlerProps<Metadata> & { event: MouseEvent; point: InternalPoint<Metadata> }

export interface BarHandlerProps<
  Metadata = Record<string, unknown>,
> extends HandlerProps<Metadata> {
  bar_idx: number
  orient_x: number
  orient_y: number
  active_y_axis: `y1` | `y2`
  active_x_axis: `x1` | `x2`
  color: string
  category_label?: string // original string category (undefined when numeric x)
}

export interface HistogramHandlerProps<
  Metadata = Record<string, unknown>,
> extends HandlerProps<Metadata> {
  value: number
  count: number
  property: string
  active_y_axis: `y1` | `y2`
  active_x_axis: `x1` | `x2`
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

// Color/size mapping configs shared by scatter, scatter-3d and binned-scatter plots
export type ColorScaleConfig = {
  type?: ScaleType
  scheme?: D3ColorSchemeName | D3InterpolateName
  value_range?: Vec2
}
export type SizeScaleConfig = {
  type?: ScaleType
  radius_range?: Vec2
  value_range?: Vec2
}

// Shared defaults for color/size scales and colorbar layout (scatter, bar, binned-scatter, …)
const COLOR_BAR_WIDTH = 220
export const COLOR_BAR_DEFAULTS = {
  width: COLOR_BAR_WIDTH,
  horizontal_bar_height: 16,
  binned_bar_height: 10,
  horizontal_footprint: { width: COLOR_BAR_WIDTH, height: 56 },
  vertical_footprint: { width: 56, height: 100 },
} as const
// Shared color/size scale defaults for scatter, scatter-3d, binned-scatter, bar, …
const VIRIDIS: D3InterpolateName = `interpolateViridis`
const SCATTER_RADIUS: Vec2 = [2, 10]
const BINNED_RADIUS: Vec2 = [4, 12]
export const SCALE_DEFAULTS: {
  scheme: D3InterpolateName
  color: ColorScaleConfig
  radius: Vec2
  binned_radius: Vec2
  size: SizeScaleConfig
  size_3d: SizeScaleConfig
} = {
  scheme: VIRIDIS,
  color: { type: `linear`, scheme: VIRIDIS, value_range: undefined },
  radius: SCATTER_RADIUS,
  binned_radius: BINNED_RADIUS,
  size: { type: `linear`, radius_range: SCATTER_RADIUS, value_range: undefined },
  size_3d: { type: `linear`, radius_range: [0.05, 0.2], value_range: undefined },
}

// Type guard for select value narrowing (avoids unsafe casts)
const SCALE_TYPE_NAMES = new Set<string>([`linear`, `log`, `arcsinh`, `time`])
export const is_scale_type_name = (val: string): val is ScaleTypeName =>
  SCALE_TYPE_NAMES.has(val)

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
      throw new Error(`arcsinh threshold must be a positive finite number, got ${threshold}`)
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

// Energy weights for the simulated annealing label placement
export interface LabelPlacementWeights {
  overlap?: number // Label-label overlap penalty (default: 30)
  marker?: number // Label-marker overlap penalty (default: 100)
  leader_cross?: number // Leader line crossing penalty (default: 10)
  leader_text?: number // Leader line crossing label text penalty (default: 8)
  distance?: number // Anchor distance penalty (default: 0.5)
  bounds?: number // Out-of-bounds penalty (default: 100)
}

// Configuration for the label auto-placement algorithm (simulated annealing)
export interface LabelPlacementConfig {
  sa_iterations?: number // SA iterations per label (default: 2000)
  weights?: LabelPlacementWeights // Energy function weights
  leader_line_threshold?: number // Min displacement (px) to show dotted leader line (default: 15)
  max_labels?: number // Skip SA when label count exceeds this (default: 300)
  candidate_gap?: number // Extra gap (px) between marker radius and label candidates (default: 4)
  // Hide labels in dense regions with more than `count` neighbors within `radius` px
  max_neighbors?: { count: number; radius: number }
}
export type HoverConfig = {
  threshold_px: number // Max screen distance (pixels) to trigger hover
}

// Type for PlotLegend props forwarded from ScatterPlot props
export type LegendConfig = Omit<
  ComponentProps<typeof PlotLegend>,
  `series_data` | `on_drag_start` | `on_drag` | `on_drag_end`
> & {
  margin?: number | Sides
  tween?: TweenOptions<Point2D>
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
  x2_scale_fn?: (x: number) => number
  y_scale_fn: (y: number) => number
  y2_scale_fn?: (y: number) => number
  pad: Required<Sides>
  x_range: Vec2
  x2_range?: Vec2
  y_range: Vec2
  y2_range?: Vec2
  fullscreen: boolean
}

export type Orientation = `vertical` | `horizontal`
export type BarMode = `overlay` | `stacked` | `grouped`

export interface BarSeries<Metadata = Record<string, unknown>> {
  id?: string | number // Optional stable identifier for the series (used for keying)
  x: readonly (number | string)[]
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
  // Specify which x-axis to use: 'x1' (bottom, default) or 'x2' (top)
  x_axis?: `x1` | `x2`
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
  point_offset?: Point2D[] | Point2D
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
// - 'synced': Y2 has exact same range as Y1
// - 'align': Y2 expands to show all data while keeping align_value (default 0) at same position as Y1
export type Y2SyncMode = `none` | `synced` | `align`

// Type guard for select value narrowing (avoids unsafe casts)
const Y2_SYNC_MODES = new Set<string>([`none`, `synced`, `align`])
export const is_y2_sync_mode = (val: string): val is Y2SyncMode => Y2_SYNC_MODES.has(val)

export interface Y2SyncConfig {
  mode: Y2SyncMode
  // For align mode: optionally specify which value to align (default: 0)
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
  // - 'synced': Y2 has exact same range as Y1
  // - 'align': Y2 expands to show all data, align_value (default 0) at same position
  // - 'none' or undefined: Independent axes (default)
  // Shorthand: 'synced' | 'align' | 'none'
  // Full config: { mode: Y2SyncMode, align_value?: number }
  sync?: Y2SyncConfig | Y2SyncMode
  categories?: readonly string[] // explicit category order/filter for categorical bar plots
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
) => Promise<{ range: Vec2; title?: string }>

// Display configuration for grid lines and zero lines
export interface DisplayConfig {
  x_grid?: boolean
  x2_grid?: boolean
  y_grid?: boolean
  y2_grid?: boolean
  x_zero_line?: boolean
  x2_zero_line?: boolean
  y_zero_line?: boolean
  y2_zero_line?: boolean
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

export type AxisKey = `x` | `x2` | `y` | `y2`
export interface PlotConfig {
  // Grouped configuration for plot axes and display settings
  x_axis?: AxisConfig
  x2_axis?: AxisConfig
  y_axis?: AxisConfig
  y2_axis?: AxisConfig
  display?: DisplayConfig
}

// Controls configuration
export interface ControlsConfig {
  show?: boolean
  open?: boolean
  toggle_props?: PaneToggleProps
  pane_props?: PaneProps
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
  auto_x_range?: Vec2
  auto_x2_range?: Vec2
  auto_y_range?: Vec2
  auto_y2_range?: Vec2
  // Helper flags
  has_x2_points?: boolean
  has_y2_points?: boolean
  show_ticks?: boolean
  // Component props
  controls_title?: string
  controls_class?: string
  toggle_props?: PaneToggleProps
  pane_props?: PaneProps
}

// Base props shared across plot components (non-bindable props only)
// Components should declare x_axis, y_axis, display, etc. as $bindable() grouped configs
export interface BasePlotProps {
  range_padding?: number // Factor to pad auto-detected ranges before nicing (e.g. 0.05 = 5%)
  padding?: Sides
  // State
  hovered?: boolean
  // Controls
  show_controls?: boolean
  controls_open?: boolean
  controls_toggle_props?: PaneToggleProps
  controls_pane_props?: PaneProps
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
export const CORNER_CELLS = [`top-left`, `top-right`, `bottom-left`, `bottom-right`] as const

// Define the structure for GridCell and GridCellCounts for 3x3 grid
export type Cell3x3 = (typeof CELLS_3X3)[number]
export type Corner = (typeof CORNER_CELLS)[number]

// Default grid line style (SSOT for all plot components)
export const DEFAULT_GRID_STYLE = {
  stroke: `var(--border-color, gray)`,
  'stroke-dasharray': `4`,
  'stroke-width': `0.5`,
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

// Sub-domain types live in ./types/* and are re-exported so existing
// `$lib/plot/core/types` import paths keep working.
export type * from '$lib/plot/core/types/plot-3d'
export * from '$lib/plot/core/types/fills'
export * from '$lib/plot/core/types/reference-lines'
