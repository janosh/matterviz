// Type definitions for isosurface visualization (charge density, molecular orbitals, etc.)
import type { Matrix3x3, Vec3 } from '$lib/math'
import type { ParsedStructure } from '$lib/structure/parse'

// Precomputed statistics for a volumetric grid (min, max, abs_max, mean)
export interface DataRange {
  min: number
  max: number
  abs_max: number
  mean: number
}

// Volumetric scalar data on a 3D grid (e.g. charge density, electrostatic potential)
export interface VolumetricData {
  grid: number[][][] // scalar values [nx][ny][nz]
  grid_dims: Vec3 // [nx, ny, nz]
  lattice: Matrix3x3 // real-space lattice vectors (rows are a, b, c)
  origin: Vec3 // grid origin in Cartesian coordinates
  data_range: DataRange // precomputed min/max/mean statistics
  // Linearization order of values in the source file.
  // VASP files are x-fastest; Gaussian .cube is z-fastest.
  data_order?: `x_fastest` | `z_fastest`
  // Whether the grid has periodic boundary conditions (affects coordinate scaling).
  // Periodic grids (CHGCAR) span [0,1) with spacing 1/N; non-periodic (.cube molecular)
  // span [0,1] with spacing 1/(N-1).
  periodic: boolean
  label?: string // e.g. "charge density", "spin density", "orbital"
}

// Result of parsing a volumetric file (contains both structure and volumetric data)
export interface VolumetricFileData {
  structure: ParsedStructure
  volumes: VolumetricData[] // one or more volumes (e.g. total + magnetization for spin-polarized)
}

// A single isosurface layer at a specific isovalue with its own appearance
export interface IsosurfaceLayer {
  isovalue: number
  color: string
  opacity: number
  visible: boolean
  // When true, also render the -isovalue surface in `negative_color`
  show_negative: boolean
  negative_color: string
}

// Isosurface rendering settings
export interface IsosurfaceSettings {
  isovalue: number
  opacity: number
  positive_color: string // color for positive isovalue lobe
  negative_color: string // color for negative isovalue lobe
  show_negative: boolean // whether to render the negative lobe (-isovalue)
  wireframe: boolean
  halo: number // fraction of cell to extend isosurface beyond boundaries (0 = clip at cell edge, 0.5 = half cell)
  layers?: IsosurfaceLayer[] // if set, overrides single-isovalue mode
}

// Categorical palette for auto-coloring isosurface layers (Tailwind-inspired)
export const LAYER_COLORS = [
  `#3b82f6`, // blue
  `#ef4444`, // red
  `#22c55e`, // green
  `#a855f7`, // purple
  `#f97316`, // orange
  `#06b6d4`, // cyan
  `#eab308`, // yellow
  `#ec4899`, // pink
] as const

// Compute min/max/abs_max/mean of a 3D grid.
// Prefer using the precomputed `data_range` field on VolumetricData when available.
export function grid_data_range(grid: number[][][]): DataRange {
  if (!grid.length || !grid[0]?.length || !grid[0][0]?.length) {
    return { min: 0, max: 0, abs_max: 0, mean: 0 }
  }
  let [min_val, max_val] = [Infinity, -Infinity]
  let sum = 0
  let count = 0
  for (const plane of grid) {
    for (const row of plane) {
      for (const val of row) {
        if (val < min_val) min_val = val
        if (val > max_val) max_val = val
        sum += val
        count++
      }
    }
  }
  const abs_max = Math.max(Math.abs(min_val), Math.abs(max_val))
  return { min: min_val, max: max_val, abs_max, mean: count > 0 ? sum / count : 0 }
}

// Pad a periodic 3D grid with halo cells from the opposite face so isosurfaces
// extend beyond the unit cell and close into complete enclosed shapes.
// Returns a larger grid with dims [nx+2*pad, ny+2*pad, nz+2*pad] and the
// fractional offset that the padded grid's origin has shifted by.
export function pad_periodic_grid(
  grid: number[][][],
  dims: Vec3,
  pad_fraction: number,
): { grid: number[][][]; dims: Vec3; offset: Vec3 } {
  const [nx, ny, nz] = dims
  const frac = Math.max(0, pad_fraction)
  const px = Math.min(Math.ceil(nx * frac), Math.floor(nx / 2))
  const py = Math.min(Math.ceil(ny * frac), Math.floor(ny / 2))
  const pz = Math.min(Math.ceil(nz * frac), Math.floor(nz / 2))
  if (px === 0 && py === 0 && pz === 0) return { grid, dims, offset: [0, 0, 0] }

  const out_nx = nx + 2 * px
  const out_ny = ny + 2 * py
  const out_nz = nz + 2 * pz
  const wrap = (val: number, size: number) => ((val % size) + size) % size

  const out: number[][][] = new Array(out_nx)
  for (let ix = 0; ix < out_nx; ix++) {
    const plane: number[][] = new Array(out_ny)
    const src_x = wrap(ix - px, nx)
    for (let iy = 0; iy < out_ny; iy++) {
      const row = new Array<number>(out_nz)
      const src_y = wrap(iy - py, ny)
      for (let iz = 0; iz < out_nz; iz++) {
        row[iz] = grid[src_x][src_y][wrap(iz - pz, nz)]
      }
      plane[iy] = row
    }
    out[ix] = plane
  }

  // Fractional offset: the padded grid starts at -pad/n in each axis
  const offset: Vec3 = [-px / nx, -py / ny, -pz / nz]
  return { grid: out, dims: [out_nx, out_ny, out_nz], offset }
}

