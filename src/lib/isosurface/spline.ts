import {
  add,
  create_frac_to_cart,
  scale_lattice_matrix,
  type Vec2,
  type Vec3,
} from '#lib/math.js'
import { safe_mod } from './grid'
import { MAX_CUBIC_GRID_POINTS, type VolumetricData } from './types'

const POLE = Math.sqrt(3) - 2 // pole of the cubic B-spline interpolation prefilter
const HORIZON = 30 // POLE ** 30 ≈ 1e-17: the prefilter's exponential tail

// Convert a line (already scaled by 6) to interpolating cubic B-spline coefficients.
const prefilter = (
  coefs: Float64Array,
  index: (idx: number) => number,
  periodic: boolean,
): void => {
  const size = coefs.length
  // causal pass y[k] = x[k] + POLE * y[k - 1], seeded with the extended signal's tail
  let seed = 0
  for (let lag = HORIZON; lag >= 0; lag--) seed = seed * POLE + coefs[index(-lag)]
  coefs[0] = seed
  for (let idx = 1; idx < size; idx++) coefs[idx] += POLE * coefs[idx - 1]
  // anti-causal pass d[k] = POLE * (d[k + 1] - y[k])
  if (periodic) {
    seed = 0
    for (let lag = HORIZON; lag >= 0; lag--)
      seed = seed * POLE - POLE * coefs[index(size - 1 + lag)]
  } else seed = (POLE / (POLE * POLE - 1)) * (POLE * coefs[size - 2] + coefs[size - 1])
  coefs[size - 1] = seed
  for (let idx = size - 2; idx >= 0; idx--) coefs[idx] = POLE * (coefs[idx + 1] - coefs[idx])
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
// grid lines. Periodic axes wrap, finite ones mirror. Values are clamped to `[lower, upper]`.
const upsample_axis = (
  values: Float64Array,
  [outer, size, inner]: Vec3,
  factor: number,
  periodic: boolean,
  [lower, upper]: Vec2,
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
  const coefs = new Float64Array(size)
  for (let line = 0; line < outer * inner; line++) {
    const [outer_idx, inner_idx] = [Math.floor(line / inner), line % inner]
    const src = outer_idx * size * inner + inner_idx
    for (let idx = 0; idx < size; idx++) coefs[idx] = 6 * values[src + idx * inner]
    prefilter(coefs, index, periodic)
    const dst = outer_idx * out_size * inner + inner_idx
    for (let base = first; base < size && base <= last; base++) {
      const dest = dst + (base - first) * factor * inner
      // A knot along this axis may already be interpolated along the other two.
      out[dest] = Math.max(lower, Math.min(upper, values[src + base * inner]))
      if (base === last) break
      const left = coefs[index(base - 1)]
      const middle = coefs[base]
      const right = coefs[index(base + 1)]
      const far = coefs[index(base + 2)]
      for (let idx = 0; idx < weights.length; idx++) {
        const weight = weights[idx]
        const spline =
          (weight[0] * left + weight[1] * middle + weight[2] * right + weight[3] * far) / 6
        out[dest + (idx + 1) * inner] = Math.max(lower, Math.min(upper, spline))
      }
    }
  }
  return out
}

// Evaluate the separable spline one axis at a time. A singleton axis has no intervals.
const resample_volume = (
  volume: VolumetricData,
  axes: readonly number[],
  subdivision: (size: number, points: number) => number,
  bounds?: Bounds,
): VolumetricData => {
  const { periodic, data_range } = volume
  const range: Vec2 = [data_range.min, data_range.max]
  let values = volume.values
  const dims: Vec3 = [...volume.dims]
  for (const axis of axes) {
    const size = dims[axis]
    const factor = subdivision(size, values.length)
    if (factor < 2 || size < 2) continue
    const outer = axis === 0 ? 1 : axis === 1 ? dims[0] : dims[0] * dims[1]
    const inner = axis === 0 ? dims[1] * dims[2] : axis === 1 ? dims[2] : 1
    // With a focused grid, retain the native extent on the other axes until their own
    // full-line prefilter. Clamping between these passes would change the tensor spline.
    const limits: Vec2 = bounds && axis !== axes.at(-1) ? [-Infinity, Infinity] : range
    const span = bounds?.[axis]
    values = upsample_axis(values, [outer, size, inner], factor, periodic, limits, span)
    const intervals = span ? span[1] - span[0] : size - Number(!periodic)
    dims[axis] = intervals * factor + Number(!periodic)
  }
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

// The tensor spline is a convex combination of coefficients within two knots of the
// sample on each axis. Per-plane maxima therefore bound *every* lobe, even crossings
// between native knots. Compute them once; a moving isovalue checks only nx + ny + nz.
const coefficient_envelopes = (volume: VolumetricData): Float64Array[] => {
  const coeffs = volume.values.slice()
  const dims = [...volume.dims]
  const strides = [dims[1] * dims[2], dims[2], 1]
  for (const [axis, size] of dims.entries()) {
    const stride = strides[axis]
    const line = new Float64Array(size)
    const index = extended_index(size, false)
    for (let outer = 0; outer < coeffs.length; outer += size * stride)
      for (let inner = 0; inner < stride; inner++) {
        for (let idx = 0; idx < size; idx++)
          line[idx] = 6 * coeffs[outer + inner + idx * stride]
        prefilter(line, index, false)
        for (let idx = 0; idx < size; idx++) coeffs[outer + inner + idx * stride] = line[idx]
      }
  }
  const peaks = dims.map((size) => new Float64Array(size))
  for (let idx = 0; idx < coeffs.length; idx++) {
    const magnitude = Math.abs(coeffs[idx])
    for (let axis = 0; axis < 3; axis++) {
      const plane = Math.floor(idx / strides[axis]) % dims[axis]
      peaks[axis][plane] = Math.max(peaks[axis][plane], magnitude)
    }
  }
  return peaks
}

type FocusGrid = { peaks: Float64Array[]; key?: string; grid?: VolumetricData }
const finite_grids = new WeakMap<VolumetricData, FocusGrid>()
const focused_volume = (
  volume: VolumetricData,
  magnitude: number,
): VolumetricData | undefined => {
  let cached = finite_grids.get(volume)
  if (!cached) {
    cached = { peaks: coefficient_envelopes(volume) }
    finite_grids.set(volume, cached)
  }
  const bounds = cached.peaks.map((peaks): Vec2 => {
    const first = peaks.findIndex((value) => value >= magnitude)
    const last = peaks.findLastIndex((value) => value >= magnitude)
    return first === -1
      ? [0, peaks.length - 1]
      : [Math.max(0, first - 2), Math.min(peaks.length - 1, last + 2)]
  }) as Bounds
  const points = (factor: number) =>
    bounds.reduce((count, [lo, hi]) => count * ((hi - lo) * factor + 1), 1)
  const factor = points(4) <= MAX_CUBIC_GRID_POINTS ? 4 : 3
  if (points(factor) > MAX_CUBIC_GRID_POINTS) return undefined
  const key = bounds.flat().join(`,`)
  if (key !== cached.key) {
    // Contract cropped axes first so intermediate arrays fit the same point budget.
    const ratio = (axis: number) =>
      ((bounds[axis][1] - bounds[axis][0]) * factor + 1) / volume.dims[axis]
    const axes = [0, 1, 2].toSorted((first, second) => ratio(first) - ratio(second))
    cached.grid = resample_volume(volume, axes, () => factor, bounds)
    cached.key = key
  }
  return cached.grid
}

// Subdivide the coarsest voxel spacings first, preserving source extrema on the fine grid.
// All panes share a geometry-only grid for the same contour bounds. Measurements keep using the source.
const surface_grids = new WeakMap<VolumetricData, VolumetricData>()
export function cubic_surface_volume(volume: VolumetricData, magnitude = 0): VolumetricData {
  if (volume.values.length >= MAX_CUBIC_GRID_POINTS || !volume.values.length) return volume
  if (
    !volume.periodic &&
    magnitude > 0 &&
    magnitude <= volume.data_range.abs_max &&
    volume.dims.every((size) => size > 1)
  ) {
    const focused = focused_volume(volume, magnitude)
    if (focused) return focused
  }
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
