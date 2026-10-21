import { resolve_tick_layout, TICK_LABEL_HEIGHT } from '#lib/plot/core/tick-layout.js'
import type { MeasuredAxis } from '#lib/plot/core/tick-layout.js'
import {
  BREAKABLE_SPACE_RE,
  DEFAULT_FONT_SPEC,
  measure_text_line,
  wrap_text_paragraph,
} from '#lib/plot/core/text-metrics.js'
import type { FontSpec, TextLineMetrics } from '#lib/plot/core/text-metrics.js'
import type { AxisConfig } from '#lib/plot/core/types.js'
import { html_to_text } from '#lib/utils.js'

export type Sides = { t?: number; b?: number; l?: number; r?: number }

export const sides_equal = (left: Required<Sides>, right: Required<Sides>): boolean =>
  left.t === right.t && left.b === right.b && left.l === right.l && left.r === right.r

// Default gap between tick labels and axis labels
export const LABEL_GAP_DEFAULT = 20
// Single-line axis title height (the title font's line height)
export const AXIS_LABEL_HEIGHT = 20
// Wrapping span for axis titles whose available extent the caller doesn't know (vertical
// titles, whose plot height PlotAxis does not forward) and the floor for horizontal ones
export const AXIS_TITLE_WRAP_WIDTH = 200
// Distance from an x/x2 axis baseline to the title center.
export const AXIS_TITLE_OFFSET = TICK_LABEL_HEIGHT + LABEL_GAP_DEFAULT

// Height of ChartShell's corner controls row (gear, fullscreen) from the plot's top edge
const CONTROLS_ROW_HEIGHT = 24
// Per-side floors; measured ticks and titles win when they need more
export const DEFAULT_PLOT_PADDING: Required<Sides> = { t: 20, b: 50, l: 50, r: 12 }

const DEFAULT_AXIS_TITLE_FONT: Readonly<FontSpec> = Object.freeze({
  ...DEFAULT_FONT_SPEC,
  font_size: 14,
  line_height: AXIS_LABEL_HEIGHT,
})

interface AxisTitleSegment {
  readonly text: string
  readonly shift?: `sub` | `super`
}

interface AxisTitleLine {
  readonly text: string
  readonly segments: readonly AxisTitleSegment[]
  readonly metrics: TextLineMetrics
}

interface AxisTitleLayout {
  // Accessible plain-text label, including the selected option's unit for interactive axes.
  readonly label: string
  readonly lines: readonly AxisTitleLine[]
  readonly width: number
  readonly height: number
  readonly line_height: number
  readonly interactive: boolean
}

const append_axis_title_segment = (
  segments: AxisTitleSegment[],
  text: string,
  shift?: AxisTitleSegment[`shift`],
): void => {
  if (!text) return
  const previous = segments.at(-1)
  if (previous && previous.shift === shift) {
    segments[segments.length - 1] = { text: `${previous.text}${text}`, shift }
  } else segments.push({ text, shift })
}

const parse_axis_title_segments = (value: string): AxisTitleSegment[] => {
  const segments: AxisTitleSegment[] = []
  // Shifts of the open <sub>/<sup> tags, innermost last
  const active_shifts: NonNullable<AxisTitleSegment[`shift`]>[] = []
  const tag_pattern = /<(?<closing>\/?)(?<tag>sub|sup)\b[^>]*>/giu
  let cursor = 0
  for (const match of value.matchAll(tag_pattern)) {
    const match_idx = match.index ?? 0
    const text = html_to_text(value.slice(cursor, match_idx))
    append_axis_title_segment(segments, text, active_shifts.at(-1))
    const tag = match.groups?.tag?.toLowerCase()
    if (tag) {
      const shift = tag === `sub` ? `sub` : `super`
      if (!match.groups?.closing) active_shifts.push(shift)
      else if (active_shifts.includes(shift)) {
        active_shifts.splice(active_shifts.lastIndexOf(shift), 1)
      }
    }
    cursor = match_idx + match[0].length
  }
  append_axis_title_segment(segments, html_to_text(value.slice(cursor)), active_shifts.at(-1))

  while (segments[0] && !segments[0].text.trimStart()) segments.shift()
  while (segments.at(-1) && !segments.at(-1)?.text.trimEnd()) segments.pop()
  if (segments[0]) segments[0] = { ...segments[0], text: segments[0].text.trimStart() }
  const last_idx = segments.length - 1
  if (segments[last_idx]) {
    segments[last_idx] = { ...segments[last_idx], text: segments[last_idx].text.trimEnd() }
  }
  return segments
}

