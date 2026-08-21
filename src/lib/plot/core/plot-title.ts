import {
  DEFAULT_FONT_SPEC,
  measure_text_line,
  wrap_text_paragraph,
} from '$lib/plot/core/text-metrics'
import type { FontSpec, TextLineMetrics } from '$lib/plot/core/text-metrics'
import type { Sides } from './layout'

type PlotTitleAlign = `start` | `middle` | `end`
type PlotTitleFontOverrides = Partial<FontSpec>
export type PlotTitleLineKind = `title` | `subtitle`

export interface PlotTitleConfig {
  text?: string
  subtitle?: string
  align?: PlotTitleAlign
  max_lines?: number
  gap?: number
  font?: PlotTitleFontOverrides
  subtitle_font?: PlotTitleFontOverrides
}

export type PlotTitleProp = string | PlotTitleConfig

export const normalize_plot_title = (
  title: PlotTitleProp | null | undefined,
): PlotTitleConfig | null => (typeof title === `string` ? { text: title } : (title ?? null))

export const pad_for_plot_title = (
  pad: Required<Sides>,
  config: PlotTitleConfig | null,
  width: number,
  height: number,
): Required<Sides> => {
  const title_height =
    width > 0 && height > 0
      ? resolve_plot_title(config, { width: Math.max(0, width - pad.l - pad.r) }).block_height
      : 0
  return { ...pad, t: pad.t + title_height }
}

interface PlotTitleLayoutInput {
  width: number
  x?: number
  y?: number
  // Include the current text-metrics revision to make cache invalidation reactive in Svelte.
  metrics_revision?: number
}

export type PlotTitleMeasure = (text: string, font: Readonly<FontSpec>) => TextLineMetrics

interface PlotTitleLine {
  readonly kind: PlotTitleLineKind
  readonly text: string
  readonly x: number
  // SVG baseline, not the top of the line box.
  readonly y: number
  readonly width: number
  readonly ascent: number
  readonly descent: number
  readonly source: TextLineMetrics[`source`]
}

export interface PlotTitleBlockLayout {
  readonly kind: PlotTitleLineKind
  // Unwrapped text used as the accessible label.
  readonly label: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly font: Readonly<FontSpec>
  readonly lines: readonly PlotTitleLine[]
}

interface ResolvedPlotTitle {
  readonly align: PlotTitleAlign
  readonly text_anchor: PlotTitleAlign
  readonly anchor_x: number
  readonly top_y: number
  readonly available_width: number
  readonly block_height: number
  readonly metrics_revision: number
  readonly title: PlotTitleBlockLayout | null
  readonly subtitle: PlotTitleBlockLayout | null
  readonly lines: readonly PlotTitleLine[]
}

const DEFAULT_PLOT_TITLE_FONT: Readonly<FontSpec> = Object.freeze({
  ...DEFAULT_FONT_SPEC,
  font_size: 18,
  font_weight: `600`,
  line_height: 22,
})

const DEFAULT_PLOT_SUBTITLE_FONT: Readonly<FontSpec> = Object.freeze({
  ...DEFAULT_FONT_SPEC,
  font_size: 13,
  line_height: 17,
})

const DEFAULT_PLOT_TITLE_GAP = 4

const normalized_font = (
  overrides: PlotTitleFontOverrides | undefined,
  fallback: Readonly<FontSpec>,
): FontSpec => {
  type StringKey =
    | `font_family`
    | `font_style`
    | `font_variant`
    | `font_weight`
    | `font_stretch`
  const string_value = (key: StringKey): string => {
    const value = overrides?.[key]?.trim()
    return value?.length ? value : fallback[key]
  }
  const positive_value = (key: `font_size` | `line_height`): number => {
    const value = overrides?.[key]
    return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback[key]
  }

  return {
    font_family: string_value(`font_family`),
    font_size: positive_value(`font_size`),
    font_style: string_value(`font_style`),
    font_variant: string_value(`font_variant`),
    font_weight: string_value(`font_weight`),
    font_stretch: string_value(`font_stretch`),
    line_height: positive_value(`line_height`),
  }
}

const normalize_label = (value: string | undefined): string => value?.trim() ?? ``

const truncate_with_ellipsis = (
  line: string,
  available_width: number,
  font: Readonly<FontSpec>,
  measure: PlotTitleMeasure,
): string => {
  const ellipsis = `…`
  if (available_width <= 0) return `${line}${ellipsis}`
  const characters = Array.from(line.trimEnd())
  while (characters.length > 0) {
    const candidate = `${characters.join(``).trimEnd()}${ellipsis}`
    if (measure(candidate, font).width <= available_width) return candidate
    characters.pop()
  }
  return ellipsis
}

