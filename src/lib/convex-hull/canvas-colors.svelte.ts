import { is_dark_mode, watch_dark_mode } from '$lib/colors'
import { get_canvas_text_color } from './helpers'

// Canvas colours for the hull renderers, kept in one place because 3D and 4D resolve them
// identically. `edge` comes from a CSS variable, which can only be read off a live element,
// so it is resolved here rather than in CSS — and re-resolved whenever the theme changes or
// the canvas element is replaced (e.g. a renderer remount). Both come back as `''` before a
// canvas exists; callers pick their own fallback at the point of use.
export function create_canvas_colors(canvas: () => HTMLCanvasElement | undefined): {
  readonly text: string
  readonly edge: string
} {
  let dark_mode = $state(is_dark_mode())
  $effect(() => watch_dark_mode((dark) => (dark_mode = dark)))

  const text = $derived(get_canvas_text_color(dark_mode))
  let edge = $state(``)
  $effect(() => {
    const node = canvas()
    edge = node ? getComputedStyle(node).getPropertyValue(`--hull-edge-color`).trim() : ``
    void dark_mode // re-read the variable when the theme flips
  })

  return {
    get text() {
      return text
    },
    get edge() {
      return edge
    },
  }
}