// Max total grid points before downsampling is applied for isosurface extraction.
// 500K balances visual quality with interactive performance (<200ms marching cubes).
const MAX_GRID_POINTS = 500_000

// Downsample a 3D volumetric grid to keep total point count under MAX_GRID_POINTS.
// Uses block averaging to preserve data fidelity while reducing grid dimensions.
// Returns original grid/dims if already within budget.
export function downsample_grid(
  grid: number[][][],
  dims: Vec3,
): { grid: number[][][]; dims: Vec3; factor: number } {
  const [nx, ny, nz] = dims
  const total = nx * ny * nz
  if (total <= MAX_GRID_POINTS) return { grid, dims, factor: 1 }

  // Increase factor until the clamped output fits within budget.
  // A single cbrt step can overshoot for anisotropic grids where max(2,...)
  // clamping prevents a small axis from shrinking below 2.
  // clamp_dim: returns 1 for single-cell axes, otherwise clamps to [2, src]
  const clamp_dim = (src: number, fac: number) =>
    Math.min(src, Math.max(2, Math.ceil(src / fac)))
  let factor = Math.ceil(Math.cbrt(total / MAX_GRID_POINTS))
  let new_nx = clamp_dim(nx, factor)
  let new_ny = clamp_dim(ny, factor)
  let new_nz = clamp_dim(nz, factor)
  while (new_nx * new_ny * new_nz > MAX_GRID_POINTS) {
    factor++
    new_nx = clamp_dim(nx, factor)
    new_ny = clamp_dim(ny, factor)
    new_nz = clamp_dim(nz, factor)
  }

  // Proportional partitioning: evenly divides [0, n) into new_n non-empty blocks.
  // Unlike fixed-stride (ix * factor), this is safe when max(2,...) clamping
  // produces more output cells than ceil(n/factor) would — no empty blocks.
  const partition = (n_out: number, n_src: number): [number, number][] =>
    Array.from({ length: n_out }, (_, idx) => [
      Math.round((idx * n_src) / n_out),
      Math.round(((idx + 1) * n_src) / n_out),
    ])

  const x_ranges = partition(new_nx, nx)
  const y_ranges = partition(new_ny, ny)
  const z_ranges = partition(new_nz, nz)

  const out: number[][][] = new Array(new_nx)
  for (let ix = 0; ix < new_nx; ix++) {
    const plane: number[][] = new Array(new_ny)
    const [sx_start, sx_end] = x_ranges[ix]
    for (let iy = 0; iy < new_ny; iy++) {
      const row = new Array<number>(new_nz)
      const [sy_start, sy_end] = y_ranges[iy]
      for (let iz = 0; iz < new_nz; iz++) {
        let sum = 0
        const [sz_start, sz_end] = z_ranges[iz]
        for (let sx = sx_start; sx < sx_end; sx++) {
          const src_plane = grid[sx]
          for (let sy = sy_start; sy < sy_end; sy++) {
            const src_row = src_plane[sy]
            for (let sz = sz_start; sz < sz_end; sz++) {
              sum += src_row[sz]
            }
          }
        }
        row[iz] = sum / ((sx_end - sx_start) * (sy_end - sy_start) * (sz_end - sz_start))
      }
      plane[iy] = row
    }
    out[ix] = plane
  }

  return { grid: out, dims: [new_nx, new_ny, new_nz], factor }
}

// Default isosurface rendering settings
export const DEFAULT_ISOSURFACE_SETTINGS: IsosurfaceSettings = {
  isovalue: 0.05,
  opacity: 0.6,
  positive_color: `#3b82f6`, // blue
  negative_color: `#ef4444`, // red
  show_negative: false,
  wireframe: false,
  halo: 0,
}

// Compute reasonable isosurface settings from a volume's data range.
// Sets isovalue to 20% of abs_max and enables negative lobe when data has
// significant negative values (>1% of max).
export function auto_isosurface_settings(data_range: DataRange): IsosurfaceSettings {
  const has_negatives = data_range.min < -data_range.abs_max * 0.01
  return {
    ...DEFAULT_ISOSURFACE_SETTINGS,
    // Fall back to default isovalue for all-zero grids to keep controls usable
    isovalue:
      data_range.abs_max > 0 ? data_range.abs_max * 0.2 : DEFAULT_ISOSURFACE_SETTINGS.isovalue,
    show_negative: has_negatives,
  }
}

// Generate N evenly-spaced isosurface layers across a data range.
// Layers are spaced from 10% to 80% of abs_max with decreasing opacity
// for outer (lower-isovalue) shells so inner shells remain visible.
export function generate_layers(data_range: DataRange, n_layers: number): IsosurfaceLayer[] {
  if (n_layers <= 0 || data_range.abs_max <= 0) return []
  const has_negatives = data_range.min < -data_range.abs_max * 0.01
  // Space isovalues from high (inner) to low (outer)
  return Array.from({ length: n_layers }, (_, idx) => {
    // Fraction from 0.8 (inner) to 0.1 (outer)
    const fraction = n_layers === 1 ? 0.2 : 0.8 - (idx / (n_layers - 1)) * 0.7
    return {
      isovalue: data_range.abs_max * fraction,
      color: LAYER_COLORS[idx % LAYER_COLORS.length],
      opacity: n_layers === 1 ? 0.6 : 0.8 - idx * (0.5 / Math.max(n_layers - 1, 1)),
      visible: true,
      show_negative: has_negatives,
      negative_color: LAYER_COLORS[(idx + 1) % LAYER_COLORS.length],
    }
  })
}
