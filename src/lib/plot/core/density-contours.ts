// Gaussian kernel density contours of screen-space points, ported from layerchart's Density
// mark (itself a wrapper of d3-contour's contourDensity). The density grid is rebuilt here
// rather than via contourDensity so contour levels can be iso-proportions: the fraction of
// the gridded density mass each contour encloses (0.5 = densest half). Unlike d3's raw
// density thresholds, those mean the same thing for series of different sizes and spreads.

import { blur2 } from 'd3-array'
import { contours } from 'd3-contour'
import type { ContourMultiPolygon } from 'd3-contour'
import { quantile_unordered } from '#lib/math.js'

// Cells the series-wide level grid may hold; past this its cells double, coarser but bounded
// per frame (a series spanning thousands of px when zoomed far in)
const MAX_LEVEL_CELLS = 250_000

type DensityContourOptions = {
  width: number // grid extent in px; points are in [0, width] x [0, height]
  height: number
  bandwidth?: number // standard deviation of the Gaussian kernel in px (d3 semantics)
  cell_size?: number // grid cell size in px, rounded down to a power of two like d3
  origin?: [number, number] // px mapped to the grid's [0, 0] corner (default [0, 0])
  // Number of evenly spaced enclosed-mass fractions (4 -> 0.2, 0.4, 0.6, 0.8), or the
  // fractions themselves, each in (0, 1)
  levels?: number | readonly number[]
}

export type DensityContour = {
  fraction: number // share of the gridded density mass this contour encloses
  path: string // SVG path data, in the same px frame as the input points
}

// Point mass splatted bilinearly onto a padded grid and blurred like d3's contourDensity
// (three box blurs approximating a Gaussian of std `bandwidth`). Points with a non-finite
// coordinate or outside the padded grid are skipped. Unlike d3, the +1 neighbour of a point
// in the last column is dropped rather than wrapped into the next row's first cell.
export function density_grid(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  opts: Pick<DensityContourOptions, `width` | `height` | `bandwidth` | `cell_size` | `origin`>,
) {
  const { width, height, bandwidth = 20, cell_size = 4, origin = [0, 0] } = opts
  // The one user-facing option here; sizes and arrays come from density_contours' caller
  if (!(bandwidth >= 0)) throw new RangeError(`density_grid: invalid bandwidth ${bandwidth}`)
  const log2_cell = Math.floor(Math.log2(cell_size))
  // d3's box-blur radius whose three passes give variance r(r + 1) = bandwidth^2
  const blur_radius = (Math.sqrt(4 * bandwidth * bandwidth + 1) - 1) / 2
  const offset = blur_radius * 3 // px of padding so the blur isn't cut off
  const n_cols = (width + offset * 2) >> log2_cell
  const n_rows = (height + offset * 2) >> log2_cell
  // Row-major point mass per cell; typed, so a write past the last row drops like in d3
  const values = new Float64Array(n_cols * n_rows)
  const inv_cell = 2 ** -log2_cell
  for (let idx = 0; idx < xs.length; idx++) {
    const grid_x = (xs[idx] - origin[0] + offset) * inv_cell
    const grid_y = (ys[idx] - origin[1] + offset) * inv_cell
    // Negated so NaN fails too
    if (!(grid_x >= 0 && grid_x < n_cols && grid_y >= 0 && grid_y < n_rows)) continue
    const col = Math.floor(grid_x)
    const row = Math.floor(grid_y)
    const frac_x = grid_x - col - 0.5
    const frac_y = grid_y - row - 0.5
    const cell = col + row * n_cols
    values[cell] += (1 - frac_x) * (1 - frac_y)
    values[cell + n_cols] += (1 - frac_x) * frac_y
    if (col + 1 < n_cols) {
      values[cell + 1] += frac_x * (1 - frac_y)
      values[cell + 1 + n_cols] += frac_x * frac_y
    }
  }
  blur2({ data: values, width: n_cols, height: n_rows }, blur_radius * inv_cell)
  return { values, n_cols, n_rows, cell_size: 2 ** log2_cell, offset }
}

// Enclosed-mass fractions from the `levels` option, validated, deduplicated and ascending
export function density_level_fractions(
  levels: DensityContourOptions[`levels`] = 4,
): number[] {
  if (typeof levels === `number`) {
    if (!Number.isInteger(levels) || levels < 1) {
      throw new RangeError(`density levels must be a positive integer, got ${levels}`)
    }
    return Array.from({ length: levels }, (_, idx) => (idx + 1) / (levels + 1))
  }
  const bad = levels.find((fraction) => !(fraction > 0 && fraction < 1))
  if (bad !== undefined) {
    throw new RangeError(`density level fractions must lie in (0, 1), got ${bad}`)
  }
  return [...new Set(levels)].toSorted((left, right) => left - right)
}

