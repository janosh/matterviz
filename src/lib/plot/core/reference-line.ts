// Reference line utilities: helper functions and coordinate resolution
import type { Vec2, Vec4 } from '$lib/math'
import {
  decoration_placement_rects,
  get_decoration_placement,
  solve_decorations,
  type DecorationPoint,
  type DecorationScene,
  type DecorationSolution,
  type ReferenceAnnotationBaseline,
  type ReferenceAnnotationCandidate,
  type ReferenceAnnotationDecorationItem,
  type ReferenceAnnotationPosition,
  type ReferenceAnnotationSide,
  type ReferenceAnnotationTextAnchor,
} from '$lib/plot/core/decorations'
import type { Rect } from '$lib/plot/core/layout'
import type {
  LayerZIndex,
  RefLine,
  RefLineAnnotation,
  RefLineValue,
} from '$lib/plot/core/types'
import {
  measure_text_line,
  resolve_font_size_css,
  resolve_font_spec,
} from '$lib/plot/core/text-metrics'

export type IndexedRefLine = RefLine & { idx: number }
export type ReferenceLineRanges = { x: Vec2; x2?: Vec2; y: Vec2; y2?: Vec2 }
export type ReferenceLineScales = {
  x: (val: number) => number
  x2?: (val: number) => number
  y: (val: number) => number
  y2?: (val: number) => number
}

const reference_annotation_id = (line_idx: number): string =>
  `reference-annotation-${line_idx}`

// Create indexed ref_lines, filtering out invisible ones
export const index_ref_lines = (ref_lines: RefLine[] | undefined): IndexedRefLine[] =>
  (ref_lines ?? [])
    .filter((line) => line.visible !== false)
    .map((line, idx) => ({ ...line, idx }))

// Z-index groups for ordered rendering
interface RefLinesByZIndex {
  below_grid: IndexedRefLine[]
  below_lines: IndexedRefLine[]
  below_points: IndexedRefLine[]
  above_all: IndexedRefLine[]
}

// Map z-index type values to object keys
const Z_INDEX_KEY_MAP: Record<LayerZIndex, keyof RefLinesByZIndex> = {
  'below-grid': `below_grid`,
  'below-lines': `below_lines`,
  'below-points': `below_points`,
  'above-all': `above_all`,
}

const apply_span = (
  start_val: number,
  end_val: number,
  span?: [number | null, number | null],
): Vec2 => {
  if (!span) return [start_val, end_val]
  return [
    span[0] !== null ? Math.max(start_val, span[0]) : start_val,
    span[1] !== null ? Math.min(end_val, span[1]) : end_val,
  ]
}

// Group indexed ref_lines by z-index for ordered rendering
export function group_ref_lines_by_z(lines: IndexedRefLine[]): RefLinesByZIndex {
  const groups: RefLinesByZIndex = {
    below_grid: [],
    below_lines: [],
    below_points: [],
    above_all: [],
  }
  for (const line of lines) {
    const key = Z_INDEX_KEY_MAP[line.z_index ?? `below-lines`]
    groups[key].push(line)
  }
  return groups
}

// Convert RefLineValue (number | Date | string) to a finite number. Strings may be numeric
// ("42", "-5") or ISO dates ("2024-06-15"). Anything else is a caller bug: drawing such a
// line at 0 would silently mislabel the data, so it throws instead.
export function normalize_value(value: RefLineValue): number {
  let numeric = NaN
  if (typeof value === `number`) numeric = value
  else if (value instanceof Date) numeric = value.getTime()
  // Number("") is 0, so blank strings stay NaN instead of reaching numeric conversion
  else if (value.trim() !== ``) {
    numeric = Number.isFinite(Number(value)) ? Number(value) : Date.parse(value)
  }
  if (Number.isFinite(numeric)) return numeric
  throw new TypeError(`Invalid reference line value: ${String(value)}`)
}

