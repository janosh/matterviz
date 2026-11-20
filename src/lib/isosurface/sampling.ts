// Volume sampling utilities: trilinear interpolation, world-coordinate volume
// samplers for cross-volume isosurface coloring, grid compatibility checks, and
// fractional display-range extraction for VESTA-style non-integer supercells.
import type { Matrix3x3, Vec2, Vec3 } from '#lib/math.js'
import {
  create_frac_to_cart,
  IDENTITY_3X3,
  inverse_3x3,
  reciprocal_lattice,
  scale_lattice_matrix,
} from '#lib/math.js'
import { diagonal_scaling } from '#lib/structure/supercell.js'
import { clamp01 } from '#lib/utils.js'
import { lower_corner, type ScalarGrid3D, upper_corner } from './grid'
import type { VolumeGrid, VolumetricData } from './types'
import { grid_data_range, MAX_GRID_POINTS } from './types'

// Preserve the rounding of ((frac % 1) + 1) % 1 while avoiding remainder operations
// for coordinates already in the cell. The addition can round up to exactly 2.
const wrap_fraction = (frac: number): number => {
  const shifted = (frac > -1 && frac < 1 ? frac : frac % 1) + 1
  if (shifted >= 1) return shifted === 2 ? 0 : shifted - 1
  return shifted
}

// Trilinear interpolation of a scalar grid (either value order) at fractional coordinates.
// Periodic grids wrap with modulo; non-periodic return 0 for out-of-bounds. Scalar
// arithmetic only: this runs once per slice pixel and per isosurface vertex.
export function trilinear_interpolate(
  grid: ScalarGrid3D,
  frac_x: number,
  frac_y: number,
  frac_z: number,
  periodic: boolean,
): number {
  // indexed, not destructured: array destructuring runs the iterator protocol per sample
  const { dims } = grid
  const size_x = dims[0]
  const size_y = dims[1]
  const size_z = dims[2]
  if (size_x === 0 || size_y === 0 || size_z === 0) return 0
  if (
    !periodic &&
    (frac_x < 0 || frac_x > 1 || frac_y < 0 || frac_y > 1 || frac_z < 0 || frac_z > 1)
  )
    return 0

  // Fractional → grid coordinates: periodic point i sits at i/n, finite at i/(n-1)
  const grid_x = periodic ? frac_x * size_x : frac_x * (size_x - 1)
  const grid_y = periodic ? frac_y * size_y : frac_y * (size_y - 1)
  const grid_z = periodic ? frac_z * size_z : frac_z * (size_z - 1)
  const floor_x = Math.floor(grid_x)
  const floor_y = Math.floor(grid_y)
  const floor_z = Math.floor(grid_z)
  const coord_x_0 = lower_corner(size_x, floor_x, periodic)
  const coord_y_0 = lower_corner(size_y, floor_y, periodic)
  const coord_z_0 = lower_corner(size_z, floor_z, periodic)
  // deltas from the clamped lower index (non-periodic x0 clamps to nx-2 so floor(gx) may != x0)
  const x_fraction = periodic ? grid_x - floor_x : grid_x - coord_x_0
  const y_fraction = periodic ? grid_y - floor_y : grid_y - coord_y_0
  const z_fraction = periodic ? grid_z - floor_z : grid_z - coord_z_0
  // scalar_grid_strides inlined: its Vec3 allocation per sample cost 7% here
  const x_fastest = grid.order === `x_fastest`
  return interpolate_cell(
    grid.values,
    x_fastest ? 1 : size_y * size_z,
    x_fastest ? size_x : size_z,
    x_fastest ? size_x * size_y : 1,
    coord_x_0,
    upper_corner(size_x, coord_x_0, periodic),
    coord_y_0,
    upper_corner(size_y, coord_y_0, periodic),
    coord_z_0,
    upper_corner(size_z, coord_z_0, periodic),
    x_fraction,
    y_fraction,
    z_fraction,
  )
}

