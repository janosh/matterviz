// Mode values (e.g. the electron–phonon coupling λ_qν) over a band structure: their parsing,
// the projection of their q-points onto the band path and the markers Bands draws there
import type { Matrix3x3, Vec2, Vec3 } from '#lib/math.js'
import { is_finite_vec3, matrix_inverse_3x3 } from '#lib/math.js'
import { is_plain_object } from '#lib/utils.js'
import { branch_x, plotted_branches } from './helpers'
import type { BaseBandStructure, ModeValues } from './types'

// A q-point's distance from the path below which it lies on it, as a fraction of the path's
// median step between consecutive q-points
export const MODE_VALUES_PATH_TOL = 0.1

const MODE_VALUES_FIELDS = new Set([`label`, `qpoints`, `frequencies`, `values`])

// Mode values from their JSON form (null for NaN, which JSON cannot write): throws naming the
// field that is wrong. Every q-point has as many frequencies and values as the first.
export function normalize_mode_values(raw: unknown): ModeValues {
  if (!is_plain_object(raw)) throw new Error(`must be an object`)
  const unknown_key = Object.keys(raw).find((key) => !MODE_VALUES_FIELDS.has(key))
  if (unknown_key !== undefined) throw new Error(`${unknown_key}: unknown field`)
  const { label, qpoints, frequencies, values } = raw
  if (typeof label !== `string`) throw new Error(`label must be a string`)
  if (!Array.isArray(qpoints) || !qpoints.every(is_finite_vec3)) {
    throw new Error(`qpoints must be an array of 3 finite fractional coordinates each`)
  }
  const n_modes =
    Array.isArray(frequencies) && Array.isArray(frequencies[0]) ? frequencies[0].length : 0
  // a [q][mode] table: one row of n_modes entries passing is_entry per q-point
  const table = <Entry>(
    name: string,
    rows: unknown,
    is_entry: (entry: unknown) => entry is Entry,
    expected: string,
  ): Entry[][] => {
    if (!Array.isArray(rows) || rows.length !== qpoints.length) {
      const got = Array.isArray(rows) ? rows.length : typeof rows
      throw new Error(`${name} must have one row per q-point (${qpoints.length}), got ${got}`)
    }
    return rows.map((row: unknown, q_idx) => {
      if (Array.isArray(row) && row.length === n_modes && row.every(is_entry)) return row
      throw new Error(`${name}[${q_idx}] must be ${n_modes} ${expected}`)
    })
  }
  const is_finite = (entry: unknown): entry is number => Number.isFinite(entry)
  const is_value = (entry: unknown): entry is number | null =>
    entry === null || is_finite(entry) || Number.isNaN(entry)
  return {
    label,
    qpoints,
    frequencies: table(`frequencies`, frequencies, is_finite, `finite numbers`),
    values: table(`values`, values, is_value, `numbers (NaN or null: no value)`).map((row) =>
      row.map((entry) => entry ?? NaN),
    ),
  }
}

// A q-point (index into the mode values) at plot x on the band path
export interface PathProjection {
  q_idx: number
  x: number
}

// One plotted segment between consecutive path q-points (a lone q-point's branch: start = end)
// and whether it continues the previous one (same q-point at the same x) or starts a new run
interface PathSegment {
  start: number
  end: number
  x_range: Vec2
  continues: boolean
}

// The plotted path as segments in x order
function path_segments(
  band_struct: BaseBandStructure,
  x_positions: Record<string, Vec2>,
): PathSegment[] {
  const path = band_struct.qpoints
  const segments: PathSegment[] = []
  const branches = plotted_branches(band_struct, x_positions).toSorted(
    ([, [start_a]], [, [start_b]]) => start_a - start_b,
  )
  for (const [branch, x_range] of branches) {
    const prev = segments.at(-1)
    const start_q = path[branch.start_index].frac_coords
    let continues =
      prev !== undefined &&
      Math.abs(prev.x_range[1] - x_range[0]) <= 1e-9 * (1 + Math.abs(x_range[0])) &&
      path[prev.end].frac_coords.every(
        (coord, axis) => Math.abs(coord - start_q[axis]) <= 1e-9,
      )
    const last = Math.max(branch.start_index, branch.end_index - 1)
    for (let idx = branch.start_index; idx <= last; idx++) {
      const end = Math.min(idx + 1, branch.end_index)
      const [x_start, x_end] = [idx, end].map((q_idx) =>
        branch_x(band_struct, branch, x_range, q_idx),
      )
      segments.push({ start: idx, end, x_range: [x_start, x_end], continues })
      continues = true
    }
  }
  return segments
}

