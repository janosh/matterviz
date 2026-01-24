// Input types for compact phase diagram definitions
// These are transformed by build-diagram.ts into full PhaseDiagramData

import type { CompUnit, PseudoBinaryMetadata, SpecialPointType, TempUnit } from './types'

// A point is [composition, temperature] for phase diagram curves
export type DiagramPoint = [number, number]
export type TempRange = [number, number] // [min, max]

// A bound can be a curve reference (string) or an inline point
export type BoundElement = string | DiagramPoint

export interface DiagramInputMeta {
  components: [string, string]
  temp_range: TempRange
  temp_unit?: TempUnit
  comp_unit?: CompUnit
  title?: string
  pseudo_binary?: PseudoBinaryMetadata
  x_axis_label?: string
  y_axis_label?: string
}

export interface RegionInput {
  id: string
  name: string
  color: string // key into DIAGRAM_COLORS or rgba string
  bounds: BoundElement[] // curve refs or inline [x,t] points
  label_position?: DiagramPoint
}

export interface SpecialPointInput {
  id: string
  type: SpecialPointType
  position: DiagramPoint
  label?: string
}

export interface DiagramInput {
  meta: DiagramInputMeta
  curves: Record<string, DiagramPoint[]>
  regions: RegionInput[]
  special_points?: SpecialPointInput[]
}
