// Volume sampling utilities: trilinear interpolation, world-coordinate volume
// samplers for cross-volume isosurface coloring, grid compatibility checks, and
// fractional display-range extraction for VESTA-style non-integer supercells.
import type { Vec2, Vec3 } from '$lib/math'
import { create_cart_to_frac_matrix, scale_lattice_matrix } from '$lib/math'
import type { VolumetricData } from './types'
import { MAX_GRID_POINTS } from './types'

const safe_mod = (val: number, dim: number) => ((val % dim) + dim) % dim

// Trilinear interpolation of a scalar 3D grid at fractional coordinates.
// Periodic grids wrap with modulo; non-periodic return 0 for out-of-bounds.
export function trilinear_interpolate(
  grid: number[][][],
  fx: number,
  fy: number,
  fz: number,
  periodic: boolean,
): number {
  const nx = grid.length
  const ny = grid[0]?.length ?? 0
  const nz = grid[0]?.[0]?.length ?? 0
  if (nx === 0 || ny === 0 || nz === 0) return 0

  // Convert fractional to grid coordinates
  const gx = periodic ? fx * nx : fx * (nx - 1)
  const gy = periodic ? fy * ny : fy * (ny - 1)
  const gz = periodic ? fz * nz : fz * (nz - 1)

  if (!periodic) {
    // Out-of-bounds check for non-periodic grids
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1 || fz < 0 || fz > 1) return 0
  }

  const x0 = periodic
    ? safe_mod(Math.floor(gx), nx)
    : Math.max(0, Math.min(Math.floor(gx), nx - 2))
  const y0 = periodic
    ? safe_mod(Math.floor(gy), ny)
    : Math.max(0, Math.min(Math.floor(gy), ny - 2))
  const z0 = periodic
    ? safe_mod(Math.floor(gz), nz)
    : Math.max(0, Math.min(Math.floor(gz), nz - 2))
  const x1 = periodic ? (x0 + 1) % nx : Math.min(x0 + 1, nx - 1)
  const y1 = periodic ? (y0 + 1) % ny : Math.min(y0 + 1, ny - 1)
  const z1 = periodic ? (z0 + 1) % nz : Math.min(z0 + 1, nz - 1)

  // deltas from clamped lower index (non-periodic x0 clamps to nx-2 so floor(gx) may != x0)
  const xd = periodic ? gx - Math.floor(gx) : gx - x0
  const yd = periodic ? gy - Math.floor(gy) : gy - y0
  const zd = periodic ? gz - Math.floor(gz) : gz - z0

  // 8-point interpolation
  const c000 = grid[x0][y0][z0]
  const c001 = grid[x0][y0][z1]
  const c010 = grid[x0][y1][z0]
  const c011 = grid[x0][y1][z1]
  const c100 = grid[x1][y0][z0]
  const c101 = grid[x1][y0][z1]
  const c110 = grid[x1][y1][z0]
  const c111 = grid[x1][y1][z1]

  const c00 = c000 + (c100 - c000) * xd
  const c01 = c001 + (c101 - c001) * xd
  const c10 = c010 + (c110 - c010) * xd
  const c11 = c011 + (c111 - c011) * xd

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

// Small tolerance so vertices numerically on the boundary of a finite grid
// (e.g. marching-cubes output at fractional coordinate 1.0 + 1e-16) still sample.
const OOB_TOL = 1e-6

// Create a sampler that maps absolute Cartesian positions (in the same physical
// frame as the volume's `origin`) to trilinearly-interpolated scalar values.
// Handles non-orthogonal lattices, origin offsets, and periodic wrapping, so it
// works both for strictly matching grids and for general resampling between
// volumes that share a Cartesian coordinate system.
// The hot callback uses scalar arithmetic only (no per-call array allocations)
// since it runs once per isosurface vertex.
export function create_volume_sampler(
  volume: VolumetricData,
  options: VolumeSamplerOptions = {},
): (position: Vec3) => number {
  const { out_of_bounds = `clamp` } = options
  const { grid, lattice, origin, periodic } = volume
  const inv = create_cart_to_frac_matrix(lattice)
  const [ox, oy, oz] = origin

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
    return trilinear_interpolate(grid, fx, fy, fz, periodic)
  }
}

// Sample a volume at many Cartesian positions (flat xyz triplets).
// Returns one scalar per position; NaN marks out-of-bounds under 'fallback' policy.
export function sample_volume_at_positions(
  volume: VolumetricData,
  positions: Float32Array | Float64Array,
  options: VolumeSamplerOptions = {},
): Float32Array {
  const sample = create_volume_sampler(volume, options)
  const n_points = Math.floor(positions.length / 3)
  const out = new Float32Array(n_points)
  const pos: Vec3 = [0, 0, 0]
  for (let idx = 0; idx < n_points; idx++) {
    pos[0] = positions[idx * 3]
    pos[1] = positions[idx * 3 + 1]
    pos[2] = positions[idx * 3 + 2]
    out[idx] = sample(pos)
  }
  return out
}

