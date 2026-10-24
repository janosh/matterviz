// Geometry of pressure-temperature phase diagrams: phase regions traced from the coexistence
// lines, nearest-boundary lookup for hover, uncertainty bands and label anchors

import {
  clamp,
  euclidean_dist as dist,
  lerp,
  lerp_vec2,
  point_in_polygon,
  polygon_signed_area,
  segment_intersection_params,
  subtract as sub,
  type Vec2,
} from '#lib/math.js'
import { clip_segment_to_unit_square } from '#lib/plot/core/decorations/index.js'
import { critical_boundaries, pressure_log_floor, pt_data_extent } from './data'
import type { PtPhaseDiagramData, PtRegion } from './types'

// Foot of the perpendicular from `point` onto segment start-end (param in [0, 1])
export function closest_on_segment(
  point: Vec2,
  start: Vec2,
  end: Vec2,
): { param: number; dist: number; foot: Vec2 } {
  const [dx, dy] = sub(end, start)
  const len_sq = dx * dx + dy * dy
  const param =
    len_sq > 0
      ? clamp(((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / len_sq, 0, 1)
      : 0
  const foot = lerp_vec2(start, end, param)
  return { param, dist: dist(point, foot), foot }
}

// Nearest point on any of `lines` (polylines in one coordinate space), null for no segments
export function nearest_on_polylines(
  point: Vec2,
  lines: readonly (readonly Vec2[])[],
): (ReturnType<typeof closest_on_segment> & { line_idx: number; seg_idx: number }) | null {
  let best: ReturnType<typeof nearest_on_polylines> = null
  for (const [line_idx, line] of lines.entries()) {
    for (let seg_idx = 0; seg_idx < line.length - 1; seg_idx++) {
      const hit = closest_on_segment(point, line[seg_idx], line[seg_idx + 1])
      if (!best || hit.dist < best.dist) best = { ...hit, line_idx, seg_idx }
    }
  }
  return best
}

// Per-point value (sigma) linearly interpolated along a polyline segment
export const interpolate_at = (
  values: readonly number[] | undefined,
  seg_idx: number,
  param: number,
): number | null =>
  values ? values[seg_idx] + (values[seg_idx + 1] - values[seg_idx]) * param : null

// === Region derivation ===

// Normalized distance below which two points are one: numerical coincidence, not snapping
const MERGE_EPS = 1e-7
// Faces with a smaller normalized area are numerical slivers, neither regions nor unnamed
const AREA_EPS = 1e-9
const FRAME_TAG = -1

// Segments of the polylines, tagged with their line and segment index
const line_segments = (lines: readonly Vec2[][]) =>
  lines.flatMap((line, line_idx) =>
    line.slice(1).map((end, seg_idx) => ({
      line_idx,
      seg_idx,
      ends: [line[seg_idx], end] as const,
    })),
  )

// Calls `visit` for each pair of segments whose (padded) bounding boxes overlap. Sorted by left
// edge, the inner loop stops at the first box starting right of the current one, so lines
// spread along x don't pay for all S² pairs.
function overlapping_pairs(
  segments: readonly (readonly [Vec2, Vec2])[],
  visit: (idx_a: number, idx_b: number) => void,
): void {
  // [x_min, x_max, y_min, y_max]
  const boxes = segments.map(([start, end]) => [
    Math.min(start[0], end[0]) - 1e-6,
    Math.max(start[0], end[0]) + 1e-6,
    Math.min(start[1], end[1]) - 1e-6,
    Math.max(start[1], end[1]) + 1e-6,
  ])
  const order = boxes
    .map((_, idx) => idx)
    .toSorted((idx_a, idx_b) => boxes[idx_a][0] - boxes[idx_b][0])
  for (let pos_a = 0; pos_a < order.length; pos_a++) {
    const box_a = boxes[order[pos_a]]
    for (let pos_b = pos_a + 1; pos_b < order.length; pos_b++) {
      const box_b = boxes[order[pos_b]]
      if (box_b[0] > box_a[1]) break
      if (box_b[3] >= box_a[2] && box_a[3] >= box_b[2]) visit(order[pos_a], order[pos_b])
    }
  }
}

// [param_a, param_b] pairs where segment a meets segment b: their crossing, and each endpoint
// of one lying on the other (T-junctions, shared ends, collinear overlaps)
function segment_hits(seg_a: readonly [Vec2, Vec2], seg_b: readonly [Vec2, Vec2]): Vec2[] {
  const crossing = segment_intersection_params(seg_a, seg_b)
  const hits: Vec2[] = crossing?.every((param) => param >= 0 && param <= 1) ? [crossing] : []
  const touch_eps = MERGE_EPS / 10
  for (const [param_b, end] of seg_b.entries()) {
    const hit = closest_on_segment(end, ...seg_a)
    if (hit.dist < touch_eps) hits.push([hit.param, param_b])
  }
  for (const [param_a, end] of seg_a.entries()) {
    const hit = closest_on_segment(end, ...seg_b)
    if (hit.dist < touch_eps) hits.push([param_a, hit.param])
  }
  return hits
}

// On or outside the window edge, where clipping ends a line anyway
const on_frame = (point: Vec2): boolean =>
  point.some((coord) => coord <= MERGE_EPS || coord >= 1 - MERGE_EPS)

interface LineEnd {
  line_idx: number
  at_start: boolean
}

// Where separately computed coexistence lines stop is noise: they overshoot or stop short of
// the triple point they share and of the window edge, and noisy ones cross each other several
// times near it. With no distance tolerance, the end of a line nearest its critical point
// stays (where the line really ends), and every other end
// 1. trims back to the farthest crossing with another line on its half of the line (by arc
//    length), cutting the overshoot (any length) and the tangle of noisy crossings with it,
// 2. joins, unless on the window edge, the ends of the other two lines of a phase triangle
//    (a|b, a|c, b|c meet at the a-b-c triple point, of which there is one): all three move to
//    their mean, the tightest triangles first,
// 3. stays if it was trimmed or lies on the window edge or another end (a closed loop), else
//    runs on along its last segment to the first line or window edge it hits (any length).
// The result doesn't depend on the order of the lines. max_gap is the farthest an end moved
// in a join or a run-on that didn't stop at the window edge (unit coordinates).
function join_line_ends(
  unit_lines: readonly Vec2[][],
  pairs: readonly (readonly [string, string])[],
  critical_points: readonly (Vec2 | undefined)[], // per line
): { lines: Vec2[][]; max_gap: number } {
  let lines = unit_lines.map((line) => [...line])
  const ends: LineEnd[] = lines.flatMap((_, line_idx) =>
    [true, false].map((at_start) => ({ line_idx, at_start })),
  )
  const point_of = ({ line_idx, at_start }: LineEnd): Vec2 =>
    lines[line_idx][at_start ? 0 : lines[line_idx].length - 1]
  const set_point = ({ line_idx, at_start }: LineEnd, point: Vec2) => {
    lines[line_idx][at_start ? 0 : lines[line_idx].length - 1] = point
  }
  const critical = new Set(
    lines.flatMap((line, line_idx) => {
      const point = critical_points[line_idx]
      if (!point) return []
      const nearer_end = dist(line[0], point) <= dist(line[line.length - 1], point) ? 0 : 1
      return [ends[2 * line_idx + nearer_end]]
    }),
  )

  // 1. Trim: crossing positions (segment index + param) along each line with any other line
  const crossings: number[][] = lines.map(() => [])
  const segments = line_segments(lines)
  overlapping_pairs(
    segments.map(({ ends: seg_ends }) => seg_ends),
    (idx_a, idx_b) => {
      const [seg_a, seg_b] = [segments[idx_a], segments[idx_b]]
      if (seg_a.line_idx === seg_b.line_idx) return
      for (const [param_a, param_b] of segment_hits(seg_a.ends, seg_b.ends)) {
        crossings[seg_a.line_idx].push(seg_a.seg_idx + param_a)
        crossings[seg_b.line_idx].push(seg_b.seg_idx + param_b)
      }
    },
  )
  const trimmed = new Set<LineEnd>()
  lines = lines.map((line, line_idx) => {
    const [start, end] = [ends[2 * line_idx], ends[2 * line_idx + 1]]
    const last_pos = line.length - 1
    // value at a position (segment index + param) interpolated from per-point values
    const at_pos =
      <T>(values: readonly T[], interp: (from: T, to: T, frac: number) => T) =>
      (pos: number): T => {
        const seg_idx = Math.min(Math.floor(pos), last_pos - 1)
        return interp(values[seg_idx], values[seg_idx + 1], pos - seg_idx)
      }
    const point_at = at_pos(line, lerp_vec2)
    const arc = [0]
    for (let idx = 1; idx <= last_pos; idx++)
      arc.push(arc[idx - 1] + dist(line[idx - 1], line[idx]))
    const arc_at = at_pos(arc, lerp)
    // each crossing belongs to the nearer end, which a critical point keeps from trimming
    const [start_cuts, end_cuts]: number[][] = [[], []]
    for (const pos of crossings[line_idx]) {
      const at_start = arc_at(pos) < arc[last_pos] / 2
      if (!critical.has(at_start ? start : end)) (at_start ? start_cuts : end_cuts).push(pos)
    }
    if (start_cuts.length) trimmed.add(start)
    if (end_cuts.length) trimmed.add(end)
    const from = start_cuts.length ? Math.max(...start_cuts) : 0
    const to = end_cuts.length ? Math.min(...end_cuts) : last_pos
    return [point_at(from), ...line.slice(Math.floor(from) + 1, Math.ceil(to)), point_at(to)]
  })
  const free = ends.filter((end) => !critical.has(end) && !on_frame(point_of(end)))
  let max_gap = 0

  // 2. Join triple points
  const pair_key = (line_idx: number) => pairs[line_idx].toSorted().join(`|`)
  const trios: { trio: LineEnd[]; phases: string; spread: number }[] = []
  for (let idx_a = 0; idx_a < lines.length; idx_a++) {
    for (let idx_b = idx_a + 1; idx_b < lines.length; idx_b++) {
      for (let idx_c = idx_b + 1; idx_c < lines.length; idx_c++) {
        const trio_lines = [idx_a, idx_b, idx_c]
        const phases = new Set(trio_lines.flatMap((line_idx) => pairs[line_idx]))
        if (phases.size !== 3 || new Set(trio_lines.map(pair_key)).size !== 3) continue
        const [ends_a, ends_b, ends_c] = trio_lines.map((line_idx) =>
          free.filter((end) => end.line_idx === line_idx),
        )
        for (const trio of ends_a.flatMap((end_a) =>
          ends_b.flatMap((end_b) => ends_c.map((end_c) => [end_a, end_b, end_c])),
        )) {
          const [pt_a, pt_b, pt_c] = trio.map(point_of)
          trios.push({
            trio,
            phases: [...phases].toSorted().join(`|`),
            spread: dist(pt_a, pt_b) + dist(pt_b, pt_c) + dist(pt_a, pt_c),
          })
        }
      }
    }
  }
  const [joined, joined_phases] = [new Set<LineEnd>(), new Set<string>()]
  for (const { trio, phases } of trios.toSorted(
    (trio_a, trio_b) => trio_a.spread - trio_b.spread,
  )) {
    if (joined_phases.has(phases) || trio.some((end) => joined.has(end))) continue
    joined_phases.add(phases)
    const points = trio.map(point_of)
    const mean = [0, 1].map(
      (axis) => points.reduce((sum, pt) => sum + pt[axis], 0) / 3,
    ) as Vec2
    for (const [idx, end] of trio.entries()) {
      joined.add(end)
      set_point(end, mean)
      max_gap = Math.max(max_gap, dist(points[idx], mean))
    }
  }

  // 3. Extend loose ends, all against the lines as they are now
  const targets = line_segments(lines).map(({ ends: seg_ends }) => seg_ends)
  const extensions = free.flatMap((end) => {
    const point = point_of(end)
    const on_end = ends.some(
      (other) => other !== end && dist(point_of(other), point) <= MERGE_EPS,
    )
    if (trimmed.has(end) || joined.has(end) || on_end) return []
    const line = lines[end.line_idx]
    const prev = (end.at_start ? line.toReversed() : line).findLast(
      (pt) => dist(pt, point) > MERGE_EPS,
    )
    if (!prev) return []
    const dir = sub(point, prev)
    // how far along prev → point (1 at point) the window edge, then the first line ahead, lies
    let reach =
      1 +
      Math.min(
        ...[0, 1].map((axis) =>
          dir[axis] > 0
            ? (1 - point[axis]) / dir[axis]
            : dir[axis] < 0
              ? -point[axis] / dir[axis]
              : Infinity,
        ),
      )
    const min_reach = 1 + MERGE_EPS / Math.hypot(...dir)
    for (const target of targets) {
      const hit = segment_intersection_params([prev, point], target)
      if (hit && hit[0] > min_reach && hit[1] >= 0 && hit[1] <= 1)
        reach = Math.min(reach, hit[0])
    }
    return [{ end, to: lerp_vec2(prev, point, reach) }]
  })
  // extensions that cross each other (lines converging outside the data) stop where they
  // first meet, all measured on the full extensions
  const ext_segs = extensions.map(({ end, to }) => [point_of(end), to] as const)
  ext_segs.forEach((seg_a, idx_a) => {
    const stop = Math.min(
      1,
      ...ext_segs.flatMap((seg_b, idx_b) =>
        idx_b === idx_a
          ? []
          : segment_hits(seg_a, seg_b).flatMap(([param]) => (param > 0 ? [param] : [])),
      ),
    )
    const { line_idx, at_start } = extensions[idx_a].end
    const to = lerp_vec2(...seg_a, stop)
    if (!on_frame(to)) max_gap = Math.max(max_gap, dist(seg_a[0], to))
    lines[line_idx] = at_start ? [to, ...lines[line_idx]] : [...lines[line_idx], to]
  })
  return { lines, max_gap }
}

interface Segment {
  start: Vec2
  end: Vec2
  tag: number // boundary index, FRAME_TAG for the window edge
}

// Split every segment where it meets another (crossings, T-junctions, shared ends) and
// return the vertices plus the deduplicated edges between them
function node_segments(segments: Segment[]): {
  vertices: Vec2[]
  edges: Vec2[]
  tags: number[]
} {
  const params = segments.map(() => [0, 1])
  const seg_ends = segments.map(({ start, end }) => [start, end] as const)
  overlapping_pairs(seg_ends, (idx_a, idx_b) => {
    for (const [param_a, param_b] of segment_hits(seg_ends[idx_a], seg_ends[idx_b])) {
      if (param_a > 0 && param_a < 1) params[idx_a].push(param_a)
      if (param_b > 0 && param_b < 1) params[idx_b].push(param_b)
    }
  })

  const vertices: Vec2[] = []
  const grid = new Map<string, number[]>()
  const vertex_id = (point: Vec2): number => {
    const [cell_x, cell_y] = [
      Math.round(point[0] / MERGE_EPS),
      Math.round(point[1] / MERGE_EPS),
    ]
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const hit = grid
          .get(`${cell_x + dx},${cell_y + dy}`)
          ?.find((vertex_idx) => dist(vertices[vertex_idx], point) <= MERGE_EPS)
        if (hit !== undefined) return hit
      }
    }
    const key = `${cell_x},${cell_y}`
    grid.set(key, [...(grid.get(key) ?? []), vertices.length])
    vertices.push(point)
    return vertices.length - 1
  }

  const edge_tags = new Map<string, number>()
  segments.forEach(({ start, end, tag }, seg_idx) => {
    const ids = params[seg_idx]
      .toSorted((param_a, param_b) => param_a - param_b)
      .map((param) => vertex_id(lerp_vec2(start, end, param)))
    for (let idx = 0; idx < ids.length - 1; idx++) {
      const [from, to] = [ids[idx], ids[idx + 1]]
      if (from === to) continue
      const key = from < to ? `${from},${to}` : `${to},${from}`
      // a boundary running along the window edge keeps its boundary tag
      const prev = edge_tags.get(key)
      if (prev === undefined || prev === FRAME_TAG) edge_tags.set(key, tag)
    }
  })
  const entries = [...edge_tags]
  return {
    vertices,
    edges: entries.map(([key]) => key.split(`,`).map(Number) as Vec2),
    tags: entries.map(([, tag]) => tag),
  }
}