// Normalize a point tuple
export const normalize_point = (point: [RefLineValue, RefLineValue]): Vec2 => [
  normalize_value(point[0]),
  normalize_value(point[1]),
]

// Clip a line segment to a rectangle using Liang-Barsky algorithm
// Returns clipped [x1, y1, x2, y2] or null if segment is entirely outside
function clip_segment_to_rect(
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  x_min: number,
  x_max: number,
  y_min: number,
  y_max: number,
): Vec4 | null {
  const dx = p2x - p1x
  const dy = p2y - p1y

  // p values represent the direction, q values the signed distance to boundary
  // Boundaries: left (x_min), right (x_max), bottom (y_min), top (y_max)
  const p_vals = [-dx, dx, -dy, dy]
  const q_vals = [p1x - x_min, x_max - p1x, p1y - y_min, y_max - p1y]

  let [t_enter, t_leave] = [0, 1]

  for (let idx = 0; idx < 4; idx++) {
    if (p_vals[idx] === 0) {
      // Line parallel to boundary
      if (q_vals[idx] < 0) return null // Outside and parallel - no intersection
    } else {
      const t_val = q_vals[idx] / p_vals[idx]
      // Entering boundary
      if (p_vals[idx] < 0) t_enter = Math.max(t_enter, t_val)
      // Leaving boundary
      else t_leave = Math.min(t_leave, t_val)
    }
  }

  if (t_enter > t_leave) return null // Segment entirely outside

  return [p1x + t_enter * dx, p1y + t_enter * dy, p1x + t_leave * dx, p1y + t_leave * dy]
}

