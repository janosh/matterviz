// Volume sampling utilities: trilinear interpolation, world-coordinate volume
// samplers for cross-volume isosurface coloring, grid compatibility checks, and
// fractional display-range extraction for VESTA-style non-integer supercells.
import type { Matrix3x3, Vec2, Vec3 } from '$lib/math'
import { reciprocal_lattice, scale_lattice_matrix } from '$lib/math'
import type { ScalarGrid3D } from './grid'
import {
  downsample_grid,
  make_volume,
  MAX_GRID_POINTS,
  type VolumeGrid,
  type VolumetricData,
} from './types'

const safe_mod = (val: number, dim: number) => ((val % dim) + dim) % dim

// Lower/upper voxel indices for one axis of a trilinear sample. Singleton axes
// (n===1) pin both corners to 0 so nx-2 clamping never goes negative.
const voxel_corners = (n: number, floor_g: number, periodic: boolean): [number, number] => {
  if (n === 1) return [0, 0]
  const lower = periodic ? safe_mod(floor_g, n) : Math.max(0, Math.min(floor_g, n - 2))
  return [lower, periodic ? (lower + 1) % n : Math.min(lower + 1, n - 1)]
}

// Trilinear interpolation of a z-fastest scalar grid at fractional coordinates.
// Periodic grids wrap with modulo; non-periodic return 0 for out-of-bounds.
export function trilinear_interpolate(
  grid: ScalarGrid3D,
  fx: number,
  fy: number,
  fz: number,
  periodic: boolean,
): number {
  const [nx, ny, nz] = grid.dims
  if (nx === 0 || ny === 0 || nz === 0) return 0
  if (!periodic && (fx < 0 || fx > 1 || fy < 0 || fy > 1 || fz < 0 || fz > 1)) return 0

  // Convert fractional to grid coordinates
  const gx = periodic ? fx * nx : fx * (nx - 1)
  const gy = periodic ? fy * ny : fy * (ny - 1)
  const gz = periodic ? fz * nz : fz * (nz - 1)
  const [x0, x1] = voxel_corners(nx, Math.floor(gx), periodic)
  const [y0, y1] = voxel_corners(ny, Math.floor(gy), periodic)
  const [z0, z1] = voxel_corners(nz, Math.floor(gz), periodic)
  // deltas from clamped lower index (non-periodic x0 clamps to nx-2 so floor(gx) may != x0)
  const xd = periodic ? gx - Math.floor(gx) : gx - x0
  const yd = periodic ? gy - Math.floor(gy) : gy - y0
  const zd = periodic ? gz - Math.floor(gz) : gz - z0
  return interpolate_cell(grid.values, ny * nz, nz, x0, x1, y0, y1, z0, z1, xd, yd, zd)
}

// 8-corner trilinear blend on a z-fastest value array with the given strides
const interpolate_cell = (
  values: ArrayLike<number>,
  stride_x: number,
  stride_y: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  xd: number,
  yd: number,
  zd: number,
): number => {
  const row_00 = x0 * stride_x + y0 * stride_y
  const row_01 = x0 * stride_x + y1 * stride_y
  const row_10 = x1 * stride_x + y0 * stride_y
  const row_11 = x1 * stride_x + y1 * stride_y
  const c00 = values[row_00 + z0] + (values[row_10 + z0] - values[row_00 + z0]) * xd
  const c01 = values[row_00 + z1] + (values[row_10 + z1] - values[row_00 + z1]) * xd
  const c10 = values[row_01 + z0] + (values[row_11 + z0] - values[row_01 + z0]) * xd
  const c11 = values[row_01 + z1] + (values[row_11 + z1] - values[row_01 + z1]) * xd
  const c0 = c00 + (c10 - c00) * yd
  const c1 = c01 + (c11 - c01) * yd
  return c0 + (c1 - c0) * zd
}

// Policy for sampling positions that fall outside a non-periodic volume's grid.
// 'clamp' samples the nearest edge value; 'fallback' returns NaN so callers can
// substitute a solid fallback color. Periodic volumes always wrap and never go OOB.
export type OutOfBoundsPolicy = `clamp` | `fallback`

export interface VolumeSamplerOptions {
  out_of_bounds?: OutOfBoundsPolicy
}

export interface BulkVolumeSamplerOptions extends VolumeSamplerOptions {
  position_offset?: Vec3
  out?: Float32Array
}

