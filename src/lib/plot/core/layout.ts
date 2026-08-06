import { format_value_or_num } from '$lib/labels'
import { euclidean_dist, to_radians } from '$lib/math'
import { get_tick_label } from '$lib/plot/core/scales'
import type { AxisConfig } from '$lib/plot/core/types'

export type Sides = { t?: number; b?: number; l?: number; r?: number }

export const sides_equal = (left: Required<Sides>, right: Required<Sides>): boolean =>
  left.t === right.t && left.b === right.b && left.l === right.l && left.r === right.r

// Default gap between tick labels and axis labels
export const LABEL_GAP_DEFAULT = 20
// Estimated height of a single tick label line (font-size 0.8em ≈ 12px + leading)
export const TICK_LABEL_HEIGHT = 16
// Estimated thickness of a rotated y-axis title (font-size ~14px + margin) — also the
// band auto-padding reserves beyond the tick+gap for that title.
export const AXIS_LABEL_HEIGHT = 20
// Air between the plot's outer edge and the y-title glyph box. Matches the slack under
// the x-title (default pad.b 60 − AXIS_TITLE_OFFSET 36 − ~half the title ≈ 14).
export const AXIS_LABEL_OUTER = 12
// Distance from an x/x2 axis baseline to the title center.
export const AXIS_TITLE_OFFSET = TICK_LABEL_HEIGHT + LABEL_GAP_DEFAULT

// Default plot padding (px) reserved for axis ticks/labels, shared by
// Histogram/BarPlot/BoxPlot/BinnedScatterPlot (ScatterPlot keeps its own bespoke default)
export const DEFAULT_PLOT_PADDING: Required<Sides> = { t: 20, b: 60, l: 60, r: 20 }

const has_axis_title = (axis: AxisConfig): boolean =>
  axis.label ? true : Boolean(axis.options?.length)

// Left y-title x: auto-padding reserves [outer | title | gap | ticks] from the plot edge
// inward. The title is *centered* on label_x, so that center sits in the middle of the
// title band (not on the gap/title boundary, which jammed glyphs into the gap).
export function y_axis_label_x(
  axis: AxisConfig,
  pad_l: number,
  max_tick_width: number,
): number {
  const inside = axis.tick?.label?.inside ?? false
  const tick_shift = inside ? 0 : (axis.tick?.label?.shift?.x ?? 0)
  const tick_extent = inside ? 0 : max_tick_width + 8 - tick_shift
  const title_center = AXIS_LABEL_OUTER + AXIS_LABEL_HEIGHT / 2
  return Math.max(
    title_center,
    pad_l -
      tick_extent -
      LABEL_GAP_DEFAULT -
      AXIS_LABEL_HEIGHT / 2 +
      (axis.label_shift?.x ?? 0),
  )
}

// Right y2-title x: mirror of y_axis_label_x (title center in its band, past the outer air).
export function y2_axis_label_x(
  axis: AxisConfig,
  width: number,
  pad_r: number,
  max_tick_width: number,
): number {
  const inside = axis.tick?.label?.inside ?? false
  const tick_shift = inside ? 0 : (axis.tick?.label?.shift?.x ?? 0) + 8
  const label_offset =
    (inside ? 0 : max_tick_width) +
    LABEL_GAP_DEFAULT +
    AXIS_LABEL_HEIGHT / 2 +
    (axis.label_shift?.x ?? 0)
  return Math.min(
    width - AXIS_LABEL_OUTER - AXIS_LABEL_HEIGHT / 2,
    width - pad_r + tick_shift + label_offset,
  )
}

// Ignore undefined sides so optional props never override defaults.
export const filter_padding = (
  padding: Partial<Sides> | undefined | null,
  defaults: Required<Sides>,
): Required<Sides> => ({
  ...defaults,
  ...Object.fromEntries(Object.entries(padding ?? {}).filter(([, val]) => val !== undefined)),
})

const TICK_FONT = `12px sans-serif`

// Measure text width using canvas (singleton pattern for performance)
let measurement_canvas: HTMLCanvasElement | null = null

