// Geometry of pressure-temperature phase diagrams: phase regions traced from the coexistence
// lines, nearest-boundary lookup for hover, uncertainty bands and label anchors

import { clamp, point_in_polygon, polygon_signed_area, type Vec2 } from '#lib/math.js'
import { clip_segment_to_unit_square } from '#lib/plot/core/decorations/index.js'
import { pressure_log_floor, pt_data_extent } from './data'
import type { PtPhaseDiagramData, PtRegion } from './types'

// Endpoints closer than this (fraction of the plotted window) to another line, another
// endpoint or the window edge are joined to it, and dangling stubs shorter than it dropped:
// separately computed boundaries rarely meet at exactly the same triple point
export const SNAP_TOL = 0.01
// Normalized distance below which two noded vertices are one
const MERGE_EPS = 1e-7
// Faces with a smaller normalized area are slivers left by snapping
const AREA_EPS = 1e-9
const FRAME_TAG = -1

const sub = (pt_a: Vec2, pt_b: Vec2): Vec2 => [pt_a[0] - pt_b[0], pt_a[1] - pt_b[1]]
const cross = (vec_a: Vec2, vec_b: Vec2): number => vec_a[0] * vec_b[1] - vec_a[1] * vec_b[0]
const dist = (pt_a: Vec2, pt_b: Vec2): number =>
  Math.hypot(pt_a[0] - pt_b[0], pt_a[1] - pt_b[1])

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
  const foot: Vec2 = [start[0] + param * dx, start[1] + param * dy]
  return { param, dist: dist(point, foot), foot }
}

