// Type definitions for Fermi surface visualization
import type { FileLoadData } from '$lib/io/types'
import type { ScalarGrid3D } from '$lib/isosurface/grid'
import type { Matrix3x3, Point2D, Vec2, Vec3 } from '$lib/math'
import type { DefaultSettings } from '$lib/settings'
import type { TooltipConfig, TooltipProp } from '$lib/tooltip'

// Viewer settings FermiSurface forwards to FermiSurfaceControls (bound) and FermiSurfaceScene
// (read-only); defaults live in DEFAULTS.fermi
export type FermiSurfaceSettings = Omit<DefaultSettings[`fermi`], `fullscreen_toggle`>

export type SpinChannel = `up` | `down` | null

// Property types for coloring: flat colour per band or spin channel, or the per-vertex
// scalar `properties` (Fermi velocity, orbital character, …) mapped through a colour scale
export type ColorProperty = `band` | `spin` | `property`

type ReciprocalCellType = `wigner_seitz` | `parallelepiped`

// One closed sheet of the Fermi surface as an indexed triangle mesh in the layout
// three.js BufferGeometry consumes directly: flat xyz positions/normals and triangle index
// triples. Vertex `idx` lives at positions[3*idx .. 3*idx+2].
export interface FermiIsosurface {
  positions: Float32Array
  indices: Uint32Array
  normals: Float32Array
  properties?: Float32Array // per-vertex scalar values (e.g. Fermi velocity magnitude)
  band_index: number
  spin: SpinChannel
}

export const vertex_count = (surface: Pick<FermiIsosurface, `positions`>): number =>
  surface.positions.length / 3

// Complete Fermi surface with multiple bands/isosurfaces
export interface FermiSurfaceData {
  isosurfaces: FermiIsosurface[]
  k_lattice: Matrix3x3 // reciprocal lattice vectors
  fermi_energy: number // Fermi level in eV
  reciprocal_cell: ReciprocalCellType
  metadata: FermiSurfaceMetadata
}

export interface FermiSurfaceMetadata {
  n_bands: number
  n_surfaces: number
  source_format?: string // e.g. 'bxsf', 'frmsf', 'json'
}

// One band's energies on the k-grid as a flat z-fastest Float64Array: the value at grid
// point (ix, iy, iz) sits at index (ix * ny + iy) * nz + iz, with dims = k_grid.
export type BandEnergyGrid = ScalarGrid3D<Float64Array>

// Input band energies on a 3D k-point grid (from BXSF/FRMSF files)
export interface BandGridData {
  // [spin][band] → flat grid. spin: 0=up, 1=down (non-spin-polarized has only spin=0)
  energies: BandEnergyGrid[][]
  k_grid: Vec3 // grid dimensions
  k_lattice: Matrix3x3 // reciprocal lattice vectors
  fermi_energy: number
  n_bands: number
  n_spins: number // 1 or 2
  // true: points sit at k=i/n with no duplicated endpoint (FRMSF); false/undefined:
  // endpoint-inclusive grid storing both equivalent k=0 and k=1 (BXSF)
  periodic?: boolean
  // Fractional grid shift per axis: grid point i sits at (i + grid_shift)/n. FRMSF lshift=2
  // (Γ + half step) gives 0.5; unset/0 for Γ-centred meshes.
  grid_shift?: Vec3
}

// 2D Fermi slice data (cross-section through the BZ)
export interface FermiSliceData {
  isolines: Isoline[]
  plane_normal: Vec3
  plane_distance: number
  metadata: {
    n_lines: number
    has_properties: boolean
  }
}

// Single isoline in a Fermi slice
export interface Isoline {
  points: Vec3[] // 3D coordinates of points on the isoline
  points_2d: Vec2[] // 2D coordinates in plane basis
  properties?: number[] // per-point scalar values
  band_index: number
  spin: SpinChannel
  is_closed: boolean // whether the isoline forms a closed loop
}

// Options for Fermi surface extraction
export interface FermiSurfaceOptions {
  mu?: number // chemical potential offset from fermi_energy (default 0)
  interpolation_factor?: number // tricubic upsampling factor (default 1, no interpolation)
}

// Options for Fermi slice computation
export interface FermiSliceOptions {
  miller_indices?: Vec3 // plane orientation (default [0,0,1])
  distance?: number // distance from origin along normal (default 0)
}

// Event data for file load
export interface FermiFileLoadData extends FileLoadData {
  fermi_data?: FermiSurfaceData
  band_data?: BandGridData
  filename: string
  file_size: number
}

// Event data for errors
export interface FermiErrorData extends FileLoadData {
  error_msg: string
}

// Hover data emitted when user hovers over a Fermi surface
export interface FermiHoverData {
  band_index: number
  spin: SpinChannel
  position_cartesian: Vec3 // k-space coordinates in Å⁻¹
  position_fractional: Vec3 | null // in reciprocal lattice units (null if conversion failed)
  screen_position: Point2D
  surface_color?: string
  property_value?: number // nearest vertex property value
  property_name?: string // label of the per-vertex property (custom_property_label or "Property")
  is_tiled?: boolean // true if from symmetry copy
  // Index into lattice_point_group_matrices(k_lattice) (0 = identity; up to 47 for cubic)
  symmetry_index?: number
  n_symmetry_ops?: number // size of the lattice point group used for tiling (48 cubic, 24 hexagonal, …)
}

// Tooltip config for prefix/suffix content
export type FermiTooltipConfig = TooltipConfig<FermiHoverData>
export type FermiTooltipProp = TooltipProp<FermiHoverData, [{ hover_data: FermiHoverData }]>

// Type guard: checks if parsed result is FermiSurfaceData (has pre-computed isosurfaces)
export const is_fermi_surface_data = (
  data: BandGridData | FermiSurfaceData | null,
): data is FermiSurfaceData => data !== null && `isosurfaces` in data

// Type guard: checks if parsed result is BandGridData (raw band grid, needs extraction)
export const is_band_grid_data = (
  data: BandGridData | FermiSurfaceData | null,
): data is BandGridData => data !== null && `energies` in data