// Compute the screen coordinates for a reference line
// Returns [x1, y1, x2, y2] in pixel coordinates, or null if line is not visible
export function resolve_line_endpoints(
  ref_line: RefLine,
  bounds: { x_min: number; x_max: number; y_min: number; y_max: number },
  scales: {
    x_scale: (val: number) => number
    x2_scale?: (val: number) => number
    y_scale: (val: number) => number
    y2_scale?: (val: number) => number
  },
): Vec4 | null {
  const { x_min, x_max, y_min, y_max } = bounds
  const { x_scale, x2_scale, y_scale, y2_scale } = scales
  // Determine which scales to use based on axis assignment
  const active_x_scale = ref_line.x_axis === `x2` && x2_scale ? x2_scale : x_scale
  const active_y_scale = ref_line.y_axis === `y2` && y2_scale ? y2_scale : y_scale

  // Check if value is within plot bounds (for visibility)
  const is_x_visible = (x_val: number): boolean => x_val >= x_min && x_val <= x_max
  const is_y_visible = (y_val: number): boolean => y_val >= y_min && y_val <= y_max

  // Apply span constraints (works for both x and y)
  const apply_x_span = (x1: number, x2: number) => apply_span(x1, x2, ref_line.x_span)
  const apply_y_span = (y1: number, y2: number) => apply_span(y1, y2, ref_line.y_span)

  // Relative to data coordinate conversion
  const to_data_x = (rel: number): number => x_min + rel * (x_max - x_min)
  const to_data_y = (rel: number): number => y_min + rel * (y_max - y_min)

  let [x1_data, x2_data] = [0, 0]
  let [y1_data, y2_data] = [0, 0]

  const line_type = ref_line.type

  if (line_type === `horizontal`) {
    const y_val = normalize_value(ref_line.y)
    const y_coord = ref_line.coord_mode === `relative` ? to_data_y(y_val) : y_val
    if (!is_y_visible(y_coord)) return null
    ;[x1_data, x2_data] = apply_x_span(x_min, x_max)
    y1_data = y_coord
    y2_data = y_coord
  } else if (line_type === `vertical`) {
    const x_val = normalize_value(ref_line.x)
    const x_coord = ref_line.coord_mode === `relative` ? to_data_x(x_val) : x_val
    if (!is_x_visible(x_coord)) return null
    x1_data = x_coord
    x2_data = x_coord
    ;[y1_data, y2_data] = apply_y_span(y_min, y_max)
  } else if (line_type === `diagonal` || line_type === `line`) {
    // Get slope/intercept - either from props or computed from points
    let slope: number
    let intercept: number
    let handled_as_vertical = false

    if (ref_line.type === `diagonal`) {
      slope = ref_line.slope
      intercept = ref_line.intercept
    } else {
      const [p1x, p1y] = normalize_point(ref_line.p1)
      const [p2x, p2y] = normalize_point(ref_line.p2)
      const dx = p2x - p1x
      if (Math.abs(dx) < 1e-10) {
        // Nearly vertical line - check x-bounds like we do for vertical type
        if (!is_x_visible(p1x)) return null
        x1_data = p1x
        x2_data = p1x
        ;[y1_data, y2_data] = apply_y_span(y_min, y_max)
        handled_as_vertical = true
        slope = 0 // Won't be used
        intercept = 0
      } else {
        slope = (p2y - p1y) / dx
        intercept = p1y - slope * p1x
      }
    }

    if (!handled_as_vertical) {
      // Intersect bounds with span constraints, then clip the line segment spanning the
      // clipped x-extent to that rect — keeps endpoints paired on y = slope·x + intercept
      const [x_lo, x_hi] = apply_x_span(x_min, x_max)
      const [y_lo, y_hi] = apply_y_span(y_min, y_max)
      if (x_lo > x_hi || y_lo > y_hi) return null
      const [y_at_lo, y_at_hi] = [slope * x_lo + intercept, slope * x_hi + intercept]
      const seg = clip_segment_to_rect(x_lo, y_at_lo, x_hi, y_at_hi, x_lo, x_hi, y_lo, y_hi)
      // Degenerate (single-point) result means the line only grazes a corner
      if (!seg || (seg[0] === seg[2] && seg[1] === seg[3])) return null
      ;[x1_data, y1_data, x2_data, y2_data] = seg
    }
  } else if (line_type === `segment`) {
    const [p1x, p1y] = normalize_point(ref_line.p1)
    const [p2x, p2y] = normalize_point(ref_line.p2)
    // Spans narrow the visible rect like every other line type; they never widen it
    const [clip_x_min, clip_x_max] = apply_x_span(x_min, x_max)
    const [clip_y_min, clip_y_max] = apply_y_span(y_min, y_max)
    const clipped = clip_segment_to_rect(
      p1x,
      p1y,
      p2x,
      p2y,
      clip_x_min,
      clip_x_max,
      clip_y_min,
      clip_y_max,
    )
    if (!clipped) return null
    ;[x1_data, y1_data, x2_data, y2_data] = clipped
  } else {
    return null
  }

  const pixels: Vec4 = [
    active_x_scale(x1_data),
    active_y_scale(y1_data),
    active_x_scale(x2_data),
    active_y_scale(y2_data),
  ]
  return pixels.every(Number.isFinite) ? pixels : null
}

interface AnnotationPosition {
  x: number
  y: number
  text_anchor: ReferenceAnnotationTextAnchor
  dominant_baseline: ReferenceAnnotationBaseline
  rotation?: number
}

const POSITION_TEXT_ANCHOR: Record<
  ReferenceAnnotationPosition,
  ReferenceAnnotationTextAnchor
> = { start: `start`, center: `middle`, end: `end` }
const SIDE_BASELINE: Record<ReferenceAnnotationSide, ReferenceAnnotationBaseline> = {
  above: `auto`,
  below: `hanging`,
  left: `middle`,
  right: `middle`,
}

