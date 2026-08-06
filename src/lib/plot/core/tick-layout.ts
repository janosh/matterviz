import { format_value_or_num } from '$lib/labels'
import { get_tick_label } from '$lib/plot/core/scales'
import { suggest_tick_count, thin_tick_indices } from '$lib/plot/core/tick-density'
import {
  analyze_tick_label_geometry,
  default_tick_label_anchor,
  type TickAxisExtent,
  type TickLabelAnchor,
  type TickLabelGeometry,
} from '$lib/plot/core/tick-geometry'
import {
  clear_text_metrics_cache,
  DEFAULT_FONT_SPEC,
  measure_css_text_width,
  measure_text_line,
  type FontSpec,
} from '$lib/plot/core/text-metrics'
import {
  create_tick_candidate,
  generate_abbreviated_candidate,
  generate_ellipsis_candidate,
  generate_stagger_candidate,
  generate_thinned_candidate,
  select_tick_candidate,
  TICK_STRATEGIES,
  type MeasuredTickCandidate,
  type TickScoringConfig,
  type TickStrategy,
  type TickStrategyCandidate,
} from '$lib/plot/core/tick-strategies'
import type { AxisConfig, TickAutoLayoutConfig } from '$lib/plot/core/types'
import { SvelteSet } from 'svelte/reactivity'

// Deterministic pre-mount height. PlotAxis replaces this font with the resolved computed font.
export const TICK_LABEL_HEIGHT = 16
export const TICK_LABEL_GAP = 6
export const TICK_STAGGER_GAP = 4

// Widths come from the shared text-metrics cache either way; hierarchy labels hold a canvas
// font shorthand, while tick layout holds the FontSpec resolved off a rendered tick.
export const measure_text_width = (
  text: string,
  font: string | Readonly<FontSpec> = DEFAULT_FONT_SPEC,
): number =>
  typeof font === `string`
    ? measure_css_text_width(text, font)
    : measure_text_line(text, font).width

// An axis plus the labels it will actually draw, so layout can measure them. Categorical
// axes pass their category names here, not the numeric indices behind them.
export type MeasuredAxis = AxisConfig & {
  tick_values?: (string | number)[]
  // Rendered pixel coordinates in tick_values order. Only callers without a scale should omit
  // these and use the legacy equal-slot projection.
  tick_positions?: number[]
  axis_extent?: TickAxisExtent
  tick_font?: Readonly<FontSpec>
}

export type TickLayoutSide = `x` | `x2` | `y` | `y2`

export interface ResolvedTickLabel {
  tick_index: number
  full_text: string
  display_text: string
  lines: string[]
  visible: boolean
  anchor: TickLabelAnchor
  rotation: number
  stagger_row: 0 | 1
}

export interface ResolvedTickLayout {
  rotation: number
  band: number
  lines: string[][]
  labels: ResolvedTickLabel[]
  visible_tick_indices: number[]
  visible_ticks: (string | number)[]
  strategy: TickStrategy
  stagger_step: number
}

// Retain the latest exact layout per side for duplicate padding/render lookups. Resizes and
// zooms replace these entries instead of accumulating geometry keys that cannot be reused.
let cached_layouts: Partial<
  Record<TickLayoutSide, { key: string; value: ResolvedTickLayout }>
> = {}

// Drop memoised layouts and the text metrics they were derived from. Call after the rendering
// font changes (web font load) or, in tests, between cases that stub canvas measurement.
export const clear_tick_metrics_cache = (): void => {
  cached_layouts = {}
  clear_text_metrics_cache()
}

const tick_text = (
  tick: string | number,
  format?: string,
  tick_labels?: AxisConfig[`ticks`],
): string =>
  typeof tick === `string`
    ? tick
    : (get_tick_label(tick, tick_labels) ?? format_value_or_num(tick, format))

// Measure the widest formatted tick label. Used for auto-padding and label placement.
export const measure_max_tick_width = (
  ticks: (string | number)[],
  format?: string,
  tick_labels?: AxisConfig[`ticks`],
  font: Readonly<FontSpec> = DEFAULT_FONT_SPEC,
): number => {
  let widest = 0
  for (const tick of ticks) {
    widest = Math.max(widest, measure_text_width(tick_text(tick, format, tick_labels), font))
  }
  return widest
}