const selected_axis_title = (
  axis: Pick<AxisConfig, `label` | `options` | `selected_key`>,
): { label: string; segments: AxisTitleSegment[]; interactive: boolean } => {
  const option = axis.options?.find(({ key }) => key === axis.selected_key)
  const interactive = Boolean(axis.options?.length)
  const placeholder = axis.label?.length ? axis.label : interactive ? `Select axis…` : ``
  const value = option?.unit
    ? `${option.label} (${option.unit})`
    : (option?.label ?? placeholder)
  const segments = parse_axis_title_segments(value)
  return {
    label: segments.map(({ text }) => text).join(``),
    segments,
    interactive,
  }
}

const split_axis_title_paragraphs = (
  segments: readonly AxisTitleSegment[],
): AxisTitleSegment[][] => {
  const paragraphs: AxisTitleSegment[][] = [[]]
  for (const segment of segments) {
    const parts = segment.text.split(/\r\n|\r|\n/u)
    for (const [part_idx, part] of parts.entries()) {
      append_axis_title_segment(paragraphs.at(-1) ?? [], part, segment.shift)
      if (part_idx < parts.length - 1) paragraphs.push([])
    }
  }
  return paragraphs
}

// Spaces collapse only where wrap_text_paragraph breaks, so segments stay aligned with lines
const segments_for_wrapped_lines = (
  paragraph: readonly AxisTitleSegment[],
  lines: readonly string[],
): AxisTitleSegment[][] => {
  const normalized: AxisTitleSegment[] = []
  let pending_space = false
  for (const { text, shift } of paragraph) {
    for (const character of text) {
      if (BREAKABLE_SPACE_RE.test(character)) {
        pending_space = normalized.length > 0
        continue
      }
      if (pending_space) normalized.push({ text: ` ` })
      normalized.push({ text: character, shift })
      pending_space = false
    }
  }
  let character_idx = 0
  return lines.map((line) => {
    while (normalized[character_idx]?.text === ` `) character_idx += 1
    const line_characters = normalized.slice(
      character_idx,
      character_idx + Array.from(line).length,
    )
    character_idx += line_characters.length
    const segments: AxisTitleSegment[] = []
    for (const { text, shift } of line_characters) {
      append_axis_title_segment(segments, text, shift)
    }
    return segments
  })
}

// Resolve the rendered title block from the same deterministic text metrics used by padding.
// Interactive triggers stay on one line and include their closed-state arrow/padding footprint.
export function resolve_axis_title_layout(
  axis: Pick<AxisConfig, `label` | `options` | `selected_key`>,
  available_width = AXIS_TITLE_WRAP_WIDTH,
): AxisTitleLayout {
  const font = DEFAULT_AXIS_TITLE_FONT
  const { label, segments, interactive } = selected_axis_title(axis)
  const shared = { label, line_height: font.line_height, interactive }
  if (!label) {
    return { ...shared, lines: [], width: 0, height: 0 }
  }
  const safe_width =
    Number.isFinite(available_width) && available_width > 0
      ? available_width
      : AXIS_TITLE_WRAP_WIDTH
  if (interactive) {
    const label_metrics = measure_text_line(label, font)
    const arrow_font = { ...font, font_size: font.font_size * 1.4 }
    const arrow_width = measure_text_line(`▾`, arrow_font).width
    // PopoverSelect: 4px horizontal padding on both sides plus a 0.3em flex gap.
    const width = label_metrics.width + arrow_width + 8 + 0.3 * font.font_size
    return {
      ...shared,
      lines: [{ text: label, segments, metrics: label_metrics }],
      width,
      height: Math.max(24, font.line_height),
    }
  }
  const lines = split_axis_title_paragraphs(segments).flatMap((paragraph) => {
    const paragraph_text = paragraph.map(({ text }) => text).join(``)
    const text_lines = wrap_text_paragraph(
      paragraph_text,
      safe_width,
      font,
      measure_text_line,
      true,
    )
    const line_segments = segments_for_wrapped_lines(paragraph, text_lines)
    return text_lines.map((text, line_idx) => ({
      text,
      segments: line_segments[line_idx],
      metrics: measure_text_line(text, font),
    }))
  })
  return {
    ...shared,
    lines,
    width: Math.max(0, ...lines.map(({ metrics }) => metrics.width)),
    height: lines.length * font.line_height,
  }
}

