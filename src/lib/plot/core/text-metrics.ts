export interface FontSpec {
  font_family: string
  font_size: number
  font_style: string
  font_variant: string
  font_weight: string
  font_stretch: string
  line_height: number
}

export interface TextLineMetrics {
  readonly text: string
  readonly width: number
  readonly ascent: number
  readonly descent: number
  readonly height: number
  readonly source: `canvas` | `fallback`
}

export type TextWidthMeasure = (
  text: string,
  font: Readonly<FontSpec>,
) => { readonly width: number }

export interface FontReadiness {
  readonly ready: PromiseLike<unknown>
}

export const DEFAULT_FONT_SPEC: Readonly<FontSpec> = Object.freeze({
  font_family: `sans-serif`,
  font_size: 12,
  font_style: `normal`,
  font_variant: `normal`,
  font_weight: `400`,
  font_stretch: `normal`,
  line_height: 16,
})

const FALLBACK_CHARACTER_WIDTH = 0.6
const FALLBACK_ASCENT = 0.8
const FALLBACK_DESCENT = 0.2

let measurement_canvas: HTMLCanvasElement | null = null
let metrics_revision = 0
let line_metrics_by_font: Record<string, Record<string, TextLineMetrics>> = Object.create(null)
let cached_line_count = 0
const MAX_CACHED_LINES = 10_000

const positive_number = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? value : fallback

const normalize_font_spec = (font: Readonly<FontSpec>): FontSpec => {
  const font_size = positive_number(font.font_size, DEFAULT_FONT_SPEC.font_size)
  return {
    font_family: font.font_family.trim() || DEFAULT_FONT_SPEC.font_family,
    font_size,
    font_style: font.font_style.trim() || DEFAULT_FONT_SPEC.font_style,
    font_variant: font.font_variant.trim() || DEFAULT_FONT_SPEC.font_variant,
    font_weight: font.font_weight.trim() || DEFAULT_FONT_SPEC.font_weight,
    font_stretch: font.font_stretch.trim() || DEFAULT_FONT_SPEC.font_stretch,
    line_height: positive_number(font.line_height, DEFAULT_FONT_SPEC.line_height),
  }
}

const leading_number = (value: string): number => {
  const match = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/iu.exec(value.trim())
  return Number(match?.[0])
}

const parse_font_size = (value: string, fallback: number): number => {
  const parsed = leading_number(value)
  return positive_number(parsed, fallback)
}