// 8-corner trilinear blend on a value array with the given strides
const interpolate_cell = (
  values: ArrayLike<number>,
  stride_x: number,
  stride_y: number,
  stride_z: number,
  coord_x_0: number,
  coord_x_1: number,
  coord_y_0: number,
  coord_y_1: number,
  coord_z_0: number,
  coord_z_1: number,
  x_fraction: number,
  y_fraction: number,
  z_fraction: number,
): number => {
  const row_00 = coord_x_0 * stride_x + coord_y_0 * stride_y
  const row_01 = coord_x_0 * stride_x + coord_y_1 * stride_y
  const row_10 = coord_x_1 * stride_x + coord_y_0 * stride_y
  const row_11 = coord_x_1 * stride_x + coord_y_1 * stride_y
  const z_0 = coord_z_0 * stride_z
  const z_1 = coord_z_1 * stride_z
  const c00 = values[row_00 + z_0] + (values[row_10 + z_0] - values[row_00 + z_0]) * x_fraction
  const c01 = values[row_00 + z_1] + (values[row_10 + z_1] - values[row_00 + z_1]) * x_fraction
  const c10 = values[row_01 + z_0] + (values[row_11 + z_0] - values[row_01 + z_0]) * x_fraction
  const c11 = values[row_01 + z_1] + (values[row_11 + z_1] - values[row_01 + z_1]) * x_fraction
  const value_c_0 = c00 + (c10 - c00) * y_fraction
  const value_c_1 = c01 + (c11 - c01) * y_fraction
  return value_c_0 + (value_c_1 - value_c_0) * z_fraction
}

// Out-of-grid samples of a non-periodic volume: 'clamp' takes the nearest edge value,
// 'fallback' returns NaN so callers substitute a solid color. Periodic volumes always wrap.
type OutOfBoundsPolicy = `clamp` | `fallback`

interface VolumeSamplerOptions {
  out_of_bounds?: OutOfBoundsPolicy
}

interface BulkVolumeSamplerOptions extends VolumeSamplerOptions {
  position_offset?: Vec3
  out?: Float32Array
}

// Lets vertices numerically on a finite grid's boundary (fraction 1 + 1e-16) still sample
const OOB_TOL = 1e-6

// Absolute Cartesian (x, y, z) in the volume's frame → trilinearly interpolated value, for
// any lattice, origin and wrapping. Scalar arithmetic only: it runs once per vertex / pixel.
function volume_sampler_xyz(
  volume: VolumeGrid,
  out_of_bounds: OutOfBoundsPolicy,
): (coord_x: number, coord_y: number, coord_z: number) => number {
  // Cartesian→fractional matrix (reciprocal lattice rows)
  const [[i00, i01, i02], [i10, i11, i12], [i20, i21, i22]] = reciprocal_lattice(
    volume.lattice,
  )
  const { periodic, values, order } = volume
  const [origin_x, origin_y, origin_z] = volume.origin
  const fallback = out_of_bounds === `fallback`
  // Read the grid once: per-sample reads through a $state volume's proxy are far slower
  const grid: ScalarGrid3D = { values, dims: [...volume.dims], order }

  return (coord_x, coord_y, coord_z) => {
    const cart_x = coord_x - origin_x
    const cart_y = coord_y - origin_y
    const cart_z = coord_z - origin_z
    let frac_x = i00 * cart_x + i01 * cart_y + i02 * cart_z
    let frac_y = i10 * cart_x + i11 * cart_y + i12 * cart_z
    let frac_z = i20 * cart_x + i21 * cart_y + i22 * cart_z
    if (periodic) {
      frac_x = wrap_fraction(frac_x)
      frac_y = wrap_fraction(frac_y)
      frac_z = wrap_fraction(frac_z)
    } else {
      if (
        fallback &&
        (frac_x < -OOB_TOL ||
          frac_x > 1 + OOB_TOL ||
          frac_y < -OOB_TOL ||
          frac_y > 1 + OOB_TOL ||
          frac_z < -OOB_TOL ||
          frac_z > 1 + OOB_TOL)
      )
        return NaN
      // Clamp genuine out-of-bounds ('clamp' policy) and tiny overshoot at the boundary
      frac_x = clamp01(frac_x)
      frac_y = clamp01(frac_y)
      frac_z = clamp01(frac_z)
    }
    return trilinear_interpolate(grid, frac_x, frac_y, frac_z, periodic)
  }
}

