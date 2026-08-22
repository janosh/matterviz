// DPR-aware 2D canvas that tracks its parent's size and the colour theme, and coalesces
// repaint requests into one animation frame (isothermal section and stability map)
import { is_dark_mode, watch_dark_mode } from '$lib/colors'
import { canvas_text_color } from '$lib/convex-hull/canvas-interactions.svelte'

export interface CanvasFrame {
  ctx: CanvasRenderingContext2D
  width: number // CSS px
  height: number
  text_color: string
  dark_mode: boolean
}

export function create_canvas_surface(inputs: {
  canvas: () => HTMLCanvasElement | undefined
  height?: () => number | undefined // CSS px; undefined follows the parent element
  draw: (frame: CanvasFrame) => void
  repaint_deps: () => unknown // reactive values the draw code reads (rAF reads are untracked)
}) {
  let dark_mode = $state(is_dark_mode())
  $effect(() => watch_dark_mode((dark) => (dark_mode = dark)))
  const text_color = $derived(canvas_text_color(dark_mode))
  let ctx: CanvasRenderingContext2D | null = null
  let dims = $state({ width: 0, height: 0 })
  let frame_id = 0

  const schedule = (): void => {
    if (frame_id || typeof requestAnimationFrame === `undefined`) return
    frame_id = requestAnimationFrame(() => {
      frame_id = 0
      if (!ctx || !dims.width || !dims.height) return
      ctx.clearRect(0, 0, dims.width, dims.height)
      inputs.draw({ ctx, width: dims.width, height: dims.height, text_color, dark_mode })
    })
  }
  function resize(): void {
    const canvas = inputs.canvas()
    if (!canvas) return undefined
    const dpr = globalThis.devicePixelRatio || 1
    // Client size excludes the parent's scrollbar, like the canvas's own CSS width: 100%
    const width = canvas.parentElement?.clientWidth ?? 0
    const height = inputs.height?.() ?? canvas.parentElement?.clientHeight ?? 0
    const [px_width, px_height] = [Math.round(width * dpr), Math.round(height * dpr)]
    if (!ctx || canvas.width !== px_width || canvas.height !== px_height) {
      canvas.width = px_width
      canvas.height = px_height
      canvas.style.height = `${height}px`
      ctx = canvas.getContext(`2d`)
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    if (dims.width !== width || dims.height !== height) dims = { width, height }
    schedule()
  }
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
  // An explicit height change is not a parent resize; this effect also does the initial
  // resize, so the observer above only tracks the canvas element itself
  $effect(resize)
  $effect(() => {
    inputs.repaint_deps()
    void text_color
    schedule()
  })
  return {
    get dims() {
      return dims
    },
    schedule,
  }
}