export function measure_text_width(text: string, font: string = TICK_FONT): number {
  if (typeof document === `undefined`) return 0
  measurement_canvas ??= document.createElement(`canvas`)
  const ctx = measurement_canvas.getContext(`2d`)
  if (!ctx) return 0
  ctx.font = font
  return ctx.measureText(text).width
}

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
// before first render). NOT interchangeable with auto-place's measured_footprint:
// that returns the offset box, which underestimates elements with overflowing
// absolutely-positioned descendants like colorbar tick labels.
export const full_footprint_or = (
  el: HTMLElement | null | undefined,
  fallback: Size,
): ElementFootprint =>
  el?.offsetWidth && el?.offsetHeight
    ? measure_full_footprint(el)
    : { ...fallback, offset_x: 0, offset_y: 0 }

// An axis plus the labels it will actually draw, so layout can measure them. Categorical
// axes pass their category names here, not the numeric indices behind them.
export type MeasuredAxis = AxisConfig & { tick_values?: (string | number)[] }

const tick_text = (
  tick: string | number,
  format?: string,
  tick_labels?: AxisConfig[`ticks`],
): string =>
  typeof tick === `string`
    ? tick
    : (get_tick_label(tick, tick_labels) ?? format_value_or_num(tick, format))

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
}

// Measure the widest formatted tick label. Used for auto-padding and label placement.
export const measure_max_tick_width = (
  ticks: (string | number)[],
  format?: string,
  tick_labels?: AxisConfig[`ticks`],
): number => {
  if (ticks.length === 0) return 0
  return Math.max(
    ...ticks.map((tick) => measure_text_width(tick_text(tick, format, tick_labels))),
  )
}

// Candidate x tick-label rotations, shallowest first. Each step buys horizontal room but
// spends plot height, so the search takes the first angle that clears the overlap.
const TICK_ROTATION_LADDER = [30, 45, 60, 90] as const
// Air between neighbouring tick labels before they read as one word.
const TICK_LABEL_GAP = 6
const DEFAULT_TICK_LABEL_MAX_LINES = 3
// A steeper wrap must save at least 15% of the outward band to justify the angle.
const MAX_STEEPER_WRAPPED_BAND_RATIO = 0.85

// Split on semantic boundaries without changing the displayed text. Whitespace, separators,
// and lower-to-upper camel-case transitions are useful wrap points; ordinary words stay intact.
const TICK_WRAP_BOUNDARY =
  /(?<=[\p{L}\p{N}][_‐–—-])(?=[\p{L}\p{N}])|(?<=[^_‐–—-] )|(?<=[a-z]{2})(?=[A-Z])/u
const tick_label_segments = (text: string): string[] => text.split(TICK_WRAP_BOUNDARY)

type WrapChoice = { lines: string[]; max_width: number; balance: number }

const explicit_tick_lines = (text: string): string[] =>
  text.replaceAll(/^(?:\r?\n)+|(?:\r?\n)+$/g, ``).split(/\r?\n/)

// Wrap at semantic boundaries into the fewest lines that fit max_width. If no partition fits,
// return the narrowest partition within max_lines so the caller can compare it to rotation.
const wrap_tick_label = (text: string, max_width: number, max_lines: number): string[] => {
  const explicit_lines = explicit_tick_lines(text)
  if (explicit_lines.length > 1) return explicit_lines

  const normalized = text.trim().replaceAll(/[^\S\u00A0\u202F]+/gu, ` `)
  if (measure_text_width(normalized) <= max_width) return [normalized]
  const segments = tick_label_segments(normalized)
  const line_limit = Math.min(max_lines, segments.length)
  if (line_limit < 2) return [text]
  const metrics = Array.from({ length: segments.length }, (_segment, start_idx) =>
    Array.from({ length: segments.length + 1 }, (_, end_idx) => {
      const line =
        end_idx > start_idx ? segments.slice(start_idx, end_idx).join(``).trim() : ``
      return { line, width: line ? measure_text_width(line) : 0 }
    }),
  )
  let previous_choices: (WrapChoice | null)[] = metrics[0].map(({ line, width }, end_idx) =>
    end_idx === 0 ? null : { lines: [line], max_width: width, balance: width ** 2 },
  )
  let narrowest = [text]
  for (let line_count = 2; line_count <= line_limit; line_count++) {
    const choices = Array<WrapChoice | null>(segments.length + 1).fill(null)
    for (let end_idx = line_count; end_idx <= segments.length; end_idx++) {
      for (let start_idx = line_count - 1; start_idx < end_idx; start_idx++) {
        const previous = previous_choices[start_idx]
        if (!previous) continue
        const { line, width } = metrics[start_idx][end_idx]
        const candidate = {
          lines: [...previous.lines, line],
          max_width: Math.max(previous.max_width, width),
          balance: previous.balance + width ** 2,
        }
        const current = choices[end_idx]
        if (
          !current ||
          candidate.max_width < current.max_width ||
          (candidate.max_width === current.max_width && candidate.balance < current.balance)
        ) {
          choices[end_idx] = candidate
        }
      }
    }
    const choice = choices[segments.length]
    if (choice) {
      narrowest = choice.lines
      if (choice.max_width <= max_width) return choice.lines
    }
    previous_choices = choices
  }
  return narrowest
}