// Phase stability fields traced from the coexistence lines: the boundaries (minus metastable
// ones, their ends joined by join_line_ends) and the plotted window split the plane into
// faces, and each face takes the phase shared by all the boundaries around it, or failing that
// the phase across a boundary from an already named neighbor. Every boundary must then
// separate exactly its two phases; a face named against that (a missing or metastable line
// merged two fields) loses its name, as does a face holding a dangling line (liquid and gas
// joined around a critical point) or an island loop. `unlabeled` counts the unnamed faces so
// callers can say when to pass explicit regions, `max_gap` how far (as a fraction of the window)
// joining moved a line end. Regions are sorted largest first, the paint
// order. With log_pressure, lines are joined in log10(P) to match a log axis; P <= 0 maps far
// below the window and is clipped away with everything else outside it.
export function derive_regions(
  data: PtPhaseDiagramData,
  { log_pressure = false }: { log_pressure?: boolean } = {},
): { regions: PtRegion[]; unlabeled: number; max_gap: number } {
  const [p_range, [t_min, t_max]] = pt_data_extent(data)
  const p_floor = log_pressure ? pressure_log_floor(data) : null
  if (log_pressure && p_floor === null) {
    throw new Error(`log pressure needs positive pressures spanning a range`)
  }
  const log_floor = Math.log10(p_floor ?? 1)
  const p_fwd = (pressure: number): number =>
    !log_pressure ? pressure : pressure > 0 ? Math.log10(pressure) : log_floor - 6
  const p_inv = (value: number) => (log_pressure ? 10 ** value : value)
  const p_min = log_pressure ? log_floor : p_range[0]
  const p_max = p_fwd(p_range[1])
  const [p_span, t_span] = [p_max - p_min, t_max - t_min]
  const to_unit = ([pressure, temp]: Vec2): Vec2 => [
    (p_fwd(pressure) - p_min) / p_span,
    (temp - t_min) / t_span,
  ]
  const from_unit = ([coord_u, coord_v]: Vec2): Vec2 => [
    p_inv(p_min + coord_u * p_span),
    t_min + coord_v * t_span,
  ]
  const stable_tags = data.boundaries.flatMap((boundary, tag) =>
    boundary.metastable ? [] : [tag],
  )
  const phases_of = (tag: number) => (tag === FRAME_TAG ? null : data.boundaries[tag].phases)
  const critical_at = new Map(
    (data.special_points ?? []).flatMap((point) =>
      point.type === `critical`
        ? critical_boundaries(point, data.boundaries).map((line) => [line, point.position])
        : [],
    ),
  )
  const { lines, max_gap } = join_line_ends(
    stable_tags.map((tag) => data.boundaries[tag].points.map(to_unit)),
    stable_tags.map((tag) => data.boundaries[tag].phases),
    stable_tags.map((tag) => {
      const critical = critical_at.get(data.boundaries[tag])
      return critical && to_unit(critical)
    }),
  )
  const corners: Vec2[] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]
  const segments: Segment[] = corners.map((corner, idx) => ({
    start: corner,
    end: corners[(idx + 1) % 4],
    tag: FRAME_TAG,
  }))
  lines.forEach((line, line_idx) => {
    for (let idx = 0; idx < line.length - 1; idx++) {
      const [from, to] = [line[idx], line[idx + 1]]
      const clipped = clip_segment_to_unit_square(
        { x: from[0], y: from[1] },
        { x: to[0], y: to[1] },
      )?.map(({ x: coord_u, y: coord_v }): Vec2 => [coord_u, coord_v])
      if (clipped && dist(clipped[0], clipped[1]) > MERGE_EPS) {
        segments.push({ start: clipped[0], end: clipped[1], tag: stable_tags[line_idx] })
      }
    }
  })

  const { vertices, edges, tags } = node_segments(segments)

  // Half-edge 2e runs edges[e][0] → edges[e][1], 2e + 1 back; twin = h ^ 1
  const origin = (half: number) => edges[half >> 1][half & 1]
  const target = (half: number) => edges[half >> 1][1 - (half & 1)]
  const outgoing: number[][] = vertices.map(() => [])
  for (let half = 0; half < edges.length * 2; half++) outgoing[origin(half)].push(half)
  const angle = (half: number) => {
    const [dx, dy] = sub(vertices[target(half)], vertices[origin(half)])
    return Math.atan2(dy, dx)
  }
  const slot = new Map<number, number>()
  for (const list of outgoing) {
    list.sort((half_a, half_b) => angle(half_a) - angle(half_b))
    list.forEach((half, idx) => slot.set(half, idx))
  }
  // Turn to the outgoing edge clockwise of the twin: faces run CCW with the face on the left
  const next = (half: number): number => {
    const list = outgoing[target(half)]
    const twin_slot = slot.get(half ^ 1) ?? 0
    return list[(twin_slot - 1 + list.length) % list.length]
  }

  const face_of = new Int32Array(edges.length * 2).fill(-1)
  const faces: { halves: number[]; vertices: Vec2[]; area: number }[] = []
  for (let start = 0; start < edges.length * 2; start++) {
    if (face_of[start] !== -1) continue
    const halves: number[] = []
    let half = start
    do {
      face_of[half] = faces.length
      halves.push(half)
      half = next(half)
    } while (half !== start && halves.length <= edges.length * 2)
    const loop = halves.map((member) => vertices[origin(member)])
    faces.push({ halves, vertices: loop, area: polygon_signed_area(loop) })
  }
  const bounded = (face_idx: number) => faces[face_idx].area > AREA_EPS

  const labels: (string | null | undefined)[] = faces.map((face, face_idx) => {
    if (!bounded(face_idx)) return null // outer face or sliver
    let domain: string[] | null = null
    for (const half of face.halves) {
      const pair = phases_of(tags[half >> 1])
      if (!pair) continue
      if (face_of[half ^ 1] === face_of[half]) return null // dangling line: two phases
      domain = domain ? domain.filter((phase) => pair.includes(phase)) : [...pair]
    }
    if (!domain) return data.phases.length === 1 ? data.phases[0].id : null
    if (domain.length === 0) return null
    return domain.length === 1 ? domain[0] : undefined // undefined: decided by neighbors
  })
  // A component touching nothing else leaves the face around it holding two phases: a free
  // line traces a zero-area face of its own, a closed loop (an island) a clockwise hole cycle
  // that the face around it doesn't exclude
  faces.forEach((face, face_idx) => {
    if (face.halves.some((half) => tags[half >> 1] === FRAME_TAG)) return // the outer face
    const free_line =
      !bounded(face_idx) && face.halves.every((half) => face_of[half ^ 1] === face_idx)
    if (!free_line && face.area >= -AREA_EPS) return
    // probe from a vertex of the component, skipping the faces it borders (an island's own
    // inside contains that vertex as well)
    const [probe_x, probe_y] = face.vertices[0]
    const bordering = new Set(face.halves.map((half) => face_of[half ^ 1]))
    const around = faces
      .flatMap((other, other_idx) =>
        bounded(other_idx) &&
        !bordering.has(other_idx) &&
        point_in_polygon(probe_x, probe_y, other.vertices)
          ? [{ other_idx, area: other.area }]
          : [],
      )
      .toSorted((hit_a, hit_b) => hit_a.area - hit_b.area)[0]
    if (around) labels[around.other_idx] = null
  })
  for (let changed = true; changed;) {
    changed = false
    faces.forEach((face, face_idx) => {
      if (labels[face_idx] !== undefined) return
      const votes = new Set<string>()
      for (const half of face.halves) {
        const pair = phases_of(tags[half >> 1])
        const across = labels[face_of[half ^ 1]]
        if (pair && typeof across === `string` && pair.includes(across)) {
          votes.add(pair[0] === across ? pair[1] : pair[0])
        }
      }
      if (votes.size === 1) {
        labels[face_idx] = [...votes][0]
        changed = true
      }
    })
  }
  // Each boundary edge must separate its two phases: unname faces that contradict that
  for (let changed = true; changed;) {
    changed = false
    for (let half = 0; half < edges.length * 2; half++) {
      const pair = phases_of(tags[half >> 1])
      const [face, across] = [face_of[half], face_of[half ^ 1]]
      const [label, across_label] = [labels[face], labels[across]]
      if (!pair || face === across || typeof label !== `string`) continue
      if (!pair.includes(label) || label === across_label) {
        labels[face] = null
        if (label === across_label) labels[across] = null
        changed = true
      }
    }
  }

  const regions = faces
    .flatMap((face, face_idx) => {
      const phase = labels[face_idx]
      return typeof phase === `string` ? [{ phase, face }] : []
    })
    .toSorted((hit_a, hit_b) => hit_b.face.area - hit_a.face.area)
    .map(({ phase, face }) => ({ phase, vertices: face.vertices.map(from_unit) }))
  const unlabeled = faces.filter(
    (_, face_idx) => bounded(face_idx) && typeof labels[face_idx] !== `string`,
  ).length
  return { regions, unlabeled, max_gap }
}