// Left y-title x: centered in the title band of [outer | title | gap | ticks] (not on the
// gap/title boundary, which jammed glyphs into the gap)
export function y_axis_label_x(
  axis: AxisConfig,
  pad_l: number,
  max_tick_width: number,
): number {
  const inside = axis.tick_label?.inside ?? false
  const tick_shift = inside ? 0 : (axis.tick_label?.shift?.x ?? 0)
  const tick_extent = inside ? 0 : max_tick_width + 8 - tick_shift
  const title_height = resolve_axis_title_layout(axis).height || AXIS_LABEL_HEIGHT
  return Math.max(
    title_height / 2,
    pad_l - tick_extent - LABEL_GAP_DEFAULT - title_height / 2 + (axis.label_shift?.x ?? 0),
  )
}

// Right y2-title x: mirror of y_axis_label_x (title center in its band).
export function y2_axis_label_x(
  axis: AxisConfig,
  width: number,
  pad_r: number,
  max_tick_width: number,
): number {
  const inside = axis.tick_label?.inside ?? false
  const tick_shift = inside ? 0 : (axis.tick_label?.shift?.x ?? 0) + 8
  const title_height = resolve_axis_title_layout(axis).height || AXIS_LABEL_HEIGHT
  const label_offset =
    (inside ? 0 : max_tick_width) +
    LABEL_GAP_DEFAULT +
    title_height / 2 +
    (axis.label_shift?.x ?? 0)
  return Math.min(width - title_height / 2, width - pad_r + tick_shift + label_offset)
}

// Line spanning the plot area at pixel `pos`: across it (horizontal) or from top to bottom
export const plot_area_line = (
  pos: number,
  horizontal: boolean,
  { width, height, pad }: { width: number; height: number; pad: Required<Sides> },
): { x1: number; x2: number; y1: number; y2: number } =>
  horizontal
    ? { x1: pad.l, x2: width - pad.r, y1: pos, y2: pos }
    : { x1: pos, x2: pos, y1: pad.t, y2: height - pad.b }

// Ignore undefined sides so optional props never override defaults.
export const filter_padding = (
  padding: Partial<Sides> | undefined | null,
  defaults: Required<Sides>,
): Required<Sides> => ({
  ...defaults,
  ...Object.fromEntries(Object.entries(padding ?? {}).filter(([, val]) => val !== undefined)),
})

// An element's full visual footprint incl. overflowing descendants (e.g. absolutely
// positioned colorbar tick labels, which offsetWidth/Height miss)
type Size = { width: number; height: number }
type ElementFootprint = Size & { offset_x: number; offset_y: number }

function measure_full_footprint(element: HTMLElement): ElementFootprint {
  const root = element.getBoundingClientRect()
  let left = root.left
  let top = root.top
  let right = root.right
  let bottom = root.bottom
  for (const child of element.querySelectorAll(`*`)) {
    const rect = child.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) continue
    left = Math.min(left, rect.left)
    top = Math.min(top, rect.top)
    right = Math.max(right, rect.right)
    bottom = Math.max(bottom, rect.bottom)
  }
  return {
    width: right - left,
    height: bottom - top,
    offset_x: left - root.left,
    offset_y: top - root.top,
  }
}

// Full footprint once laid out, else `fallback`. NOT interchangeable with decorations'
// measured_footprint, which returns the offset box (missing overflowing descendants).
export const full_footprint_or = (
  element: HTMLElement | null | undefined,
  fallback: Size,
): ElementFootprint =>
  element?.offsetWidth && element?.offsetHeight
    ? measure_full_footprint(element)
    : { ...fallback, offset_x: 0, offset_y: 0 }

export const element_position_for_footprint = (
  placement: { x: number; y: number } | null | undefined,
  footprint: Pick<ElementFootprint, `offset_x` | `offset_y`>,
): { x: number; y: number } | null =>
  placement
    ? { x: placement.x - footprint.offset_x, y: placement.y - footprint.offset_y }
    : null