// Sampler from absolute Cartesian positions (the frame of the volume's `origin`) to values,
// for matching grids and for resampling between volumes sharing a Cartesian frame
export function create_volume_sampler(
  volume: VolumeGrid,
  { out_of_bounds = `clamp` }: VolumeSamplerOptions = {},
): (position: Vec3) => number {
  const sample = volume_sampler_xyz(volume, out_of_bounds)
  return (position) => sample(position[0], position[1], position[2])
}

// Sample a volume at flat xyz triplets shifted by `position_offset`, one scalar per position
// (NaN marks out-of-bounds under 'fallback'). Pass `out` of the right size to fill in place.
export function sample_volume_at_positions(
  volume: VolumeGrid,
  positions: Float32Array | Float64Array,
  { out_of_bounds = `clamp`, position_offset = [0, 0, 0], out }: BulkVolumeSamplerOptions = {},
): Float32Array {
  const [offset_x, offset_y, offset_z] = position_offset
  const n_points = Math.floor(positions.length / 3)
  const scalars = out?.length === n_points ? out : new Float32Array(n_points)
  const sample = volume_sampler_xyz(volume, out_of_bounds)
  for (let idx = 0; idx < n_points; idx++) {
    const position_idx = idx * 3
    scalars[idx] = sample(
      positions[position_idx] + offset_x,
      positions[position_idx + 1] + offset_y,
      positions[position_idx + 2] + offset_z,
    )
  }
  return scalars
}

const fmt_vec = (vec: readonly number[]): string =>
  `[${vec.map((val) => Number(val.toPrecision(6))).join(`, `)}]`

// Strict VESTA-style grid comparison (same dims and boundary mode, origins and voxel vectors
// within tolerance): the first mismatch as a diagnostic, null when matching. Cross-volume
// coloring works for any shared Cartesian frame, but only matching grids sample exactly.
export function compare_volume_grids(
  vol_a: VolumetricData,
  vol_b: VolumetricData,
  { tolerance = 1e-4 }: { tolerance?: number } = {},
): string | null {
  const [nx_a, ny_a, nz_a] = vol_a.dims
  const [nx_b, ny_b, nz_b] = vol_b.dims
  if (nx_a !== nx_b || ny_a !== ny_b || nz_a !== nz_b) {
    return `grid dimensions differ: ${nx_a}×${ny_a}×${nz_a} vs ${nx_b}×${ny_b}×${nz_b}`
  }

  const mode = ({ periodic }: VolumetricData) => (periodic ? `periodic` : `finite`)
  if (vol_a.periodic !== vol_b.periodic) {
    return `boundary modes differ: ${mode(vol_a)} vs ${mode(vol_b)}`
  }

  for (let axis = 0; axis < 3; axis++) {
    const delta = Math.abs(vol_a.origin[axis] - vol_b.origin[axis])
    if (delta > tolerance) {
      return `origins differ by ${delta.toPrecision(3)} Å along axis ${axis}: ${fmt_vec(
        vol_a.origin,
      )} vs ${fmt_vec(vol_b.origin)}`
    }
  }

  // Voxel vectors are lattice_row / n (periodic) or / (n - 1) (finite); dims and boundary
  // modes match by now, so one divisor per axis serves both volumes
  for (let axis = 0; axis < 3; axis++) {
    const divisor = Math.max(vol_a.periodic ? vol_a.dims[axis] : vol_a.dims[axis] - 1, 1)
    for (let comp = 0; comp < 3; comp++) {
      const voxel_delta =
        Math.abs(vol_a.lattice[axis][comp] - vol_b.lattice[axis][comp]) / divisor
      if (voxel_delta > tolerance) {
        return `voxel vectors differ along axis ${axis}: ${fmt_vec(
          vol_a.lattice[axis],
        )} vs ${fmt_vec(vol_b.lattice[axis])} (lattice rows)`
      }
    }
  }

  return null
}

// Fractional display range per lattice axis, e.g. [[-0.15, 2.15], [-0.15, 2.15], [0, 1]]
export type DisplayRange = [Vec2, Vec2, Vec2]