// Calculate annotation position given line endpoints and annotation config
export function calculate_annotation_position(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  annotation: {
    position?: `start` | `center` | `end`
    side?: `above` | `below` | `left` | `right`
    offset?: { x?: number; y?: number }
    gap?: number
    edge_padding?: number
    rotate?: boolean
  },
): AnnotationPosition {
  const position = annotation.position ?? `end`
  const side = annotation.side ?? `above`
  const offset_x = annotation.offset?.x ?? 0
  const offset_y = annotation.offset?.y ?? 0
  const gap = annotation.gap ?? 8 // pixels from line
  const edge_padding = annotation.edge_padding ?? 4 // pixels from plot edge at start/end

  // Fraction along line: start=0, center=0.5, end=1
  const frac = position === `start` ? 0 : position === `center` ? 0.5 : 1

  // Calculate base position with edge padding applied along line direction
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy)

  let base_x = x1 + frac * dx
  let base_y = y1 + frac * dy

  // Apply edge padding to pull text slightly inward from plot boundaries
  if (len > 0 && position !== `center`) {
    const dir_x = dx / len
    const dir_y = dy / len
    // At 'end', move back toward start; at 'start', move toward end
    const inward = position === `end` ? -edge_padding : edge_padding
    base_x += dir_x * inward
    base_y += dir_y * inward
  }

  let perp_x = 0
  let perp_y = 0
  if (len > 0) {
    // Perpendicular vector (normalized)
    const nx = -dy / len
    const ny = dx / len
    let sign: number
    if (side === `above` || side === `below`) {
      // In SVG, y increases downward. Flip sign if 'above' and perpendicular points down (ny > 0),
      // or if 'below' and perpendicular points up (ny <= 0), to ensure offset is in correct direction
      sign = (side === `above`) === ny > 0 ? -1 : 1
    } else {
      // left/right offset to the side of the line in screen space (right -> +x, left -> -x), stable
      // regardless of endpoint order — vertical ref lines are stored bottom->top, which flips the
      // perpendicular. Horizontal lines (nx == 0) fall back to right = up (-y), left = down (+y).
      const want_right = side === `right`
      sign = Math.abs(nx) > 1e-9 ? (want_right ? 1 : -1) * Math.sign(nx) : want_right ? -1 : 1
    }
    perp_x = sign * nx * gap
    perp_y = sign * ny * gap
  }

  const text_anchor =
    side === `left` ? `end` : side === `right` ? `start` : POSITION_TEXT_ANCHOR[position]
  const dominant_baseline = SIDE_BASELINE[side]

  // Calculate rotation if needed (keep text readable)
  let rotation: number | undefined
  if (annotation.rotate && len > 0) {
    const angle = Math.atan2(dy, dx) * (180 / Math.PI)
    rotation = angle > 90 ? angle - 180 : angle < -90 ? angle + 180 : angle
  }

  return {
    x: base_x + perp_x + offset_x,
    y: base_y + perp_y + offset_y,
    text_anchor,
    dominant_baseline,
    rotation,
  }
}

interface ReferenceAnnotationMetrics {
  text_width: number
  font_size: number
  text_ascent: number
  text_descent: number
  padding: number
}

const AUTO_ANNOTATION_POSITIONS: readonly ReferenceAnnotationPosition[] = [
  `end`,
  `center`,
  `start`,
]
const AUTO_ANNOTATION_SIDES: readonly ReferenceAnnotationSide[] = [
  `above`,
  `below`,
  `right`,
  `left`,
]

export const estimate_reference_annotation_metrics = (
  annotation: RefLineAnnotation,
): ReferenceAnnotationMetrics => {
  const padding =
    typeof annotation.padding === `number` &&
    Number.isFinite(annotation.padding) &&
    annotation.padding >= 0
      ? annotation.padding
      : 2
  const inherited_font = resolve_font_spec(
    typeof document === `undefined` ? null : document.documentElement,
  )
  // Match SVG default `12px` when unset; resolve em/rem/% against inherited size.
  const font_size = resolve_font_size_css(
    annotation.font_size ?? `12px`,
    inherited_font.font_size,
  )
  const text_metrics = measure_text_line(annotation.text, {
    ...inherited_font,
    ...(annotation.font_family && annotation.font_family !== `inherit`
      ? { font_family: annotation.font_family }
      : {}),
    font_size,
    line_height: font_size * 1.2,
  })
  return {
    text_width: text_metrics.width,
    font_size,
    text_ascent: text_metrics.ascent,
    text_descent: text_metrics.descent,
    padding,
  }
}