const TICK_ROTATION_LADDER = [30, 45, 60, 90] as const
const DEFAULT_TICK_LABEL_MAX_LINES = 3
const DEFAULT_MAX_BAND_FOR_SCORING = 80
const DEFAULT_VERTICAL_WRAP_WIDTH = DEFAULT_MAX_BAND_FOR_SCORING
const DEFAULT_STRATEGY_ORDER: readonly TickStrategy[] = [
  `upright`,
  `wrap`,
  `stagger`,
  `thin`,
  `abbreviate`,
  `rotate`,
  `ellipsis`,
]

// Split on semantic boundaries without changing the displayed text. Whitespace, separators,
// and lower-to-upper camel-case transitions are useful wrap points; ordinary words stay intact.
// Camel case splits after two lowercase letters, or after one when the capital itself starts a
// word (`xAxis`). A bare one-letter rule would tear unit strings apart, since the `V` of `10 eV`
// looks exactly like the `A` of `xAxis` until you check whether lowercase follows it.
const TICK_WRAP_BOUNDARY =
  /(?<=[\p{L}\p{N}][_‐–—-])(?=[\p{L}\p{N}])|(?<=[^_‐–—-] )|(?<=[a-z]{2})(?=[A-Z])|(?<=[a-z])(?=[A-Z][a-z])/u
const tick_label_segments = (text: string): string[] => text.split(TICK_WRAP_BOUNDARY)

type WrapChoice = { lines: string[]; max_width: number; balance: number }

const explicit_tick_lines = (text: string): string[] =>
  text.replaceAll(/^(?:\r?\n)+|(?:\r?\n)+$/g, ``).split(/\r?\n/)

// Wrap at semantic boundaries into the fewest lines that fit max_width. If no partition fits,
// return the narrowest partition within max_lines so the caller can compare it to rotation.
const wrap_tick_label = (
  text: string,
  max_width: number,
  max_lines: number,
  font: Readonly<FontSpec>,
): string[] => {
  const explicit_lines = explicit_tick_lines(text)
  if (explicit_lines.length > 1) return explicit_lines

  const normalized = text.trim().replaceAll(/[^\S\u00A0\u202F]+/gu, ` `)
  if (measure_text_width(normalized, font) <= max_width) return [normalized]
  const segments = tick_label_segments(normalized)
  const line_limit = Math.min(max_lines, segments.length)
  if (line_limit < 2) return [normalized]
  const metrics = Array.from({ length: segments.length }, (_segment, start_idx) =>
    Array.from({ length: segments.length + 1 }, (_, end_idx) => {
      const line =
        end_idx > start_idx ? segments.slice(start_idx, end_idx).join(``).trim() : ``
      return { line, width: line ? measure_text_width(line, font) : 0 }
    }),
  )
  let previous_choices: (WrapChoice | null)[] = metrics[0].map(({ line, width }, end_idx) =>
    end_idx === 0 ? null : { lines: [line], max_width: width, balance: width ** 2 },
  )
  let narrowest = [normalized]
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

const resolved_strategies = (config: TickAutoLayoutConfig): readonly TickStrategy[] => {
  // Plain Set, not SvelteSet: these are throwaway dedupes inside a pure layout computation,
  // so reactive signal allocation would be pure overhead on the per-frame path.
  const strategies = config.strategies ?? DEFAULT_STRATEGY_ORDER
  if (strategies.length === 0) throw new Error(`tick auto_layout.strategies must not be empty`)
  for (const strategy of strategies) {
    if (!TICK_STRATEGIES.some((candidate) => candidate === strategy)) {
      throw new Error(`unknown tick auto-layout strategy "${strategy}"`)
    }
  }
  return [...new Set(strategies)]
}

const finite_nonnegative = (value: number, name: string): number => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number, got ${value}`)
  }
  return value
}

const positive_integer = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer, got ${value}`)
  }
  return value
}