type LabelBlock = { width: number; height: number }

const label_block_band = (lines: string[], rotation: number): number => {
  const radians = to_radians(Math.abs(rotation))
  const width = Math.max(...lines.map((line) => measure_text_width(line)))
  return width * Math.sin(radians) + lines.length * TICK_LABEL_HEIGHT * Math.cos(radians)
}

const max_label_block = (labels: string[][]): LabelBlock => ({
  width: Math.max(...labels.flat().map((line) => measure_text_width(line))),
  height: Math.max(...labels.map((lines) => lines.length)) * TICK_LABEL_HEIGHT,
})

const auto_block_rotation = (block: LabelBlock, pitch_px: number): number | null => {
  if (!(pitch_px > 0) || block.width + TICK_LABEL_GAP <= pitch_px) return 0
  for (const candidate of TICK_ROTATION_LADDER) {
    if (pitch_px * Math.sin(to_radians(candidate)) >= block.height + TICK_LABEL_GAP) {
      return candidate
    }
  }
  return null
}

// Shallowest rotation that keeps neighbouring x tick labels apart, given the widest label
// and the horizontal pitch between adjacent ticks. Upright labels need their full width;
// rotated ones sit on parallel baselines whose perpendicular separation is
// `pitch * sin(angle)`, so they clear each other once that exceeds one line height. Returns
// 0 when labels already fit, and the steepest angle when even 90 degrees cannot.
//
// Negative by convention: anchored at their end, labels then trail down and to the *left*
// of their tick. Tilting the other way would push the last label off the right edge of the
// plot, where there is no margin to spill into.
export const auto_tick_rotation = (widest_px: number, pitch_px: number): number => {
  const angle = auto_block_rotation({ width: widest_px, height: TICK_LABEL_HEIGHT }, pitch_px)
  return angle === 0 ? 0 : -(angle ?? 90)
}

