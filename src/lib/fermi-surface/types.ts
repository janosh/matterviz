// Type definitions for Fermi surface visualization
import type { Matrix3x3, Vec3 } from '$lib/math'

// Spin channel type
export type SpinChannel = `up` | `down` | null

// Representation modes for rendering
export type RepresentationMode = `solid` | `wireframe` | `transparent`

// Property types for coloring
export type ColorProperty = `band` | `velocity` | `spin` | `custom`

// Reciprocal cell type
export type ReciprocalCellType = `wigner_seitz` | `parallelepiped`

// Dimensionality classification (following IFermi conventions)
export type SurfaceDimensionality = `1D` | `2D` | `quasi-2D` | `3D`

// Core isosurface data (output of marching cubes algorithm)
export interface Isosurface {
  vertices: Vec3[]
  faces: number[][] // triangle indices (each array has 3 indices)
  normals: Vec3[] // per-vertex normals
  properties?: number[] // per-vertex scalar values (e.g. Fermi velocity magnitude)
  vector_properties?: Vec3[] // per-vertex vector values (e.g. spin texture)
  band_index: number
  spin: SpinChannel
  // Analysis results (computed on demand)
  area?: number
  dimensionality?: SurfaceDimensionality
  orientation?: Vec3 | null // principal orientation vector for 2D surfaces
  avg_velocity?: number
}

// Complete Fermi surface with multiple bands/isosurfaces
export interface FermiSurfaceData {
  isosurfaces: Isosurface[]
  k_lattice: Matrix3x3 // reciprocal lattice vectors
  fermi_energy: number // Fermi level in eV
  reciprocal_cell: ReciprocalCellType
  metadata: FermiSurfaceMetadata
}

// Metadata for Fermi surface
export interface FermiSurfaceMetadata {
  n_bands: number
  n_surfaces: number
  total_area: number // total surface area in Å⁻²
  source_format?: string // e.g. 'bxsf', 'frmsf', 'json'
  source_file?: string
  has_spin?: boolean
  has_velocities?: boolean
  has_spin_texture?: boolean
  is_irreducible?: boolean // true if data covers only irreducible BZ wedge (needs tiling)
}

// 5D grid types for band data. Indexing: `[spin][band][kx][ky][kz]`
// - spin: 0=up, 1=down (non-spin-polarized has only spin=0)
// - band: 0-based index
// - kx/ky/kz: k-point indices (0 to k_grid[i]-1)
export type EnergyGrid5D = number[][][][][] // scalar energies
export type VectorGrid5D = Vec3[][][][][] // vector quantities (velocities, spin texture)

// Input band energies on a 3D k-point grid (from BXSF/FRMSF files)
export interface BandGridData {
  energies: EnergyGrid5D // [spin][band][kx][ky][kz]
  k_grid: Vec3 // grid dimensions
  k_lattice: Matrix3x3 // reciprocal lattice vectors
  fermi_energy: number
  // Optional property grids (same shape as energies)
  velocities?: VectorGrid5D // Fermi velocity vectors [spin][band][kx][ky][kz]
  spin_texture?: VectorGrid5D // spin expectation values [spin][band][kx][ky][kz]
  // Metadata
  n_bands: number
  n_spins: number // 1 or 2
  origin?: Vec3 // k-space origin (default [0,0,0])
}

// 2D Fermi slice data (cross-section through the BZ)
export interface FermiSliceData {
  isolines: Isoline[]
  plane_normal: Vec3
  plane_distance: number
  k_lattice_2d: [Vec3, Vec3] // in-plane reciprocal vectors
  metadata: {
    n_lines: number
    has_properties: boolean
  }
}

// Single isoline in a Fermi slice
export interface Isoline {
  points: Vec3[] // 3D coordinates of points on the isoline
  points_2d: [number, number][] // 2D coordinates in plane basis
  properties?: number[] // per-point scalar values
  band_index: number
  spin: SpinChannel
  is_closed: boolean // whether the isoline forms a closed loop
}

// Options for Fermi surface extraction
export interface FermiSurfaceOptions {
  mu?: number // chemical potential offset from fermi_energy (default 0)
  wigner_seitz?: boolean // mark as Wigner-Seitz representation in metadata (default true)
  compute_velocities?: boolean // compute Fermi velocities (default false)
  compute_dimensionality?: boolean // analyze surface topology (default false)
  selected_bands?: number[] // only process specific bands (default: all)
  selected_spins?: SpinChannel[] // only process specific spin channels
  interpolation_factor?: number // interpolation density (default 1, no interpolation)
}

// Options for Fermi slice computation
export interface FermiSliceOptions {
  miller_indices?: Vec3 // plane orientation (default [0,0,1])
  distance?: number // distance from origin along normal (default 0)
}

// Event data for file load
export interface FermiFileLoadData {
  fermi_data?: FermiSurfaceData
  band_data?: BandGridData
  filename: string
  file_size: number
}

// Event data for errors
export interface FermiErrorData {
  error_msg: string
  filename?: string
}

// Hover data emitted when user hovers over a Fermi surface
export interface FermiHoverData {
  band_index: number
  spin: SpinChannel
  position_cartesian: Vec3 // k-space coordinates in Å⁻¹
  position_fractional: Vec3 // in reciprocal lattice units
  screen_position: { x: number; y: number }
  surface_color?: string
  property_value?: number // nearest vertex property value
  property_name?: string // "velocity" | "custom" | undefined
  is_tiled?: boolean // true if from symmetry copy
  symmetry_index?: number // 0-47 (0 = identity)
}

// Tooltip config for prefix/suffix content
export interface FermiTooltipConfig {
  prefix?: string | ((data: FermiHoverData) => string)
  suffix?: string | ((data: FermiHoverData) => string)
}

// Type guard: checks if parsed result is FermiSurfaceData (has pre-computed isosurfaces)
export const is_fermi_surface_data = (
  data: BandGridData | FermiSurfaceData | null,
): data is FermiSurfaceData => data !== null && `isosurfaces` in data

// Type guard: checks if parsed result is BandGridData (raw band grid, needs extraction)
export const is_band_grid_data = (
  data: BandGridData | FermiSurfaceData | null,
): data is BandGridData => data !== null && `energies` in data