const effective_side = (side: TickLayoutSide, inside: boolean): TickLayoutSide => {
  if (!inside) return side
  if (side === `x`) return `x2`
  if (side === `x2`) return `x`
  if (side === `y`) return `y2`
  return `y`
}

const resolve_positions = (positions: readonly number[], tick_count: number): number[] => {
  if (positions.length !== tick_count) {
    throw new Error(`tick_positions has ${positions.length} entries for ${tick_count} ticks`)
  }
  return [...positions]
}

const resolve_axis_extent = (
  axis: MeasuredAxis,
  axis_size: number,
  positions: readonly number[],
): TickAxisExtent => {
  if (axis.axis_extent) return axis.axis_extent
  if (positions.length === 0) return { start: 0, end: axis_size }
  let start = 0
  let end = axis_size
  for (const position of positions) {
    if (!Number.isFinite(position)) continue
    if (position < start) start = position
    if (position > end) end = position
  }
  return { start, end }
}

const local_axis_widths = (positions: readonly number[], extent: TickAxisExtent): number[] => {
  const extent_min = Math.min(extent.start, extent.end)
  const extent_max = Math.max(extent.start, extent.end)
  const spatial_order = positions
    .map((position, tick_idx) => ({ position, tick_idx }))
    .filter(({ position }) => Number.isFinite(position))
    .toSorted(
      (left, right) => left.position - right.position || left.tick_idx - right.tick_idx,
    )
  const widths = Array<number>(positions.length).fill(0)
  for (const [spatial_idx, { position, tick_idx }] of spatial_order.entries()) {
    const previous = spatial_order[spatial_idx - 1]?.position
    const next = spatial_order[spatial_idx + 1]?.position
    const slot_start = previous == null ? extent_min : (previous + position) / 2
    const slot_end = next == null ? extent_max : (position + next) / 2
    widths[tick_idx] = Math.max(0, slot_end - slot_start - TICK_LABEL_GAP)
  }
  return widths
}

const rotation_angles = (max_angle: number): number[] => {
  if (max_angle === 0) return []
  const angles = TICK_ROTATION_LADDER.filter((angle) => angle <= max_angle) as number[]
  if (!angles.includes(max_angle)) angles.push(max_angle)
  return angles.toSorted((left, right) => left - right)
}

const auto_rotation_sign = (side: TickLayoutSide, inside: boolean): 1 | -1 =>
  (side === `x2` || side === `y2`) !== inside ? 1 : -1

interface CandidateGeometry {
  candidate: TickStrategyCandidate
  labels: readonly TickLabelGeometry[]
  colliding_label_count: number
  band: number
  stagger_step: number
  measured: MeasuredTickCandidate
}

// How far labels reach away from their baseline: x/x2 measure vertically, y/y2 horizontally,
// and x2/y grow toward negative coordinates so their band is the negated minimum.
const outward_band = (labels: readonly TickLabelGeometry[], side: TickLayoutSide): number => {
  const horizontal = side === `x` || side === `x2`
  const negated = side === `x2` || side === `y`
  let band = 0
  for (const { aabb } of labels) {
    const reach = horizontal
      ? negated
        ? -aabb.min_y
        : aabb.max_y
      : negated
        ? -aabb.min_x
        : aabb.max_x
    if (reach > band) band = reach
  }
  return band
}