export const calc_auto_padding = ({
  padding,
  default_padding,
  x_axis = {},
  x2_axis = {},
  y_axis = {},
  y2_axis = {},
  label_gap = LABEL_GAP_DEFAULT,
  width,
}: AutoPaddingConfig): Required<Sides> => {
  // Padding for a vertical-axis side (y/y2): reserve outside tick offsets, the widest tick,
  // title gap, rotated title width, and outer air. Titles can render from interactive options
  // without a literal label, and still need their band when an axis intentionally has no ticks.
  const side_pad = (
    axis: MeasuredAxis,
    default_side: number,
    side: `left` | `right`,
  ): number => {
    const ticks = axis.tick_values ?? []
    const has_title = has_axis_title(axis)
    if (ticks.length === 0 && !has_title) return default_side
    const inside = axis.tick?.label?.inside ?? false
    const tick_shift = axis.tick?.label?.shift?.x ?? 0
    const has_outside_ticks = ticks.length > 0 && !inside
    const tick_width = has_outside_ticks
      ? measure_max_tick_width(ticks, axis.format, axis.ticks)
      : 0
    const tick_offset = !has_outside_ticks
      ? 0
      : 8 + Math.max(0, side === `left` ? -tick_shift : tick_shift)
    const title_band = has_title ? AXIS_LABEL_HEIGHT + AXIS_LABEL_OUTER : 0
    const title_gap = has_title && has_outside_ticks ? label_gap : 0
    const title_shift = axis.label_shift?.x ?? 0
    const title_shift_outward = Math.max(0, side === `left` ? -title_shift : title_shift)
    return Math.max(
      default_side,
      tick_width + title_gap + title_band + tick_offset + title_shift_outward,
    )
  }
  // Resolved before the x/x2 helpers below, which need the true plot width to know whether
  // the tick labels have to rotate. Left/right never depend on top/bottom, so there is no cycle.
  const pad_l = padding.l ?? side_pad(y_axis, default_padding.l, `left`)
  const pad_r = padding.r ?? side_pad(y2_axis, default_padding.r, `right`)
  // No width means no way to tell whether labels collide, so they are treated as upright
  const plot_width = width == null ? 0 : width - pad_l - pad_r

  const top_pad = (): number => {
    const ticks = x2_axis.tick_values ?? []
    const has_title = has_axis_title(x2_axis)
    if (ticks.length === 0 && !has_title) return default_padding.t
    const inside = x2_axis.tick?.label?.inside ?? false
    const has_outside_ticks = ticks.length > 0 && !inside
    const tick_shift = x2_axis.tick?.label?.shift?.y ?? 0
    // Same reach the labels will actually have; assuming one upright line here is what
    // clips a rotated top axis off the figure.
    const tick_band = has_outside_ticks
      ? resolve_tick_layout(x2_axis, plot_width, `x2`).band + 8 + Math.max(0, -tick_shift)
      : 0
    const title_band = has_title
      ? AXIS_LABEL_HEIGHT + Math.max(0, x2_axis.label_shift?.y ?? 0)
      : 0
    const title_gap = has_title && has_outside_ticks ? label_gap : 0
    const outer_air = has_title || has_outside_ticks ? AXIS_LABEL_OUTER : 0
    return Math.max(default_padding.t, tick_band + title_gap + title_band + outer_air)
  }

  // Bottom depends on the angle the x labels will render at, since a rotated label projects
  // its own width downward. Reserving exactly what the title placement will use is what
  // keeps the surplus from becoming dead space.
  const bottom_pad = (): number => {
    const inside = x_axis.tick?.label?.inside ?? false
    // Inside labels reach into the plot, and no labels reach nowhere: neither needs room
    if (inside || (x_axis.tick_values ?? []).length === 0) return default_padding.b
    const { rotation, band } = resolve_tick_layout(x_axis, plot_width, `x`)
    if (rotation === 0 && band <= TICK_LABEL_HEIGHT) return default_padding.b
    const tick_shift = Math.max(0, x_axis.tick?.label?.shift?.y ?? 0)
    // The title sits one gap past the labels and is centered, so half of it reaches further
    // still. LABEL_GAP_DEFAULT, not `label_gap`: PlotAxis places it via AXIS_TITLE_OFFSET.
    const below_baseline = has_axis_title(x_axis)
      ? band + LABEL_GAP_DEFAULT + AXIS_LABEL_HEIGHT / 2
      : band
    return Math.max(default_padding.b, below_baseline + tick_shift + AXIS_LABEL_OUTER)
  }

  return {
    t: padding.t ?? top_pad(),
    b: padding.b ?? bottom_pad(),
    l: pad_l,
    r: pad_r,
  }
}

