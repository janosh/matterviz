// Pure geometry for tick labels placed at their rendered pixel positions. Text measurement
// stays at the call site so this module works without DOM or Svelte APIs.

type TickLabelId = string | number
type TickLabelLine = string
export type TickAxisSide = `x` | `x2` | `y` | `y2`
const ANCHORS = [`start`, `middle`, `end`] as const
export type TickLabelAnchor = (typeof ANCHORS)[number]
export type TickLabelRotation = number
type TickStaggerRow = number

// `axis` is x for x/x2 and y for y/y2. `cross_axis` is the actual label origin after
// tick offset, configured shifts, and staggering have been applied.
export interface TickLabelPosition {
  axis: number
  cross_axis: number
}

export interface TickAxisExtent {
  start: number
  end: number
}

export interface TickLabelDimensions {
  line_widths: readonly number[]
  line_height: number
}

export interface TickLabelItem {
  id: TickLabelId
  lines: readonly TickLabelLine[]
  position: TickLabelPosition
  rotation?: TickLabelRotation
  anchor?: TickLabelAnchor
  stagger_row?: TickStaggerRow
  dimensions?: TickLabelDimensions
}

type TickLabelMeasure = (item: TickLabelItem, item_idx: number) => TickLabelDimensions

export interface TickAabb {
  min_x: number
  min_y: number
  max_x: number
  max_y: number
  width: number
  height: number
}

export interface TickLabelGeometry {
  item_idx: number
  id: TickLabelId
  lines: readonly TickLabelLine[]
  position: TickLabelPosition
  side: TickAxisSide
  anchor: TickLabelAnchor
  rotation: TickLabelRotation
  stagger_row: TickStaggerRow
  dimensions: TickLabelDimensions
  aabb: TickAabb
}

export interface TickAxisEdgeOverflow {
  start: number
  end: number
  total: number
}

export interface TickCollisionSummary {
  colliding_indices: readonly number[]
  count: number
}

export interface TickGeometrySummary {
  labels: readonly TickLabelGeometry[]
  collisions: TickCollisionSummary
  edge_overflow_px: number
}

export interface TickAnchorChoiceOptions {
  side: TickAxisSide
  position: TickLabelPosition
  rotation: TickLabelRotation
  dimensions: TickLabelDimensions
  axis_extent: TickAxisExtent
  edge_gap?: number
  preferred_anchor?: TickLabelAnchor
}

export interface TickGeometryOptions {
  items: readonly TickLabelItem[]
  side: TickAxisSide
  axis_extent: TickAxisExtent
  measure?: TickLabelMeasure
  gap?: number
  edge_gap?: number
}

