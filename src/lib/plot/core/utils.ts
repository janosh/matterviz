import type { TweenOptions } from 'svelte/motion'

// Unique DOM id token (for SVG clipPath/gradient ids, control `for`/`id` prefixes). Returns a
// fresh id on every call; callers should store it in a const (e.g. `const id = unique_id('foo')`)
// so it stays stable across re-renders. Pass a prefix for a readable `prefix-<uuid>`, or omit it
// when the caller adds its own prefix.
export const unique_id = (prefix = ``): string =>
  prefix ? `${prefix}-${crypto.randomUUID()}` : crypto.randomUUID()

// Path-morph (interpolatePath) tweening scales poorly with many simultaneously morphing
// <path> elements (band structures with 100+ bands) or a single very long line. Disable
// the morph above these budgets unless the caller explicitly opts into a tween.
const LINE_TWEEN = { max_series: 16, max_points: 8000 }

export const resolve_line_tween = (
  line_tween: TweenOptions<string> | undefined,
  load: { series: number; points: number },
): TweenOptions<string> | undefined =>
  line_tween ??
  (load.series > LINE_TWEEN.max_series || load.points > LINE_TWEEN.max_points
    ? { duration: 0 }
    : undefined)

// Attachment factory reporting an element's rendered size (immediately, on resize, and zeroed
// on unmount) without an extra measuring wrapper div. The element is passed along for callers
// that also read its computed style.
export const observe_size =
  <El extends Element>(
    on_size: (size: { height: number; width: number }, element: El) => void,
  ) =>
  (element: El) => {
    const update = () =>
      on_size({ height: element.clientHeight, width: element.clientWidth }, element)
    const observer = new ResizeObserver(update)
    observer.observe(element)
    update()
    return () => {
      observer.disconnect()
      on_size({ height: 0, width: 0 }, element)
    }
  }

// Keep the bitmap inside its SVG foreignObject so export preserves the layer's paint order.
export const attach_canvas =
  (class_name: string, assign: (canvas: HTMLCanvasElement | undefined) => void) =>
  (foreign_object: SVGForeignObjectElement) => {
    const canvas = document.createElement(`canvas`)
    canvas.className = class_name
    Object.assign(canvas.style, { display: `block`, pointerEvents: `none` })
    foreign_object.append(canvas)
    assign(canvas)
    return () => {
      assign(undefined)
      canvas.remove()
    }
  }

// Round fractional CSS sizes/DPR to the nearest physical pixel, keeping tiny canvases valid.
// Assign dimensions only when changed: writing them resets the bitmap and context state.
export function prepare_canvas(
  canvas: HTMLCanvasElement | undefined,
  width: number,
  height: number,
) {
  if (!canvas || !(width > 0 && height > 0)) return undefined
  const pixel_ratio = globalThis.devicePixelRatio || 1
  const backing_width = Math.max(1, Math.round(width * pixel_ratio))
  const backing_height = Math.max(1, Math.round(height * pixel_ratio))
  if (canvas.width !== backing_width) canvas.width = backing_width
  if (canvas.height !== backing_height) canvas.height = backing_height
  if (canvas.style.width !== `${width}px`) canvas.style.width = `${width}px`
  if (canvas.style.height !== `${height}px`) canvas.style.height = `${height}px`
  const ctx = canvas.getContext(`2d`)
  return ctx ? { ctx, width, height, pixel_ratio } : undefined
}
