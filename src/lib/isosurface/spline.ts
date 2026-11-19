import type { Vec2, Vec3 } from '#lib/math.js'
import { safe_mod } from './grid'
import { MAX_CUBIC_GRID_POINTS, type VolumetricData } from './types'

const POLE = Math.sqrt(3) - 2 // pole of the cubic B-spline interpolation prefilter
const HORIZON = 30 // POLE ** 30 ≈ 1e-17: the prefilter's exponential tail

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
): Float64Array => {
  const period = periodic ? size : 2 * size - 2
  const index = (idx: number): number => {
    const wrapped = safe_mod(idx, period)
    return wrapped < size ? wrapped : period - wrapped
  }
  const intervals = periodic ? size : size - 1
  const out_size = intervals * factor + (periodic ? 0 : 1)
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
    const dst = outer_idx * out_size * inner + inner_idx
    for (let base = 0; base < size; base++) {
      const dest = dst + base * factor * inner
      out[dest] = values[src + base * inner] // preserve every source knot, including exact extrema
      if (base === intervals) break
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
    values = upsample_axis(values, [outer, size, inner], factor, periodic, range)
    dims[axis] = periodic ? size * factor : (size - 1) * factor + 1
  }
  return values === volume.values ? volume : { ...volume, values, dims }
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

// Subdivide the coarsest voxel spacings first, preserving source extrema on the fine grid.
// All panes and isovalues share this geometry-only grid; measurement uses the source.
const surface_grids = new WeakMap<VolumetricData, VolumetricData>()
export function cubic_surface_volume(volume: VolumetricData): VolumetricData {
  if (volume.values.length >= MAX_CUBIC_GRID_POINTS || !volume.values.length) return volume
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