const assert_finite = (value: number, name: string): void => {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite, got ${value}`)
}

const assert_non_negative = (value: number, name: string): void => {
  assert_finite(value, name)
  if (value < 0) throw new RangeError(`${name} must be non-negative, got ${value}`)
}

const validate_axis_extent = ({ start, end }: TickAxisExtent): void => {
  assert_finite(start, `axis_extent.start`)
  assert_finite(end, `axis_extent.end`)
}

const validate_position = (
  { axis, cross_axis }: TickLabelPosition,
  item_idx?: number,
): void => {
  const prefix = item_idx == null ? `position` : `items[${item_idx}].position`
  assert_finite(axis, `${prefix}.axis`)
  assert_finite(cross_axis, `${prefix}.cross_axis`)
}

const validate_dimensions = (
  dimensions: TickLabelDimensions,
  line_count: number,
  name = `dimensions`,
): void => {
  if (dimensions.line_widths.length !== line_count) {
    throw new RangeError(
      `${name}.line_widths has ${dimensions.line_widths.length} entries for ${line_count} lines`,
    )
  }
  dimensions.line_widths.forEach((width, line_idx) =>
    assert_non_negative(width, `${name}.line_widths[${line_idx}]`),
  )
  assert_non_negative(dimensions.line_height, `${name}.line_height`)
}

export const is_tick_label_anchor = (value: unknown): value is TickLabelAnchor =>
  typeof value === `string` && ANCHORS.includes(value as TickLabelAnchor)

export const validate_tick_label_anchor = (value: unknown): TickLabelAnchor => {
  if (!is_tick_label_anchor(value)) {
    throw new TypeError(
      `tick label anchor must be "start", "middle", or "end", got ${String(value)}`,
    )
  }
  return value
}

const normalized_rotation = (rotation: TickLabelRotation): number => {
  const wrapped = ((rotation % 360) + 360) % 360
  return wrapped > 180 ? wrapped - 360 : wrapped
}

// Match SVG text-anchor conventions used by PlotAxis: horizontal unrotated labels center on
// their ticks; rotated labels trail inward; y/y2 labels point toward their axis spine.
export const default_tick_label_anchor = (
  side: TickAxisSide,
  rotation: TickLabelRotation,
): TickLabelAnchor => {
  assert_finite(rotation, `rotation`)
  if (side === `y`) return `end`
  if (side === `y2`) return `start`
  const normalized = normalized_rotation(rotation)
  if (normalized === 0) return `middle`
  const above_axis = side === `x2`
  return above_axis === normalized > 0 ? `end` : `start`
}

const anchor_x_bounds = (
  width: number,
  anchor: TickLabelAnchor,
): [min_x: number, max_x: number] => {
  if (anchor === `start`) return [0, width]
  if (anchor === `end`) return [-width, 0]
  return [-width / 2, width / 2]
}

const block_y_bounds = (
  height: number,
  side: TickAxisSide,
): [min_y: number, max_y: number] => {
  if (side === `x`) return [0, height]
  if (side === `x2`) return [-height, 0]
  return [-height / 2, height / 2]
}

// Sub-pixel float dust from AABB corner math; reuse for feasibility edge checks too.
export const TICK_GEOMETRY_EPSILON = Number.EPSILON * 16

const snap_near_zero = (value: number): number =>
  Math.abs(value) <= TICK_GEOMETRY_EPSILON ? 0 : value

// Build the union of all same-anchor text lines as one block, then rotate its four corners
// around the label origin. This is exact for the block AABB even when line widths differ.
export const calculate_rotated_tick_label_aabb = ({
  position,
  side,
  anchor,
  rotation,
  dimensions,
}: {
  position: TickLabelPosition
  side: TickAxisSide
  anchor: TickLabelAnchor
  rotation: TickLabelRotation
  dimensions: TickLabelDimensions
}): TickAabb => {
  validate_position(position)
  validate_tick_label_anchor(anchor)
  assert_finite(rotation, `rotation`)
  validate_dimensions(dimensions, dimensions.line_widths.length)

  return rotated_aabb(position, side, anchor, rotation, dimensions)
}

// Hot path: every candidate layout builds one of these per label, so it stays allocation-free.
const rotated_aabb = (
  position: TickLabelPosition,
  side: TickAxisSide,
  anchor: TickLabelAnchor,
  rotation: TickLabelRotation,
  dimensions: TickLabelDimensions,
): TickAabb => {
  let block_width = 0
  for (const width of dimensions.line_widths) {
    if (width > block_width) block_width = width
  }
  const block_height = dimensions.line_widths.length * dimensions.line_height
  const [local_min_x, local_max_x] = anchor_x_bounds(block_width, anchor)
  const [local_min_y, local_max_y] = block_y_bounds(block_height, side)
  const radians = (normalized_rotation(rotation) * Math.PI) / 180
  const cosine = snap_near_zero(Math.cos(radians))
  const sine = snap_near_zero(Math.sin(radians))
  const horizontal = side === `x` || side === `x2`
  const origin_x = horizontal ? position.axis : position.cross_axis
  const origin_y = horizontal ? position.cross_axis : position.axis

  // What each local edge contributes to each output axis. Summing the per-axis extremes is
  // bit-identical to enumerating all four corners, because IEEE addition is monotonic.
  const x_left = local_min_x * cosine
  const x_right = local_max_x * cosine
  const x_top = -(local_min_y * sine)
  const x_bottom = -(local_max_y * sine)
  const y_left = local_min_x * sine
  const y_right = local_max_x * sine
  const y_top = local_min_y * cosine
  const y_bottom = local_max_y * cosine
  const min_x = origin_x + Math.min(x_left, x_right) + Math.min(x_top, x_bottom)
  const max_x = origin_x + Math.max(x_left, x_right) + Math.max(x_top, x_bottom)
  const min_y = origin_y + Math.min(y_left, y_right) + Math.min(y_top, y_bottom)
  const max_y = origin_y + Math.max(y_left, y_right) + Math.max(y_top, y_bottom)
  return { min_x, min_y, max_x, max_y, width: max_x - min_x, height: max_y - min_y }
}

// Overflow is reported relative to the supplied start/end direction, including reversed axes.
export const detect_axis_edge_overflow = (
  aabb: TickAabb,
  side: TickAxisSide,
  axis_extent: TickAxisExtent,
  edge_gap = 0,
): TickAxisEdgeOverflow => {
  validate_axis_extent(axis_extent)
  assert_non_negative(edge_gap, `edge_gap`)
  return edge_overflow(aabb, side, axis_extent, edge_gap)
}

// Same math without the argument checks. Callers that loop over labels validate the extent
// and gap once up front, so re-checking them per label is the loop's dominant cost.
const edge_overflow = (
  aabb: TickAabb,
  side: TickAxisSide,
  axis_extent: TickAxisExtent,
  edge_gap: number,
): TickAxisEdgeOverflow => {
  const horizontal = side === `x` || side === `x2`
  const interval_min = horizontal ? aabb.min_x : aabb.min_y
  const interval_max = horizontal ? aabb.max_x : aabb.max_y
  const forward = axis_extent.end >= axis_extent.start
  const start = forward
    ? Math.max(0, axis_extent.start + edge_gap - interval_min)
    : Math.max(0, interval_max - (axis_extent.start - edge_gap))
  const end = forward
    ? Math.max(0, interval_max - (axis_extent.end - edge_gap))
    : Math.max(0, axis_extent.end + edge_gap - interval_min)
  return { start, end, total: start + end }
}

// Pick the least-overflowing anchor. Ties retain the preferred/default anchor, which makes
// upright y/y2 labels stable because horizontal text-anchor does not affect their axis extent.
export const choose_tick_label_anchor = (
  options: TickAnchorChoiceOptions,
): TickLabelAnchor => {
  const {
    position,
    rotation,
    dimensions,
    axis_extent,
    edge_gap = 0,
    preferred_anchor,
  } = options
  validate_position(position)
  assert_finite(rotation, `rotation`)
  validate_axis_extent(axis_extent)
  assert_non_negative(edge_gap, `edge_gap`)
  validate_dimensions(dimensions, dimensions.line_widths.length)
  if (preferred_anchor != null) validate_tick_label_anchor(preferred_anchor)
  return best_anchor(options).anchor
}

// Returns the winning anchor together with its box, so callers never rebuild it. Overflow is
// non-negative and ties keep the preferred anchor, so an anchor that already fits wins
// outright — the common case then costs one box instead of three.
const best_anchor = ({
  side,
  position,
  rotation,
  dimensions,
  axis_extent,
  edge_gap = 0,
  preferred_anchor,
}: TickAnchorChoiceOptions): { anchor: TickLabelAnchor; aabb: TickAabb } => {
  const preferred = preferred_anchor ?? default_tick_label_anchor(side, rotation)
  let chosen = preferred
  let chosen_aabb = rotated_aabb(position, side, preferred, rotation, dimensions)
  let least_overflow = edge_overflow(chosen_aabb, side, axis_extent, edge_gap).total
  if (least_overflow === 0) return { anchor: chosen, aabb: chosen_aabb }
  for (const candidate of ANCHORS) {
    if (candidate === preferred) continue
    const aabb = rotated_aabb(position, side, candidate, rotation, dimensions)
    const { total } = edge_overflow(aabb, side, axis_extent, edge_gap)
    if (total < least_overflow) {
      chosen = candidate
      chosen_aabb = aabb
      least_overflow = total
    }
  }
  return { anchor: chosen, aabb: chosen_aabb }
}

const resolve_dimensions = (
  item: TickLabelItem,
  item_idx: number,
  measure?: TickLabelMeasure,
): TickLabelDimensions => {
  if (item.lines.length === 0) {
    throw new RangeError(`items[${item_idx}].lines must contain at least one line`)
  }
  const dimensions = item.dimensions ?? measure?.(item, item_idx)
  if (!dimensions) {
    throw new TypeError(
      `items[${item_idx}] needs explicit dimensions or a measurement callback`,
    )
  }
  validate_dimensions(dimensions, item.lines.length, `items[${item_idx}].dimensions`)
  return {
    line_widths: [...dimensions.line_widths],
    line_height: dimensions.line_height,
  }
}

export const calculate_tick_label_geometry = ({
  items,
  side,
  axis_extent,
  measure,
  edge_gap = 0,
}: Pick<
  TickGeometryOptions,
  `items` | `side` | `axis_extent` | `measure` | `edge_gap`
>): TickLabelGeometry[] => {
  validate_axis_extent(axis_extent)
  assert_non_negative(edge_gap, `edge_gap`)
  return items.map((item, item_idx) => {
    validate_position(item.position, item_idx)
    const rotation = item.rotation ?? 0
    assert_finite(rotation, `items[${item_idx}].rotation`)
    const stagger_row = item.stagger_row ?? 0
    if (!Number.isInteger(stagger_row) || stagger_row < 0) {
      throw new RangeError(
        `items[${item_idx}].stagger_row must be a non-negative integer, got ${stagger_row}`,
      )
    }
    const dimensions = resolve_dimensions(item, item_idx, measure)
    const explicit = item.anchor == null ? null : validate_tick_label_anchor(item.anchor)
    const { anchor, aabb } = explicit
      ? {
          anchor: explicit,
          aabb: rotated_aabb(item.position, side, explicit, rotation, dimensions),
        }
      : best_anchor({
          side,
          position: item.position,
          rotation,
          dimensions,
          axis_extent,
          edge_gap,
        })
    return {
      item_idx,
      id: item.id,
      lines: [...item.lines],
      position: { ...item.position },
      side,
      anchor,
      rotation,
      stagger_row,
      dimensions,
      aabb,
    }
  })
}

const aabbs_collide = (first: TickAabb, second: TickAabb, gap: number): boolean => {
  const separated_x = first.max_x + gap <= second.min_x || second.max_x + gap <= first.min_x
  const separated_y = first.max_y + gap <= second.min_y || second.max_y + gap <= first.min_y
  return !separated_x && !separated_y
}

const intervals_collide = (
  first: readonly [number, number],
  second: readonly [number, number],
  second_offset: number,
  gap: number,
): boolean =>
  first[1] + gap > second[0] + second_offset && second[1] + second_offset + gap > first[0]

const local_bounds = (
  label: TickLabelGeometry,
): readonly [x: [number, number], y: [number, number]] => {
  let width = 0
  for (const line_width of label.dimensions.line_widths) width = Math.max(width, line_width)
  return [
    anchor_x_bounds(width, label.anchor),
    block_y_bounds(label.lines.length * label.dimensions.line_height, label.side),
  ]
}

// Every label on an axis shares one rotation, so tilted labels sit on parallel baselines and
// their axis-aligned boxes overlap long before the text does. Compare their oriented bounds after
// the AABB broad phase so labels separated along either text axis do not force extra rotation.
const labels_collide = (
  first: TickLabelGeometry,
  second: TickLabelGeometry,
  gap: number,
): boolean => {
  if (!aabbs_collide(first.aabb, second.aabb, gap)) return false
  const rotation = normalized_rotation(first.rotation)
  if (
    rotation === 0 ||
    rotation !== normalized_rotation(second.rotation) ||
    first.side !== second.side
  ) {
    return true
  }
  const radians = (rotation * Math.PI) / 180
  const horizontal = first.side === `x` || first.side === `x2`
  const delta_along = second.position.axis - first.position.axis
  const delta_cross = second.position.cross_axis - first.position.cross_axis
  const delta_x = horizontal ? delta_along : delta_cross
  const delta_y = horizontal ? delta_cross : delta_along
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const offset_x = delta_x * cosine + delta_y * sine
  const offset_y = -delta_x * sine + delta_y * cosine
  const [first_x, first_y] = local_bounds(first)
  const [second_x, second_y] = local_bounds(second)
  return (
    intervals_collide(first_x, second_x, offset_x, gap) &&
    intervals_collide(first_y, second_y, offset_y, gap)
  )
}

export const detect_tick_label_collisions_sweep = (
  labels: readonly TickLabelGeometry[],
  gap = 0,
): TickCollisionSummary => {
  assert_non_negative(gap, `gap`)
  const spatially_sorted = labels.toSorted(
    (first, second) =>
      first.aabb.min_x - second.aabb.min_x ||
      first.aabb.max_x - second.aabb.max_x ||
      first.item_idx - second.item_idx,
  )
  const active: TickLabelGeometry[] = []
  const is_colliding = Array.from({ length: labels.length }, () => false)
  let count = 0
  for (const current of spatially_sorted) {
    for (let active_idx = active.length - 1; active_idx >= 0; active_idx--) {
      if (active[active_idx].aabb.max_x + gap <= current.aabb.min_x) {
        active.splice(active_idx, 1)
      }
    }
    for (const candidate of active) {
      if (labels_collide(candidate, current, gap)) {
        is_colliding[candidate.item_idx] = true
        is_colliding[current.item_idx] = true
        count += 1
      }
    }
    active.push(current)
  }
  return {
    colliding_indices: is_colliding.flatMap((collides, item_idx) =>
      collides ? [item_idx] : [],
    ),
    count,
  }
}

export const analyze_tick_label_geometry = (
  options: TickGeometryOptions,
): TickGeometrySummary => {
  const { gap = 0, edge_gap = 0 } = options
  assert_non_negative(gap, `gap`)
  const labels = calculate_tick_label_geometry(options)
  const collisions = detect_tick_label_collisions_sweep(labels, gap)
  let edge_overflow_px = 0
  for (const label of labels) {
    edge_overflow_px += edge_overflow(
      label.aabb,
      label.side,
      options.axis_extent,
      edge_gap,
    ).total
  }
  return {
    labels,
    collisions,
    edge_overflow_px,
  }
}
