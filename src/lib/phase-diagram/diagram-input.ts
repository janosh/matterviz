// Input types for compact phase diagram definitions
// These are transformed by build-diagram.ts into full PhaseDiagramData

import type { Vec2 } from '$lib/math'
import type { CompUnit, PseudoBinaryMetadata, SpecialPoint, TempUnit } from './types'

// A point is [composition, temperature] for phase diagram curves
export type DiagramPoint = Vec2
type TempRange = Vec2 // [min, max]

// A bound can be a curve reference (string) or an inline point
export type BoundElement = string | DiagramPoint

interface DiagramInputMeta {
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
  color?: string // raw CSS color; omitted → get_phase_color(name) picks from the palette
  bounds: BoundElement[] // curve refs or inline [x,t] points
  label_position?: DiagramPoint
}

export interface DiagramInput {
  meta: DiagramInputMeta
  curves: Record<string, DiagramPoint[]>
  regions: RegionInput[]
  special_points?: SpecialPoint[]
}
