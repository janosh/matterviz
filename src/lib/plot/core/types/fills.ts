// Fill-region and error-band types for 2D plots (shaded areas between boundaries).
// Self-contained leaf module re-exported via $lib/plot/core/types.

// FillBoundary - references to data sources for fill regions
// Can reference series by index, by id, or specify constant/axis/function/data values
export type FillBoundary =
  | { type: `series`; series_idx: number }
  | { type: `series`; series_id: string | number }
  | { type: `constant`; value: number }
  | { type: `axis`; axis: `x` | `x2` | `y` | `y2`; value?: number }
  | { type: `function`; fn: (coord: number) => number }
  // x is optional; when omitted, values align to the companion boundary's x positions
  | { type: `data`; values: readonly number[]; x?: readonly number[] }
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
  stroke?: string // Outline color drawn around the region on hover (default: theme-aware contrast)
  stroke_width?: number // Outline width in px on hover (default: 1.5)
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
  series:
    | { type: `series`; series_idx: number }
    | {
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
