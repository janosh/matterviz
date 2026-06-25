// Reference-line and reference-plane types for 2D and 3D plots.
// Depends only on LayerZIndex (from ./fills) and math vectors; re-exported via $lib/plot/core/types.

import type { Vec3 } from '$lib/math'
import type { LayerZIndex } from '$lib/plot/core/types/fills'

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
  x_axis?: `x1` | `x2` // for vertical lines with dual x-axes
  y_axis?: `y1` | `y2` // for horizontal lines with dual y-axes
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
export type RefLine = RefLineBase &
  (
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

type Ref3DBase = Omit<
  RefLineBase,
  | `coord_mode`
  | `x_axis`
  | `y_axis`
  | `style`
  | `hover_style`
  | `annotation`
  | `on_click`
  | `on_hover`
> & {
  z_span?: [number | null, number | null]
}

// Base properties shared by all 3D reference line types
// Aligned with RefLineBase for future feature parity (interactions, annotations, etc.)
export interface RefLine3DBase extends Ref3DBase {
  style?: RefLineStyle
  hover_style?: RefLineStyle
  annotation?: RefLineAnnotation
  on_click?: (event: { line_idx: number; line_id?: string | number }) => void
  on_hover?: (event: { line_idx: number; line_id?: string | number } | null) => void
}

// 3D reference line - discriminated union
export type RefLine3D = RefLine3DBase &
  (
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
export interface RefPlaneBase extends Ref3DBase {
  style?: RefPlaneStyle
}

// 3D reference plane - discriminated union
export type RefPlane = RefPlaneBase &
  (
    | { type: `xy`; z: number } // horizontal plane at z
    | { type: `xz`; y: number } // vertical plane at y
    | { type: `yz`; x: number } // vertical plane at x
    | { type: `normal`; normal: Vec3; point: Vec3 }
    | { type: `points`; p1: Vec3; p2: Vec3; p3: Vec3 } // plane through 3 points
  )