// Where on the plotted path (x as in Bands' x_positions) each q-point lies: within `rel_tol` ×
// the path's median step, in Cartesian reciprocal space through `recip_lattice` (rows b_i), of
// the nearest periodic image of the q-point. A q-point near several stretches of the path (a
// path revisiting it) lies at each, one near consecutive segments (a path vertex) at the closest
// only. Points off the path are left out.
export function project_qpoints_onto_path(
  band_struct: BaseBandStructure,
  recip_lattice: Matrix3x3,
  qpoints: readonly Vec3[],
  x_positions: Record<string, Vec2>,
  rel_tol = MODE_VALUES_PATH_TOL,
): PathProjection[] {
  const [[b_00, b_01, b_02], [b_10, b_11, b_12], [b_20, b_21, b_22]] = recip_lattice
  // Cartesian Σ f_i b_i of fractional (f_0, f_1, f_2)
  const to_cart = (f_0: number, f_1: number, f_2: number): Vec3 => [
    f_0 * b_00 + f_1 * b_10 + f_2 * b_20,
    f_0 * b_01 + f_1 * b_11 + f_2 * b_21,
    f_0 * b_02 + f_1 * b_12 + f_2 * b_22,
  ]
  const segments = path_segments(band_struct, x_positions).map((segment) => {
    const origin = band_struct.qpoints[segment.start].frac_coords
    const target = band_struct.qpoints[segment.end].frac_coords
    const vec = to_cart(target[0] - origin[0], target[1] - origin[1], target[2] - origin[2])
    const len_sq = vec[0] ** 2 + vec[1] ** 2 + vec[2] ** 2
    return { ...segment, origin, end_frac: target, vec, len_sq }
  })
  const steps = segments
    .map(({ len_sq }) => Math.sqrt(len_sq))
    .filter((step) => step > 0)
    .toSorted((lhs, rhs) => lhs - rhs)
  const tolerance = rel_tol * (steps[Math.floor(steps.length / 2)] ?? 0)
  const tol_sq = tolerance ** 2
  const candidates = segment_candidates(segments, qpoints, recip_lattice, tolerance)

  // Only a q-point's candidate segments can lie within tolerance: every other one is out of
  // reach and ends the run, as a gap between candidates does here. The pair test works in
  // scalars, on squared distances, allocating nothing.
  const projections: PathProjection[] = []
  for (const [q_idx, seg_idxs] of candidates) {
    const [q_0, q_1, q_2] = qpoints[q_idx]
    // the closest point of the current run of consecutive segments within tolerance
    let [best_sq, best_x] = [Infinity, NaN]
    let prev_idx = -2
    for (const seg_idx of seg_idxs) {
      const { origin, vec, len_sq, x_range, continues } = segments[seg_idx]
      if (seg_idx !== prev_idx + 1) {
        if (best_sq <= tol_sq) projections.push({ q_idx, x: best_x })
        best_sq = Infinity
      }
      prev_idx = seg_idx
      // q relative to the segment start, at its periodic image nearest that start
      let f_0 = q_0 - origin[0]
      let f_1 = q_1 - origin[1]
      let f_2 = q_2 - origin[2]
      f_0 -= Math.round(f_0)
      f_1 -= Math.round(f_1)
      f_2 -= Math.round(f_2)
      const rel_0 = f_0 * b_00 + f_1 * b_10 + f_2 * b_20
      const rel_1 = f_0 * b_01 + f_1 * b_11 + f_2 * b_21
      const rel_2 = f_0 * b_02 + f_1 * b_12 + f_2 * b_22
      const along = rel_0 * vec[0] + rel_1 * vec[1] + rel_2 * vec[2]
      const frac = len_sq > 0 ? Math.min(1, Math.max(0, along / len_sq)) : 0
      const dist_sq =
        (rel_0 - frac * vec[0]) ** 2 +
        (rel_1 - frac * vec[1]) ** 2 +
        (rel_2 - frac * vec[2]) ** 2
      // a jump or a segment out of reach ends the run
      if (!continues || dist_sq > tol_sq) {
        if (best_sq <= tol_sq) projections.push({ q_idx, x: best_x })
        best_sq = Infinity
      }
      if (dist_sq <= tol_sq && dist_sq < best_sq) {
        best_sq = dist_sq
        best_x = x_range[0] + frac * (x_range[1] - x_range[0])
      }
    }
    if (best_sq <= tol_sq) projections.push({ q_idx, x: best_x })
  }
  return projections
}

