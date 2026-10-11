// Canvas markers avoid one SVG node per point and batch adjacent shared styles into one
// path, keeping dense scatter plots efficient.

import { type D3SymbolName, symbol_map } from '#lib/labels.js'
import { clamp01 } from '#lib/utils.js'
import { color as d3_color } from 'd3-color'
import { symbol as d3_symbol, symbolCircle } from 'd3-shape'

export interface CanvasMarker {
  cx: number
  cy: number
  radius: number
  // Explicit d3 symbol area; defaults to π·radius² (same as ScatterPoint)
  symbol_size?: number
  symbol_type?: D3SymbolName
  fill: string
  fill_opacity: number
  stroke: string
  stroke_width: number
  stroke_opacity: number
  opacity: number // legend-hover dimming, 1 when not dimmed
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
interface MarkerPaint {
  fill_style: string
  stroke_style: string
  line_width: number
  fill_alpha: number
  stroke_alpha: number
  // Each translucent or filled-and-stroked marker must be painted on its own to preserve SVG overlap compositing
  // and fill/stroke order, even when styles match
  isolate: boolean
}
const marker_paint = (marker: CanvasMarker): MarkerPaint => {
  const fill_color_opacity = color_opacity(marker.fill)
  const stroke_color_opacity = color_opacity(marker.stroke)
  const has_fill = marker.fill !== `none` && fill_color_opacity > 0
  const has_stroke = marker.stroke !== `none` && stroke_color_opacity > 0
  const line_width = Number.isFinite(marker.stroke_width)
    ? Math.max(0, marker.stroke_width)
    : 0
  const fill_alpha = normalize_alpha(has_fill ? marker.opacity * marker.fill_opacity : 0)
  const stroke_alpha = normalize_alpha(
    line_width > 0 && has_stroke ? marker.opacity * marker.stroke_opacity : 0,
  )
  return {
    fill_style: has_fill ? marker.fill : `#000`, // canvas rejects CSS `none`
    stroke_style: has_stroke ? marker.stroke : `#000`,
    line_width,
    fill_alpha,
    stroke_alpha,
    isolate:
      (fill_alpha > 0 && (stroke_alpha > 0 || fill_alpha < 1 || fill_color_opacity < 1)) ||
      (stroke_alpha > 0 && (stroke_alpha < 1 || stroke_color_opacity < 1)),
  }
}

const same_style = (marker: CanvasMarker, other: CanvasMarker | null): boolean =>
  other !== null &&
  marker.fill === other.fill &&
  marker.stroke === other.stroke &&
  marker.fill_opacity === other.fill_opacity &&
  marker.stroke_width === other.stroke_width &&
  marker.stroke_opacity === other.stroke_opacity &&
  marker.opacity === other.opacity

const is_circle = (marker: CanvasMarker): boolean =>
  (marker.symbol_type === undefined || marker.symbol_type === `Circle`) &&
  marker.symbol_size == null

const valid_marker = (marker: CanvasMarker): boolean => {
  const marker_size = marker.symbol_size ?? marker.radius
  return (
    Number.isFinite(marker.cx) &&
    Number.isFinite(marker.cy) &&
    Number.isFinite(marker_size) &&
    marker_size > 0
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
// LRU entries; with the side cap that bounds the cache at 16 MB of RGBA
export const MAX_SPRITE_CACHE = 256
// Canvas default miterLimit: a miter join reaches up to this many half stroke widths past a sharp vertex
const MITER_LIMIT = 10
interface Sprite {
  image: OffscreenCanvas
  half: number // CSS px from the sprite's top-left corner to the marker centre
}
const sprite_cache = new Map<string, Sprite>() // insertion order = recency

// The sprite for a marker style, or null when it exceeds MAX_SPRITE_SIDE or no offscreen 2D context exists
const sprite_for = (
  marker: CanvasMarker,
  paint: MarkerPaint,
  pixel_ratio: number,
): Sprite | null => {
  const key = `${marker.fill}|${marker.stroke}|${marker.fill_opacity}|${marker.stroke_width}|${marker.stroke_opacity}|${marker.opacity}|${marker.symbol_type}|${marker.symbol_size}|${marker.radius}|${pixel_ratio}`
  const cached = sprite_cache.get(key)
  if (cached) {
    sprite_cache.delete(key)
    sprite_cache.set(key, cached)
    return cached
  }
  // half-extent: circle radius, or a symbol's bounding radius (d3 sizes are areas), plus the stroke's reach (round
  // for circles, up to a miter at symbol vertices) and an antialias pixel
  const circle = is_circle(marker)
  const shape_radius = circle
    ? marker.radius
    : Math.sqrt(marker.symbol_size ?? Math.PI * marker.radius ** 2)
  const stroke_reach =
    paint.stroke_alpha > 0 ? (paint.line_width / 2) * (circle ? 1 : MITER_LIMIT) : 0
  const half = shape_radius + stroke_reach + 1
  const side = Math.max(1, Math.ceil(2 * half * pixel_ratio))
  if (side > MAX_SPRITE_SIDE) return null
  const image = new OffscreenCanvas(side, side)
  const sprite_ctx = image.getContext(`2d`)
  if (!sprite_ctx) return null
  sprite_ctx.scale(pixel_ratio, pixel_ratio)
  sprite_ctx.fillStyle = paint.fill_style
  sprite_ctx.strokeStyle = paint.stroke_style
  sprite_ctx.lineWidth = paint.line_width
  const outline = new Path2D()
  if (circle) outline.arc(half, half, marker.radius, 0, Math.PI * 2)
  else
    outline.addPath(
      symbol_path(marker.symbol_type, marker.radius, marker.symbol_size),
      new DOMMatrix([1, 0, 0, 1, half, half]),
    )
  if (paint.fill_alpha > 0) {
    sprite_ctx.globalAlpha = paint.fill_alpha
    // oxlint-disable-next-line eslint-plugin-unicorn/no-array-fill-with-reference-type -- canvas fill, not Array.fill
    sprite_ctx.fill(outline)
  }
  if (paint.stroke_alpha > 0) {
    sprite_ctx.globalAlpha = paint.stroke_alpha
    sprite_ctx.stroke(outline)
  }
  const oldest = sprite_cache.keys().next()
  if (sprite_cache.size >= MAX_SPRITE_CACHE && !oldest.done) sprite_cache.delete(oldest.value)
  const sprite = { image, half }
  sprite_cache.set(key, sprite)
  return sprite
}

const same_sprite = (marker: CanvasMarker, other: CanvasMarker | null): boolean =>
  same_style(marker, other) &&
  marker.radius === other?.radius &&
  marker.symbol_type === other.symbol_type &&
  marker.symbol_size === other.symbol_size

// Sprites by the index of the valid marker opening each style run (null: the style paints nothing), or null when
// paths are the better renderer: too many runs, an oversized marker or no offscreen 2D context. Decided before
// anything is drawn, so the fallback never repaints.
const plan_sprites = (
  markers: readonly CanvasMarker[],
  pixel_ratio: number,
): Map<number, Sprite | null> | null => {
  const runs = new Map<number, Sprite | null>()
  let open_marker: CanvasMarker | null = null
  for (const [idx, marker] of markers.entries()) {
    if (!valid_marker(marker) || same_sprite(marker, open_marker)) continue
    if (runs.size === MAX_SPRITE_RUNS) return null
    open_marker = marker
    const paint = marker_paint(marker)
    if (paint.fill_alpha === 0 && paint.stroke_alpha === 0) runs.set(idx, null)
    else {
      const sprite = sprite_for(marker, paint, pixel_ratio)
      if (!sprite) return null
      runs.set(idx, sprite)
    }
  }
  return runs
}

const stamp_sprites = (
  ctx: CanvasRenderingContext2D,
  markers: readonly CanvasMarker[],
  runs: Map<number, Sprite | null>,
  pixel_ratio: number,
): void => {
  let sprite: Sprite | null = null
  for (const [idx, marker] of markers.entries()) {
    if (!valid_marker(marker)) continue
    const run_sprite = runs.get(idx)
    if (run_sprite !== undefined) sprite = run_sprite
    if (!sprite) continue
    // device-pixel snapped top-left corner, in the identity transform
    const left = Math.round((marker.cx - sprite.half) * pixel_ratio)
    const top = Math.round((marker.cy - sprite.half) * pixel_ratio)
    ctx.drawImage(sprite.image, left, top)
  }
}

// Clear and draw markers. The backing store uses CSS size * pixel_ratio.
export function draw_markers(
  ctx: CanvasRenderingContext2D,
  markers: readonly CanvasMarker[],
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
    stamp_sprites(ctx, markers, runs, pixel_ratio)
    ctx.restore()
    return
  }
  if (markers.length === 0) {
    ctx.restore()
    return
  }

  ctx.scale(pixel_ratio, pixel_ratio)

  let open_marker: CanvasMarker | null = null
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

  for (const marker of markers) {
    if (!valid_marker(marker)) continue
    // Styles usually repeat across a series: normalize and assign canvas state only when the style changes
    const style_changed = !same_style(marker, open_marker)
    if (style_changed || paint_state?.isolate) {
      flush()
      ctx.beginPath()
    }
    if (style_changed) {
      paint_state = marker_paint(marker)
      ctx.fillStyle = paint_state.fill_style
      ctx.strokeStyle = paint_state.stroke_style
      ctx.lineWidth = paint_state.line_width
      open_marker = marker
    }

    if (is_circle(marker)) {
      ctx.moveTo(marker.cx + marker.radius, marker.cy) // break path so adjacent arcs don't connect
      ctx.arc(marker.cx, marker.cy, marker.radius, 0, Math.PI * 2)
      has_circles = true
    } else {
      open_symbols ??= new Path2D()
      symbol_transform ??= new DOMMatrix()
      symbol_transform.e = marker.cx
      symbol_transform.f = marker.cy
      open_symbols.addPath(
        symbol_path(marker.symbol_type, marker.radius, marker.symbol_size),
        symbol_transform,
      )
    }
  }
  flush()
  ctx.restore()
}