// Replace invalid axes (non-finite bounds or non-positive width) with [0, 1]. Non-periodic
// volumes also clamp to [0, 1]: a finite volume must not be repeated implicitly.
export function sanitize_display_range(range: DisplayRange, periodic: boolean): DisplayRange {
  return range.map(([lower, upper]) => {
    if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper - lower <= 1e-6)
      return [0, 1]
    if (periodic) return [lower, upper]
    const clamped: Vec2 = [Math.max(lower, 0), Math.min(upper, 1)]
    return clamped[1] - clamped[0] > 1e-6 ? clamped : [0, 1]
  }) as DisplayRange
}

// The finite window marching cubes runs on: a fractional `range` of the base cell, or of the
// supercell `frame` M (rows in base fractions) when that is not diagonal
export type VolumeWindow = { range: DisplayRange; frame?: Matrix3x3 }

// Periodic volumes always get an endpoint-inclusive window, even for an integer supercell: an
// N-point periodic grid spans [0, 1) but finite marching cubes reads N points as [0, 1], so
// [0, S] is resampled to N*S + 1 points (same spacing, closed final interval). A diagonal
// supercell is that box in base fractions, any other [0, 1]³ in its own frame. The halo pads
// each outer face by `halo` base cells (halo / |M_i| frame fractions). An explicit
// display_range (base fractions) wins over the supercell; finite volumes get only a real crop of
// it, unpadded (a full [0, 1]³ range resolves to no window).
export function resolve_volume_window(
  volume: VolumetricData,
  {
    display_range,
    supercell = IDENTITY_3X3,
    halo = 0,
  }: { display_range?: DisplayRange; supercell?: Matrix3x3; halo?: number } = {},
): VolumeWindow | null {
  if (!display_range && !volume.periodic) return null
  const pad = Math.max(0, halo)
  if (display_range) {
    const range = sanitize_display_range(display_range, volume.periodic)
    // A full finite window crops nothing: no window keeps the surface-specific cubic frame.
    if (!volume.periodic)
      return range.every(([lower, upper]) => lower === 0 && upper === 1) ? null : { range }
    return { range: range.map(([lower, upper]) => [lower - pad, upper + pad]) as DisplayRange }
  }
  const tiling = diagonal_scaling(supercell)
  // 0 - pad: +0 (not -0) without a halo
  if (tiling) return { range: tiling.map((factor) => [0 - pad, factor + pad]) as DisplayRange }
  const range = supercell.map((row) => {
    const frac_pad = pad / Math.hypot(...row)
    return [0 - frac_pad, 1 + frac_pad]
  }) as DisplayRange
  return { range, frame: supercell }
}

const validate_grid_budget = (max_points: number): void => {
  if (!Number.isSafeInteger(max_points) || max_points < 8)
    throw new RangeError(`max_points must allow at least a 2×2×2 grid, got ${max_points}`)
}

// Counts already include marching cubes' minimum two points on each axis.
const fit_grid_counts = (counts: Vec3, max_points: number): Vec3 => {
  while (counts[0] * counts[1] * counts[2] > max_points) {
    const largest = counts.indexOf(Math.max(...counts))
    counts[largest] = Math.max(2, Math.floor(counts[largest] * 0.9))
  }
  return counts
}

// Endpoint-inclusive sample counts per axis for a (sanitized) fractional window, at most
// max_points in all. Periodic volumes have n intervals per cell, finite ones n - 1. Over budget,
// the largest axis shrinks first. A window too wide to count (e.g. [0, 1e308]) throws.
export function range_sample_counts(
  volume: VolumeGrid,
  range: DisplayRange,
  max_points: number = MAX_GRID_POINTS,
): Vec3 {
  validate_grid_budget(max_points)
  const intervals = volume.dims.map((dim) => (volume.periodic ? dim : Math.max(dim - 1, 1)))
  const counts = range.map(([lower, upper], axis) =>
    Math.max(2, Math.round((upper - lower) * intervals[axis]) + 1),
  ) as Vec3
  if (!counts.every(Number.isSafeInteger)) {
    throw new RangeError(
      `Volume window ${JSON.stringify(range)} needs ${counts.join(` x `)} samples at the source density`,
    )
  }
  return fit_grid_counts(counts, max_points)
}