const measure_candidate = ({
  candidate,
  side,
  positions,
  axis_extent,
  font,
  edge_gap,
  max_band,
  min_visible_ticks,
  preserve_endpoints,
  renderable_indices,
}: {
  candidate: TickStrategyCandidate
  side: TickLayoutSide
  positions: readonly number[]
  axis_extent: TickAxisExtent
  font: Readonly<FontSpec>
  edge_gap: number
  max_band?: number
  min_visible_ticks: number
  preserve_endpoints: boolean
  renderable_indices: readonly number[]
}): CandidateGeometry => {
  const visible_labels = candidate.labels.filter(({ visible }) => visible)
  const item_for = (label: (typeof candidate.labels)[number], cross_axis: number) => ({
    id: label.tick_index,
    lines: label.display_lines,
    position: { axis: positions[label.tick_index], cross_axis },
    rotation: candidate.rotation_deg,
    stagger_row: label.stagger_row,
    dimensions: {
      line_widths: label.display_lines.map((line) => measure_text_width(line, font)),
      line_height: font.line_height,
    },
  })
  const baseline = analyze_tick_label_geometry({
    items: visible_labels.map((label) => item_for(label, 0)),
    side,
    axis_extent,
    gap: TICK_LABEL_GAP,
    edge_gap,
  })
  const stagger_step = outward_band(baseline.labels, side) + TICK_STAGGER_GAP
  const outward_direction = side === `x` || side === `y2` ? 1 : -1
  // Only the stagger candidate moves labels off the baseline row; for every other candidate
  // the second pass would re-derive the geometry it was just handed.
  const geometry = visible_labels.some(({ stagger_row }) => stagger_row !== 0)
    ? analyze_tick_label_geometry({
        items: visible_labels.map((label) =>
          item_for(label, outward_direction * label.stagger_row * stagger_step),
        ),
        side,
        axis_extent,
        gap: TICK_LABEL_GAP,
        edge_gap,
      })
    : baseline
  const band = outward_band(geometry.labels, side)
  const first_renderable_idx = renderable_indices[0]
  const last_renderable_idx = renderable_indices.at(-1)
  const endpoint_violation =
    preserve_endpoints &&
    first_renderable_idx != null &&
    last_renderable_idx != null &&
    (!candidate.labels[first_renderable_idx].visible ||
      !candidate.labels[last_renderable_idx].visible)
  const visible_count_violation = visible_labels.length < min_visible_ticks
  const band_overflow = max_band == null ? 0 : Math.max(0, band - max_band)
  const measurements = {
    collisions:
      geometry.collisions.count + Number(endpoint_violation) + Number(visible_count_violation),
    edge_overflow_px:
      geometry.overflows.reduce((total, overflow) => total + overflow.total, 0) +
      band_overflow,
    band_fraction: band / Math.max(1, max_band ?? DEFAULT_MAX_BAND_FOR_SCORING),
  }
  return {
    candidate,
    labels: geometry.labels,
    colliding_label_count: geometry.collisions.colliding_indices.length,
    band,
    stagger_step,
    measured: { candidate, measurements },
  }
}

const adaptive_thin_indices = (item_count: number, requested_count: number): number[] => {
  if (requested_count >= item_count) {
    return Array.from({ length: item_count }, (_unused, tick_idx) => tick_idx)
  }
  return Array.from({ length: requested_count }, (_unused, visible_idx) =>
    Math.min(item_count - 1, Math.floor(((visible_idx + 0.5) * item_count) / requested_count)),
  ).filter((tick_idx, selected_idx, selected) => tick_idx !== selected[selected_idx - 1])
}

const scoring_config = (config: TickAutoLayoutConfig): TickScoringConfig => ({
  mode: config.scoring?.mode,
  weights: config.scoring?.weights,
})

const empty_layout = (): ResolvedTickLayout => ({
  rotation: 0,
  band: 0,
  lines: [],
  labels: [],
  visible_tick_indices: [],
  visible_ticks: [],
  strategy: `upright`,
  stagger_step: 0,
})

type LabelBlock = { width: number; height: number }

const widest_line = (lines: readonly string[], font: Readonly<FontSpec>): number => {
  let widest = 0
  for (const line of lines) widest = Math.max(widest, measure_text_width(line, font))
  return widest
}

const legacy_label_band = (
  lines: readonly string[],
  rotation: number,
  font: Readonly<FontSpec>,
  is_horizontal: boolean,
): number => {
  const radians = (Math.abs(rotation) * Math.PI) / 180
  const width = widest_line(lines, font)
  const height = lines.length * font.line_height
  return is_horizontal
    ? width * Math.sin(radians) + height * Math.cos(radians)
    : width * Math.cos(radians) + height * Math.sin(radians)
}

const legacy_max_block = (
  labels: readonly (readonly string[])[],
  font: Readonly<FontSpec>,
): LabelBlock => {
  let width = 0
  let max_lines = 0
  for (const lines of labels) {
    width = Math.max(width, widest_line(lines, font))
    max_lines = Math.max(max_lines, lines.length)
  }
  return { width, height: max_lines * font.line_height }
}