// Density threshold whose superlevel set {cells >= threshold} holds each `fraction` of the
// grid's mass (the highest-density region). Fractions must ascend, as
// density_level_fractions returns them; NaN for all when the grid holds no mass.
export function mass_thresholds(values: Float64Array, fractions: readonly number[]): number[] {
  const sorted = values.toSorted() // native numeric ascending, swept from the top
  let total = 0
  for (const val of sorted) total += val
  if (!(total > 0)) return fractions.map(() => NaN)
  let [cumulative, cell_idx] = [0, sorted.length]
  return fractions.map((fraction) => {
    while (cell_idx > 0 && cumulative < fraction * total) cumulative += sorted[--cell_idx]
    return sorted[Math.min(cell_idx, sorted.length - 1)]
  })
}

// Densities (points per px^2) whose superlevel sets hold each fraction of the whole series'
// mass. Gridded over the series' own core extent (0.5-99.5th percentiles, so one far outlier
// can't inflate the grid) rather than the view, so panning moves contours without reshaping
// them. Past MAX_LEVEL_CELLS the grid coarsens, approximating the levels when zoomed far in.
export function level_densities(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  fractions: readonly number[],
  opts: Pick<DensityContourOptions, `bandwidth` | `cell_size`> = {},
): number[] {
  const { bandwidth = 20 } = opts
  const finite = Array.from({ length: xs.length }, (_, idx) => idx).filter(
    (idx) => Number.isFinite(xs[idx]) && Number.isFinite(ys[idx]),
  )
  if (finite.length === 0) return fractions.map(() => NaN)
  const core = (vals: ArrayLike<number>): [number, number] => {
    const picked = finite.map((idx) => vals[idx])
    return [quantile_unordered(picked, 0.005), quantile_unordered(picked, 0.995)]
  }
  const [[x_lo, x_hi], [y_lo, y_hi]] = [core(xs), core(ys)]
  const [width, height] = [x_hi - x_lo, y_hi - y_lo]
  const pad = 6 * bandwidth // blur padding on both sides, as density_grid adds it
  let cell_size = opts.cell_size ?? 4
  while (((width + pad) / cell_size) * ((height + pad) / cell_size) > MAX_LEVEL_CELLS) {
    cell_size *= 2
  }
  const grid = density_grid(xs, ys, {
    width,
    height,
    bandwidth,
    cell_size,
    origin: [x_lo, y_lo],
  })
  return mass_thresholds(grid.values, fractions).map((value) => value / grid.cell_size ** 2)
}

// GeoJSON MultiPolygon -> SVG path with every coordinate mapped through `to_px` and rounded
// to 0.01 px. Holes keep d3's opposite winding, so the default nonzero fill cuts them out.
export function multipolygon_path(
  { coordinates }: Pick<ContourMultiPolygon, `coordinates`>,
  to_px: (val: number) => number = (val) => val,
): string {
  const fmt = (val: number) => Math.round(to_px(val) * 100) / 100
  let path = ``
  for (const polygon of coordinates) {
    for (const ring of polygon) {
      if (ring.length === 0) continue
      path += `M${ring.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(`L`)}Z`
    }
  }
  return path
}

// Iso-proportion density contours of the whole series (see level_densities), drawn on a grid
// over [0, width] x [0, height]. Outermost (largest enclosed fraction) first so filled layers
// stack with the densest core on top. Empty when there is no mass to contour in view.
export function density_contours(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  opts: DensityContourOptions,
): DensityContour[] {
  const fractions = density_level_fractions(opts.levels)
  if (xs.length === 0 || opts.width <= 0 || opts.height <= 0) return []
  const grid = density_grid(xs, ys, opts)
  const cell_area = grid.cell_size ** 2
  const thresholds = level_densities(xs, ys, fractions, opts).map((value) => value * cell_area)
  const contour_of = contours().size([grid.n_cols, grid.n_rows])
  // d3-contour's types want a plain array (it only indexes it)
  const values = Array.from(grid.values)
  // d3 returns rings in grid units; map them back to the caller's px frame
  const to_px = (val: number) => val * grid.cell_size - grid.offset
  return fractions
    .map((fraction, idx) => ({ fraction, threshold: thresholds[idx] }))
    .filter(({ threshold }) => threshold > 0)
    .map(({ fraction, threshold }) => ({
      fraction,
      path: multipolygon_path(contour_of.contour(values, threshold), to_px),
    }))
    .filter(({ path }) => path)
    .toReversed()
}