interface AxisInterpolation {
  lower: Int32Array
  upper: Int32Array
  weight: Float64Array
  direct: boolean
}

const precompute_axis_interpolation = (
  range: Vec2,
  count: number,
  source_dim: number,
  periodic: boolean,
): AxisInterpolation => {
  const intervals = periodic ? source_dim : Math.max(source_dim - 1, 1)
  const fractional_step = (range[1] - range[0]) / (count - 1)
  const grid_step = fractional_step * intervals
  const grid_start = range[0] * intervals
  const direct =
    Math.abs(grid_step - 1) < 1e-10 && Math.abs(grid_start - Math.round(grid_start)) < 1e-10
  const lower = new Int32Array(count)
  const upper = new Int32Array(count)
  const weight = new Float64Array(count)

  for (let sample_idx = 0; sample_idx < count; sample_idx++) {
    const grid_coord = grid_start + sample_idx * grid_step
    const grid_floor = Math.floor(grid_coord)
    const lower_idx = lower_corner(source_dim, grid_floor, periodic)
    lower[sample_idx] = lower_idx
    upper[sample_idx] = upper_corner(source_dim, lower_idx, periodic)
    weight[sample_idx] = grid_coord - (periodic ? grid_floor : lower_idx)
  }
  return { lower, upper, weight, direct }
}

// Resample a volume over a fractional display range (VESTA-style non-integer supercell) into a
// finite grid whose bounds land exactly on the range, so marching cubes clips there instead of
// at cell boundaries. Periodic volumes wrap; resolution follows the source voxel density,
// capped at max_points. The lattice spans the range and the origin shifts by range_min·lattice,
// keeping vertices in the source's Cartesian frame.
export function extract_volume_range(
  volume: VolumeGrid &
    Partial<Pick<VolumetricData, `label` | `units` | `source` | `source_filename`>>,
  range: DisplayRange,
  max_points: number = MAX_GRID_POINTS,
): Omit<VolumetricData, `id`> {
  const sanitized = sanitize_display_range(range, volume.periodic)
  const [range_x, range_y, range_z] = sanitized
  const widths = sanitized.map(([lower, upper]) => upper - lower) as Vec3

  const counts = range_sample_counts(volume, sanitized, max_points)

  const [size_x, size_y, size_z] = counts
  const [src_nx, src_ny, src_nz] = volume.dims
  const src_stride_x = src_ny * src_nz
  const src = volume.values
  const x_samples = precompute_axis_interpolation(range_x, size_x, src_nx, volume.periodic)
  const y_samples = precompute_axis_interpolation(range_y, size_y, src_ny, volume.periodic)
  const z_samples = precompute_axis_interpolation(range_z, size_z, src_nz, volume.periodic)
  const values = new Float64Array(size_x * size_y * size_z)
  let out_idx = 0
  if (x_samples.direct && y_samples.direct && z_samples.direct) {
    // Sample points coincide with source voxels: copy without blending
    const nearest = ({ lower, upper, weight }: AxisInterpolation, idx: number) =>
      weight[idx] > 0.5 ? upper[idx] : lower[idx]
    for (let x_idx = 0; x_idx < size_x; x_idx++) {
      const x_offset = nearest(x_samples, x_idx) * src_stride_x
      for (let y_idx = 0; y_idx < size_y; y_idx++) {
        const row_offset = x_offset + nearest(y_samples, y_idx) * src_nz
        for (let z_idx = 0; z_idx < size_z; z_idx++) {
          values[out_idx++] = src[row_offset + nearest(z_samples, z_idx)]
        }
      }
    }
  } else {
    for (let x_idx = 0; x_idx < size_x; x_idx++) {
      const x_lower = x_samples.lower[x_idx]
      const x_upper = x_samples.upper[x_idx]
      const x_weight = x_samples.weight[x_idx]
      for (let y_idx = 0; y_idx < size_y; y_idx++) {
        const y_lower = y_samples.lower[y_idx]
        const y_upper = y_samples.upper[y_idx]
        const y_weight = y_samples.weight[y_idx]
        for (let z_idx = 0; z_idx < size_z; z_idx++) {
          values[out_idx++] = interpolate_cell(
            src,
            src_stride_x,
            src_nz,
            1,
            x_lower,
            x_upper,
            y_lower,
            y_upper,
            z_samples.lower[z_idx],
            z_samples.upper[z_idx],
            x_weight,
            y_weight,
            z_samples.weight[z_idx],
          )
        }
      }
    }
  }

  const [row_a, row_b, row_c] = volume.lattice
  const { label, units, source, source_filename } = volume
  return {
    values,
    dims: counts,
    order: `z_fastest`,
    data_range: grid_data_range(values),
    label,
    units: units ?? null, // a bare grid names none
    source,
    source_filename,
    lattice: scale_lattice_matrix(volume.lattice, widths),
    origin: [
      volume.origin[0] + range_x[0] * row_a[0] + range_y[0] * row_b[0] + range_z[0] * row_c[0],
      volume.origin[1] + range_x[0] * row_a[1] + range_y[0] * row_b[1] + range_z[0] * row_c[1],
      volume.origin[2] + range_x[0] * row_a[2] + range_y[0] * row_b[2] + range_z[0] * row_c[2],
    ],
    periodic: false, // the extracted block is a finite window; endpoints included
  }
}

