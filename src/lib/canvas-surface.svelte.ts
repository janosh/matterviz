// DPR-aware 2D canvas that tracks its parent's size and the colour theme, and coalesces
// repaint requests into one animation frame. An optional transparent overlay canvas stacked
// over the base is sized alongside it and repainted on every scheduled frame, so cheap
// animations (pulsing markers) don't trigger the expensive base repaint.
import { is_dark_mode, watch_dark_mode } from '$lib/colors'
import { untrack } from 'svelte'

export interface CanvasFrame {
  ctx: CanvasRenderingContext2D
  width: number // CSS px
  height: number
  text_color: string
  dark_mode: boolean
}

// Canvas text colour. Canvas takes a colour value, not a CSS variable, so read the colour the
// canvas element itself inherits (already resolved through light-dark()/var()); the fallback
// only applies before the canvas exists.
export function canvas_text_color(canvas: Element | undefined, dark_mode: boolean): string {
  const inherited = canvas && getComputedStyle(canvas).color
  return inherited && inherited !== `rgba(0, 0, 0, 0)`
    ? inherited
    : dark_mode
      ? `#ffffff`
      : `#212121`
}

// Backing store at `width`×`height` CSS px times `dpr`, with the context transformed so draw
// code works in CSS px. Assigning width/height clears a canvas even when unchanged, so the
// existing context is kept when the size matches.
function size_canvas(
  canvas: HTMLCanvasElement,
  existing: CanvasRenderingContext2D | null,
  width: number,
  height: number,
  dpr: number,
): CanvasRenderingContext2D | null {
  const [px_width, px_height] = [Math.round(width * dpr), Math.round(height * dpr)]
  if (
    existing?.canvas === canvas &&
    canvas.width === px_width &&
    canvas.height === px_height
  ) {
    return existing
  }
  canvas.width = px_width
  canvas.height = px_height
  const ctx = canvas.getContext(`2d`)
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = `high`
  }
  return ctx
}

export function create_canvas_surface(inputs: {
  canvas: () => HTMLCanvasElement | undefined
  overlay_canvas?: () => HTMLCanvasElement | undefined
  height?: () => number | undefined // CSS px; undefined follows the parent element
  draw: (frame: CanvasFrame) => void // base layer, onto a cleared context
  draw_overlay?: (frame: CanvasFrame) => void // overlay layer, every frame; clears itself
  repaint_deps: () => unknown // reactive values the draw code reads (rAF reads are untracked)
}) {
  // Root guess before mount; watch_dark_mode re-reads from the canvas itself once it exists
  let dark_mode = $state(is_dark_mode())
  $effect(() => watch_dark_mode((dark) => (dark_mode = dark), inputs.canvas()))
  const text_color = $derived(canvas_text_color(inputs.canvas(), dark_mode))
  let ctx: CanvasRenderingContext2D | null = null
  let overlay_ctx: CanvasRenderingContext2D | null = null
  let dims = $state({ width: 0, height: 0 })
  let frame_id = 0
  let base_is_stale = false

  const frame_for = (context: CanvasRenderingContext2D): CanvasFrame => ({
    ctx: context,
    width: dims.width,
    height: dims.height,
    text_color,
    dark_mode,
  })

  // One frame for both layers: the overlay always, the base only when asked, so an overlay
  // tick landing on a pending base redraw is absorbed rather than requeued
  function schedule(redraw_base = true): void {
    base_is_stale ||= redraw_base
    if (frame_id) return
    frame_id = requestAnimationFrame(() => {
      frame_id = 0
      const redraw = base_is_stale
      base_is_stale = false
      if (!dims.width || !dims.height) return
      if (redraw && ctx) {
        ctx.clearRect(0, 0, dims.width, dims.height)
        inputs.draw(frame_for(ctx))
      }
      if (overlay_ctx) inputs.draw_overlay?.(frame_for(overlay_ctx))
    })
  }

  function resize(): void {
    const canvas = inputs.canvas()
    if (!canvas) return
    const dpr = globalThis.devicePixelRatio || 1
    // Client size excludes the parent's scrollbar, like the canvas's own CSS width: 100%
    const width = canvas.parentElement?.clientWidth ?? 0
    const explicit_height = inputs.height?.()
    const height = explicit_height ?? canvas.parentElement?.clientHeight ?? 0
    if (explicit_height !== undefined) canvas.style.height = `${height}px`
    ctx = size_canvas(canvas, ctx, width, height, dpr)
    const overlay = inputs.overlay_canvas?.()
    if (overlay) overlay_ctx = size_canvas(overlay, overlay_ctx, width, height, dpr)
    if (dims.width !== width || dims.height !== height) dims = { width, height }
    schedule()
  }

  // Parent resizes only re-size the canvas (a camera, say, is never reset by them)
  $effect(() => {
    const canvas = inputs.canvas()
    if (!canvas) return undefined
    const observer = new ResizeObserver(resize)
    if (canvas.parentElement) observer.observe(canvas.parentElement)
    return () => {
      observer.disconnect()
      if (frame_id) cancelAnimationFrame(frame_id)
      frame_id = 0
    }
  })
  // Initial sizing, plus re-sizing when a canvas mounts or the explicit height changes
  // (neither is a parent resize). resize() writes `dims`, so it runs untracked.
  $effect(() => {
    void [inputs.canvas(), inputs.overlay_canvas?.(), inputs.height?.()]
    untrack(resize)
  })
  $effect(() => {
    inputs.repaint_deps()
    void text_color
    schedule()
  })

  return {
    get dims() {
      return dims
    },
    get text_color() {
      return text_color
    },
    get dark_mode() {
      return dark_mode
    },
    schedule,
  }
}