const legacy_auto_rotation = (block: LabelBlock, pitch: number): number | null => {
  if (!(pitch > 0) || block.width + TICK_LABEL_GAP <= pitch) return 0
  for (const angle of TICK_ROTATION_LADDER) {
    if (pitch * Math.sin((angle * Math.PI) / 180) >= block.height + TICK_LABEL_GAP) {
      return angle
    }
  }
  return null
}

const legacy_result = (
  ticks: readonly (string | number)[],
  full_texts: readonly string[],
  lines: string[][],
  rotation: number,
  side: TickLayoutSide,
  font: Readonly<FontSpec>,
): ResolvedTickLayout => {
  let band = lines.length === 0 ? font.line_height : 0
  const is_horizontal = side === `x` || side === `x2`
  for (const label_lines of lines) {
    band = Math.max(band, legacy_label_band(label_lines, rotation, font, is_horizontal))
  }
  const labels = full_texts.map(
    (full_text, tick_idx): ResolvedTickLabel => ({
      tick_index: tick_idx,
      full_text,
      display_text: lines[tick_idx].join(`\n`),
      lines: lines[tick_idx],
      visible: true,
      anchor: default_tick_label_anchor(effective_side(side, false), rotation),
      rotation,
      stagger_row: 0,
    }),
  )
  return {
    rotation,
    band,
    lines,
    labels,
    visible_tick_indices: labels.map(({ tick_index }) => tick_index),
    visible_ticks: [...ticks],
    strategy: rotation === 0 ? `upright` : `rotate`,
    stagger_step: 0,
  }
}

// Preserve the previous equal-pitch behavior only for callers that genuinely cannot project
// tick positions. Plot hosts and PlotAxis always use the geometry-aware path below.
const compute_legacy_tick_layout = (
  axis: MeasuredAxis,
  axis_size: number,
  side: TickLayoutSide,
  full_texts: string[],
): ResolvedTickLayout => {
  const ticks = axis.tick_values ?? []
  const font = axis.tick_font ?? DEFAULT_FONT_SPEC
  const is_horizontal = side === `x` || side === `x2`
  const unwrapped = full_texts.map((text) =>
    is_horizontal ? explicit_tick_lines(text) : [text],
  )
  const configured = axis.tick?.label?.rotation ?? `auto`
  if (configured !== `auto`) {
    return legacy_result(ticks, full_texts, unwrapped, configured, side, font)
  }
  if (!is_horizontal || full_texts.length === 0 || !(axis_size > 0)) {
    return legacy_result(ticks, full_texts, unwrapped, 0, side, font)
  }
  const pitch = axis_size / full_texts.length
  const unwrapped_block = legacy_max_block(unwrapped, font)
  if (unwrapped_block.width + TICK_LABEL_GAP <= pitch) {
    return legacy_result(ticks, full_texts, unwrapped, 0, side, font)
  }
  const sign = auto_rotation_sign(side, axis.tick?.label?.inside ?? false)
  const signed_angle = (angle: number): number => (angle === 0 ? 0 : sign * angle)
  const unwrapped_angle =
    full_texts.length === 1 ? 0 : (legacy_auto_rotation(unwrapped_block, pitch) ?? 90)
  const unwrapped_result = legacy_result(
    ticks,
    full_texts,
    unwrapped,
    signed_angle(unwrapped_angle),
    side,
    font,
  )
  const max_lines = positive_integer(
    Math.max(1, Math.floor(axis.tick?.label?.max_lines ?? DEFAULT_TICK_LABEL_MAX_LINES)),
    `tick.label.max_lines`,
  )
  if (max_lines <= 1) return unwrapped_result
  const wrapped = full_texts.map((text) =>
    wrap_tick_label(text, Math.max(0, pitch - TICK_LABEL_GAP), max_lines, font),
  )
  const wrapped_block = legacy_max_block(wrapped, font)
  if (full_texts.length === 1) {
    return wrapped_block.width < unwrapped_block.width
      ? legacy_result(ticks, full_texts, wrapped, 0, side, font)
      : unwrapped_result
  }
  const wrapped_angle = legacy_auto_rotation(wrapped_block, pitch)
  if (wrapped_angle == null) return unwrapped_result
  const wrapped_result = legacy_result(
    ticks,
    full_texts,
    wrapped,
    signed_angle(wrapped_angle),
    side,
    font,
  )
  const not_steeper = Math.abs(wrapped_result.rotation) <= Math.abs(unwrapped_result.rotation)
  const clearly_shorter = wrapped_result.band <= unwrapped_result.band * 0.85
  return not_steeper || clearly_shorter ? wrapped_result : unwrapped_result
}