export const UNIT_CELL_RANGE: DisplayRange = [
  [0, 1],
  [0, 1],
  [0, 1],
]

// A periodic window's parallelepiped (`range` in fractions of the frame M, rows in base
// fractions; identity for a box) and the integer lattice cells meeting it, which the unit-cell
// surface is tiled over and clipped to
export type SurfaceClip = { frame: Matrix3x3; range: DisplayRange; cells: Vec3[] }

// Integer cells t (base fractions t + [0, 1]³) whose frame-fraction bounding box overlaps
// `range` by more than a touching face. A window spanning over MAX_GRID_POINTS candidate
// cells throws: even 2³ points per cell would exceed the budget.
function window_cells(frame: Matrix3x3, range: DisplayRange): Vec3[] {
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((mask) =>
    [0, 1, 2].map((axis) => (mask >> axis) & 1),
  )
  const bounds = (points: Vec3[]): Vec2[] =>
    [0, 1, 2].map((axis) => {
      const vals = points.map((point) => point[axis])
      return [Math.min(...vals), Math.max(...vals)] as Vec2
    })
  const to_base = create_frac_to_cart(frame)
  const to_frame = create_frac_to_cart(inverse_3x3(frame))
  const base_box = bounds(
    corners.map((bits) => to_base(bits.map((bit, axis) => range[axis][bit]) as Vec3)),
  )
  const cell_box = bounds(corners.map((bits) => to_frame(bits as Vec3)))
  const spans = base_box.map(([lower, upper]) => [Math.floor(lower), Math.ceil(upper)])
  const n_candidates = spans.reduce((prod, [lower, upper]) => prod * (upper - lower), 1)
  if (!(n_candidates <= MAX_GRID_POINTS)) {
    throw new RangeError(`Volume window ${JSON.stringify(range)} covers ${n_candidates} cells`)
  }
  const cells: Vec3[] = []
  for (let cell_a = spans[0][0]; cell_a < spans[0][1]; cell_a++)
    for (let cell_b = spans[1][0]; cell_b < spans[1][1]; cell_b++)
      for (let cell_c = spans[2][0]; cell_c < spans[2][1]; cell_c++) {
        const shift = to_frame([cell_a, cell_b, cell_c])
        const meets = shift.every(
          (val, axis) =>
            val + cell_box[axis][0] < range[axis][1] - 1e-9 &&
            val + cell_box[axis][1] > range[axis][0] + 1e-9,
        )
        if (meets) cells.push([cell_a, cell_b, cell_c])
      }
  return cells
}

// Whether the inclusive voxel spans fit the extraction budget
const voxels_fit = (voxels: number[][], max_points: number): boolean =>
  voxels.reduce((prod, [lower, upper]) => prod * (upper - lower + 1), 1) <= max_points

