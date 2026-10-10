// Reference line utilities: helper functions and coordinate resolution
import { array_extent, type Vec2, type Vec4 } from '#lib/math.js'
import type {
  DecorationPoint,
  DecorationScene,
  DecorationSolution,
  ReferenceAnnotationBaseline,
  ReferenceAnnotationCandidate,
  ReferenceAnnotationDecorationItem,
  ReferenceAnnotationPosition,
  ReferenceAnnotationSide,
  ReferenceAnnotationTextAnchor,
} from '#lib/plot/core/decorations/index.js'
import {
  decoration_placement_rects,
  get_decoration_placement,
  solve_decorations,
} from '#lib/plot/core/decorations/index.js'
import { range_bounds } from '#lib/plot/core/interactions.js'
import type { Rect } from '#lib/plot/core/layout.js'
import type {
  AxisKey,
  RefLine,
  RefLineAnnotation,
  RefLineValue,
} from '#lib/plot/core/types.js'
import {
  measure_text_line,
  resolve_font_size_css,
  resolve_font_spec,
} from '#lib/plot/core/text-metrics.js'

export type IndexedRefLine = RefLine & { idx: number }
type Scale = (val: number) => number
// Ranges and scales of all four axes as reference lines see them. The frame substitutes x/y
// for x2/y2 while no series carries data there, so every entry is always a real axis.
export type ReferenceLineAxes = {
  ranges: Record<AxisKey, Vec2>
  scales: Record<AxisKey, Scale>
}
// Sorted data bounds and pixel scales of the two axes one line is drawn against
export type RefLineAxes = {
  x_min: number
  x_max: number
  y_min: number
  y_max: number
  x_scale: Scale
  y_scale: Scale
}

const reference_annotation_id = (line_idx: number): string =>
  `reference-annotation-${line_idx}`

export const index_ref_lines = (ref_lines: RefLine[] | undefined): IndexedRefLine[] =>
  (ref_lines ?? [])
    .filter((line) => line.visible !== false)
    .map((line, idx) => ({ ...line, idx }))

