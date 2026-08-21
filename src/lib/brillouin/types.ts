import type { Matrix3x3, Point2D, Vec2, Vec3 } from '$lib/math'
import type { DefaultSettings } from '$lib/settings'
import type { TooltipProp } from '$lib/tooltip'

// Viewer settings BrillouinZone forwards to BrillouinZoneControls (bound) and
// BrillouinZoneScene (read-only); defaults live in DEFAULTS.brillouin
export type BrillouinZoneSettings = Omit<DefaultSettings[`brillouin`], `fullscreen_toggle`>

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

export type ConvexHullData = Pick<BZMeshData, `vertices` | `faces`> & {
  edges: Vec2[] // pairs of vertex indices
}
