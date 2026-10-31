// Canvas markers avoid one SVG node per point and batch adjacent shared styles into one
// path, keeping dense scatter plots efficient.

import { type D3SymbolName, symbol_map } from '#lib/labels.js'
import { attach_canvas, canvas_painters, prepare_canvas } from '#lib/plot/core/utils.js'
import { clamp01 } from '#lib/utils.js'
import { color as d3_color } from 'd3-color'
import { symbol as d3_symbol, symbolCircle } from 'd3-shape'

// Visible markers past which charts in `auto` mode paint one canvas instead of SVG nodes
export const CANVAS_MARKER_THRESHOLD = 1000

// Canvas ignores invalid paint values, so restrict it to d3 colors and SVG's no-paint
// keyword. Memoized: a plot authors only a handful of distinct paint strings.
const canvas_color_safety = new Map<string, boolean>()
export const canvas_safe_color = (color: string): boolean => {
  let safe = canvas_color_safety.get(color)
  if (safe === undefined) {
    if (canvas_color_safety.size >= 1024) canvas_color_safety.clear()
    safe = color === `none` || d3_color(color) !== null
    canvas_color_safety.set(color, safe)
  }
  return safe
}

// A marker's look apart from its position, so charts build it once per data change and share
// one object across every marker drawn alike (whose runs then batch by identity)
export interface MarkerStyle {
  radius: number
  // Explicit d3 symbol area; defaults to π·radius² (same as ScatterPoint)
  symbol_size?: number
  symbol_type?: D3SymbolName
  fill: string
  fill_opacity: number
  stroke: string
  stroke_width: number
  stroke_opacity: number
}

// Markers as parallel arrays: a frame of a million points fills three typed arrays and one
// array of shared style references rather than a million objects for the GC to trace.
// `opacity` is legend-hover dimming, 1 when not dimmed.
export type MarkerBatch = {
  cx: Float64Array
  cy: Float64Array
  opacity: Float64Array
  style: MarkerStyle[]
  length: number
}
export const create_marker_batch = (capacity: number): MarkerBatch => ({
  cx: new Float64Array(capacity),
  cy: new Float64Array(capacity),
  opacity: new Float64Array(capacity),
  style: [],
  length: 0,
})
export const push_marker = (
  batch: MarkerBatch,
  cx: number,
  cy: number,
  opacity: number,
  style: MarkerStyle,
): void => {
  const idx = batch.length++
  batch.cx[idx] = cx
  batch.cy[idx] = cy
  batch.opacity[idx] = opacity
  batch.style[idx] = style
}

// Reuse position-independent d3 outlines by symbol and size.
const symbol_path_cache = new Map<string, Path2D>()
const MAX_SYMBOL_CACHE = 512