const wrapped_lines = (
  label: string,
  available_width: number,
  max_lines: number,
  font: Readonly<FontSpec>,
  measure: PlotTitleMeasure,
): string[] => {
  const lines = label
    .split(/\r\n|\r|\n/u)
    .flatMap((paragraph) => wrap_text_paragraph(paragraph, available_width, font, measure))
  if (lines.length <= max_lines) return lines

  const visible_lines = lines.slice(0, max_lines)
  visible_lines[max_lines - 1] = truncate_with_ellipsis(
    visible_lines[max_lines - 1],
    available_width,
    font,
    measure,
  )
  return visible_lines
}

const resolve_block = (
  kind: PlotTitleLineKind,
  label: string,
  anchor_x: number,
  top_y: number,
  available_width: number,
  max_lines: number,
  font: Readonly<FontSpec>,
  measure: PlotTitleMeasure,
): PlotTitleBlockLayout | null => {
  if (!label) return null

  const text_lines = wrapped_lines(label, available_width, max_lines, font, measure)
  const lines = text_lines.map((text, line_idx): PlotTitleLine => {
    const metrics = measure(text, font)
    const line_top = top_y + line_idx * font.line_height
    const centered_leading = (font.line_height - metrics.height) / 2
    return {
      kind,
      text,
      x: anchor_x,
      y: line_top + centered_leading + metrics.ascent,
      width: metrics.width,
      ascent: metrics.ascent,
      descent: metrics.descent,
      source: metrics.source,
    }
  })
  return {
    kind,
    label,
    x: anchor_x,
    y: top_y,
    width: Math.max(0, ...lines.map(({ width }) => width)),
    height: lines.length * font.line_height,
    font,
    lines,
  }
}

const validate_layout_input = (
  config: PlotTitleConfig | null | undefined,
  input: PlotTitleLayoutInput,
): { gap: number; max_lines: number } => {
  const { gap = DEFAULT_PLOT_TITLE_GAP, max_lines } = config ?? {}
  const assert_finite = (value: number, name: string, non_negative = false): void => {
    if (Number.isFinite(value) && (!non_negative || value >= 0)) return
    throw new Error(
      `Plot title ${name} must be ${non_negative ? `a finite non-negative number` : `finite`}, got ${value}`,
    )
  }
  assert_finite(input.width, `width`, true)
  if (input.x !== undefined) assert_finite(input.x, `x`)
  if (input.y !== undefined) assert_finite(input.y, `y`)
  assert_finite(gap, `gap`, true)
  if (max_lines !== undefined && (!Number.isInteger(max_lines) || max_lines < 1)) {
    throw new Error(`Plot title max_lines must be a positive integer, got ${max_lines}`)
  }
  return { gap, max_lines: max_lines ?? Number.POSITIVE_INFINITY }
}

// Resolve title and subtitle line boxes without owning reactive or component state. Supplying a
// measure callback makes measurement fully deterministic in tests and non-browser exporters.
export function resolve_plot_title(
  config: PlotTitleConfig | null | undefined,
  input: PlotTitleLayoutInput,
  measure: PlotTitleMeasure = measure_text_line,
): ResolvedPlotTitle {
  const { gap, max_lines } = validate_layout_input(config, input)
  const { width: available_width, x = 0, y: top_y = 0, metrics_revision = 0 } = input
  const { align = `middle` } = config ?? {}
  const anchor_x =
    align === `start` ? x : align === `end` ? x + available_width : x + available_width / 2
  const title_font = normalized_font(config?.font, DEFAULT_PLOT_TITLE_FONT)
  const subtitle_font = normalized_font(config?.subtitle_font, DEFAULT_PLOT_SUBTITLE_FONT)
  const title_label = normalize_label(config?.text)
  const subtitle_label = normalize_label(config?.subtitle)

  const title = resolve_block(
    `title`,
    title_label,
    anchor_x,
    top_y,
    available_width,
    max_lines,
    title_font,
    measure,
  )
  const subtitle_top = top_y + (title?.height ?? 0) + (title && subtitle_label ? gap : 0)
  const subtitle = resolve_block(
    `subtitle`,
    subtitle_label,
    anchor_x,
    subtitle_top,
    available_width,
    max_lines,
    subtitle_font,
    measure,
  )
  const block_height =
    (title?.height ?? 0) + (title && subtitle ? gap : 0) + (subtitle?.height ?? 0)

  return {
    align,
    text_anchor: align,
    anchor_x,
    top_y,
    available_width,
    block_height,
    metrics_revision,
    title,
    subtitle,
    lines: [...(title?.lines ?? []), ...(subtitle?.lines ?? [])],
  }
}
