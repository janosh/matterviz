import type { Matrix3x3, Vec3 } from '$lib/math'
import type { Crystal } from '$lib/structure'

export type BrillouinZoneData = {
  order: number // 1st, 2nd, 3rd BZ
  vertices: Vec3[]
  faces: number[][] // triangle indices for mesh rendering
  edges: Vec3[][] // line segments for edge rendering
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

export type ConvexHullData = {
  vertices: Vec3[]
  faces: number[][] // indices into vertices array
  edges: [number, number][] // pairs of vertex indices
}