const compute_tick_layout = (
  axis: MeasuredAxis,
  axis_size: number,
  side: TickLayoutSide,
  full_texts: string[],
): ResolvedTickLayout => {
  if (full_texts.length === 0) return empty_layout()
  if (axis.tick_positions == null) {
    return compute_legacy_tick_layout(axis, axis_size, side, full_texts)
  }
  const ticks = axis.tick_values ?? []
  const is_horizontal = side === `x` || side === `x2`
  const font = axis.tick_font ?? DEFAULT_FONT_SPEC
  const axis_position_shift = is_horizontal
    ? (axis.tick?.label?.shift?.x ?? 0)
    : (axis.tick?.label?.shift?.y ?? 0)
  const positions = resolve_positions(axis.tick_positions, ticks.length).map(
    (position) => position + axis_position_shift,
  )
  const renderable_indices: number[] = []
  const base_labels = full_texts.map((full_text, tick_idx) => {
    const visible = Number.isFinite(positions[tick_idx])
    if (visible) renderable_indices.push(tick_idx)
    return { full_text, visible }
  })
  const axis_extent = resolve_axis_extent(axis, axis_size, positions)
  const geometry_side = effective_side(side, axis.tick?.label?.inside ?? false)
  const configured = axis.tick?.label?.rotation ?? `auto`
  const explicit_lines = full_texts.map(explicit_tick_lines)
  const explicit_labels = base_labels.map((label, tick_idx) => ({
    ...label,
    display_lines: explicit_lines[tick_idx],
  }))
  const common_config = {
    side: geometry_side,
    positions,
    axis_extent,
    font,
    edge_gap: 0,
    min_visible_ticks: Math.min(1, renderable_indices.length),
    preserve_endpoints: false,
    renderable_indices,
  }
  if (configured !== `auto`) {
    const explicit_candidate = create_tick_candidate({
      id: `explicit`,
      strategy: configured === 0 ? `upright` : `rotate`,
      rotation_deg: configured,
      labels: explicit_labels,
    })
    const measured = measure_candidate({ candidate: explicit_candidate, ...common_config })
    return finalize_layout(measured, ticks, side, is_horizontal)
  }

  const auto_layout = axis.tick?.label?.auto_layout ?? {}
  const strategies = resolved_strategies(auto_layout)
  const max_angle = finite_nonnegative(auto_layout.max_angle ?? 90, `auto_layout.max_angle`)
  if (max_angle > 90) {
    throw new Error(`auto_layout.max_angle must not exceed 90, got ${max_angle}`)
  }
  const max_band =
    auto_layout.max_band == null
      ? undefined
      : finite_nonnegative(auto_layout.max_band, `auto_layout.max_band`)
  const edge_gap = finite_nonnegative(auto_layout.edge_gap ?? 0, `auto_layout.edge_gap`)
  const min_visible_ticks = Math.min(
    renderable_indices.length,
    positive_integer(
      auto_layout.min_visible_ticks ?? Math.min(2, ticks.length),
      `auto_layout.min_visible_ticks`,
    ),
  )
  const preserve_endpoints = (auto_layout.endpoint_policy ?? `preserve`) === `preserve`
  const candidate_config = {
    ...common_config,
    edge_gap,
    max_band,
    min_visible_ticks,
    preserve_endpoints,
  }
  const candidates: TickStrategyCandidate[] = []
  // Density estimation and the final scoring pass both want the upright geometry; measuring
  // it is the single most expensive step here, so whichever needs it first pays for both.
  let upright_geometry: CandidateGeometry | undefined
  const upright = create_tick_candidate({
    id: `upright`,
    strategy: `upright`,
    labels: explicit_labels,
  })
  if (strategies.includes(`upright`)) candidates.push(upright)

  const slot_widths = local_axis_widths(positions, axis_extent)
  const max_lines = positive_integer(
    Math.max(1, Math.floor(axis.tick?.label?.max_lines ?? DEFAULT_TICK_LABEL_MAX_LINES)),
    `tick.label.max_lines`,
  )
  if (strategies.includes(`wrap`) && max_lines > 1) {
    const vertical_wrap_width = Math.min(
      max_band ?? DEFAULT_VERTICAL_WRAP_WIDTH,
      measure_max_tick_width(ticks, axis.format, axis.ticks, font),
    )
    candidates.push(
      create_tick_candidate({
        id: `wrap`,
        strategy: `wrap`,
        labels: base_labels.map((label, tick_idx) => ({
          ...label,
          display_lines: wrap_tick_label(
            label.full_text,
            is_horizontal ? slot_widths[tick_idx] : vertical_wrap_width,
            max_lines,
            font,
          ),
        })),
      }),
    )
  }
  if (strategies.includes(`stagger`) && renderable_indices.length > 1) {
    candidates.push(generate_stagger_candidate(upright, { id: `stagger` }))
  }
  if (strategies.includes(`abbreviate`)) {
    candidates.push(generate_abbreviated_candidate(upright, { id: `abbreviate` }))
  }
  const rotation_sign = auto_rotation_sign(side, axis.tick?.label?.inside ?? false)
  const rotated_candidates: TickStrategyCandidate[] =
    strategies.includes(`rotate`) && renderable_indices.length > 1
      ? rotation_angles(max_angle).map((angle) =>
          create_tick_candidate({
            id: `rotate-${angle}`,
            strategy: `rotate`,
            labels: base_labels,
            rotation_deg: rotation_sign * angle,
          }),
        )
      : []
  candidates.push(...rotated_candidates)
  if (strategies.includes(`ellipsis`)) {
    candidates.push(
      generate_ellipsis_candidate(upright, {
        id: `ellipsis`,
        max_width_px: is_horizontal ? slot_widths : (max_band ?? DEFAULT_VERTICAL_WRAP_WIDTH),
        measure_text: (text) => measure_text_width(text, font),
      }),
    )
  }

  // One bounded density pass: estimate a target once from measured labels, then score that
  // stable subset with the other candidates. No reactive feedback from selected labels occurs.
  if (strategies.includes(`thin`) && renderable_indices.length > min_visible_ticks) {
    upright_geometry ??= measure_candidate({ candidate: upright, ...candidate_config })
    const axis_label_sizes = renderable_indices.map((tick_idx) => {
      const label = upright.labels[tick_idx]
      return is_horizontal
        ? Math.max(...label.display_lines.map((line) => measure_text_width(line, font)))
        : label.display_lines.length * font.line_height
    })
    const extent_size = Math.abs(axis_extent.end - axis_extent.start)
    const density_count = suggest_tick_count(extent_size, axis_label_sizes, TICK_LABEL_GAP)
    const non_colliding_count =
      renderable_indices.length - upright_geometry.colliding_label_count
    // Labels outside every collision can remain. When every label collides, that count is zero,
    // so fall back to the independent density estimate instead of collapsing to the minimum.
    const collision_limited_count =
      non_colliding_count > 0 ? non_colliding_count : density_count
    const requested_count = Math.max(
      min_visible_ticks,
      Math.min(renderable_indices.length, density_count, collision_limited_count),
    )
    const selected_renderable_indices =
      auto_layout.endpoint_policy === `adaptive`
        ? adaptive_thin_indices(renderable_indices.length, requested_count)
        : thin_tick_indices(renderable_indices.length, requested_count)
    const selected_indices = new SvelteSet(
      selected_renderable_indices.map((tick_idx) => renderable_indices[tick_idx]),
    )
    // Compose only thinning with the fixed rotation ladder. This adds at most four candidates,
    // avoiding the combinatorial search that arbitrary strategy composition would create.
    candidates.push(
      ...[upright, ...rotated_candidates].map((candidate) =>
        generate_thinned_candidate(candidate, selected_indices, {
          id: candidate === upright ? `thin` : `thin-${candidate.id}`,
        }),
      ),
    )
  }

  if (candidates.length === 0) candidates.push(upright)
  const measured_candidates = candidates.map((candidate) =>
    candidate === upright && upright_geometry
      ? upright_geometry
      : measure_candidate({ candidate, ...candidate_config }),
  )
  const selection = select_tick_candidate(
    measured_candidates.map(({ measured }) => measured),
    scoring_config(auto_layout),
  )
  const winner_id = selection.winner?.candidate.id ?? selection.evaluated[0]?.candidate.id
  const winner =
    measured_candidates.find(({ candidate }) => candidate.id === winner_id) ??
    measured_candidates[0]
  return finalize_layout(winner, ticks, side, is_horizontal)
}