// Small tolerance so vertices numerically on the boundary of a finite grid
// (e.g. marching-cubes output at fractional coordinate 1.0 + 1e-16) still sample.
const OOB_TOL = 1e-6

interface PreparedVolumeSampler {
  lattice: Matrix3x3 // snapshot of the lattice the inverse was computed from
  inv: Matrix3x3 // Cartesian→fractional matrix (reciprocal lattice rows)
}

const prepared_sampler_cache = new WeakMap<VolumeGrid, PreparedVolumeSampler>()

// The lattice inverse is the only derived state; keyed by volume identity and
// invalidated when the lattice matrix entries change on that object
const prepare_volume_sampler = (volume: VolumeGrid): PreparedVolumeSampler => {
  const cached = prepared_sampler_cache.get(volume)
  if (
    cached?.lattice.every((row, row_idx) =>
      row.every((val, col_idx) => val === volume.lattice[row_idx][col_idx]),
    )
  ) {
    return cached
  }
  const prepared = {
    lattice: volume.lattice.map((row) => [...row]) as Matrix3x3,
    inv: reciprocal_lattice(volume.lattice),
  }
  prepared_sampler_cache.set(volume, prepared)
  return prepared
}

// Create a sampler that maps absolute Cartesian positions (in the same physical
// frame as the volume's `origin`) to trilinearly-interpolated scalar values.
// Handles non-orthogonal lattices, origin offsets, and periodic wrapping, so it
// works both for strictly matching grids and for general resampling between
// volumes that share a Cartesian coordinate system.
// The hot callback uses scalar arithmetic only (no per-call array allocations)
// since it runs once per isosurface vertex.
export function create_volume_sampler(
  volume: VolumeGrid,
  options: VolumeSamplerOptions = {},
): (position: Vec3) => number {
  const { out_of_bounds = `clamp` } = options
  const { inv } = prepare_volume_sampler(volume)
  const { periodic } = volume
  const [ox, oy, oz] = volume.origin

  return (position: Vec3): number => {
    const cx = position[0] - ox
    const cy = position[1] - oy
    const cz = position[2] - oz
    let fx = inv[0][0] * cx + inv[0][1] * cy + inv[0][2] * cz
    let fy = inv[1][0] * cx + inv[1][1] * cy + inv[1][2] * cz
    let fz = inv[2][0] * cx + inv[2][1] * cy + inv[2][2] * cz
    if (periodic) {
      fx = safe_mod(fx, 1)
      fy = safe_mod(fy, 1)
      fz = safe_mod(fz, 1)
    } else {
      if (
        out_of_bounds === `fallback` &&
        (fx < -OOB_TOL ||
          fx > 1 + OOB_TOL ||
          fy < -OOB_TOL ||
          fy > 1 + OOB_TOL ||
          fz < -OOB_TOL ||
          fz > 1 + OOB_TOL)
      )
        return NaN
      // Clamp both genuine out-of-bounds ('clamp' policy = nearest edge value)
      // and tiny numerical overshoot at the boundary
      fx = Math.min(1, Math.max(0, fx))
      fy = Math.min(1, Math.max(0, fy))
      fz = Math.min(1, Math.max(0, fz))
    }
    return trilinear_interpolate(volume, fx, fy, fz, periodic)
  }
}