const FONT_SHORTHAND_SIZE =
  /(?:^|\s)(?<font_size>[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|cap|ic|lh|rlh|vw|vh|vmin|vmax)(?=\/|\s|$)/iu
const parse_font_shorthand_size = (value: string, fallback: number): number =>
  positive_number(Number(FONT_SHORTHAND_SIZE.exec(value)?.groups?.font_size), fallback)

const parse_line_height = (
  value: string,
  font_size: number,
  fallback: Readonly<FontSpec>,
): number => {
  const fallback_ratio =
    positive_number(fallback.line_height, DEFAULT_FONT_SPEC.line_height) /
    positive_number(fallback.font_size, DEFAULT_FONT_SPEC.font_size)
  const normalized = value.trim().toLowerCase()
  if (!normalized || normalized === `normal`) return font_size * fallback_ratio

  const parsed = leading_number(normalized)
  if (!(parsed > 0) || !Number.isFinite(parsed)) return font_size * fallback_ratio
  if (/^[\d.]+$/u.test(normalized)) return parsed * font_size
  if (normalized.endsWith(`em`)) return parsed * font_size
  if (normalized.endsWith(`%`)) return (parsed / 100) * font_size
  return parsed
}

// Resolve a CSS font-size to pixels. Bare numbers and px are absolute; em/rem/% scale from
// parent_font_size (typically the inherited computed size from resolve_font_spec).
export function resolve_font_size_css(
  value: string | undefined,
  parent_font_size: number = DEFAULT_FONT_SPEC.font_size,
): number {
  const parent = positive_number(parent_font_size, DEFAULT_FONT_SPEC.font_size)
  const normalized = value?.trim().toLowerCase() ?? ``

  const match =
    /^(?<magnitude>[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(?<unit>px|pt|em|rem|%)?$/u.exec(
      normalized,
    )
  if (!match) return parse_font_size(normalized, parent)

  const parsed = Number(match.groups?.magnitude)
  if (!(parsed > 0) || !Number.isFinite(parsed)) return parent
  const unit = match.groups?.unit
  if (unit === `em` || unit === `rem`) return parsed * parent
  if (unit === `%`) return (parsed / 100) * parent
  return unit === `pt` ? parsed * (96 / 72) : parsed
}

// Resolve the inherited font actually applied to an HTML or SVG element. Computed font sizes
// are pixels in browsers; deterministic fallback values keep this safe during SSR and tests.
export function resolve_font_spec(
  element: HTMLElement | SVGElement | null | undefined,
  fallback: Readonly<FontSpec> = DEFAULT_FONT_SPEC,
): FontSpec {
  const normalized_fallback = normalize_font_spec(fallback)
  const view = element?.ownerDocument.defaultView
  if (!element || !view) return normalized_fallback

  const computed_style = view.getComputedStyle(element)
  const font_size = parse_font_size(computed_style.fontSize, normalized_fallback.font_size)
  return {
    font_family: computed_style.fontFamily.trim() || normalized_fallback.font_family,
    font_size,
    font_style: computed_style.fontStyle.trim() || normalized_fallback.font_style,
    font_variant: computed_style.fontVariant.trim() || normalized_fallback.font_variant,
    font_weight: computed_style.fontWeight.trim() || normalized_fallback.font_weight,
    font_stretch: computed_style.fontStretch.trim() || normalized_fallback.font_stretch,
    line_height: parse_line_height(computed_style.lineHeight, font_size, normalized_fallback),
  }
}

// Canvas font syntax excludes line-height. Omitting normal qualifiers also canonicalizes
// equivalent computed styles (for example `normal` and weight `400`) to one cache key.
export function font_spec_to_css(font: Readonly<FontSpec>): string {
  const normalized = normalize_font_spec(font)
  const qualifiers = [
    normalized.font_style === `normal` ? `` : normalized.font_style,
    normalized.font_variant === `normal` ? `` : normalized.font_variant,
    [`normal`, `400`].includes(normalized.font_weight) ? `` : normalized.font_weight,
    normalized.font_stretch === `normal` ? `` : normalized.font_stretch,
  ].filter(Boolean)
  return [...qualifiers, `${normalized.font_size}px`, normalized.font_family].join(` `)
}

const fallback_line_metrics = (text: string, font: Readonly<FontSpec>): TextLineMetrics => {
  const code_point_count = Array.from(text).length
  const ascent = font.font_size * FALLBACK_ASCENT
  const descent = font.font_size * FALLBACK_DESCENT
  return {
    text,
    width: code_point_count * font.font_size * FALLBACK_CHARACTER_WIDTH,
    ascent,
    descent,
    height: ascent + descent,
    source: `fallback`,
  }
}

const get_canvas_context = (): CanvasRenderingContext2D | null => {
  if (typeof document === `undefined`) return null
  measurement_canvas ??= document.createElement(`canvas`)
  return measurement_canvas.getContext(`2d`)
}

const finite_metric = (value: number | undefined, fallback: number): number =>
  typeof value === `number` && Number.isFinite(value) && value >= 0 ? value : fallback

const uncached_line_metrics = (
  text: string,
  font: Readonly<FontSpec>,
  font_css: string,
): TextLineMetrics => {
  const fallback = fallback_line_metrics(text, font)
  const context = get_canvas_context()
  if (!context) return fallback

  context.font = font_css
  const measured = context.measureText(text)
  const width = finite_metric(measured.width, fallback.width)
  const ascent = finite_metric(
    measured.fontBoundingBoxAscent,
    finite_metric(measured.actualBoundingBoxAscent, fallback.ascent),
  )
  const descent = finite_metric(
    measured.fontBoundingBoxDescent,
    finite_metric(measured.actualBoundingBoxDescent, fallback.descent),
  )
  return {
    text,
    width,
    ascent,
    descent,
    height: ascent + descent,
    source: `canvas`,
  }
}

const cached_line_metrics = (
  text: string,
  font_css: string,
  font: Readonly<FontSpec>,
): TextLineMetrics => {
  const cached = line_metrics_by_font[font_css]?.[text]
  if (cached) return cached
  // Panning a numeric axis mints new labels forever, so the cache needs a ceiling.
  if (cached_line_count >= MAX_CACHED_LINES) clear_text_metrics_cache()
  const metrics = uncached_line_metrics(text, font, font_css)
  ;(line_metrics_by_font[font_css] ??= Object.create(null))[text] = metrics
  cached_line_count += 1
  return metrics
}

// Normalising a spec and joining its canvas shorthand costs more than the cache lookup it
// guards, and tick wrapping measures hundreds of substrings against one stable font object.
const css_by_font_spec = new WeakMap<Readonly<FontSpec>, string>()
const canonical_font_css = (font: Readonly<FontSpec>): string => {
  let font_css = css_by_font_spec.get(font)
  if (font_css === undefined) {
    font_css = font_spec_to_css(font)
    css_by_font_spec.set(font, font_css)
  }
  return font_css
}

// Cache each line under its canonical canvas font. Multiline blocks therefore reuse repeated
// lines and fonts while still applying their own line-height.
export function measure_text_line(
  text: string,
  font: Readonly<FontSpec> = DEFAULT_FONT_SPEC,
): TextLineMetrics {
  const font_css = canonical_font_css(font)
  // Normalising is only needed to build fallback metrics, which a hit never reaches.
  return (
    line_metrics_by_font[font_css]?.[text] ??
    cached_line_metrics(text, font_css, normalize_font_spec(font))
  )
}

const split_overlong_word = (
  word: string,
  available_width: number,
  font: Readonly<FontSpec>,
  measure: TextWidthMeasure,
): string[] => {
  if (measure(word, font).width <= available_width) return [word]

  const chunks: string[] = []
  let chunk = ``
  for (const character of word) {
    const candidate = `${chunk}${character}`
    if (chunk && measure(candidate, font).width > available_width) {
      chunks.push(chunk)
      chunk = character
    } else chunk = candidate
  }
  if (chunk) chunks.push(chunk)
  return chunks
}

// Greedily wrap one paragraph at word boundaries, splitting only words wider than the line.
// Callers choose whether an empty paragraph contributes a blank line.
export function wrap_text_paragraph(
  paragraph: string,
  available_width: number,
  font: Readonly<FontSpec>,
  measure: TextWidthMeasure = measure_text_line,
  preserve_empty_line = false,
): string[] {
  // No-break spaces stay within words and must not become wrapping opportunities.
  const trimmed = paragraph.trim()
  if (!trimmed) return preserve_empty_line ? [``] : []
  const words = trimmed.split(/[^\S\u00A0\u202F]+/u)
  if (available_width <= 0) return [words.join(` `)]

  const lines: string[] = []
  let line = ``
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (measure(candidate, font).width <= available_width) {
      line = candidate
      continue
    }
    if (line) lines.push(line)
    const chunks = split_overlong_word(word, available_width, font, measure)
    lines.push(...chunks.slice(0, -1))
    line = chunks.at(-1) ?? ``
  }
  if (line) lines.push(line)
  return lines
}

// Width for callers that already hold a canvas font shorthand rather than a FontSpec. Shares
// one canvas and one cache with measure_text_line, so a single invalidation covers both.
export const measure_css_text_width = (text: string, font_css: string): number =>
  cached_line_metrics(text, font_css, {
    ...DEFAULT_FONT_SPEC,
    font_size: parse_font_shorthand_size(font_css, DEFAULT_FONT_SPEC.font_size),
  }).width

// Clear cached browser and fallback measurements. The returned monotonic revision can be
// copied into Svelte state so derived layout reruns without this pure module owning observers.
export function clear_text_metrics_cache(): number {
  line_metrics_by_font = Object.create(null)
  cached_line_count = 0
  measurement_canvas = null
  metrics_revision += 1
  return metrics_revision
}

export const get_text_metrics_revision = (): number => metrics_revision

// Every axis and plot title asks for invalidation independently, so without memoizing per
// `ready` promise a page of N plots clears the cache N times, each clear re-running every
// dependent layout.
const invalidation_by_readiness = new WeakMap<object, Promise<number>>()

// One-shot font readiness hook for browser hosts. Await the returned revision and assign it to
// reactive state; no FontFaceSet event listener or other long-lived observer is retained here.
export function invalidate_text_metrics_after_fonts_ready(
  font_readiness: FontReadiness | undefined = typeof document === `undefined`
    ? undefined
    : document.fonts,
): Promise<number> {
  const ready = font_readiness?.ready
  if (!ready) return Promise.resolve(metrics_revision)
  const shared = invalidation_by_readiness.get(ready)
  if (shared) return shared
  const pending = Promise.resolve(ready).then(() => clear_text_metrics_cache())
  invalidation_by_readiness.set(ready, pending)
  // A cached rejection would be replayed to every later caller, so evict and let them retry
  pending.catch(() => invalidation_by_readiness.delete(ready))
  return pending
}
