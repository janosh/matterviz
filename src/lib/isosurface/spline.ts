import {
  add,
  create_frac_to_cart,
  scale_lattice_matrix,
  type Vec2,
  type Vec3,
} from '#lib/math'
import { safe_mod } from './grid'
import { MAX_CUBIC_GRID_POINTS, type VolumetricData } from './types'

const POLE = Math.sqrt(3) - 2 // pole of the cubic B-spline interpolation prefilter
const HORIZON = 30 // POLE ** 30 ≈ 1e-17: the prefilter's exponential tail

// Convert lines (already scaled by 6) to interpolating cubic B-spline coefficients in place.
// Sample `idx` of line `inner` is data[offset + idx * stride + inner]: `stride` interleaved
// lines filter together, so a strided axis streams whole contiguous rows.
const prefilter = (
  data: Float64Array,
  index: (idx: number) => number,
  periodic: boolean,
  [offset, size, stride]: Vec3,
): void => {
  const last = offset + (size - 1) * stride
  const seeds = new Float64Array(stride)
  // causal pass y[k] = x[k] + POLE * y[k - 1], seeded with the extended signal's tail
  for (let lag = HORIZON; lag >= 0; lag--) {
    const row = offset + index(-lag) * stride
    for (let inner = 0; inner < stride; inner++)
      seeds[inner] = seeds[inner] * POLE + data[row + inner]
  }
  data.set(seeds, offset)
  for (let row = offset + stride; row <= last; row += stride)
    for (let inner = 0; inner < stride; inner++)
      data[row + inner] += POLE * data[row - stride + inner]
  // anti-causal pass d[k] = POLE * (d[k + 1] - y[k])
  if (periodic) {
    seeds.fill(0)
    for (let lag = HORIZON; lag >= 0; lag--) {
      const row = offset + index(size - 1 + lag) * stride
      for (let inner = 0; inner < stride; inner++)
        seeds[inner] = seeds[inner] * POLE - POLE * data[row + inner]
    }
  } else
    for (let inner = 0; inner < stride; inner++)
      seeds[inner] =
        (POLE / (POLE * POLE - 1)) * (POLE * data[last - stride + inner] + data[last + inner])
  data.set(seeds, last)
  for (let row = last - stride; row >= offset; row -= stride)
    for (let inner = 0; inner < stride; inner++)
      data[row + inner] = POLE * (data[row + stride + inner] - data[row + inner])
}

type Bounds = [Vec2, Vec2, Vec2]
const extended_index = (size: number, periodic: boolean) => {
  const period = periodic ? size : 2 * size - 2
  return (idx: number): number => {
    const wrapped = safe_mod(idx, period)
    return wrapped < size ? wrapped : period - wrapped
  }
}

// Upsample one axis of an [outer, size, inner] row-major array by an integer factor with an
// interpolating cubic B-spline (Unser's recursive prefilter, then the spline's 4 taps): it
// passes through every sample and is C2, so isolines bend smoothly instead of kinking at
// grid lines. Periodic axes wrap, finite ones mirror.
const upsample_axis = (
  values: Float64Array,
  [outer, size, inner]: Vec3,
  factor: number,
  periodic: boolean,
  bounds?: Vec2,
): Float64Array => {
  const index = extended_index(size, periodic)
  const intervals = periodic ? size : size - 1
  const [first, last] = bounds ?? [0, intervals]
  const out_size = (last - first) * factor + (periodic ? 0 : 1)
  // Every interval on this axis uses the same cubic weights at its inserted samples.
  const weights = Array.from({ length: factor - 1 }, (_, idx) => {
    const frac = (idx + 1) / factor
    return [
      (1 - frac) ** 3,
      3 * frac ** 3 - 6 * frac ** 2 + 4,
      -3 * frac ** 3 + 3 * frac ** 2 + 3 * frac + 1,
      frac ** 3,
    ]
  })
  const out = new Float64Array(outer * out_size * inner)
  // One [size, inner] slab at a time: its `inner` interleaved lines prefilter as contiguous rows.
  const coefs = new Float64Array(size * inner)
  for (let outer_idx = 0; outer_idx < outer; outer_idx++) {
    const slab = outer_idx * size * inner
    for (let idx = 0; idx < coefs.length; idx++) coefs[idx] = 6 * values[slab + idx]
    prefilter(coefs, index, periodic, [0, size, inner])
    for (let inner_idx = 0; inner_idx < inner; inner_idx++) {
      const dst = outer_idx * out_size * inner + inner_idx
      for (let base = first; base < size && base <= last; base++) {
        const dest = dst + (base - first) * factor * inner
        out[dest] = values[slab + base * inner + inner_idx]
        if (base === last) break
        const left = coefs[index(base - 1) * inner + inner_idx]
        const middle = coefs[base * inner + inner_idx]
        const right = coefs[index(base + 1) * inner + inner_idx]
        const far = coefs[index(base + 2) * inner + inner_idx]
        for (let idx = 0; idx < weights.length; idx++) {
          const weight = weights[idx]
          out[dest + (idx + 1) * inner] =
            (weight[0] * left + weight[1] * middle + weight[2] * right + weight[3] * far) / 6
        }
      }
    }
  }
  return out
}