// === Uncertainty ===

// Signed [x, y] pixel moves of a point under +sigma and -sigma. They differ on a log axis,
// where the band is asymmetric.
export interface PixelSigma {
  plus: Vec2
  minus: Vec2
}

// Closed band around a pixel-space polyline: each point moves along its normal on both sides
// by max(σx |nx|, σy |ny|), so a temperature error widens a shallow boundary and a pressure
// error a steep one. The max, not a quadrature sum: on a free-energy crossing both errors
// project one uncertainty (σT = σΔG / |ΔS|, σP = σΔG / |ΔV|, so σT / σP = |dT/dP|), which
// shifts the line by the same normal distance either way.
export function uncertainty_band(
  pixels: readonly Vec2[],
  deltas: readonly PixelSigma[],
): Vec2[] {
  // Central-difference normals; repeated points borrow the nearest defined one
  const normals = pixels.map((_, idx): Vec2 | null => {
    const [dx, dy] = sub(
      pixels[Math.min(pixels.length - 1, idx + 1)],
      pixels[Math.max(0, idx - 1)],
    )
    const len = Math.hypot(dx, dy)
    return len > 0 ? [-dy / len, dx / len] : null
  })
  const normal_at = (idx: number): Vec2 => {
    for (let offset = 0; offset < normals.length; offset++) {
      const found = normals[idx + offset] ?? normals[idx - offset]
      if (found) return found
    }
    return [0, 0]
  }
  const upper: Vec2[] = []
  const lower: Vec2[] = []
  pixels.forEach((point, idx) => {
    const { plus, minus } = deltas[idx]
    for (const side of [1, -1]) {
      const dir = normal_at(idx).map((comp) => comp * side) as Vec2
      // per axis, the move (+sigma or -sigma) that points the same way as this side
      const [reach_x, reach_y] = [0, 1].map((axis) =>
        Math.abs(Math.sign(dir[axis]) === Math.sign(plus[axis]) ? plus[axis] : minus[axis]),
      )
      const reach = Math.max(reach_x * Math.abs(dir[0]), reach_y * Math.abs(dir[1]))
      ;(side === 1 ? upper : lower).push([
        point[0] + dir[0] * reach,
        point[1] + dir[1] * reach,
      ])
    }
  })
  return [...upper, ...lower.toReversed()]
}

// === Labels ===

// Sutherland-Hodgman clip of a polygon to an axis-aligned rectangle
export function clip_polygon_to_rect(
  vertices: readonly Vec2[],
  [x_min, y_min, x_max, y_max]: [number, number, number, number],
): Vec2[] {
  // [axis, bound, side]: a point is inside when side * (point[axis] - bound) >= 0
  const half_planes: [0 | 1, number, 1 | -1][] = [
    [0, x_min, 1],
    [0, x_max, -1],
    [1, y_min, 1],
    [1, y_max, -1],
  ]
  let output = [...vertices]
  for (const [axis, bound, side] of half_planes) {
    const inside = (point: Vec2) => side * (point[axis] - bound) >= 0
    const cut = (from: Vec2, to: Vec2): Vec2 =>
      lerp_vec2(from, to, (bound - from[axis]) / (to[axis] - from[axis]))
    const input = output
    output = []
    input.forEach((current, idx) => {
      const prev = input[(idx + input.length - 1) % input.length]
      if (inside(current) !== inside(prev)) output.push(cut(prev, current))
      if (inside(current)) output.push(current)
    })
  }
  return output
}