// Sample a volume at many Cartesian positions (flat xyz triplets).
// Returns one scalar per position; NaN marks out-of-bounds under 'fallback' policy.
export function sample_volume_at_positions(
  volume: VolumeGrid,
  positions: Float32Array | Float64Array,
  options: BulkVolumeSamplerOptions = {},
): Float32Array {
  const { out_of_bounds = `clamp`, position_offset = [0, 0, 0] } = options
  const { inv } = prepare_volume_sampler(volume)
  const { values, periodic } = volume
  const [nx, ny, nz] = volume.dims
  const [offset_x, offset_y, offset_z] = position_offset
  const [origin_x, origin_y, origin_z] = volume.origin
  const n_points = Math.floor(positions.length / 3)
  const out = options.out?.length === n_points ? options.out : new Float32Array(n_points)
  if (nx === 0 || ny === 0 || nz === 0) {
    out.fill(0)
    return out
  }
  const stride_x = ny * nz
  for (let idx = 0; idx < n_points; idx++) {
    const position_idx = idx * 3
    const cart_x = positions[position_idx] + offset_x - origin_x
    const cart_y = positions[position_idx + 1] + offset_y - origin_y
    const cart_z = positions[position_idx + 2] + offset_z - origin_z
    let frac_x = inv[0][0] * cart_x + inv[0][1] * cart_y + inv[0][2] * cart_z
    let frac_y = inv[1][0] * cart_x + inv[1][1] * cart_y + inv[1][2] * cart_z
    let frac_z = inv[2][0] * cart_x + inv[2][1] * cart_y + inv[2][2] * cart_z

    if (periodic) {
      frac_x = safe_mod(frac_x, 1)
      frac_y = safe_mod(frac_y, 1)
      frac_z = safe_mod(frac_z, 1)
    } else {
      if (
        out_of_bounds === `fallback` &&
        (frac_x < -OOB_TOL ||
          frac_x > 1 + OOB_TOL ||
          frac_y < -OOB_TOL ||
          frac_y > 1 + OOB_TOL ||
          frac_z < -OOB_TOL ||
          frac_z > 1 + OOB_TOL)
      ) {
        out[idx] = Number.NaN
        continue
      }
      frac_x = Math.min(1, Math.max(0, frac_x))
      frac_y = Math.min(1, Math.max(0, frac_y))
      frac_z = Math.min(1, Math.max(0, frac_z))
    }

    const grid_x = frac_x * (periodic ? nx : nx - 1)
    const grid_y = frac_y * (periodic ? ny : ny - 1)
    const grid_z = frac_z * (periodic ? nz : nz - 1)
    const [x_lower, x_upper] = voxel_corners(nx, Math.floor(grid_x), periodic)
    const [y_lower, y_upper] = voxel_corners(ny, Math.floor(grid_y), periodic)
    const [z_lower, z_upper] = voxel_corners(nz, Math.floor(grid_z), periodic)
    out[idx] = interpolate_cell(
      values,
      stride_x,
      nz,
      x_lower,
      x_upper,
      y_lower,
      y_upper,
      z_lower,
      z_upper,
      grid_x - x_lower,
      grid_y - y_lower,
      grid_z - z_lower,
    )
  }
  return out
}

// Result of a strict VESTA-style grid compatibility check between two volumes.
export interface GridCompatibility {
  ok: boolean
  reason?: string // identifies the first mismatching property when ok is false
}

const incompatible_grids = (reason: string): GridCompatibility => ({ ok: false, reason })

const fmt_vec = (vec: readonly number[]): string =>
  `[${vec.map((val) => Number(val.toPrecision(6))).join(`, `)}]`

// Strictly compare two volumetric grids: identical dimensions, origins equal
// within tolerance, all voxel vectors equal within tolerance, and matching
// periodic/finite boundary modes. Cross-volume coloring via create_volume_sampler
// works for any two volumes sharing a Cartesian frame, but strictly matching
// grids guarantee the sampled field is exact (no cross-grid resampling).
export function compare_volume_grids(
  vol_a: VolumetricData,
  vol_b: VolumetricData,
  { tolerance = 1e-4 }: { tolerance?: number } = {},
): GridCompatibility {
  const [nx_a, ny_a, nz_a] = vol_a.dims
  const [nx_b, ny_b, nz_b] = vol_b.dims
  if (nx_a !== nx_b || ny_a !== ny_b || nz_a !== nz_b) {
    return incompatible_grids(
      `grid dimensions differ: ${nx_a}×${ny_a}×${nz_a} vs ${nx_b}×${ny_b}×${nz_b}`,
    )
  }

  if (vol_a.periodic !== vol_b.periodic) {
    return incompatible_grids(
      `boundary modes differ: ${vol_a.periodic ? `periodic` : `finite`} vs ${
        vol_b.periodic ? `periodic` : `finite`
      }`,
    )
  }

  for (let axis = 0; axis < 3; axis++) {
    const delta = Math.abs(vol_a.origin[axis] - vol_b.origin[axis])
    if (delta > tolerance) {
      return incompatible_grids(
        `origins differ by ${delta.toPrecision(3)} Å along axis ${axis}: ${fmt_vec(
          vol_a.origin,
        )} vs ${fmt_vec(vol_b.origin)}`,
      )
    }
  }

  // Compare voxel vectors: lattice_row / n for periodic grids (spacing 1/n),
  // lattice_row / (n-1) for finite grids (spacing 1/(n-1), endpoints included).
  // Dims and boundary modes already match at this point, so one divisor per
  // axis suffices for both volumes.
  for (let axis = 0; axis < 3; axis++) {
    const divisor = Math.max(vol_a.periodic ? vol_a.dims[axis] : vol_a.dims[axis] - 1, 1)
    for (let comp = 0; comp < 3; comp++) {
      const voxel_delta =
        Math.abs(vol_a.lattice[axis][comp] - vol_b.lattice[axis][comp]) / divisor
      if (voxel_delta > tolerance) {
        return incompatible_grids(
          `voxel vectors differ along axis ${axis}: ${fmt_vec(
            vol_a.lattice[axis],
          )} vs ${fmt_vec(vol_b.lattice[axis])} (lattice rows)`,
        )
      }
    }
  }

  return { ok: true }
}