// Evaluate the separable spline one axis at a time. A singleton axis has no intervals.
// Values are clamped to the data range only after the last pass: clamping in between would
// change the tensor spline (an overshoot clamped on one axis shifts the next axis' interpolant).
const resample_volume = (
  volume: VolumetricData,
  axes: readonly number[],
  subdivision: (size: number, points: number) => number,
  bounds?: Bounds,
): VolumetricData => {
  const { periodic, data_range } = volume
  let values = volume.values
  const dims: Vec3 = [...volume.dims]
  for (const axis of axes) {
    const size = dims[axis]
    const factor = subdivision(size, values.length)
    if (factor < 2 || size < 2) continue
    const outer = axis === 0 ? 1 : axis === 1 ? dims[0] : dims[0] * dims[1]
    const inner = axis === 0 ? dims[1] * dims[2] : axis === 1 ? dims[2] : 1
    const span = bounds?.[axis]
    values = upsample_axis(values, [outer, size, inner], factor, periodic, span)
    const intervals = span ? span[1] - span[0] : size - Number(!periodic)
    dims[axis] = intervals * factor + Number(!periodic)
  }
  if (values !== volume.values)
    for (let idx = 0; idx < values.length; idx++)
      values[idx] = Math.max(data_range.min, Math.min(data_range.max, values[idx]))
  if (!bounds) return values === volume.values ? volume : { ...volume, values, dims }
  const fractions = bounds.map(([lo], axis) => lo / (volume.dims[axis] - 1)) as Vec3
  const widths = bounds.map(([lo, hi], axis) => (hi - lo) / (volume.dims[axis] - 1)) as Vec3
  return {
    ...volume,
    values,
    dims,
    origin: add(volume.origin, create_frac_to_cart(volume.lattice)(fractions)),
    lattice: scale_lattice_matrix(volume.lattice, widths),
  }
}

// Slice isolines use integer subdivisions so the fine grid retains every original sample.
export function upsample_volume(
  volume: VolumetricData,
  { min_axis_points = 64, max_points = 4_000_000 } = {},
): VolumetricData {
  return resample_volume(volume, [2, 1, 0], (size, points) =>
    Math.min(Math.ceil(min_axis_points / size), Math.floor(max_points / points)),
  )
}

// Per-plane maxima of |data| along each axis of a z-fastest [nx, ny, nz] array.
const plane_peaks = (data: Float64Array, [nx, ny, nz]: Vec3): Float64Array[] => {
  const peaks = [nx, ny, nz].map((size) => new Float64Array(size))
  const [x_peaks, y_peaks, z_peaks] = peaks
  let idx = 0
  for (let idx_x = 0; idx_x < nx; idx_x++)
    for (let idx_y = 0; idx_y < ny; idx_y++) {
      let row_peak = 0
      for (let idx_z = 0; idx_z < nz; idx_z++, idx++) {
        const magnitude = Math.abs(data[idx])
        if (magnitude > row_peak) row_peak = magnitude
        if (magnitude > z_peaks[idx_z]) z_peaks[idx_z] = magnitude
      }
      if (row_peak > y_peaks[idx_y]) y_peaks[idx_y] = row_peak
      if (row_peak > x_peaks[idx_x]) x_peaks[idx_x] = row_peak
    }
  return peaks
}

// The tensor spline is a convex combination of coefficients within two knots of the
// sample on each axis. Per-plane maxima therefore bound *every* lobe, even crossings
// between native knots. Compute them once; a moving isovalue checks only nx + ny + nz.
const coefficient_envelopes = (volume: VolumetricData): Float64Array[] => {
  const coeffs = new Float64Array(volume.values.length)
  const [, ny, nz] = volume.dims
  const strides = [ny * nz, nz, 1]
  for (const [axis, size] of volume.dims.entries()) {
    const stride = strides[axis]
    const source = axis === 0 ? volume.values : coeffs
    for (let idx = 0; idx < coeffs.length; idx++) coeffs[idx] = 6 * source[idx]
    const index = extended_index(size, false)
    for (let outer = 0; outer < coeffs.length; outer += size * stride)
      prefilter(coeffs, index, false, [outer, size, stride])
  }
  return plane_peaks(coeffs, volume.dims)
}

