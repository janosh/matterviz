// Geometry for the generic ternary (barycentric) plot: composition triples to triangle
// coordinates and back, the grid of constant-fraction lines with their tick anchors, and
// the pixel fit of the unit triangle into a plot area.
//
// Corner convention matches the convex hull and the isothermal ternary sections
// (TRIANGLE_VERTICES): the first component sits at the right corner, the second at the
// top, the third at the left.
import { TRIANGLE_VERTICES } from '$lib/convex-hull/barycentric-coords'
import type { Vec2, Vec3 } from '$lib/math'
import type { LineStyle, Markers, PointStyle } from '$lib/plot/core/types'

export const TRIANGLE_HEIGHT = TRIANGLE_VERTICES[1][1]

// Any triple of non-negative amounts; ternary_fractions() scales it to sum to 1
export type TernaryTriple = readonly [number, number, number]

// One series of compositions. Each point is a triple of amounts of the three components
// (in the order of the plot's `labels`); amounts are normalized per point, so counts,
// fractions and percentages all work and may be mixed between points.
export interface TernarySeries<Metadata = Record<string, unknown>> {
  id?: string | number // stable key; defaults to the series index
  points: readonly TernaryTriple[]
  label?: string
  color?: string // defaults to the plot palette color of the series index
  markers?: Markers // `points` (default), `line` or `line+points`
  point_style?: PointStyle | readonly PointStyle[] // one style or one per point
  line_style?: LineStyle
  // Per-point values mapped through the plot's color scale (drawn with a color bar).
  // Null entries fall back to the series color.
  color_values?: readonly (number | null)[]
  metadata?: Metadata | readonly Metadata[]
  visible?: boolean
}

// What hover, click and tooltip snippets receive for a point
export interface TernaryPointProps<Metadata = Record<string, unknown>> {
  series_idx: number
  point_idx: number
  series_id: string | number
  series_label: string
  amounts: TernaryTriple // as given
  fractions: Vec3 // normalized to sum to 1
  color: string
  color_value: number | null
  metadata: Metadata | undefined
}

// Fractions of a triple. Amounts need not sum to 1 (raw counts work); negative, NaN or
// all-zero amounts throw since they have no position in the triangle. Negative amounts
// within `tolerance` of the total are round-off from computing one fraction as
// `1 - a - b` and clamp to zero instead.
export function ternary_fractions(
  triple: TernaryTriple,
  label = `ternary point`,
  tolerance = 1e-9,
): Vec3 {
  if (triple.length !== 3 || triple.some((amt) => !Number.isFinite(amt))) {
    throw new Error(`${label} must be three finite numbers, got [${triple.join(`, `)}]`)
  }
  const raw_total = triple[0] + triple[1] + triple[2]
  if (triple.some((amt) => amt < -tolerance * Math.abs(raw_total))) {
    throw new Error(`${label} has a negative amount: [${triple.join(`, `)}]`)
  }
  const [amt_a, amt_b, amt_c] = triple.map((amt) => Math.max(0, amt))
  const total = amt_a + amt_b + amt_c
  if (total === 0) throw new Error(`${label} has no amounts: [${triple.join(`, `)}]`)
  return [amt_a / total, amt_b / total, amt_c / total]
}

// Fractions -> [x, y] in the unit triangle (side 1, y up, base on y = 0)
export const ternary_to_xy = ([frac_a, frac_b, frac_c]: readonly [
  number,
  number,
  number,
]): Vec2 => {
  const [corner_a, corner_b, corner_c] = TRIANGLE_VERTICES
  return [
    frac_a * corner_a[0] + frac_b * corner_b[0] + frac_c * corner_c[0],
    frac_a * corner_a[1] + frac_b * corner_b[1] + frac_c * corner_c[1],
  ]
}

// [x, y] in the unit triangle -> fractions. Points outside the triangle return fractions
// outside [0, 1] (still summing to 1), so callers can test containment with a tolerance.
export const xy_to_ternary = ([x_pos, y_pos]: Vec2): Vec3 => {
  const frac_b = y_pos / TRIANGLE_HEIGHT
  const frac_a = x_pos - frac_b / 2
  return [frac_a, frac_b, 1 - frac_a - frac_b]
}

export const inside_triangle = (fractions: Vec3, tolerance = 1e-9): boolean =>
  fractions.every((frac) => frac >= -tolerance)

// One grid line: the locus of `component` = `value`, from one edge of the triangle to the
// other. `from` is the end that carries the tick label and `outward` the unit direction
// pointing away from the triangle there: fraction ticks of the right corner's component
// read along the bottom edge, of the top corner's along the right edge and of the left
// corner's along the left edge, each written on the outside.
export interface TernaryGridLine {
  component: 0 | 1 | 2
  value: number
  from: Vec2
  to: Vec2
  outward: Vec2
}

const EDGE_OUTWARD: readonly Vec2[] = [
  [0, -1], // bottom edge, component 0 ticks
  [TRIANGLE_HEIGHT, 0.5], // right edge, component 1 ticks
  [-TRIANGLE_HEIGHT, 0.5], // left edge, component 2 ticks
]

// Grid lines at every multiple of `step` strictly inside (0, 1). Steps that do not divide
// 1 evenly stop at the last multiple below 1; a non-positive step yields no lines.
export function ternary_grid_lines(step: number): TernaryGridLine[] {
  if (!(step > 0) || step >= 1) return []
  const n_lines = Math.ceil(1 / step) - 1
  const lines: TernaryGridLine[] = []
  for (const component of [0, 1, 2] as const) {
    for (let idx = 1; idx <= n_lines; idx++) {
      const value = Number((idx * step).toPrecision(12))
      if (value >= 1 - 1e-9) break
      const rest = 1 - value
      // The two other components (cyclic order) trade `rest` between them along the line.
      // The ticked end lies on the edge where the next component is zero: component 0
      // ticks where component 1 is zero, i.e. on the bottom edge
      const next = (component + 1) % 3
      const prev = (component + 2) % 3
      const endpoint = (share_next: number): Vec2 => {
        const fractions: Vec3 = [0, 0, 0]
        fractions[component] = value
        fractions[next] = share_next
        fractions[prev] = rest - share_next
        return ternary_to_xy(fractions)
      }
      lines.push({
        component,
        value,
        from: endpoint(0),
        to: endpoint(rest),
        outward: EDGE_OUTWARD[component],
      })
    }
  }
  return lines
}

// Pixel fit of the unit triangle into a `width` x `height` box, centered, preserving the
// equilateral shape. `to_px` flips y since SVG grows downwards.
export interface TernaryLayout {
  scale: number // px per unit of triangle side
  origin: Vec2 // px position of the unit triangle's (0, 0), the left corner
  to_px: (xy: readonly [number, number]) => Vec2
  from_px: (px: Vec2) => Vec2
}

export function ternary_layout(width: number, height: number): TernaryLayout {
  const scale = Math.max(0, Math.min(width, height / TRIANGLE_HEIGHT))
  const origin: Vec2 = [(width - scale) / 2, height - (height - scale * TRIANGLE_HEIGHT) / 2]
  return {
    scale,
    origin,
    to_px: ([x_pos, y_pos]) => [origin[0] + x_pos * scale, origin[1] - y_pos * scale],
    from_px: ([px_x, px_y]) => [(px_x - origin[0]) / scale, (origin[1] - px_y) / scale],
  }
}