// The single place a line's x_axis/y_axis is read. Bounds are sorted so an inverted range
// such as [1, 0] keeps its lines.
export function resolve_ref_line_axes(
  line: RefLine,
  { ranges, scales }: ReferenceLineAxes,
): RefLineAxes {
  const x_axis = line.x_axis === `x2` ? `x2` : `x`
  const y_axis = line.y_axis === `y2` ? `y2` : `y`
  const [x_min, x_max] = range_bounds(ranges[x_axis])
  const [y_min, y_max] = range_bounds(ranges[y_axis])
  return { x_min, x_max, y_min, y_max, x_scale: scales[x_axis], y_scale: scales[y_axis] }
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

export const normalize_point = (point: [RefLineValue, RefLineValue]): Vec2 => [
  normalize_value(point[0]),
  normalize_value(point[1]),
]

// Clip the line p1 + t·(p2 - p1) to the rect [x_min, x_max, y_min, y_max] with Liang-Barsky.
// t_range [0, 1] clips the segment p1→p2, [-Infinity, Infinity] the infinite line through both.
// Returns the clipped [x1, y1, x2, y2] in p1→p2 order, or null if nothing is inside.
function clip_to_rect(
  [p1x, p1y]: Vec2,
  [p2x, p2y]: Vec2,
  [x_min, x_max, y_min, y_max]: Vec4,
  [t_min, t_max]: Vec2 = [0, 1],
): Vec4 | null {
  const delta_x = p2x - p1x
  const delta_y = p2y - p1y

  // p values represent the direction, q values the signed distance to boundary
  // Boundaries: left (x_min), right (x_max), bottom (y_min), top (y_max)
  const p_vals = [-delta_x, delta_x, -delta_y, delta_y]
  const q_vals = [p1x - x_min, x_max - p1x, p1y - y_min, y_max - p1y]

  let [t_enter, t_leave] = [t_min, t_max]

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

  if (t_enter > t_leave) return null

  return [
    p1x + t_enter * delta_x,
    p1y + t_enter * delta_y,
    p1x + t_leave * delta_x,
    p1y + t_leave * delta_y,
  ]
}

// Compute the screen coordinates for a reference line against the axes it is drawn on (see
// resolve_ref_line_axes). Returns [x1, y1, x2, y2] in pixel coordinates, or null if the line
// is not visible. Lines are drawn straight in pixel space, so extension, clipping and relative
// coords all happen there: on log/arcsinh axes data-space math would bend a line away from its
// defining points and change a clipped segment's shape on zoom.
export function resolve_line_endpoints(ref_line: RefLine, axes: RefLineAxes): Vec4 | null {
  const { x_min, x_max, y_min, y_max, x_scale, y_scale } = axes
  // Spans narrow the visible rect like every other bound; they never widen it
  const [x_lo, x_hi] = apply_span(x_min, x_max, ref_line.x_span)
  const [y_lo, y_hi] = apply_span(y_min, y_max, ref_line.y_span)
  if (x_lo > x_hi || y_lo > y_hi) return null
  const finite = (pixels: Vec4 | null): Vec4 | null =>
    pixels?.every(Number.isFinite) ? pixels : null
  const to_px = ([x_val, y_val]: Vec2): Vec2 => [x_scale(x_val), y_scale(y_val)]
  // relative coords: 0 = min, 1 = max of the axis, interpolated linearly in pixels
  const relative_px = (scale: Scale, min: number, max: number, frac: number): number =>
    scale(min) + frac * (scale(max) - scale(min))

  if (ref_line.type === `horizontal` || ref_line.type === `vertical`) {
    const is_horizontal = ref_line.type === `horizontal`
    const value = normalize_value(is_horizontal ? ref_line.y : ref_line.x)
    const [scale, min, max] = is_horizontal ? [y_scale, y_min, y_max] : [x_scale, x_min, x_max]
    const relative = ref_line.coord_mode === `relative`
    if (relative ? value < 0 || value > 1 : value < min || value > max) return null
    const px = relative ? relative_px(scale, min, max, value) : scale(value)
    return finite(
      is_horizontal
        ? [x_scale(x_lo), px, x_scale(x_hi), px]
        : [px, y_scale(y_lo), px, y_scale(y_hi)],
    )
  }
  if (ref_line.type === `diagonal`) {
    // slope/intercept define a data-space line (a curve on nonlinear axes), so it is clipped
    // in data space and drawn as the chord between its visible ends
    const { slope, intercept } = ref_line
    const seg = clip_to_rect(
      [x_lo, slope * x_lo + intercept],
      [x_hi, slope * x_hi + intercept],
      [x_lo, x_hi, y_lo, y_hi],
    )
    // Degenerate (single-point) result means the line only grazes a corner
    if (!seg || (seg[0] === seg[2] && seg[1] === seg[3])) return null
    return finite([...to_px([seg[0], seg[1]]), ...to_px([seg[2], seg[3]])])
  }
  if (ref_line.type !== `segment` && ref_line.type !== `line`) return null

  let [p1, p2] = [normalize_point(ref_line.p1), normalize_point(ref_line.p2)]
  // Infinite lines run toward increasing data x (then y), independent of point order
  if (ref_line.type === `line` && (p1[0] > p2[0] || (p1[0] === p2[0] && p1[1] > p2[1]))) {
    ;[p1, p2] = [p2, p1]
  }
  const [px_1, px_2] = [to_px(p1), to_px(p2)]
  if (![...px_1, ...px_2].every(Number.isFinite)) return null
  const [rect_x_1, rect_x_2] = [x_scale(x_lo), x_scale(x_hi)]
  const [rect_y_1, rect_y_2] = [y_scale(y_lo), y_scale(y_hi)]
  const rect: Vec4 = [
    Math.min(rect_x_1, rect_x_2),
    Math.max(rect_x_1, rect_x_2),
    Math.min(rect_y_1, rect_y_2),
    Math.max(rect_y_1, rect_y_2),
  ]
  if (ref_line.type === `segment`) return finite(clip_to_rect(px_1, px_2, rect))
  // Coincident points define no direction
  if (px_1[0] === px_2[0] && px_1[1] === px_2[1]) return null
  const seg = clip_to_rect(px_1, px_2, rect, [-Infinity, Infinity])
  // Degenerate (single-point) result means the line only grazes a corner
  return seg && !(seg[0] === seg[2] && seg[1] === seg[3]) ? finite(seg) : null
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

export function calculate_annotation_position(
  coord_x_1: number,
  coord_y_1: number,
  coord_x: number,
  coord_y_2: number,
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
  const gap = annotation.gap ?? 8 // pixels from line
  const edge_padding = annotation.edge_padding ?? 4 // pixels from plot edge at start/end

  // Fraction along line: start=0, center=0.5, end=1
  const frac = position === `start` ? 0 : position === `center` ? 0.5 : 1

  // Calculate base position with edge padding applied along line direction
  const delta_x = coord_x - coord_x_1
  const delta_y = coord_y_2 - coord_y_1
  const len = Math.hypot(delta_x, delta_y)

  let base_x = coord_x_1 + frac * delta_x
  let base_y = coord_y_1 + frac * delta_y

  if (len > 0 && position !== `center`) {
    // At 'end', move back toward start; at 'start', move toward end
    const inward = position === `end` ? -edge_padding : edge_padding
    base_x += (delta_x / len) * inward
    base_y += (delta_y / len) * inward
  }

  let perp_x = 0
  let perp_y = 0
  if (len > 0) {
    // Perpendicular vector (normalized)
    const normal_x = -delta_y / len
    const size_y = delta_x / len
    let sign: number
    if (side === `above` || side === `below`) {
      // In SVG, y increases downward. Flip sign if 'above' and perpendicular points down (ny > 0),
      // or if 'below' and perpendicular points up (ny <= 0), to ensure offset is in correct direction
      sign = (side === `above`) === size_y > 0 ? -1 : 1
    } else {
      // left/right offset to the side of the line in screen space (right -> +x, left -> -x), stable
      // regardless of endpoint order — vertical ref lines are stored bottom->top, which flips the
      // perpendicular. Horizontal lines (nx == 0) fall back to right = up (-y), left = down (+y).
      const want_right = side === `right`
      sign =
        Math.abs(normal_x) > 1e-9
          ? (want_right ? 1 : -1) * Math.sign(normal_x)
          : want_right
            ? -1
            : 1
    }
    perp_x = sign * normal_x * gap
    perp_y = sign * size_y * gap
  }

  const text_anchor =
    side === `left` ? `end` : side === `right` ? `start` : POSITION_TEXT_ANCHOR[position]

  // Keep the text readable: never upside down
  let rotation: number | undefined
  if (annotation.rotate && len > 0) {
    const angle = Math.atan2(delta_y, delta_x) * (180 / Math.PI)
    rotation = angle > 90 ? angle - 180 : angle < -90 ? angle + 180 : angle
  }

  return {
    x: base_x + perp_x + (annotation.offset?.x ?? 0),
    y: base_y + perp_y + (annotation.offset?.y ?? 0),
    text_anchor,
    dominant_baseline: SIDE_BASELINE[side],
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

const AUTO_ANNOTATION_POSITIONS = [`end`, `center`, `start`] as const
const AUTO_ANNOTATION_SIDES = [`above`, `below`, `right`, `left`] as const

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
    ...(annotation.font_family &&
      annotation.font_family !== `inherit` && { font_family: annotation.font_family }),
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
  ].map(({ x: coord_x, y: coord_y }) => {
    const delta_x = coord_x - pivot.x
    const delta_y = coord_y - pivot.y
    return {
      x: pivot.x + delta_x * cos_rotation - delta_y * sin_rotation,
      y: pivot.y + delta_x * sin_rotation + delta_y * cos_rotation,
    }
  })
  const [x_min, x_max] = array_extent(corners.map((corner) => corner.x))
  const [y_min, y_max] = array_extent(corners.map((corner) => corner.y))
  return { x: x_min, y: y_min, width: x_max - x_min, height: y_max - y_min }
}

const annotation_candidate = (
  endpoints: Vec4,
  annotation: RefLineAnnotation,
  metrics: ReferenceAnnotationMetrics,
  position: ReferenceAnnotationPosition,
  side: ReferenceAnnotationSide,
): ReferenceAnnotationCandidate => {
  const [coord_x_1, coord_y_1, coord_x, coord_y_2] = endpoints
  const anchor = calculate_annotation_position(coord_x_1, coord_y_1, coord_x, coord_y_2, {
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

function create_reference_annotation_items(
  lines: readonly IndexedRefLine[],
  axes: ReferenceLineAxes,
  clearance: number,
): ReferenceAnnotationDecorationItem[] {
  const items: ReferenceAnnotationDecorationItem[] = []
  for (const line of lines) {
    const { annotation } = line
    if (!annotation) continue
    const endpoints = resolve_line_endpoints(line, resolve_ref_line_axes(line, axes))
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
}: Omit<DecorationScene, `items`> &
  ReferenceLineAxes & {
    base_solution: DecorationSolution
    lines: readonly IndexedRefLine[]
    clearance?: number
  }): DecorationSolution {
  // `scene.base_pad` includes marginal reservations, so normalized obstacles project onto
  // the same pixels the annotation candidates were built from
  const annotations = solve_decorations({
    ...scene,
    exclusion_rects: [...exclusion_rects, ...decoration_placement_rects(base_solution)],
    items: create_reference_annotation_items(lines, { ranges, scales }, clearance),
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