// Planes from `margin` before the first to `margin` after the last peak >= magnitude.
const level_bounds = (peaks: Float64Array[], magnitude: number, margin: number) =>
  peaks.map((planes): Vec2 | null => {
    const first = planes.findIndex((value) => value >= magnitude)
    if (first === -1) return null
    const last = planes.findLastIndex((value) => value >= magnitude)
    return [Math.max(0, first - margin), Math.min(planes.length - 1, last + margin)]
  })
const grid_points = (bounds: (Vec2 | null)[], factor: number): number =>
  bounds.reduce((count, span) => count * (span ? (span[1] - span[0]) * factor + 1 : 1), 1)

// Recently used focused grids per source, at most MAX_FOCUSED_POINTS samples in all (each
// grid alone <= MAX_CUBIC_GRID_POINTS): interleaved levels (A, B, A) in one rebuild get the
// same grid object back, so the geometry jobs share it.
const MAX_FOCUSED_POINTS = 2_000_000
type FocusGrid = {
  sample_peaks: Float64Array[]
  peaks?: Float64Array[]
  grids: Map<string, VolumetricData>
}
const finite_grids = new WeakMap<VolumetricData, FocusGrid>()
const focused_volume = (
  volume: VolumetricData,
  magnitude: number,
): VolumetricData | undefined => {
  let cached = finite_grids.get(volume)
  if (!cached) {
    cached = { sample_peaks: plane_peaks(volume.values, volume.dims), grids: new Map() }
    finite_grids.set(volume, cached)
  }
  // Each sample is a convex combination of coefficients within one knot, so the coefficient
  // crop below contains the samples' crop with a 1-plane margin. If even that misses the
  // budget, skip the whole-source coefficient pass.
  const sample_bounds = level_bounds(cached.sample_peaks, magnitude, 1)
  if (grid_points(sample_bounds, 3) > MAX_CUBIC_GRID_POINTS) return undefined
  cached.peaks ??= coefficient_envelopes(volume)
  const bounds = level_bounds(cached.peaks, magnitude, 2).map(
    (span, axis) => span ?? [0, volume.dims[axis] - 1],
  ) as Bounds
  const factor = grid_points(bounds, 4) <= MAX_CUBIC_GRID_POINTS ? 4 : 3
  if (grid_points(bounds, factor) > MAX_CUBIC_GRID_POINTS) return undefined
  const key = bounds.flat().join(`,`)
  const { grids } = cached
  let grid = grids.get(key)
  if (grid) grids.delete(key) // re-inserted below as most recently used
  else {
    // Contract cropped axes first so intermediate arrays fit the same point budget.
    const ratio = (axis: number) =>
      ((bounds[axis][1] - bounds[axis][0]) * factor + 1) / volume.dims[axis]
    const axes = [0, 1, 2].toSorted((first, second) => ratio(first) - ratio(second))
    grid = resample_volume(volume, axes, () => factor, bounds)
    let total = grid.values.length
    for (const kept of grids.values()) total += kept.values.length
    for (const [old_key, old_grid] of grids) {
      if (total <= MAX_FOCUSED_POINTS) break
      grids.delete(old_key) // Map order is least recently used first
      total -= old_grid.values.length
    }
  }
  grids.set(key, grid)
  return grid
}

// Focusing scans the whole source's spline coefficients once (~270 ms, 64 MB copy at 200³).
const MAX_FOCUS_SOURCE_POINTS = 8_000_000

// Subdivide the coarsest voxel spacings first, preserving source extrema on the fine grid.
// All panes share a geometry-only grid for the same contour bounds. Measurements keep using the source.
const surface_grids = new WeakMap<VolumetricData, VolumetricData>()
export function cubic_surface_volume(volume: VolumetricData, magnitude = 0): VolumetricData {
  if (!volume.values.length) return volume
  // A finite field over the full-grid budget can still focus on a small level set (e.g. one
  // peak); geometry preparation would otherwise coarsen the source and step over it.
  if (
    !volume.periodic &&
    magnitude > 0 &&
    magnitude <= volume.data_range.abs_max &&
    volume.values.length <= MAX_FOCUS_SOURCE_POINTS &&
    volume.dims.every((size) => size > 1)
  ) {
    const focused = focused_volume(volume, magnitude)
    if (focused) return focused
  }
  if (volume.values.length >= MAX_CUBIC_GRID_POINTS) return volume
  const cached = surface_grids.get(volume)
  if (cached) return cached
  const endpoint = volume.periodic ? 0 : 1
  const spacing = volume.lattice.map(
    (axis, idx) => Math.hypot(...axis) / (volume.dims[idx] - endpoint),
  )
  const axes = [0, 1, 2].toSorted((first, second) => spacing[second] - spacing[first])
  const refined = resample_volume(volume, axes, (size, points) =>
    (points / size) * (2 * size - endpoint) <= MAX_CUBIC_GRID_POINTS ? 2 : 1,
  )
  surface_grids.set(volume, refined)
  return refined
}