// Fractional display range per lattice axis, e.g. [[-0.15, 2.15], [-0.15, 2.15], [0, 1]]
export type DisplayRange = [Vec2, Vec2, Vec2]

// Replace invalid axes (non-finite bounds or non-positive width) with [0, 1].
// Non-periodic volumes additionally clamp to [0, 1] — a finite volume must not
// be repeated implicitly.
export function sanitize_display_range(range: DisplayRange, periodic: boolean): DisplayRange {
  return range.map(([lo, hi]) => {
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi - lo <= 1e-6) return [0, 1]
    if (periodic) return [lo, hi]
    const clamped: Vec2 = [Math.max(lo, 0), Math.min(hi, 1)]
    return clamped[1] - clamped[0] > 1e-6 ? clamped : [0, 1]
  }) as DisplayRange
}

export interface VolumeDisplayRangeOptions {
  display_range?: DisplayRange
  tiling?: Vec3
  halo?: number
}

// Resolve the finite window used for marching cubes. Periodic volumes always
// need an endpoint-inclusive window, including for an integer structure
// supercell: a periodic N-point grid spans [0, 1), while finite marching cubes
// interprets N points as spanning [0, 1]. Resampling [0, S] to N*S + 1 points
// preserves the original voxel spacing and closes the final periodic interval.
// Finite volumes only get a window when one is explicitly requested and are
// never repeated to follow the structure supercell.
export function resolve_volume_display_range(
  volume: VolumetricData,
  { display_range, tiling = [1, 1, 1], halo = 0 }: VolumeDisplayRangeOptions = {},
): DisplayRange | null {
  if (!display_range && !volume.periodic) return null

  const range = display_range
    ? sanitize_display_range(display_range, volume.periodic)
    : (tiling.map((factor) => [0, factor]) as DisplayRange)

  if (!volume.periodic) return range
  const padding = Math.max(0, halo)
  return range.map(([lo, hi]) => [lo - padding, hi + padding]) as DisplayRange
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
    if (periodic) {
      lower[sample_idx] = safe_mod(grid_floor, source_dim)
      upper[sample_idx] = (lower[sample_idx] + 1) % source_dim
      weight[sample_idx] = grid_coord - grid_floor
    } else {
      lower[sample_idx] = Math.max(0, Math.min(grid_floor, source_dim - 2))
      upper[sample_idx] = Math.min(lower[sample_idx] + 1, source_dim - 1)
      weight[sample_idx] = grid_coord - lower[sample_idx]
    }
  }
  return { lower, upper, weight, direct }
}