// Nearest point on any of `lines` (polylines in one coordinate space), null for no segments
export function nearest_on_polylines(
  point: Vec2,
  lines: readonly (readonly Vec2[])[],
): (ReturnType<typeof closest_on_segment> & { line_idx: number; seg_idx: number }) | null {
  let best:
    | (ReturnType<typeof closest_on_segment> & { line_idx: number; seg_idx: number })
    | null = null
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

// Nearest point on the unit square's edges when within `tol` (and not past a corner by more)
function snap_to_frame(point: Vec2, tol: number): Vec2 | null {
  const [coord_u, coord_v] = point
  if (coord_u < -tol || coord_u > 1 + tol || coord_v < -tol || coord_v > 1 + tol) return null
  const options: [number, Vec2][] = [
    [Math.abs(coord_u), [0, clamp(coord_v, 0, 1)]],
    [Math.abs(1 - coord_u), [1, clamp(coord_v, 0, 1)]],
    [Math.abs(coord_v), [clamp(coord_u, 0, 1), 0]],
    [Math.abs(1 - coord_v), [clamp(coord_u, 0, 1), 1]],
  ]
  const [gap, foot] = options.reduce((best, opt) => (opt[0] < best[0] ? opt : best))
  return gap <= tol ? foot : null
}

// Join loose ends: endpoints of different lines chained within `tol` of each other merge to
// their mean (triple points; transitive, so the result doesn't depend on line order), then
// each remaining end snaps onto a nearby line or the window edge
function snap_endpoints(lines: Vec2[][], tol: number): Vec2[][] {
  const snapped = lines.map((line) => line.map((point): Vec2 => [...point]))
  const ends = snapped.flatMap((line, line_idx) => [
    { line_idx, point_idx: 0 },
    { line_idx, point_idx: line.length - 1 },
  ])
  const end_point = (idx: number) => snapped[ends[idx].line_idx][ends[idx].point_idx]
  const parent = ends.map((_, idx) => idx)
  const root = (idx: number): number =>
    parent[idx] === idx ? idx : (parent[idx] = root(parent[idx]))
  for (let idx_a = 0; idx_a < ends.length; idx_a++) {
    for (let idx_b = idx_a + 1; idx_b < ends.length; idx_b++) {
      if (ends[idx_a].line_idx === ends[idx_b].line_idx) continue
      if (dist(end_point(idx_a), end_point(idx_b)) <= tol) parent[root(idx_a)] = root(idx_b)
    }
  }
  const clusters = new Map<number, number[]>()
  ends.forEach((_, idx) => clusters.set(root(idx), [...(clusters.get(root(idx)) ?? []), idx]))
  const loose: number[] = []
  for (const members of clusters.values()) {
    if (members.length < 2) {
      loose.push(...members)
      continue
    }
    const points = members.map(end_point)
    const mean = [0, 1].map(
      (axis) => points.reduce((sum, point) => sum + point[axis], 0) / points.length,
    ) as Vec2
    const target = snap_to_frame(mean, tol) ?? mean
    for (const member of members) {
      const { line_idx, point_idx } = ends[member]
      snapped[line_idx][point_idx] = [...target]
    }
  }
  for (const idx of loose) {
    const { line_idx: own_line, point_idx } = ends[idx]
    const point = end_point(idx)
    const hit = nearest_on_polylines(
      point,
      snapped.map((line, line_idx) => (line_idx === own_line ? [] : line)),
    )
    const on_line = hit && hit.dist <= tol ? hit : null
    const on_frame = snap_to_frame(point, tol)
    const target =
      on_frame && (!on_line || dist(point, on_frame) <= on_line.dist)
        ? on_frame
        : on_line?.foot
    if (target) snapped[own_line][point_idx] = [...target]
  }
  return snapped
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
  const touch_eps = MERGE_EPS / 10
  const params = segments.map(() => [0, 1])
  // [axis][min, max] per segment, padded so touching segments still overlap
  const boxes = segments.map(({ start, end }) =>
    [0, 1].map((axis) => [
      Math.min(start[axis], end[axis]) - 1e-6,
      Math.max(start[axis], end[axis]) + 1e-6,
    ]),
  )
  const apart = (idx_a: number, idx_b: number) =>
    [0, 1].some(
      (axis) =>
        boxes[idx_a][axis][1] < boxes[idx_b][axis][0] ||
        boxes[idx_b][axis][1] < boxes[idx_a][axis][0],
    )
  for (let idx_a = 0; idx_a < segments.length; idx_a++) {
    const seg_a = segments[idx_a]
    for (let idx_b = idx_a + 1; idx_b < segments.length; idx_b++) {
      const seg_b = segments[idx_b]
      if (apart(idx_a, idx_b)) continue
      const dir_a = sub(seg_a.end, seg_a.start)
      const dir_b = sub(seg_b.end, seg_b.start)
      const denom = cross(dir_a, dir_b)
      if (Math.abs(denom) > 1e-14) {
        const offset = sub(seg_b.start, seg_a.start)
        const param_a = cross(offset, dir_b) / denom
        const param_b = cross(offset, dir_a) / denom
        if (param_a > 0 && param_a < 1 && param_b > 0 && param_b < 1) {
          params[idx_a].push(param_a)
          params[idx_b].push(param_b)
        }
      }
      // Endpoints lying on the other segment: T-junctions and collinear overlaps
      for (const [from, onto] of [
        [idx_b, idx_a],
        [idx_a, idx_b],
      ]) {
        for (const point of [segments[from].start, segments[from].end]) {
          const hit = closest_on_segment(point, segments[onto].start, segments[onto].end)
          if (hit.dist < touch_eps && hit.param > 0 && hit.param < 1) {
            params[onto].push(hit.param)
          }
        }
      }
    }
  }

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
      .map((param) =>
        vertex_id([
          start[0] + param * (end[0] - start[0]),
          start[1] + param * (end[1] - start[1]),
        ]),
      )
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

// Drop dangling chains shorter than `min_len`: overshoots past a triple point. Longer ones
// (a coexistence line ending at a critical point) stay.
function prune_stubs(
  { vertices, edges, tags }: ReturnType<typeof node_segments>,
  min_len: number,
): { edges: Vec2[]; tags: number[] } {
  const alive = edges.map(() => true)
  const incident: number[][] = vertices.map(() => [])
  edges.forEach(([from, to], edge_idx) => {
    incident[from].push(edge_idx)
    incident[to].push(edge_idx)
  })
  const live_edges = (vertex: number) => incident[vertex].filter((edge) => alive[edge])
  let changed = true
  while (changed) {
    changed = false
    for (let leaf = 0; leaf < vertices.length; leaf++) {
      if (live_edges(leaf).length !== 1) continue
      const chain: number[] = []
      let [current, prev_edge, length] = [leaf, -1, 0]
      while (length < min_len) {
        const next = live_edges(current).filter((edge) => edge !== prev_edge)
        if ((current !== leaf && next.length !== 1) || next.length === 0) break
        const [edge] = next
        chain.push(edge)
        const [from, to] = edges[edge]
        length += dist(vertices[from], vertices[to])
        current = from === current ? to : from
        prev_edge = edge
      }
      if (length < min_len && chain.length) {
        for (const edge of chain) alive[edge] = false
        changed = true
      }
    }
  }
  return {
    edges: edges.filter((_, idx) => alive[idx]),
    tags: tags.filter((_, idx) => alive[idx]),
  }
}

// Phase stability fields traced from the coexistence lines: the boundaries (minus metastable
// ones) and the plotted window split the plane into faces, and each face takes the phase
// shared by all the boundaries around it, or failing that the phase across a boundary from
// an already named neighbor. Every boundary must then separate exactly its two phases; a face
// named against that (a missing or metastable line merged two fields) loses its name, as does
// a face holding a dangling or free-floating line (liquid and gas joined around a critical
// point) or an island loop. `unlabeled` counts the unnamed faces so callers can say when to
// pass explicit regions. Regions are sorted largest first, the paint order.
// With log_pressure, lines are joined in log10(P) so snapping matches a log axis; P <= 0 maps
// far below the window and is clipped away with everything else outside it.
export function derive_regions(
  data: PtPhaseDiagramData,
  {
    snap_tol = SNAP_TOL,
    log_pressure = false,
  }: { snap_tol?: number; log_pressure?: boolean } = {},
): { regions: PtRegion[]; unlabeled: number } {
  const [p_range, [t_min, t_max]] = pt_data_extent(data)
  const p_floor = log_pressure ? pressure_log_floor(data) : null
  if (log_pressure && p_floor === null) {
    throw new Error(`log pressure needs a positive pressure in the data or pressure_range`)
  }
  const log_floor = Math.log10(p_floor ?? 1)
  const p_fwd = (pressure: number): number =>
    !log_pressure ? pressure : pressure > 0 ? Math.log10(pressure) : log_floor - 6
  const p_inv = (value: number) => (log_pressure ? 10 ** value : value)
  const p_min = log_pressure ? Math.max(p_fwd(p_range[0]), log_floor) : p_range[0]
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
  const lines = snap_endpoints(
    stable_tags.map((tag) => data.boundaries[tag].points.map(to_unit)),
    snap_tol,
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

  const noded = node_segments(segments)
  const { vertices } = noded
  const { edges, tags } = prune_stubs(noded, snap_tol)

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
  // Snapping slivers (under 0.01% of the window) don't count as missing fields
  const unlabeled = faces.filter(
    (face, face_idx) => face.area > 1e-4 && typeof labels[face_idx] !== `string`,
  ).length
  return { regions, unlabeled }
}

// === Uncertainty ===

// Signed [x, y] pixel moves of a point under +sigma and -sigma. They differ on a log axis,
// where the band is asymmetric.
export interface PixelSigma {
  plus: Vec2
  minus: Vec2
}

// Closed band around a pixel-space polyline: each point moves along its normal on both sides
// by the reach of its error ellipse in that direction, sqrt((σx nx)² + (σy ny)²), so a
// temperature error widens a shallow boundary and a pressure error a steep one
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
      const reach = Math.hypot(reach_x * dir[0], reach_y * dir[1])
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
    const cut = (from: Vec2, to: Vec2): Vec2 => {
      const frac = (bound - from[axis]) / (to[axis] - from[axis])
      return [from[0] + frac * (to[0] - from[0]), from[1] + frac * (to[1] - from[1])]
    }
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