// Resolve wrapping, rotation, and the outward band as one layout decision so padding and
// rendering cannot disagree. Automatic labels compare wrapped and unwrapped rotations and use
// the smaller band; explicit rotations remain exact.
export const resolve_tick_layout = (
  axis: MeasuredAxis,
  plot_width: number,
  side: `x` | `x2` | `y` | `y2`,
) => {
  const ticks = axis.tick_values ?? []
  const labels = ticks.map((tick) => tick_text(tick, axis.format, axis.ticks))
  const is_horizontal = side === `x` || side === `x2`
  const unwrapped_lines = labels.map((label) =>
    is_horizontal ? explicit_tick_lines(label) : [label],
  )
  const configured = axis.tick?.label?.rotation ?? `auto`
  const layout_for = (lines: string[][], rotation: number) => ({
    rotation,
    band:
      lines.length === 0
        ? TICK_LABEL_HEIGHT
        : Math.max(...lines.map((label_lines) => label_block_band(label_lines, rotation))),
    lines,
  })

  if (configured !== `auto`) return layout_for(unwrapped_lines, configured)
  if (!is_horizontal || ticks.length === 0 || !(plot_width > 0)) {
    return layout_for(unwrapped_lines, 0)
  }

  const pitch = plot_width / ticks.length
  const unwrapped_block = max_label_block(unwrapped_lines)
  const raw_max_lines = axis.tick?.label?.max_lines ?? DEFAULT_TICK_LABEL_MAX_LINES
  const max_lines = Number.isFinite(raw_max_lines)
    ? Math.max(1, Math.floor(raw_max_lines))
    : DEFAULT_TICK_LABEL_MAX_LINES
  if (unwrapped_block.width + TICK_LABEL_GAP <= pitch) {
    return layout_for(unwrapped_lines, 0)
  }

  // Which sign trails up-and-to-the-left — the direction that keeps the last label on the
  // figure — is set by which side of the baseline the labels sit on: x2 puts them above,
  // and so does an x axis labelled `inside`.
  const above_baseline = (side === `x2`) !== (axis.tick?.label?.inside ?? false)
  const signed_rotation = (angle: number): number =>
    angle === 0 ? 0 : above_baseline ? angle : -angle

  // A lone label has no neighbour to collide with. It may wrap to stay within the plot, but
  // rotating it away from its centered anchor would create edge overflow rather than fix it.
  const unwrapped_angle =
    ticks.length === 1 ? 0 : (auto_block_rotation(unwrapped_block, pitch) ?? 90)
  const unwrapped = layout_for(unwrapped_lines, signed_rotation(unwrapped_angle))
  if (max_lines <= 1) return unwrapped
  const wrapped_lines = labels.map((label) =>
    wrap_tick_label(label, Math.max(0, pitch - TICK_LABEL_GAP), max_lines),
  )
  const wrapped_block = max_label_block(wrapped_lines)
  if (ticks.length === 1) {
    return wrapped_block.width < unwrapped_block.width
      ? layout_for(wrapped_lines, 0)
      : unwrapped
  }

  const wrapped_angle = auto_block_rotation(wrapped_block, pitch)
  if (wrapped_angle == null) return unwrapped
  const wrapped = layout_for(wrapped_lines, signed_rotation(wrapped_angle))
  const not_steeper = Math.abs(wrapped.rotation) <= Math.abs(unwrapped.rotation)
  const clearly_shorter = wrapped.band <= unwrapped.band * MAX_STEEPER_WRAPPED_BAND_RATIO
  return not_steeper || clearly_shorter ? wrapped : unwrapped
}

const constrain_axis_position = (
  cursor: number,
  size: number,
  viewport_size: number,
  offset: number,
): number => {
  const distance = Math.abs(offset)
  const after = cursor + distance
  const before = cursor - distance - size
  const preferred = offset >= 0 ? after : before
  const alternate = offset >= 0 ? before : after
  const overflow = offset >= 0 ? preferred + size > viewport_size : preferred < 0
  return Math.max(0, Math.min(overflow ? alternate : preferred, viewport_size - size))
}

