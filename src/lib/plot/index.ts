import type { SimulationNodeDatum } from 'd3-force'
import type { SymbolType } from 'd3-shape'
import * as d3_symbols from 'd3-shape'
import type { ComponentProps } from 'svelte'
import { type TweenedOptions } from 'svelte/motion'
import type ColorBar from './ColorBar.svelte'
import PlotLegend from './PlotLegend.svelte'

export { default as ColorBar } from './ColorBar.svelte'
export { default as ColorScaleSelect } from './ColorScaleSelect.svelte'
export { default as ElementScatter } from './ElementScatter.svelte'
export { default as Line } from './Line.svelte'
export { default as PlotLegend } from './PlotLegend.svelte'
export { default as ScatterPlot } from './ScatterPlot.svelte'
export { default as ScatterPlotControls } from './ScatterPlotControls.svelte'
export { default as ScatterPoint } from './ScatterPoint.svelte'

export type XyObj = { x: number; y: number }
export type Sides = { t?: number; b?: number; l?: number; r?: number }

export type D3Symbol = keyof typeof d3_symbols & `symbol${Capitalize<string>}`
export type D3SymbolName = Exclude<
  D3Symbol extends `symbol${infer Name}` ? Name : never,
  ``
>

export const symbol_names = [
  ...d3_symbols.symbolsFill,
  ...d3_symbols.symbolsStroke,
].map((sym) => {
  // Attempt to find the key associated with this symbol function object
  for (const key in d3_symbols) {
    if (
      Object.prototype.hasOwnProperty.call(d3_symbols, key) &&
      d3_symbols[key as keyof typeof d3_symbols] === sym
    ) {
      if (key.match(/symbol[A-Z]/)) return key.substring(6)
    }
  }
}) as D3SymbolName[]

export const symbol_map = Object.fromEntries(
  symbol_names.map((name) => [name, d3_symbols[`symbol${name}`]]),
) as Record<D3SymbolName, SymbolType>

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

// Define the structure for a data series in the plot
export interface DataSeries {
  x: readonly number[]
  y: readonly number[]
  // Optional marker display type override for this specific series
  markers?: `line` | `points` | `line+points`
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
export type LegendConfig =
  & Omit<
    ComponentProps<typeof PlotLegend>,
    `series_data` | `on_toggle` | `on_drag_start` | `on_drag` | `on_drag_end`
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

// Small value to substitute for non-positive minimum in log scales
export const LOG_MIN_EPS = 1e-9
