import { resolve_tick_layout, TICK_LABEL_HEIGHT } from '$lib/plot/core/tick-layout'
import type { MeasuredAxis } from '$lib/plot/core/tick-layout'
import {
  DEFAULT_FONT_SPEC,
  measure_text_line,
  wrap_text_paragraph,
} from '$lib/plot/core/text-metrics'
import type { FontSpec, TextLineMetrics } from '$lib/plot/core/text-metrics'
import type { AxisConfig } from '$lib/plot/core/types'

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

const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': `\u00A0`,
  '&amp;': `&`,
  '&lt;': `<`,
  '&gt;': `>`,
  '&quot;': `"`,
  '&#39;': `'`,
}
const decode_axis_title_text = (value: string): string =>
  value.replaceAll(/&(?:nbsp|amp|lt|gt|quot|#39);/gu, (entity) => HTML_ENTITIES[entity])

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
  const active_tags: (`sub` | `sup`)[] = []
  const tag_pattern = /<(?<closing>\/?)(?<tag>sub|sup)\b[^>]*>/giu
  let cursor = 0
  for (const match of value.matchAll(tag_pattern)) {
    const match_idx = match.index ?? 0
    const active_tag = active_tags.at(-1)
    append_axis_title_segment(
      segments,
      decode_axis_title_text(value.slice(cursor, match_idx)),
      active_tag === `sub` ? `sub` : active_tag === `sup` ? `super` : undefined,
    )
    const tag = match.groups?.tag?.toLowerCase() as `sub` | `sup` | undefined
    if (tag && match.groups?.closing) {
      const tag_idx = active_tags.lastIndexOf(tag)
      if (tag_idx !== -1) active_tags.splice(tag_idx, 1)
    } else if (tag) active_tags.push(tag)
    cursor = match_idx + match[0].length
  }
  const active_tag = active_tags.at(-1)
  append_axis_title_segment(
    segments,
    decode_axis_title_text(value.slice(cursor)),
    active_tag === `sub` ? `sub` : active_tag === `sup` ? `super` : undefined,
  )

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
  const option =
    axis.options?.find(({ key }) => key === axis.selected_key) ?? axis.options?.[0]
  const value = option?.unit
    ? `${option.label} (${option.unit})`
    : (option?.label ?? axis.label ?? ``)
  const segments = parse_axis_title_segments(value)
  return {
    label: segments.map(({ text }) => text).join(``),
    segments,
    interactive: option !== undefined,
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

const segments_for_wrapped_lines = (
  paragraph: readonly AxisTitleSegment[],
  lines: readonly string[],
): AxisTitleSegment[][] => {
  const normalized: AxisTitleSegment[] = []
  let pending_space = false
  for (const { text, shift } of paragraph) {
    for (const character of text) {
      if (/\s/u.test(character)) {
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
  font: Readonly<FontSpec> = DEFAULT_AXIS_TITLE_FONT,
): AxisTitleLayout {
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
    // PortalSelect: 4px horizontal padding on both sides plus a 0.3em flex gap.
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

// Left y-title x: auto-padding reserves [outer | title | gap | ticks] from the plot edge
// inward. The title is *centered* on label_x, so that center sits in the middle of the
// title band (not on the gap/title boundary, which jammed glyphs into the gap).
export function y_axis_label_x(
  axis: AxisConfig,
  pad_l: number,
  max_tick_width: number,
): number {
  const inside = axis.tick_label?.inside ?? false
  const tick_shift = inside ? 0 : (axis.tick_label?.shift?.x ?? 0)
  const tick_extent = inside ? 0 : max_tick_width + 8 - tick_shift
  const title_height = resolve_axis_title_layout(axis).height || AXIS_LABEL_HEIGHT
  const title_center = title_height / 2
  return Math.max(
    title_center,
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

// Ignore undefined sides so optional props never override defaults.
export const filter_padding = (
  padding: Partial<Sides> | undefined | null,
  defaults: Required<Sides>,
): Required<Sides> => ({
  ...defaults,
  ...Object.fromEntries(Object.entries(padding ?? {}).filter(([, val]) => val !== undefined)),
})

// Measure an element's full visual footprint, including descendants that overflow its
// offset box. Colorbar tick labels are position:absolute outside the bar, so
// offsetWidth/offsetHeight underestimate the space they actually occupy — which lets
// auto-placement put the colorbar where its labels overlap the axes.
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

// Full footprint once the element is laid out, else `fallback` (offset dims read 0
// before first render). NOT interchangeable with decorations' measured_footprint:
// that returns the offset box, which underestimates elements with overflowing
// absolutely-positioned descendants like colorbar tick labels.
export const full_footprint_or = (
  el: HTMLElement | null | undefined,
  fallback: Size,
): ElementFootprint =>
  el?.offsetWidth && el?.offsetHeight
    ? measure_full_footprint(el)
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
  label_gap?: number // Gap between tick labels and axis labels (default: LABEL_GAP_DEFAULT)
  width?: number // Plot width, needed to know whether x tick labels have to rotate
  height?: number // Plot height, needed for y/y2 wrapping and thinning
}

const project_measured_axis = (
  axis: MeasuredAxis,
  target_start: number,
  target_end: number,
): MeasuredAxis => {
  const positions = axis.tick_positions
  if (!positions || positions.length === 0) return axis
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
  if (source_span === 0) {
    return {
      ...axis,
      tick_positions: positions.map(() => (target_start + target_end) / 2),
      axis_extent: { start: target_start, end: target_end },
    }
  }
  return {
    ...axis,
    tick_positions: positions.map(
      (position) =>
        target_start + ((position - source_extent.start) / source_span) * target_span,
    ),
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
  label_gap = LABEL_GAP_DEFAULT,
  width,
  height,
}: AutoPaddingConfig): Required<Sides> => {
  const title_layout_for = (axis: MeasuredAxis, available_width: number): AxisTitleLayout =>
    resolve_axis_title_layout(
      axis,
      available_width > 0 ? available_width : AXIS_TITLE_WRAP_WIDTH,
    )
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
  // Padding for a vertical-axis side (y/y2): reserve outside tick offsets, the widest tick,
  // title gap, rotated title width, and outer air. Titles can render from interactive options
  // without a literal label, and still need their band when an axis intentionally has no ticks.
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
    const title_gap = has_title && has_outside_ticks ? label_gap : 0
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

  const top_pad = (available_width: number): number => {
    const ticks = x2_axis.tick_values ?? []
    const title_layout = title_layout_for(x2_axis, available_width)
    const has_title = title_layout.height > 0
    if (ticks.length === 0 && !has_title) return default_padding.t
    const inside = x2_axis.tick_label?.inside ?? false
    const has_outside_ticks = ticks.length > 0 && !inside
    const tick_shift = x2_axis.tick_label?.shift?.y ?? 0
    const tick_band = has_outside_ticks
      ? horizontal_tick_layout(x2_axis, available_width, `x2`).band
      : 0
    const tick_reach = has_outside_ticks ? tick_band + 8 + Math.max(0, -tick_shift) : 0
    // PlotAxis treats the x2 title shift as its distance from the baseline. Rotated or
    // wrapped ticks push the title farther out by the excess tick band.
    // Extra wrapped lines stack outward from that first line, so they count in full.
    const title_reach = has_title
      ? Math.max(0, x2_axis.label_shift?.y ?? AXIS_TITLE_OFFSET) +
        Math.max(0, tick_band - TICK_LABEL_HEIGHT) +
        title_layout.height -
        title_layout.line_height / 2
      : 0
    return Math.max(default_padding.t, Math.max(tick_reach, title_reach))
  }

  // Bottom depends on the angle the x labels will render at, since a rotated label projects
  // its own width downward. Reserving exactly what the title placement will use is what
  // keeps the surplus from becoming dead space.
  const bottom_pad = (available_width: number): number => {
    const inside = x_axis.tick_label?.inside ?? false
    const tick_values = x_axis.tick_values ?? []
    const has_outside_ticks = tick_values.length > 0 && !inside
    const title_layout = title_layout_for(x_axis, available_width)
    const title_height = title_layout.height
    if (!has_outside_ticks && title_height === 0) return default_padding.b
    const band = has_outside_ticks
      ? horizontal_tick_layout(x_axis, available_width, `x`).band
      : TICK_LABEL_HEIGHT
    const tick_shift = Math.max(0, x_axis.tick_label?.shift?.y ?? 0)
    // The title's first line sits one gap past the labels and is centered there, so half a
    // line reaches further still; wrapped lines stack below it in full. LABEL_GAP_DEFAULT,
    // not `label_gap`: PlotAxis places it via AXIS_TITLE_OFFSET.
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

  // One deterministic refinement makes y density use the top/bottom bands selected above,
  // then gives x/x2 the resulting horizontal span. Keeping this bounded avoids reactive
  // fixed-point oscillation while matching the final rendered plot on both dimensions.
  if (height != null) {
    const refined_plot_height = Math.max(0, height - pad_t - pad_b)
    ;[pad_l, pad_r] = vertical_pads(refined_plot_height)
    plot_width = width == null ? 0 : Math.max(0, width - pad_l - pad_r)
    pad_t = padding.t ?? top_pad(plot_width)
    pad_b = padding.b ?? bottom_pad(plot_width)
  }

  return { t: pad_t, b: pad_b, l: pad_l, r: pad_r }
}

// Continuous placement algorithm with grid sampling and overlap scoring
// Finds the optimal position for a legend/colorbar by sampling a grid of candidates
// and scoring each by data point overlap and distance to exclusion zones

// Common rectangle type for consistency
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
  // Element to place. When provided and laid out, its full visual footprint
  // (including descendants that overflow the box, e.g. colorbar tick labels) is
  // measured and overrides element_size — keeping placement overlap-free everywhere.
  element?: HTMLElement | null
  // Minimum distance from plot edges to avoid axis label overlap (default: 12)
  axis_clearance?: number
  // Rectangles to avoid (e.g., already-placed legend when placing colorbar)
  exclude_rects?: Rect[]
  // Data points to avoid overlapping
  points: { x: number; y: number }[]
}

interface ElementPlacementResult {
  x: number
  y: number
  score: number // Higher is better (fewer overlaps, farther from points)
}

// Scoring constants
const EXCLUSION_PENALTY = 1000
const DISTANCE_WEIGHT = 0.001
// Strong corner preference: corners can have 3-4 more overlapping points and still win
const CORNER_WEIGHT = 5.0
const MAX_SAMPLE_POINTS = 500
// Candidate positions sampled per axis (GRID_RESOLUTION² candidates per placement)
const GRID_RESOLUTION = 10

// Check if a point is inside a rectangle
export const point_in_rect = (point: { x: number; y: number }, rect: Rect): boolean =>
  point.x >= rect.x &&
  point.x <= rect.x + rect.width &&
  point.y >= rect.y &&
  point.y <= rect.y + rect.height

// Check if two rectangles overlap
export const rects_overlap = (left_rect: Rect, right_rect: Rect): boolean =>
  !(
    left_rect.x + left_rect.width <= right_rect.x ||
    right_rect.x + right_rect.width <= left_rect.x ||
    left_rect.y + left_rect.height <= right_rect.y ||
    right_rect.y + right_rect.height <= left_rect.y
  )

// Evenly thin items while preserving order and both endpoints so placement cost stays
// bounded without dropping an abrupt series tail the decoration solver should avoid.
export const stride_sample = <T>(items: readonly T[], limit: number): readonly T[] => {
  if (items.length <= limit) return items
  if (limit <= 1) return items.slice(0, Math.max(0, limit))
  const last_idx = items.length - 1
  return Array.from(
    { length: limit },
    (_, idx) => items[Math.round((idx * last_idx) / (limit - 1))],
  )
}

// Keep long thinned segments from recreating more filler points than sampling removed.
const MAX_SEGMENT_SAMPLES = 64

// Include finite vertices and, for connected series, sample long segments so auto-placed
// decorations avoid sparse lines. Callers can accumulate series in one obstacle array.
export function sample_series_obstacle_points(
  pixel_points: { x: number; y: number }[],
  draws_line: boolean,
  step: number,
  obstacles: { x: number; y: number }[] = [],
): { x: number; y: number }[] {
  let previous: { x: number; y: number } | null = null
  for (const point of pixel_points) {
    if (!isFinite(point.x) || !isFinite(point.y)) {
      previous = null // non-finite breaks the line; don't sample across the gap
      continue
    }
    obstacles.push(point)
    if (draws_line && previous && step > 0) {
      const n_samples = Math.min(
        MAX_SEGMENT_SAMPLES,
        Math.floor(Math.hypot(point.x - previous.x, point.y - previous.y) / step),
      )
      for (let idx = 1; idx < n_samples; idx++) {
        const frac = idx / n_samples
        const x = previous.x + (point.x - previous.x) * frac
        const y = previous.y + (point.y - previous.y) * frac
        obstacles.push({ x, y })
      }
    }
    previous = point
  }
  return obstacles
}

// Score grid positions by point overlap, exclusion rectangles, nearest-point distance,
// and corner proximity.
export function compute_element_placement(
  config: ElementPlacementConfig,
): ElementPlacementResult {
  const {
    plot_bounds,
    element_size,
    element,
    axis_clearance = 12,
    exclude_rects = [],
    points,
  } = config

  // Include overflowing descendants such as colorbar tick labels after first render.
  const {
    width: elem_width,
    height: elem_height,
    offset_x,
    offset_y,
  } = full_footprint_or(element, element_size)

  const plot_left = plot_bounds.x + axis_clearance
  const plot_right = plot_bounds.x + plot_bounds.width - axis_clearance
  const plot_top = plot_bounds.y + axis_clearance
  const plot_bottom = plot_bounds.y + plot_bounds.height - axis_clearance
  const valid_x_min = plot_left - offset_x
  const valid_y_min = plot_top - offset_y
  const valid_x_max = plot_right - offset_x - elem_width
  const valid_y_max = plot_bottom - offset_y - elem_height

  const effective_x_min = Math.min(valid_x_min, valid_x_max)
  const effective_x_max = Math.max(valid_x_min, valid_x_max)
  const effective_y_min = Math.min(valid_y_min, valid_y_max)
  const effective_y_max = Math.max(valid_y_min, valid_y_max)

  const sampled_points = stride_sample(points, MAX_SAMPLE_POINTS)

  let best_result: ElementPlacementResult = {
    x: effective_x_min,
    y: effective_y_min,
    score: -Infinity,
  }

  const x_step = (effective_x_max - effective_x_min) / (GRID_RESOLUTION - 1)
  const y_step = (effective_y_max - effective_y_min) / (GRID_RESOLUTION - 1)

  const max_corner_dist = Math.hypot(plot_right - plot_left, plot_bottom - plot_top)

  for (let grid_x = 0; grid_x < GRID_RESOLUTION; grid_x++) {
    for (let grid_y = 0; grid_y < GRID_RESOLUTION; grid_y++) {
      const cand_x = effective_x_min + grid_x * x_step
      const cand_y = effective_y_min + grid_y * y_step
      const rect_left = cand_x + offset_x
      const rect_top = cand_y + offset_y
      const rect_right = rect_left + elem_width
      const rect_bottom = rect_top + elem_height
      const cand_rect: Rect = {
        x: rect_left,
        y: rect_top,
        width: elem_width,
        height: elem_height,
      }

      // Check for overlap with exclusion rectangles first (early rejection)
      let exclusion_penalty = 0
      for (const excl_rect of exclude_rects) {
        if (rects_overlap(cand_rect, excl_rect)) exclusion_penalty += EXCLUSION_PENALTY
      }

      let overlap_count = 0
      let min_distance_sq = Infinity
      const center_x = rect_left + elem_width / 2
      const center_y = rect_top + elem_height / 2
      // Containment inlined rather than via point_in_rect: this loop runs GRID_RESOLUTION²
      // times over the sampled field, so per-point call overhead dominates.
      for (const point of sampled_points) {
        const { x: point_x, y: point_y } = point
        if (
          point_x >= rect_left &&
          point_x <= rect_right &&
          point_y >= rect_top &&
          point_y <= rect_bottom
        ) {
          overlap_count++
        }
        const dx = point_x - center_x
        const dy = point_y - center_y
        const distance_sq = dx * dx + dy * dy
        if (distance_sq < min_distance_sq) min_distance_sq = distance_sq
      }

      // No points means no nearest-point bonus.
      const min_distance = min_distance_sq === Infinity ? 0 : Math.sqrt(min_distance_sq)

      // Corner proximity scores from the measured footprint, not its center. Math.hypot
      // directly rather than euclidean_dist, whose vector form allocates two array literals,
      // a mapped difference array, and a spread on each of its four calls per candidate.
      const min_corner_dist = Math.min(
        Math.hypot(rect_left - plot_left, rect_top - plot_top), // top-left
        Math.hypot(rect_right - plot_right, rect_top - plot_top), // top-right
        Math.hypot(rect_left - plot_left, rect_bottom - plot_bottom), // bottom-left
        Math.hypot(rect_right - plot_right, rect_bottom - plot_bottom), // bottom-right
      )
      const corner_bonus =
        max_corner_dist > 0 ? (1 - min_corner_dist / max_corner_dist) * CORNER_WEIGHT : 0

      const score =
        -overlap_count + min_distance * DISTANCE_WEIGHT + corner_bonus - exclusion_penalty

      if (score > best_result.score) {
        best_result = { x: cand_x, y: cand_y, score }
      }
    }
  }

  return best_result
}