// A periodic grid trilinearly resampled to `dims` points per axis (z-fastest)
export function resample_periodic(grid: ScalarGrid3D, dims: Vec3): ScalarGrid3D<Float64Array> {
  const values = new Float64Array(dims[0] * dims[1] * dims[2])
  let out_idx = 0
  for (let x_idx = 0; x_idx < dims[0]; x_idx++)
    for (let y_idx = 0; y_idx < dims[1]; y_idx++)
      for (let z_idx = 0; z_idx < dims[2]; z_idx++)
        values[out_idx++] = trilinear_interpolate(
          grid,
          x_idx / dims[0],
          y_idx / dims[1],
          z_idx / dims[2],
          true,
        )
  return { values, dims, order: `z_fastest` }
}

// The grid marching cubes runs on. A finite volume's is its window (an explicit crop) or the
// whole cell, resampled through extract_volume_range so the endpoints land exactly on the
// requested fractions (block-averaging instead shifted an f = x_frac isosurface by 0.1 Å in a
// 20 Å cell); an in-budget cell with at least 2 points per axis would be copied unchanged, so
// it is reused as is. A periodic volume's is its unit cell (the source voxels themselves in
// budget, else resampled to fit) plus a `clip` for its window, diagonal, sheared or explicit:
// the surface tiled over the window's cells and clipped to it keeps every source-grid
// crossing, which resampling the window at its own spacing did not.
export function prepare_geometry_grid(
  volume: VolumeGrid,
  window: VolumeWindow | null,
  max_points = MAX_GRID_POINTS,
): { grid: ScalarGrid3D<Float64Array>; lattice: Matrix3x3; origin: Vec3; clip?: SurfaceClip } {
  validate_grid_budget(max_points)
  const { values, dims, order, lattice, origin, periodic } = volume
  const in_budget = values.length <= max_points && dims.every((dim) => dim >= 2)
  if (periodic) {
    const { range, frame = IDENTITY_3X3 } = window ?? { range: UNIT_CELL_RANGE }
    // An over-budget source in a box window that fits at its own spacing (a crop) keeps its
    // resolution: the whole voxels around the crop, copied exactly and meshed as one periodic
    // cell, clipped to the crop. A voxel of halo on each side keeps the wrap slab and the
    // edge voxels' wrapped gradient stencils outside the crop, so the clip drops them and the
    // kept normals see true neighbours; coarsening the cell, or resampling a crop that starts
    // between voxels, stepped over narrow crossings.
    const voxels = range.map(([lower, upper], axis) => [
      Math.floor(lower * dims[axis]) - 1,
      Math.ceil(upper * dims[axis]) + 2,
    ])
    if (!in_budget && !window?.frame && voxels_fit(voxels, max_points)) {
      const box = voxels.map((bounds, axis) =>
        bounds.map((idx) => idx / dims[axis]),
      ) as DisplayRange
      const block = extract_volume_range(volume, box, max_points)
      const counts = block.dims
      const cell_range = range.map(([lower, upper], axis) =>
        [lower, upper].map((bound) => (bound * dims[axis] - voxels[axis][0]) / counts[axis]),
      ) as DisplayRange
      return {
        grid: block,
        lattice: scale_lattice_matrix(
          lattice,
          counts.map((count, axis) => count / dims[axis]) as Vec3,
        ),
        origin: block.origin,
        clip: { frame: IDENTITY_3X3, range: cell_range, cells: [[0, 0, 0]] },
      }
    }
    // read off the volume once: per-sample reads through a $state proxy are far slower
    const source = { values, dims: [...dims] as Vec3, order }
    const scale = Math.min(Math.cbrt(max_points / values.length), 1)
    const grid = in_budget
      ? source
      : resample_periodic(
          source,
          fit_grid_counts(
            dims.map((dim) => Math.max(2, Math.floor(dim * scale))) as Vec3,
            max_points,
          ),
        )
    return { grid, lattice, origin, clip: { frame, range, cells: window_cells(frame, range) } }
  }
  if (!window && in_budget) return { grid: volume, lattice, origin }
  const extracted = extract_volume_range(volume, window?.range ?? UNIT_CELL_RANGE, max_points)
  return { grid: extracted, lattice: extracted.lattice, origin: extracted.origin }
}