// Calculate auto-adjusted padding based on tick label widths/heights
// This ensures tick labels don't overlap with axis labels
export interface AutoPaddingConfig {
  padding: Partial<Sides> // User padding (undefined sides will be auto-calculated)
  default_padding: Required<Sides> // Default padding to use as baseline
  x_axis?: MeasuredAxis
  x2_axis?: MeasuredAxis
  y_axis?: MeasuredAxis
  y2_axis?: MeasuredAxis
  width?: number // Plot width, needed to know whether x tick labels have to rotate
  height?: number // Plot height, needed for y/y2 wrapping and thinning
  controls_row?: boolean // whether the corner controls row (gear, fullscreen) is drawn
}

const project_measured_axis = (
  axis: MeasuredAxis,
  target_start: number,
  target_end: number,
): MeasuredAxis => {
  const positions = axis.tick_positions
  if (positions.length === 0) return axis
  const source_extent = axis.axis_extent ?? {
    start: Math.min(...positions),
    end: Math.max(...positions),
  }
  const target_span = target_end - target_start
  // Omitted/zero plot size must not collapse every tick onto 0 or invent a zero extent.
  if (!Number.isFinite(target_span) || target_span === 0) {
    return axis.axis_extent ? axis : { ...axis, axis_extent: source_extent }
  }
  const source_span = source_extent.end - source_extent.start
  // A collapsed source puts every tick at the target's center
  const project = (position: number) =>
    source_span === 0
      ? (target_start + target_end) / 2
      : target_start + ((position - source_extent.start) / source_span) * target_span
  return {
    ...axis,
    tick_positions: positions.map(project),
    axis_extent: { start: target_start, end: target_end },
  }
}

// No ticks is a value, not missing geometry.
const EMPTY_AXIS: MeasuredAxis = { tick_values: [], tick_positions: [] }

