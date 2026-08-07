// Canvas markers avoid one SVG node per point and batch adjacent shared styles into one
// path, keeping dense scatter plots efficient.

import { type D3SymbolName, symbol_map } from '$lib/labels'
import type { Rect } from '$lib/plot/core/layout'
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

// Position and symbol vary within a batch; style fields start a new path.
const style_key = (marker: CanvasMarker): string =>
  `${marker.fill}|${marker.fill_opacity}|${marker.stroke}|${marker.stroke_width}|${marker.stroke_opacity}|${marker.opacity}`

// Reuse position-independent d3 outlines by symbol and size.
const symbol_path_cache = new Map<string, Path2D>()
const MAX_SYMBOL_CACHE = 512

const paint_color = (color: string): boolean => color !== `none` && color !== `transparent`
const normalize_alpha = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0

const symbol_path = (
  symbol_type: D3SymbolName | undefined,
  radius: number,
  symbol_size?: number,
): Path2D => {
  const size = symbol_size ?? Math.PI * radius ** 2
  const key = `${symbol_type}|${size}`
  let path = symbol_path_cache.get(key)
  if (!path) {
    if (symbol_path_cache.size > MAX_SYMBOL_CACHE) symbol_path_cache.clear()
    const shape = (symbol_type && symbol_map[symbol_type]) ?? symbolCircle
    const spec = d3_symbol().type(shape).size(size)() ?? ``
    path = new Path2D(spec)
    symbol_path_cache.set(key, path)
  }
  return path
}

// Clear and draw markers. The backing store uses CSS size * pixel_ratio; clip is in CSS px.
export function draw_markers(
  ctx: CanvasRenderingContext2D,
  markers: readonly CanvasMarker[],
  options: { width: number; height: number; pixel_ratio?: number; clip?: Rect },
): void {
  const { width, height, pixel_ratio = 1, clip } = options

  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, width * pixel_ratio, height * pixel_ratio)
  if (markers.length === 0) {
    ctx.restore()
    return
  }

  ctx.scale(pixel_ratio, pixel_ratio)
  if (clip) {
    ctx.beginPath()
    ctx.rect(clip.x, clip.y, clip.width, clip.height)
    ctx.clip()
  }

  let open_key: string | null = null
  // Circles use the current path; translated symbols accumulate in one Path2D.
  let open_symbols: Path2D | null = null
  let has_circles = false
  // Separate alpha passes reproduce SVG fill/stroke opacity.
  let symbol_transform: DOMMatrix | undefined
  let fill_alpha = 1
  let stroke_alpha = 0

  const paint = (path?: Path2D) => {
    if (fill_alpha > 0) {
      ctx.globalAlpha = fill_alpha
      if (path) ctx.fill(path)
      else ctx.fill()
    }
    if (stroke_alpha > 0) {
      ctx.globalAlpha = stroke_alpha
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

  for (const [marker_idx, marker] of markers.entries()) {
    const { cx, cy, radius, symbol_size } = marker
    const valid_size =
      symbol_size == null
        ? Number.isFinite(radius) && radius > 0
        : Number.isFinite(symbol_size) && symbol_size > 0
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || !valid_size) continue

    const has_fill = paint_color(marker.fill)
    const has_stroke = paint_color(marker.stroke)
    const stroke_width = Number.isFinite(marker.stroke_width)
      ? Math.max(0, marker.stroke_width)
      : 0
    const next_fill_alpha = has_fill
      ? normalize_alpha(marker.opacity * marker.fill_opacity)
      : 0
    const next_stroke_alpha =
      stroke_width > 0 && has_stroke
        ? normalize_alpha(marker.opacity * marker.stroke_opacity)
        : 0
    // Translucent markers isolate so overlapping alphas match SVG (shared path composites once).
    const isolate =
      (next_fill_alpha > 0 && next_fill_alpha < 1) ||
      (next_stroke_alpha > 0 && next_stroke_alpha < 1)
    const key = isolate ? `${style_key(marker)}|${marker_idx}` : style_key(marker)
    if (key !== open_key) {
      flush()
      ctx.fillStyle = has_fill ? marker.fill : `#000` // canvas rejects CSS `none`
      ctx.strokeStyle = has_stroke ? marker.stroke : `#000`
      ctx.lineWidth = stroke_width
      fill_alpha = next_fill_alpha
      stroke_alpha = next_stroke_alpha
      open_key = key
      ctx.beginPath()
    }

    if (
      (marker.symbol_type === undefined || marker.symbol_type === `Circle`) &&
      marker.symbol_size == null
    ) {
      ctx.moveTo(cx + radius, cy) // break path so adjacent arcs don't connect
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      has_circles = true
    } else {
      open_symbols ??= new Path2D()
      symbol_transform ??= new DOMMatrix()
      symbol_transform.e = cx
      symbol_transform.f = cy
      open_symbols.addPath(
        symbol_path(marker.symbol_type, radius, marker.symbol_size),
        symbol_transform,
      )
    }
  }
  flush()
  ctx.restore()
}