// Resample a volume over a fractional display range (VESTA-style non-integer
// supercell) into a finite grid whose bounds land exactly on the requested
// fractional coordinates, so marching cubes clips repeated surfaces precisely
// at the range instead of at integer cell boundaries. Periodic volumes wrap;
// the sample resolution follows the source voxel density, capped at max_points
// (matching the downsampling budget applied to integer-tiled grids).
// The returned volume's lattice spans the range and its origin shifts by
// range_min·lattice, keeping vertices in the same Cartesian frame as the source.
export function extract_volume_range(
  volume: VolumeGrid & Partial<Pick<VolumetricData, `label` | `source` | `source_filename`>>,
  range: DisplayRange,
  max_points: number = MAX_GRID_POINTS,
): VolumetricData {
  const [rx, ry, rz] = sanitize_display_range(range, volume.periodic)
  const widths: Vec3 = [rx[1] - rx[0], ry[1] - ry[0], rz[1] - rz[0]]

  // Sample counts follow the source voxel density (inclusive endpoints), capped
  // to the point budget. The reduction loop guards against cbrt undershoot when
  // the min-2 floor prevents an axis from shrinking.
  let counts = widths.map((width, axis) => {
    const source_intervals = volume.periodic
      ? volume.dims[axis]
      : Math.max(volume.dims[axis] - 1, 1)
    return Math.max(2, Math.round(width * source_intervals) + 1)
  }) as Vec3
  const total = counts[0] * counts[1] * counts[2]
  if (total > max_points) {
    const shrink = Math.cbrt(max_points / total)
    counts = counts.map((count) => Math.max(2, Math.floor(count * shrink))) as Vec3
    while (counts[0] * counts[1] * counts[2] > Math.max(max_points, 8)) {
      const largest = counts.indexOf(Math.max(...counts))
      counts[largest] = Math.max(2, Math.floor(counts[largest] * 0.9))
    }
  }

  const [nx, ny, nz] = counts
  const [src_nx, src_ny, src_nz] = volume.dims
  const src_stride_x = src_ny * src_nz
  const src = volume.values
  const x_samples = precompute_axis_interpolation(rx, nx, src_nx, volume.periodic)
  const y_samples = precompute_axis_interpolation(ry, ny, src_ny, volume.periodic)
  const z_samples = precompute_axis_interpolation(rz, nz, src_nz, volume.periodic)
  const values = new Float64Array(nx * ny * nz)
  let out_idx = 0
  if (x_samples.direct && y_samples.direct && z_samples.direct) {
    // Sample points coincide with source voxels: copy without blending
    const nearest = ({ lower, upper, weight }: AxisInterpolation, idx: number) =>
      weight[idx] > 0.5 ? upper[idx] : lower[idx]
    for (let x_idx = 0; x_idx < nx; x_idx++) {
      const x_offset = nearest(x_samples, x_idx) * src_stride_x
      for (let y_idx = 0; y_idx < ny; y_idx++) {
        const row_offset = x_offset + nearest(y_samples, y_idx) * src_nz
        for (let z_idx = 0; z_idx < nz; z_idx++) {
          values[out_idx++] = src[row_offset + nearest(z_samples, z_idx)]
        }
      }
    }
  } else {
    for (let x_idx = 0; x_idx < nx; x_idx++) {
      const x_lower = x_samples.lower[x_idx]
      const x_upper = x_samples.upper[x_idx]
      const x_weight = x_samples.weight[x_idx]
      for (let y_idx = 0; y_idx < ny; y_idx++) {
        const y_lower = y_samples.lower[y_idx]
        const y_upper = y_samples.upper[y_idx]
        const y_weight = y_samples.weight[y_idx]
        for (let z_idx = 0; z_idx < nz; z_idx++) {
          values[out_idx++] = interpolate_cell(
            src,
            src_stride_x,
            src_nz,
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
  const { label, source, source_filename } = volume
  return make_volume(values, counts, {
    label,
    source,
    source_filename,
    lattice: scale_lattice_matrix(volume.lattice, widths),
    origin: [
      volume.origin[0] + rx[0] * row_a[0] + ry[0] * row_b[0] + rz[0] * row_c[0],
      volume.origin[1] + rx[0] * row_a[1] + ry[0] * row_b[1] + rz[0] * row_c[1],
      volume.origin[2] + rx[0] * row_a[2] + ry[0] * row_b[2] + rz[0] * row_c[2],
    ],
    periodic: false, // the extracted block is a finite window; endpoints included
  })
}

// The finite grid marching cubes runs on: a VESTA-style fractional window when a
// range is given, else the (budget-downsampled) source grid itself.
export function prepare_geometry_grid(
  volume: VolumeGrid,
  range: DisplayRange | null,
): { grid: ScalarGrid3D<Float64Array>; lattice: Matrix3x3; origin: Vec3 } {
  if (range) {
    const extracted = extract_volume_range(volume, range)
    return { grid: extracted, lattice: extracted.lattice, origin: extracted.origin }
  }
  return { grid: downsample_grid(volume).grid, lattice: volume.lattice, origin: volume.origin }
}