// Result of a strict VESTA-style grid compatibility check between two volumes.
export interface GridCompatibility {
  ok: boolean
  reason?: string // identifies the first mismatching property when ok is false
}

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
  const [nx_a, ny_a, nz_a] = vol_a.grid_dims
  const [nx_b, ny_b, nz_b] = vol_b.grid_dims
  if (nx_a !== nx_b || ny_a !== ny_b || nz_a !== nz_b) {
    return {
      ok: false,
      reason: `grid dimensions differ: ${nx_a}×${ny_a}×${nz_a} vs ${nx_b}×${ny_b}×${nz_b}`,
    }
  }

  if (vol_a.periodic !== vol_b.periodic) {
    return {
      ok: false,
      reason: `boundary modes differ: ${vol_a.periodic ? `periodic` : `finite`} vs ${
        vol_b.periodic ? `periodic` : `finite`
      }`,
    }
  }

  for (let axis = 0; axis < 3; axis++) {
    const delta = Math.abs(vol_a.origin[axis] - vol_b.origin[axis])
    if (delta > tolerance) {
      return {
        ok: false,
        reason: `origins differ by ${delta.toPrecision(3)} Å along axis ${axis}: ${fmt_vec(
          vol_a.origin,
        )} vs ${fmt_vec(vol_b.origin)}`,
      }
    }
  }

  // Compare voxel vectors: lattice_row / n for periodic grids (spacing 1/n),
  // lattice_row / (n-1) for finite grids (spacing 1/(n-1), endpoints included).
  // Dims and boundary modes already match at this point, so one divisor per
  // axis suffices for both volumes.
  for (let axis = 0; axis < 3; axis++) {
    const divisor = Math.max(
      vol_a.periodic ? vol_a.grid_dims[axis] : vol_a.grid_dims[axis] - 1,
      1,
    )
    for (let comp = 0; comp < 3; comp++) {
      const voxel_delta =
        Math.abs(vol_a.lattice[axis][comp] - vol_b.lattice[axis][comp]) / divisor
      if (voxel_delta > tolerance) {
        return {
          ok: false,
          reason: `voxel vectors differ along axis ${axis}: ${fmt_vec(
            vol_a.lattice[axis],
          )} vs ${fmt_vec(vol_b.lattice[axis])} (lattice rows)`,
        }
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
    : ([
        [0, tiling[0]],
        [0, tiling[1]],
        [0, tiling[2]],
      ] as DisplayRange)

  if (!volume.periodic) return range
  const padding = Math.max(0, halo)
  return range.map(([lo, hi]) => [lo - padding, hi + padding]) as DisplayRange
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
  volume: VolumetricData,
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
      ? volume.grid_dims[axis]
      : Math.max(volume.grid_dims[axis] - 1, 1)
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
  const steps: Vec3 = [widths[0] / (nx - 1), widths[1] / (ny - 1), widths[2] / (nz - 1)]
  const grid: number[][][] = Array(nx)
  let [min_val, max_val, sum] = [Infinity, -Infinity, 0]
  for (let ix = 0; ix < nx; ix++) {
    const fx = rx[0] + ix * steps[0]
    const plane: number[][] = Array(ny)
    for (let iy = 0; iy < ny; iy++) {
      const fy = ry[0] + iy * steps[1]
      const row: number[] = Array(nz)
      for (let iz = 0; iz < nz; iz++) {
        const val = trilinear_interpolate(
          volume.grid,
          fx,
          fy,
          rz[0] + iz * steps[2],
          volume.periodic,
        )
        row[iz] = val
        if (val < min_val) min_val = val
        if (val > max_val) max_val = val
        sum += val
      }
      plane[iy] = row
    }
    grid[ix] = plane
  }

  const [row_a, row_b, row_c] = volume.lattice
  return {
    ...volume,
    grid,
    grid_dims: counts,
    lattice: scale_lattice_matrix(volume.lattice, widths),
    origin: [
      volume.origin[0] + rx[0] * row_a[0] + ry[0] * row_b[0] + rz[0] * row_c[0],
      volume.origin[1] + rx[0] * row_a[1] + ry[0] * row_b[1] + rz[0] * row_c[1],
      volume.origin[2] + rx[0] * row_a[2] + ry[0] * row_b[2] + rz[0] * row_c[2],
    ],
    data_range: {
      min: min_val,
      max: max_val,
      abs_max: Math.max(Math.abs(min_val), Math.abs(max_val)),
      mean: sum / (nx * ny * nz),
    },
    periodic: false, // the extracted block is a finite window; endpoints included
  }
}