// Positive offsets prefer right/down; negative offsets prefer left/up.
export function constrain_tooltip_position(
  cursor_x: number,
  cursor_y: number,
  tooltip_width: number,
  tooltip_height: number,
  viewport_width: number,
  viewport_height: number,
  options: { offset?: number; offset_x?: number; offset_y?: number } = {},
): { x: number; y: number } {
  const { offset = 10 } = options
  const offset_x = options.offset_x ?? offset
  const offset_y = options.offset_y ?? offset
  return {
    x: constrain_axis_position(cursor_x, tooltip_width, viewport_width, offset_x),
    y: constrain_axis_position(cursor_y, tooltip_height, viewport_height, offset_y),
  }
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

export interface ElementPlacementConfig {
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
  // Number of samples per axis (default: 10, meaning 10x10 = 100 candidates)
  grid_resolution?: number
}

export interface ElementPlacementResult {
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

// Include finite vertices and, for connected series, sample long segments so auto-placed
// legends and colorbars avoid lines between sparse markers.
export function sample_series_obstacle_points(
  pixel_points: { x: number; y: number }[],
  draws_line: boolean,
  step: number,
): { x: number; y: number }[] {
  const obstacles: { x: number; y: number }[] = []
  let prev: { x: number; y: number } | null = null
  for (const point of pixel_points) {
    if (!isFinite(point.x) || !isFinite(point.y)) {
      prev = null // non-finite breaks the line; don't sample across the gap
      continue
    }
    obstacles.push(point)
    if (draws_line && prev && step > 0) {
      const n_samples = Math.floor(Math.hypot(point.x - prev.x, point.y - prev.y) / step)
      for (let idx = 1; idx < n_samples; idx++) {
        const frac = idx / n_samples
        const x = prev.x + (point.x - prev.x) * frac
        const y = prev.y + (point.y - prev.y) * frac
        obstacles.push({ x, y })
      }
    }
    prev = point
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
    grid_resolution: raw_resolution = 10,
  } = config

  const grid_resolution = Math.max(2, raw_resolution)

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

  const sampled_points =
    points.length > MAX_SAMPLE_POINTS
      ? Array.from(
          { length: MAX_SAMPLE_POINTS },
          (_, idx) => points[Math.floor((idx * points.length) / MAX_SAMPLE_POINTS)],
        )
      : points

  let best_result: ElementPlacementResult = {
    x: effective_x_min,
    y: effective_y_min,
    score: -Infinity,
  }

  const x_step = (effective_x_max - effective_x_min) / (grid_resolution - 1)
  const y_step = (effective_y_max - effective_y_min) / (grid_resolution - 1)

  const max_corner_dist = euclidean_dist([plot_left, plot_top], [plot_right, plot_bottom])

  for (let grid_x = 0; grid_x < grid_resolution; grid_x++) {
    for (let grid_y = 0; grid_y < grid_resolution; grid_y++) {
      const cand_x = effective_x_min + grid_x * x_step
      const cand_y = effective_y_min + grid_y * y_step
      const cand_rect: Rect = {
        x: cand_x + offset_x,
        y: cand_y + offset_y,
        width: elem_width,
        height: elem_height,
      }

      // Check for overlap with exclusion rectangles first (early rejection)
      let exclusion_penalty = 0
      for (const excl_rect of exclude_rects) {
        if (rects_overlap(cand_rect, excl_rect)) {
          exclusion_penalty += EXCLUSION_PENALTY
        }
      }

      let overlap_count = 0
      let min_distance_sq = Infinity
      const center_x = cand_rect.x + elem_width / 2
      const center_y = cand_rect.y + elem_height / 2

      for (const point of sampled_points) {
        if (point_in_rect(point, cand_rect)) {
          overlap_count++
        }
        const dx = point.x - center_x
        const dy = point.y - center_y
        const distance_sq = dx * dx + dy * dy
        if (distance_sq < min_distance_sq) min_distance_sq = distance_sq
      }

      // No points means no nearest-point bonus.
      const min_distance = min_distance_sq === Infinity ? 0 : Math.sqrt(min_distance_sq)

      // Score corner proximity from the measured footprint, not its center.
      const elem_right = cand_rect.x + elem_width
      const elem_bottom = cand_rect.y + elem_height

      const min_corner_dist = Math.min(
        euclidean_dist([cand_rect.x, cand_rect.y], [plot_left, plot_top]), // top-left
        euclidean_dist([elem_right, cand_rect.y], [plot_right, plot_top]), // top-right
        euclidean_dist([cand_rect.x, elem_bottom], [plot_left, plot_bottom]), // bottom-left
        euclidean_dist([elem_right, elem_bottom], [plot_right, plot_bottom]), // bottom-right
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