// For each q-point that may lie within `tolerance` of a segment, those segments' indices in
// path order, keyed in q order: a superset found through a periodic grid over the q-points'
// images in [0, 1)³. A point within the tolerance of a segment lies, in fractional coordinates,
// inside the segment's box widened by |Δf_i| ≤ tolerance · ‖column i of B⁻¹‖ (f = r · B⁻¹), so
// each segment visits the few cells that box covers instead of every q-point.
function segment_candidates(
  segments: readonly { origin: Vec3; end_frac: Vec3 }[],
  qpoints: readonly Vec3[],
  recip_lattice: Matrix3x3,
  tolerance: number,
): Map<number, number[]> {
  const inverse = matrix_inverse_3x3(recip_lattice)
  // slack (relative, and 1e-9 absolute, far past an image's rounding across a cell edge) so a
  // box edge rounded inward never drops a point the exact test keeps
  const reach = [0, 1, 2].map(
    (axis) =>
      tolerance *
        Math.hypot(inverse[0][axis], inverse[1][axis], inverse[2][axis]) *
        (1 + 1e-9) +
      1e-9,
  )
  // counting sort of the q-points into n_cells³ cells, about one point per cell
  const per_side = Math.round(Math.cbrt(qpoints.length))
  const n_cells = Math.max(1, Math.min(64, per_side))
  const cell_of = (frac: number): number =>
    Math.min(n_cells - 1, Math.floor((frac - Math.floor(frac)) * n_cells))
  const q_cells = Int32Array.from(qpoints, ([f_0, f_1, f_2]) => {
    return (cell_of(f_0) * n_cells + cell_of(f_1)) * n_cells + cell_of(f_2)
  })
  const cell_starts = new Int32Array(n_cells ** 3 + 1)
  for (const cell of q_cells) cell_starts[cell + 1]++
  for (let cell = 0; cell < n_cells ** 3; cell++) cell_starts[cell + 1] += cell_starts[cell]
  const cell_items = new Int32Array(qpoints.length)
  const fill = cell_starts.slice(0, -1)
  for (const [q_idx, cell] of q_cells.entries()) cell_items[fill[cell]++] = q_idx

  // a box wider than a period wraps onto every cell along that axis once
  const cell_span = (lo: number, hi: number): number[] => {
    const [first, last] = [Math.floor(lo * n_cells), Math.floor(hi * n_cells)]
    const count = Math.min(n_cells, last - first + 1)
    return Array.from({ length: count }, (_, step) => {
      const cell = (first + step) % n_cells
      return cell < 0 ? cell + n_cells : cell
    })
  }
  const candidates = new Map<number, number[]>()
  const seen_in = new Int32Array(qpoints.length).fill(-1) // one visit per (segment, q-point)
  for (const [seg_idx, { origin, end_frac }] of segments.entries()) {
    const [span_0, span_1, span_2] = [0, 1, 2].map((axis) =>
      cell_span(
        Math.min(origin[axis], end_frac[axis]) - reach[axis],
        Math.max(origin[axis], end_frac[axis]) + reach[axis],
      ),
    )
    for (const cell_0 of span_0) {
      for (const cell_1 of span_1) {
        for (const cell_2 of span_2) {
          const cell = (cell_0 * n_cells + cell_1) * n_cells + cell_2
          for (let item = cell_starts[cell]; item < cell_starts[cell + 1]; item++) {
            const q_idx = cell_items[item]
            if (seen_in[q_idx] === seg_idx) continue
            seen_in[q_idx] = seg_idx
            const list = candidates.get(q_idx)
            if (list) list.push(seg_idx)
            else candidates.set(q_idx, [seg_idx])
          }
        }
      }
    }
  }
  return new Map([...candidates].toSorted(([q_a], [q_b]) => q_a - q_b))
}

// One mode of a projected q-point with a value
export interface ModeValueMarker {
  x: number
  frequency: number // data unit, as in the mode values
  value: number
  q_idx: number
  mode_idx: number
}

// A q mesh meets the path every few pixels, and a triangle at each one fills the bands, so
// each mode keeps its strongest marker (|value|, which size and colour show) in every
// 1/MODE_MARKER_BINS of the path span: strong coupling always stays, weak ones thin out
export const MODE_MARKER_BINS = 50
export function thin_mode_markers(
  markers: readonly ModeValueMarker[],
  [x_min, x_max]: readonly [number, number],
): ModeValueMarker[] {
  const span = x_max - x_min
  if (!(span > 0)) return [...markers]
  const kept = new Map<string, ModeValueMarker>()
  for (const marker of markers) {
    const bin = Math.floor(((marker.x - x_min) / span) * MODE_MARKER_BINS)
    const key = `${marker.mode_idx} ${Math.min(MODE_MARKER_BINS - 1, Math.max(0, bin))}`
    const held = kept.get(key)
    if (!held || Math.abs(marker.value) > Math.abs(held.value)) kept.set(key, marker)
  }
  return [...kept.values()]
}

// The markers to draw: every mode with a value at every projected q-point
export const mode_value_markers = (
  { frequencies, values }: ModeValues,
  projections: readonly PathProjection[],
): ModeValueMarker[] =>
  projections.flatMap(({ q_idx, x }) =>
    values[q_idx].flatMap((value, mode_idx) =>
      Number.isNaN(value)
        ? []
        : [{ x, frequency: frequencies[q_idx][mode_idx], value, q_idx, mode_idx }],
    ),
  )
