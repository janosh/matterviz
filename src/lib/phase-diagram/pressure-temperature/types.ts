// Pressure-temperature phase diagram input: plain JSON (arrays, strings, numbers) so it can
// cross a widget boundary unchanged. All coordinates are [pressure, temperature] pairs in the
// data's own units (pressure_unit, temperature_unit). A null-valued key counts as omitted.

import type { Point2D, Vec2 } from '#lib/math.js'
import type { LineStyle } from '#lib/plot/index.js'
import type { TooltipConfig, TooltipProp } from '#lib/tooltip/index.js'
import type { TempUnit } from '../types'

export type PressureUnit = `Pa` | `kPa` | `MPa` | `GPa` | `bar` | `kbar` | `atm`

export interface PtPhase {
  id: string
  name?: string // display label (defaults to id), chemical formulas get subscripts
  color?: string // CSS color, defaults to the phase palette
  description?: string // shown in the tooltip, e.g. `bcc` or `stable above 1185 K`
}

// Coexistence line between two phases
export interface PtBoundary {
  id: string
  phases: [string, string] // ids of the two coexisting phases, in any order
  points: Vec2[] // [pressure, temperature] polyline
  // Per-point standard errors (one entry per point, same units as the data): sigma_t is the
  // temperature uncertainty at fixed pressure, sigma_p the pressure uncertainty at fixed
  // temperature. Either, both or neither may be given.
  sigma_t?: number[]
  sigma_p?: number[]
  label?: string
  style?: LineStyle
  // Metastable extensions draw dashed and don't split the plane into regions
  metastable?: boolean
}

export type PtSpecialPointType = `triple` | `critical` | `custom`

export interface PtSpecialPoint {
  id: string
  type: PtSpecialPointType
  position: Vec2 // [pressure, temperature]
  phases?: string[] // ids of the phases meeting here
  sigma_t?: number
  sigma_p?: number
  label?: string
}

// Explicit stability field of one phase. Omit regions to derive them from the boundaries.
export interface PtRegion {
  phase: string // phase id
  vertices: Vec2[] // closed [pressure, temperature] polygon
  label_position?: Vec2
}

export interface PtPhaseDiagramData {
  phases: PtPhase[]
  boundaries: PtBoundary[]
  // Omit to trace regions from the boundaries; an empty array draws none
  regions?: PtRegion[]
  special_points?: PtSpecialPoint[]
  // Plotted window, defaults to the extent of the boundaries and special points
  pressure_range?: Vec2
  temperature_range?: Vec2
  pressure_unit?: PressureUnit // default GPa
  temperature_unit?: TempUnit // default K
  system?: string // e.g. `Fe` or `H2O`, names the diagram in labels and export filenames
  title?: string
}

export type PtUncertaintyMode = `band` | `bars` | `both` | `none`

// Uncertainty of a boundary at the hovered point, standard errors in data units
export interface PtBoundaryHit {
  boundary: PtBoundary
  point: Vec2 // nearest point on the boundary
  sigma_t: number | null
  sigma_p: number | null
}

export interface PtHoverInfo {
  phase: PtPhase | null // stable phase at the cursor, null outside every region
  point: Vec2 // [pressure, temperature] at the cursor, data units
  boundary: PtBoundaryHit | null // set within a few pixels of a coexistence line
  special_point: PtSpecialPoint | null
  position: Point2D // tooltip anchor in plot-SVG pixels
}

export type PtPhaseDiagramTooltipProp = TooltipProp<PtHoverInfo, TooltipConfig<PtHoverInfo>>