const finalize_layout = (
  winner: CandidateGeometry,
  ticks: readonly (string | number)[],
  side: TickLayoutSide,
  is_horizontal: boolean,
): ResolvedTickLayout => {
  const geometry_by_idx = new Map(winner.labels.map((label) => [label.id, label]))
  const labels = winner.candidate.labels.map(
    (label): ResolvedTickLabel => ({
      tick_index: label.tick_index,
      full_text: label.full_text,
      display_text: label.display_lines.join(`\n`),
      lines: [...label.display_lines],
      visible: label.visible,
      anchor:
        geometry_by_idx.get(label.tick_index)?.anchor ??
        (is_horizontal ? `middle` : side === `y` ? `end` : `start`),
      rotation: winner.candidate.rotation_deg,
      stagger_row: label.stagger_row,
    }),
  )
  const visible_tick_indices = labels
    .filter(({ visible }) => visible)
    .map(({ tick_index }) => tick_index)
  return {
    rotation: winner.candidate.rotation_deg,
    band: winner.band,
    lines: labels.map(({ lines: label_lines }) => label_lines),
    labels,
    visible_tick_indices,
    visible_ticks: visible_tick_indices.map((tick_idx) => ticks[tick_idx]),
    strategy: winner.candidate.strategy,
    stagger_step: winner.stagger_step,
  }
}

