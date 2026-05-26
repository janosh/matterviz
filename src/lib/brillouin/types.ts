import type { Matrix3x3, Point2D, Vec3 } from '$lib/math'
import type { Crystal } from '$lib/structure'
import type { TooltipConfig, TooltipProp } from '$lib/tooltip'

// Hover data for BZ tooltip
export type BZHoverData = {
  position_cartesian: Vec3 // k-point in Cartesian coords (Å⁻¹)
  position_fractional: Vec3 | null // k-point in fractional coords
  screen_position: Point2D // for tooltip positioning
  is_ibz: boolean // true if hovering the IBZ mesh
  bz_order: number
  bz_volume: number
  ibz_volume: number | null // only when IBZ is shown
  symmetry_multiplicity: number | null // BZ volume / IBZ volume (e.g., 48 for cubic)
}

// Tooltip configuration for prefix/suffix customization
export type BZTooltipConfig = TooltipConfig<BZHoverData>

// Tooltip prop can be a snippet for full customization or config for prefix/suffix
export type BZTooltipProp = TooltipProp<BZHoverData, [{ hover_data: BZHoverData }]>

type BZMeshData = {
  vertices: Vec3[]
  faces: number[][] // Face indices for mesh rendering
  edges: Vec3[][] // Edge segments for boundary rendering
}

// Data structure for the irreducible Brillouin zone wedge
export type IrreducibleBZData = BZMeshData & { volume: number } // IBZ volume in Å⁻³

export type BrillouinZoneData = BZMeshData & {
  order: number // 1st, 2nd, 3rd BZ
  k_lattice: Matrix3x3 // reciprocal lattice vectors
  volume: number // BZ volume in Å⁻³
}

export type BrillouinZoneProps = {
  structure: Crystal
  bz_order?: number // default 1
  // Styling
  surface_color?: string
  surface_opacity?: number
  edge_color?: string
  edge_width?: number
  show_vectors?: boolean // show b₁, b₂, b₃
}

export type ConvexHullData = Pick<BZMeshData, `vertices` | `faces`> & {
  edges: [number, number][] // pairs of vertex indices
}