// Colour-scale output (`rgb(...)`) and 3/6-digit hex carry no alpha, so skip the d3 parse
// those 100k-marker plots would otherwise pay twice per marker.
const OPAQUE_COLOR = /^(?:rgb\(|hsl\(|#[\da-f]{3}$|#[\da-f]{6}$)/i
const color_opacity = (color: string): number =>
  OPAQUE_COLOR.test(color) ? 1 : (d3_color(color)?.opacity ?? 1)
const normalize_alpha = (value: number): number =>
  Number.isFinite(value) ? clamp01(value) : 0

const symbol_path = (
  symbol_type: D3SymbolName | undefined,
  radius: number,
  symbol_size?: number,
): Path2D => {
  const size = symbol_size ?? Math.PI * radius ** 2
  const key = `${symbol_type}|${size}`
  const cached_path = symbol_path_cache.get(key)
  if (cached_path) return cached_path
  if (symbol_path_cache.size > MAX_SYMBOL_CACHE) symbol_path_cache.clear()
  const shape = (symbol_type && symbol_map[symbol_type]) ?? symbolCircle
  const path = new Path2D(d3_symbol().type(shape).size(size)() ?? ``)
  symbol_path_cache.set(key, path)
  return path
}

// Canvas paint state of a marker style: SVG semantics (fill, then stroke, each with its own alpha; `none` and
// fully transparent colours paint nothing). Shared by the batched path and the sprite renderer.
const marker_paint = (opacity: number, style: MarkerStyle) => {
  const fill_color_opacity = color_opacity(style.fill)
  const stroke_color_opacity = color_opacity(style.stroke)
  const has_fill = style.fill !== `none` && fill_color_opacity > 0
  const has_stroke = style.stroke !== `none` && stroke_color_opacity > 0
  const line_width = Number.isFinite(style.stroke_width) ? Math.max(0, style.stroke_width) : 0
  const fill_alpha = normalize_alpha(has_fill ? opacity * style.fill_opacity : 0)
  const stroke_alpha = normalize_alpha(
    line_width > 0 && has_stroke ? opacity * style.stroke_opacity : 0,
  )
  return {
    fill_style: has_fill ? style.fill : `#000`, // canvas rejects CSS `none`
    stroke_style: has_stroke ? style.stroke : `#000`,
    line_width,
    fill_alpha,
    stroke_alpha,
    // Each translucent or filled-and-stroked marker is painted on its own to preserve SVG overlap
    // compositing and fill/stroke order, even when styles match
    isolate:
      (fill_alpha > 0 && (stroke_alpha > 0 || fill_alpha < 1 || fill_color_opacity < 1)) ||
      (stroke_alpha > 0 && (stroke_alpha < 1 || stroke_color_opacity < 1)),
  }
}

type MarkerPaint = ReturnType<typeof marker_paint>

// `first`'s markers, then `second`'s (painted over them)
export const concat_marker_batches = (
  first: MarkerBatch,
  second: MarkerBatch,
): MarkerBatch => {
  const joined = create_marker_batch(first.length + second.length)
  for (const key of [`cx`, `cy`, `opacity`] as const) {
    joined[key].set(first[key].subarray(0, first.length))
    joined[key].set(second[key].subarray(0, second.length), first.length)
  }
  for (let idx = 0; idx < first.length; idx++) joined.style[idx] = first.style[idx]
  for (let idx = 0; idx < second.length; idx++)
    joined.style[first.length + idx] = second.style[idx]
  joined.length = first.length + second.length
  return joined
}

// Whether marker `idx` paints like marker `other` (-1: none), shape aside; a shared style
// object answers without comparing fields
const same_style = (batch: MarkerBatch, idx: number, other: number): boolean => {
  if (other < 0 || batch.opacity[idx] !== batch.opacity[other]) return false
  const style = batch.style[idx]
  const other_style = batch.style[other]
  return (
    style === other_style ||
    (style.fill === other_style.fill &&
      style.stroke === other_style.stroke &&
      style.fill_opacity === other_style.fill_opacity &&
      style.stroke_width === other_style.stroke_width &&
      style.stroke_opacity === other_style.stroke_opacity)
  )
}

const is_circle = ({ symbol_type, symbol_size }: MarkerStyle): boolean =>
  (symbol_type === undefined || symbol_type === `Circle`) && symbol_size == null

const valid_marker = ({ cx, cy, style }: MarkerBatch, idx: number): boolean => {
  const size = style[idx].symbol_size ?? style[idx].radius
  return (
    Number.isFinite(cx[idx]) && Number.isFinite(cy[idx]) && Number.isFinite(size) && size > 0
  )
}

// === Sprites ===
// Dense plots stamp one pre-rendered bitmap per distinct style instead of tracing tens of thousands of arcs. Each
// stamp paints a whole marker (fill then stroke) over the ones before it, which is exactly SVG's per-marker order,
// so translucent overlaps composite as in SVG. Stamps snap to device pixels (≤ half a device pixel of shift).
export const SPRITE_MIN_MARKERS = 2000
// Style changes per draw past which tracing paths beats building bitmaps (per-point colours, say)
export const MAX_SPRITE_RUNS = 64
// Device-px side of the largest sprite; bigger markers trace paths
export const MAX_SPRITE_SIDE = 128
// Cached sprites before a reset; with the side cap that bounds the cache at 16 MB of RGBA
const MAX_SPRITE_CACHE = 256
// Canvas default miterLimit: a miter join reaches up to this many half stroke widths past a sharp vertex
const MITER_LIMIT = 10
type Sprite = { image: OffscreenCanvas; half: number } // half: CSS px from corner to centre
const sprite_cache = new Map<string, Sprite>()

// The sprite for a marker style, or null when it exceeds MAX_SPRITE_SIDE or no offscreen 2D context exists
const sprite_for = (
  opacity: number,
  style: MarkerStyle,
  paint: MarkerPaint,
  pixel_ratio: number,
) => {
  const key = `${style.fill}|${style.stroke}|${style.fill_opacity}|${style.stroke_width}|${style.stroke_opacity}|${opacity}|${style.symbol_type}|${style.symbol_size}|${style.radius}|${pixel_ratio}`
  const cached = sprite_cache.get(key)
  if (cached) return cached
  // half-extent: circle radius, or a symbol's bounding radius (d3 sizes are areas), plus the stroke's reach (round
  // for circles, up to a miter at symbol vertices) and an antialias pixel
  const circle = is_circle(style)
  const shape_radius = circle
    ? style.radius
    : Math.sqrt(style.symbol_size ?? Math.PI * style.radius ** 2)
  const stroke_reach =
    paint.stroke_alpha > 0 ? (paint.line_width / 2) * (circle ? 1 : MITER_LIMIT) : 0
  const half = shape_radius + stroke_reach + 1
  const side = Math.max(1, Math.ceil(2 * half * pixel_ratio))
  if (side > MAX_SPRITE_SIDE) return null
  const image = new OffscreenCanvas(side, side)
  const sprite_ctx = image.getContext(`2d`)
  if (!sprite_ctx) return null
  // a single marker always takes the path renderer, so sprites paint exactly like it
  const single = create_marker_batch(1)
  push_marker(single, half, half, opacity, style)
  draw_markers(sprite_ctx, single, {
    width: 2 * half,
    height: 2 * half,
    pixel_ratio,
  })
  if (sprite_cache.size >= MAX_SPRITE_CACHE) sprite_cache.clear() // like symbol_path_cache
  const sprite = { image, half }
  sprite_cache.set(key, sprite)
  return sprite
}

const same_sprite = (batch: MarkerBatch, idx: number, other: number): boolean => {
  if (!same_style(batch, idx, other)) return false
  const style = batch.style[idx]
  const other_style = batch.style[other]
  return (
    style === other_style ||
    (style.radius === other_style.radius &&
      style.symbol_type === other_style.symbol_type &&
      style.symbol_size === other_style.symbol_size)
  )
}

// Sprites by the index of the valid marker opening each style run (null: the style paints nothing), or null when
// paths are the better renderer: too many runs, an oversized marker or no offscreen 2D context. Decided before
// anything is drawn, so the fallback never repaints.
const plan_sprites = (markers: MarkerBatch, pixel_ratio: number) => {
  const runs = new Map<number, Sprite | null>()
  let open_marker = -1
  for (let idx = 0; idx < markers.length; idx++) {
    if (!valid_marker(markers, idx) || same_sprite(markers, idx, open_marker)) continue
    if (runs.size === MAX_SPRITE_RUNS) return null
    open_marker = idx
    const [opacity, style] = [markers.opacity[idx], markers.style[idx]]
    const paint = marker_paint(opacity, style)
    if (paint.fill_alpha === 0 && paint.stroke_alpha === 0) runs.set(idx, null)
    else {
      const sprite = sprite_for(opacity, style, paint, pixel_ratio)
      if (!sprite) return null
      runs.set(idx, sprite)
    }
  }
  return runs
}

// Clear and draw markers. The backing store uses CSS size * pixel_ratio.
export function draw_markers(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  markers: MarkerBatch,
  options: { width: number; height: number; pixel_ratio?: number },
): void {
  const { width, height, pixel_ratio = 1 } = options

  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, width * pixel_ratio, height * pixel_ratio)
  const runs =
    markers.length >= SPRITE_MIN_MARKERS && typeof OffscreenCanvas !== `undefined`
      ? plan_sprites(markers, pixel_ratio)
      : null
  if (runs) {
    let sprite: Sprite | null = null
    for (let idx = 0; idx < markers.length; idx++) {
      if (!valid_marker(markers, idx)) continue
      const run_sprite = runs.get(idx) // set where a style run opens
      if (run_sprite !== undefined) sprite = run_sprite
      if (!sprite) continue
      // device-pixel snapped top-left corner, in the identity transform
      const left = Math.round((markers.cx[idx] - sprite.half) * pixel_ratio)
      const top = Math.round((markers.cy[idx] - sprite.half) * pixel_ratio)
      ctx.drawImage(sprite.image, left, top)
    }
  }
  if (runs || markers.length === 0) {
    ctx.restore()
    return
  }

  ctx.scale(pixel_ratio, pixel_ratio)

  let open_marker = -1
  let paint_state: MarkerPaint | null = null
  // Circles use the current path; translated symbols accumulate in one Path2D.
  let open_symbols: Path2D | null = null
  let has_circles = false
  let symbol_transform: DOMMatrix | undefined

  // Separate alpha passes reproduce SVG fill/stroke opacity.
  const paint = (path?: Path2D) => {
    if (!paint_state) return
    if (paint_state.fill_alpha > 0) {
      ctx.globalAlpha = paint_state.fill_alpha
      if (path) ctx.fill(path)
      else ctx.fill()
    }
    if (paint_state.stroke_alpha > 0) {
      ctx.globalAlpha = paint_state.stroke_alpha
      if (path) ctx.stroke(path)
      else ctx.stroke()
    }
  }
  const flush = () => {
    if (has_circles) paint()
    if (open_symbols) paint(open_symbols)
    has_circles = false
    open_symbols = null
  }

  for (let idx = 0; idx < markers.length; idx++) {
    if (!valid_marker(markers, idx)) continue
    // Styles usually repeat across a series: normalize and assign canvas state only when the style changes
    const style_changed = !same_style(markers, idx, open_marker)
    if (style_changed || paint_state?.isolate) {
      flush()
      ctx.beginPath()
    }
    const cx = markers.cx[idx]
    const cy = markers.cy[idx]
    const style = markers.style[idx]
    if (style_changed) {
      paint_state = marker_paint(markers.opacity[idx], style)
      ctx.fillStyle = paint_state.fill_style
      ctx.strokeStyle = paint_state.stroke_style
      ctx.lineWidth = paint_state.line_width
      open_marker = idx
    }

    if (is_circle(style)) {
      ctx.moveTo(cx + style.radius, cy) // break path so adjacent arcs don't connect
      ctx.arc(cx, cy, style.radius, 0, Math.PI * 2)
      has_circles = true
    } else {
      open_symbols ??= new Path2D()
      symbol_transform ??= new DOMMatrix()
      symbol_transform.e = cx
      symbol_transform.f = cy
      open_symbols.addPath(
        symbol_path(style.symbol_type, style.radius, style.symbol_size),
        symbol_transform,
      )
    }
  }
  flush()
  ctx.restore()
}

// A chart's marker canvas: the attachment that puts it in a foreignObject (keeping SVG paint
// order for export) plus an effect painting `layer()` on it, also registered as its export
// painter so exports redraw at the export pixel ratio. Creates an $effect: call during init.
export function create_marker_canvas(
  layer: () => { markers: MarkerBatch; width: number; height: number },
) {
  let canvas = $state<HTMLCanvasElement>()
  const paint = (target?: HTMLCanvasElement, pixel_ratio?: number) => {
    const { markers, width, height } = layer()
    const surface = prepare_canvas(target, width, height, pixel_ratio)
    if (surface) draw_markers(surface.ctx, markers, surface)
  }
  $effect(() => {
    paint(canvas)
    if (canvas) canvas_painters.set(canvas, paint)
  })
  return attach_canvas(`marker-canvas`, (node) => (canvas = node))
}