// calc_auto_padding and PlotAxis call this same resolver. Memo keys include every geometric and
// strategy input, so a resize or font change cannot reuse a stale label decision.
export const resolve_tick_layout = (
  axis: MeasuredAxis,
  axis_size: number,
  side: TickLayoutSide,
): ResolvedTickLayout => {
  finite_nonnegative(axis_size, `axis_size`)
  const ticks = axis.tick_values ?? []
  const full_texts = ticks.map((tick) => tick_text(tick, axis.format, axis.ticks))
  const label = axis.tick?.label
  const auto_layout = label?.auto_layout
  const font = axis.tick_font ?? DEFAULT_FONT_SPEC
  const key = [
    side,
    axis_size,
    label?.rotation ?? ``,
    label?.max_lines ?? ``,
    label?.inside ?? ``,
    label?.shift?.x ?? ``,
    label?.shift?.y ?? ``,
    auto_layout?.strategies?.join(`,`) ?? ``,
    auto_layout?.scoring?.mode ?? ``,
    JSON.stringify(auto_layout?.scoring?.weights ?? {}),
    auto_layout?.max_angle ?? ``,
    auto_layout?.max_band ?? ``,
    auto_layout?.min_visible_ticks ?? ``,
    auto_layout?.edge_gap ?? ``,
    auto_layout?.endpoint_policy ?? ``,
    axis.tick_positions?.join(`,`) ?? ``,
    axis.axis_extent ? `${axis.axis_extent.start},${axis.axis_extent.end}` : ``,
    `${font.font_family},${font.font_size},${font.font_style},${font.font_variant},${font.font_weight},${font.font_stretch},${font.line_height}`,
    full_texts.join(`\u0000`),
  ].join(`|`)
  const cached = cached_layouts[side]
  if (cached?.key === key) return cached.value
  const resolved = compute_tick_layout(axis, axis_size, side, full_texts)
  cached_layouts[side] = { key, value: resolved }
  return resolved
}