export const calc_auto_padding = ({
  padding,
  default_padding,
  x_axis = EMPTY_AXIS,
  x2_axis = EMPTY_AXIS,
  y_axis = EMPTY_AXIS,
  y2_axis = EMPTY_AXIS,
  width,
  height,
  controls_row = false,
}: AutoPaddingConfig): Required<Sides> => {
  // Resolve vertical density against the current drawable height. Explicit top/bottom padding
  // is stable; otherwise the default bands provide a deterministic first pass.
  const initial_plot_height =
    height == null
      ? 0
      : Math.max(
          0,
          height - (padding.t ?? default_padding.t) - (padding.b ?? default_padding.b),
        )
  const y_title_layout = resolve_axis_title_layout(y_axis)
  const y2_title_layout = resolve_axis_title_layout(y2_axis)
  // Padding for a y/y2 side: outside tick offsets, widest tick, title gap, rotated title
  // width and outer air. Titles need their band even when an axis has no ticks.
  const side_pad = (
    axis: MeasuredAxis,
    title_layout: AxisTitleLayout,
    default_side: number,
    side: `left` | `right`,
    available_height: number,
  ): number => {
    const ticks = axis.tick_values ?? []
    const has_title = title_layout.height > 0
    if (ticks.length === 0 && !has_title) return default_side
    const inside = axis.tick_label?.inside ?? false
    const tick_shift = axis.tick_label?.shift?.x ?? 0
    const has_outside_ticks = ticks.length > 0 && !inside
    const tick_width = has_outside_ticks
      ? resolve_tick_layout(
          project_measured_axis(axis, available_height, 0),
          available_height,
          side === `left` ? `y` : `y2`,
        ).band
      : 0
    const tick_offset = !has_outside_ticks
      ? 0
      : 8 + Math.max(0, side === `left` ? -tick_shift : tick_shift)
    const title_band = has_title ? title_layout.height : 0
    const title_gap = has_title && has_outside_ticks ? LABEL_GAP_DEFAULT : 0
    const title_shift = axis.label_shift?.x ?? 0
    const title_shift_outward = Math.max(0, side === `left` ? -title_shift : title_shift)
    return Math.max(
      default_side,
      tick_width + title_gap + title_band + tick_offset + title_shift_outward,
    )
  }
  const vertical_pads = (available_height: number): [number, number] => [
    padding.l ?? side_pad(y_axis, y_title_layout, default_padding.l, `left`, available_height),
    padding.r ??
      side_pad(y2_axis, y2_title_layout, default_padding.r, `right`, available_height),
  ]
  let [pad_l, pad_r] = vertical_pads(initial_plot_height)
  // Horizontal labels can use side padding; score endpoints against the full SVG width.
  const horizontal_tick_layout = (
    axis: MeasuredAxis,
    available_width: number,
    side: `x` | `x2`,
  ) => {
    const projected = project_measured_axis(axis, 0, available_width)
    return resolve_tick_layout(
      width == null
        ? projected
        : { ...projected, axis_extent: { start: -pad_l, end: available_width + pad_r } },
      available_width,
      side,
    )
  }

  // The top y2 tick label can sit entirely above the plot's top edge, right under the chart's
  // corner controls (gear, fullscreen), so a y2 axis keeps the top band clear of that row
  const y2_outside_ticks = Boolean(y2_axis.tick_values?.length) && !y2_axis.tick_label?.inside
  const controls_floor =
    controls_row && y2_outside_ticks ? CONTROLS_ROW_HEIGHT + TICK_LABEL_HEIGHT : 0
  const top_pad = (available_width: number): number => {
    const ticks = x2_axis.tick_values ?? []
    const title_layout = resolve_axis_title_layout(x2_axis, available_width)
    const has_title = title_layout.height > 0
    if (ticks.length === 0 && !has_title) return Math.max(controls_floor, default_padding.t)
    const inside = x2_axis.tick_label?.inside ?? false
    const has_outside_ticks = ticks.length > 0 && !inside
    const tick_shift = x2_axis.tick_label?.shift?.y ?? 0
    const tick_band = has_outside_ticks
      ? horizontal_tick_layout(x2_axis, available_width, `x2`).band
      : 0
    const tick_reach = has_outside_ticks ? tick_band + 8 + Math.max(0, -tick_shift) : 0
    // Rotated/wrapped ticks push the x2 title out by the excess tick band; extra wrapped
    // title lines stack outward in full
    const title_reach = has_title
      ? Math.max(0, x2_axis.label_shift?.y ?? AXIS_TITLE_OFFSET) +
        Math.max(0, tick_band - TICK_LABEL_HEIGHT) +
        title_layout.height -
        title_layout.line_height / 2
      : 0
    return Math.max(controls_floor, default_padding.t, tick_reach, title_reach)
  }

  // Bottom depends on the x label angle (rotated labels project their width downward);
  // reserving exactly what the title placement uses avoids dead space
  const bottom_pad = (available_width: number): number => {
    const inside = x_axis.tick_label?.inside ?? false
    const tick_values = x_axis.tick_values ?? []
    const has_outside_ticks = tick_values.length > 0 && !inside
    const title_layout = resolve_axis_title_layout(x_axis, available_width)
    const title_height = title_layout.height
    if (!has_outside_ticks && title_height === 0) return default_padding.b
    const band = has_outside_ticks
      ? horizontal_tick_layout(x_axis, available_width, `x`).band
      : TICK_LABEL_HEIGHT
    const tick_shift = Math.max(0, x_axis.tick_label?.shift?.y ?? 0)
    // The title's first line is centered one gap past the labels (half a line further);
    // wrapped lines stack below it in full
    const below_baseline =
      title_height > 0
        ? band + LABEL_GAP_DEFAULT + title_height - title_layout.line_height / 2
        : band
    const title_shift = title_height > 0 ? Math.max(0, x_axis.label_shift?.y ?? 0) : 0
    const content_reach = below_baseline + tick_shift + title_shift
    return Math.max(default_padding.b, content_reach)
  }

  let plot_width = width == null ? 0 : Math.max(0, width - pad_l - pad_r)
  let pad_t = padding.t ?? top_pad(plot_width)
  let pad_b = padding.b ?? bottom_pad(plot_width)

  // One bounded refinement (avoiding reactive oscillation): y density uses the top/bottom
  // bands selected above, then x/x2 get the resulting horizontal span
  if (height != null) {
    const refined_plot_height = Math.max(0, height - pad_t - pad_b)
    ;[pad_l, pad_r] = vertical_pads(refined_plot_height)
    plot_width = width == null ? 0 : Math.max(0, width - pad_l - pad_r)
    pad_t = padding.t ?? top_pad(plot_width)
    pad_b = padding.b ?? bottom_pad(plot_width)
  }

  return { t: pad_t, b: pad_b, l: pad_l, r: pad_r }
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const pad_rect = (rect: Rect, padding: number): Rect => ({
  x: rect.x - padding,
  y: rect.y - padding,
  width: rect.width + 2 * padding,
  height: rect.height + 2 * padding,
})

export const centered_rect = (
  center_x: number,
  top_y: number,
  width: number,
  height: number,
): Rect => ({
  x: center_x - width / 2,
  y: top_y,
  width,
  height,
})

export const rect_within_rect = (rect: Rect, bounds: Rect): boolean =>
  rect.x >= bounds.x &&
  rect.x + rect.width <= bounds.x + bounds.width &&
  rect.y >= bounds.y &&
  rect.y + rect.height <= bounds.y + bounds.height

interface ElementPlacementConfig {
  // Bounds of the plot area (in SVG coordinates)
  plot_bounds: Rect
  // Fallback size of the element to place (used before `element` first renders)
  element_size: Size
  // Element to place; once laid out, its full footprint (incl. overflowing descendants)
  // overrides element_size
  element?: HTMLElement | null
  // Minimum distance from plot edges to avoid axis label overlap (default: 12)
  axis_clearance?: number
  // Rectangles to avoid (e.g., already-placed legend when placing colorbar)
  exclude_rects?: Rect[]
  // Data to avoid covering: points, or rects (bars, bins) where a size is given
  obstacles: readonly { x: number; y: number; width?: number; height?: number }[]
}

interface ElementPlacementResult {
  x: number
  y: number
  // Obstacle cells the element covers there, an overlapped exclusion rect outweighing all
  // obstacles together; 0 is a free spot
  overlaps: number
}

// Occupancy grid cell (px). Candidates step by it, and a cell an obstacle touches counts as
// covered wherever the element touches it, so a 0-overlap spot never covers an obstacle.
export const PLACEMENT_CELL = 4

export const point_in_rect = (point: { x: number; y: number }, rect: Rect): boolean =>
  point.x >= rect.x &&
  point.x <= rect.x + rect.width &&
  point.y >= rect.y &&
  point.y <= rect.y + rect.height

export const rects_overlap = (left_rect: Rect, right_rect: Rect): boolean =>
  !(
    left_rect.x + left_rect.width <= right_rect.x ||
    right_rect.x + right_rect.width <= left_rect.x ||
    left_rect.y + left_rect.height <= right_rect.y ||
    right_rect.y + right_rect.height <= left_rect.y
  )

// Place a legend/colorbar: in a free plot corner if there is one, else in the free spot with
// the most room around it, else where it covers the least data. Obstacles and exclusion rects
// fill an occupancy grid whose summed-area table counts any candidate in O(1), so every cell
// position is tried and every obstacle counts.
export function compute_element_placement(
  config: ElementPlacementConfig,
): ElementPlacementResult {
  const {
    plot_bounds,
    element_size,
    element,
    axis_clearance = 12,
    exclude_rects = [],
    obstacles,
  } = config
  // Include overflowing descendants such as colorbar tick labels after first render.
  const { width, height, offset_x, offset_y } = full_footprint_or(element, element_size)
  const plot_left = plot_bounds.x + axis_clearance
  const plot_right = plot_bounds.x + plot_bounds.width - axis_clearance
  const plot_top = plot_bounds.y + axis_clearance
  const plot_bottom = plot_bounds.y + plot_bounds.height - axis_clearance
  // Range of the footprint's top-left corner; an element larger than the area is centered on it
  const span = (lo: number, hi: number, size: number): [number, number] =>
    hi - size >= lo ? [lo, hi - size] : [(lo + hi - size) / 2, (lo + hi - size) / 2]
  const [x_min, x_max] = span(plot_left, plot_right, width)
  const [y_min, y_max] = span(plot_top, plot_bottom, height)

  const cols = Math.max(1, Math.ceil((x_max + width - x_min) / PLACEMENT_CELL))
  const rows = Math.max(1, Math.ceil((y_max + height - y_min) / PLACEMENT_CELL))
  // Summed-area table with a zero row and column: sums[(row + 1) * (cols + 1) + col + 1]
  const sums = new Float64Array((rows + 1) * (cols + 1))
  const cell = (value: number, origin: number, count: number, round = Math.floor) =>
    Math.max(0, Math.min(count, round((value - origin) / PLACEMENT_CELL)))
  const [grid_right, grid_bottom] = [x_max + width, y_max + height]
  // Adds `weight` to every grid cell the rect touches (a zero-size one, a point, marks its
  // cell) and returns the total added; one off the grid, which no candidate can cover, adds none
  const fill = (
    rect: { x: number; y: number; width?: number; height?: number },
    weight: number,
  ) => {
    const { x: left, y: top, width: rect_w = 0, height: rect_h = 0 } = rect
    // negated so NaN coordinates fail too
    if (
      !(
        left <= grid_right &&
        left + rect_w >= x_min &&
        top <= grid_bottom &&
        top + rect_h >= y_min
      )
    )
      return 0
    const [col_lo, row_lo] = [cell(left, x_min, cols - 1), cell(top, y_min, rows - 1)]
    const col_hi = Math.max(col_lo + 1, cell(left + rect_w, x_min, cols, Math.ceil))
    const row_hi = Math.max(row_lo + 1, cell(top + rect_h, y_min, rows, Math.ceil))
    for (let row = row_lo; row < row_hi; row++) {
      for (let col = col_lo; col < col_hi; col++)
        sums[(row + 1) * (cols + 1) + col + 1] += weight
    }
    return weight * (row_hi - row_lo) * (col_hi - col_lo)
  }
  let obstacle_weight = 0
  for (const obstacle of obstacles) obstacle_weight += fill(obstacle, 1)
  for (const rect of exclude_rects) fill(rect, obstacle_weight + 1)
  for (let row = 1; row <= rows; row++) {
    for (let col = 1; col <= cols; col++) {
      const idx = row * (cols + 1) + col
      sums[idx] += sums[idx - 1] + sums[idx - cols - 1] - sums[idx - cols - 2]
    }
  }
  const sum_at = (row: number, col: number) => sums[row * (cols + 1) + col]
  // Obstacle weight under the footprint at (left, top), grown by `margin` cells on every side
  const covered = (left: number, top: number, margin = 0): number => {
    const [col_lo, row_lo] = [
      cell(left, x_min, cols) - margin,
      cell(top, y_min, rows) - margin,
    ]
    const col_hi = cell(left + width, x_min, cols, Math.ceil) + margin
    const row_hi = cell(top + height, y_min, rows, Math.ceil) + margin
    const [c_lo, c_hi] = [Math.max(0, col_lo), Math.min(cols, col_hi)]
    const [r_lo, r_hi] = [Math.max(0, row_lo), Math.min(rows, row_hi)]
    return sum_at(r_hi, c_hi) - sum_at(r_lo, c_hi) - sum_at(r_hi, c_lo) + sum_at(r_lo, c_lo)
  }
  // Free margin (cells) around a free spot: the most it can grow and still cover nothing
  const room = (left: number, top: number): number => {
    let [lo, hi] = [0, Math.max(cols, rows)]
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (covered(left, top, mid) === 0) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  const at = ({ left, top }: { left: number; top: number }, overlaps: number) => ({
    x: left - offset_x,
    y: top - offset_y,
    overlaps,
  })

  // 1. A free corner, the one with the most room (farthest from the data); ties top-left first.
  // A one-cell lead is a tie: right/bottom corners sit off the grid and round out by a cell, so
  // symmetric data would otherwise flip corners on a 1px resize.
  let corner: { left: number; top: number; room: number } | null = null
  for (const top of [y_min, y_max]) {
    for (const left of [x_min, x_max]) {
      if (covered(left, top) > 0) continue
      const corner_room = room(left, top)
      if (!corner || corner_room > corner.room + 1) corner = { left, top, room: corner_room }
    }
  }
  if (corner) return at(corner, 0)

  // 2. Else every cell position: the least data covered, then the most room around a free spot,
  // which centers the element in a gap instead of flipping between its ends as the plot resizes
  const steps = (lo: number, hi: number): number[] => [
    ...Array.from(
      { length: Math.ceil((hi - lo) / PLACEMENT_CELL) },
      (_, idx) => lo + idx * PLACEMENT_CELL,
    ),
    hi,
  ]
  let best = { left: x_min, top: y_min, overlaps: Infinity, room: -1 }
  for (const left of steps(x_min, x_max)) {
    for (const top of steps(y_min, y_max)) {
      const overlaps = covered(left, top)
      if (overlaps > best.overlaps) continue
      // a free spot that can't grow past the best one's room is no better: skip its search
      if (overlaps === 0 && best.overlaps === 0 && covered(left, top, best.room + 1) > 0)
        continue
      const spot_room = overlaps === 0 ? room(left, top) : -1
      if (overlaps < best.overlaps || spot_room > best.room)
        best = { left, top, overlaps, room: spot_room }
    }
  }
  return at(best, best.overlaps)
}