export const reference_annotation_text_rect = (
  anchor: AnnotationPosition,
  metrics: ReferenceAnnotationMetrics,
): Rect => {
  const anchor_fraction = { start: 0, middle: 0.5, end: 1 }[anchor.text_anchor]
  const text_height = metrics.text_ascent + metrics.text_descent
  const text_top =
    anchor.dominant_baseline === `hanging`
      ? anchor.y
      : anchor.dominant_baseline === `middle`
        ? anchor.y - text_height / 2
        : anchor.y - metrics.text_ascent
  return {
    x: anchor.x - metrics.padding - metrics.text_width * anchor_fraction,
    y: text_top - metrics.padding,
    width: metrics.text_width + 2 * metrics.padding,
    height: text_height + 2 * metrics.padding,
  }
}

const rotate_rect_around = (
  rect: Rect,
  pivot: DecorationPoint,
  rotation_degrees: number | undefined,
): Rect => {
  if (!rotation_degrees) return rect
  const rotation_radians = (rotation_degrees * Math.PI) / 180
  const cos_rotation = Math.cos(rotation_radians)
  const sin_rotation = Math.sin(rotation_radians)
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ].map(({ x, y }) => {
    const delta_x = x - pivot.x
    const delta_y = y - pivot.y
    return {
      x: pivot.x + delta_x * cos_rotation - delta_y * sin_rotation,
      y: pivot.y + delta_x * sin_rotation + delta_y * cos_rotation,
    }
  })
  const x_min = Math.min(...corners.map(({ x }) => x))
  const x_max = Math.max(...corners.map(({ x }) => x))
  const y_min = Math.min(...corners.map(({ y }) => y))
  const y_max = Math.max(...corners.map(({ y }) => y))
  return { x: x_min, y: y_min, width: x_max - x_min, height: y_max - y_min }
}

const annotation_candidate = (
  endpoints: Vec4,
  annotation: RefLineAnnotation,
  metrics: ReferenceAnnotationMetrics,
  position: ReferenceAnnotationPosition,
  side: ReferenceAnnotationSide,
): ReferenceAnnotationCandidate => {
  const [x1, y1, x2, y2] = endpoints
  const anchor = calculate_annotation_position(x1, y1, x2, y2, {
    ...annotation,
    position,
    side,
  })
  const unrotated_rect = reference_annotation_text_rect(anchor, metrics)
  return {
    position,
    side,
    ...anchor,
    rect: rotate_rect_around(unrotated_rect, anchor, anchor.rotation),
  }
}

// Existing explicit position/side requests are pinned. Unspecified annotations receive a stable
// preferred-first cross product of line positions and sides for obstacle-aware selection.
export function create_reference_annotation_candidates(
  endpoints: Vec4,
  annotation: RefLineAnnotation,
  metrics: ReferenceAnnotationMetrics = estimate_reference_annotation_metrics(annotation),
): ReferenceAnnotationCandidate[] {
  const preferred_position = annotation.position ?? `end`
  const preferred_side = annotation.side ?? `above`
  if (annotation.position !== undefined || annotation.side !== undefined) {
    return [
      annotation_candidate(endpoints, annotation, metrics, preferred_position, preferred_side),
    ]
  }
  return AUTO_ANNOTATION_POSITIONS.flatMap((position) =>
    AUTO_ANNOTATION_SIDES.map((side) =>
      annotation_candidate(endpoints, annotation, metrics, position, side),
    ),
  )
}

function create_reference_annotation_items({
  lines,
  ranges,
  scales,
  clearance,
}: {
  lines: readonly IndexedRefLine[]
  ranges: ReferenceLineRanges
  scales: ReferenceLineScales
  clearance?: number
}): ReferenceAnnotationDecorationItem[] {
  const items: ReferenceAnnotationDecorationItem[] = []
  for (const line of lines) {
    const { annotation } = line
    if (!annotation) continue
    const x_range = line.x_axis === `x2` ? (ranges.x2 ?? ranges.x) : ranges.x
    const y_range = line.y_axis === `y2` ? (ranges.y2 ?? ranges.y) : ranges.y
    const endpoints = resolve_line_endpoints(
      line,
      {
        x_min: x_range[0],
        x_max: x_range[1],
        y_min: y_range[0],
        y_max: y_range[1],
      },
      {
        x_scale: scales.x,
        x2_scale: scales.x2,
        y_scale: scales.y,
        y2_scale: scales.y2,
      },
    )
    if (!endpoints) continue
    const candidates = create_reference_annotation_candidates(endpoints, annotation)
    items.push({
      id: reference_annotation_id(line.idx),
      kind: `reference-annotation`,
      footprint: { width: candidates[0].rect.width, height: candidates[0].rect.height },
      clearance,
      candidates,
      pinned: annotation.position !== undefined || annotation.side !== undefined,
    })
  }
  return items
}

export function solve_reference_annotations({
  base_solution,
  exclusion_rects = [],
  lines,
  ranges,
  scales,
  clearance = 4,
  ...scene
}: Omit<DecorationScene, `items`> & {
  base_solution: DecorationSolution
  lines: readonly IndexedRefLine[]
  ranges: ReferenceLineRanges
  scales: ReferenceLineScales
  clearance?: number
}): DecorationSolution {
  const annotations = solve_decorations({
    ...scene,
    base_pad: base_solution.pad,
    exclusion_rects: [...exclusion_rects, ...decoration_placement_rects(base_solution)],
    items: create_reference_annotation_items({ lines, ranges, scales, clearance }),
  })
  return {
    ...base_solution,
    placements: [...base_solution.placements, ...annotations.placements],
  }
}

export const get_reference_annotation_placement = (
  solution: DecorationSolution,
  line_idx: number,
): ReferenceAnnotationCandidate | undefined =>
  get_decoration_placement(solution, reference_annotation_id(line_idx))?.reference_annotation

interface Scene3DParams {
  scene_x: number
  scene_y: number
  scene_z: number
  x_range: Vec2
  y_range: Vec2
  z_range: Vec2
}

// Apply span constraints or use full range as fallback
export const span_or = (
  span: [number | null, number | null] | undefined,
  range: Vec2,
): Vec2 => [span?.[0] ?? range[0], span?.[1] ?? range[1]]

// Normalize a data value to scene coordinates (centered around 0)
export function normalize_to_scene(
  value: number,
  [min_val, max_val]: Vec2,
  scene_size: number,
): number {
  const range = max_val - min_val
  return range === 0 ? 0 : ((value - min_val) / range - 0.5) * scene_size
}

// Create a function to convert user data coordinates to Three.js coordinates
// Note: In Three.js, Y is vertical. We map:
// - user X → Three.js X (horizontal)
// - user Y → Three.js Z (depth/horizontal)
// - user Z → Three.js Y (vertical)
export function create_to_threejs(
  params: Scene3DParams,
): (user_x: number, user_y: number, user_z: number) => { x: number; y: number; z: number } {
  const { scene_x, scene_y, scene_z, x_range, y_range, z_range } = params
  return (user_x: number, user_y: number, user_z: number) => ({
    x: normalize_to_scene(user_x, x_range, scene_x),
    y: normalize_to_scene(user_z, z_range, scene_z), // z → Y
    z: normalize_to_scene(user_y, y_range, scene_y), // y → Z
  })
}
