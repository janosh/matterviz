// DPR-aware 2D canvas that tracks its parent's size and the colour theme, and coalesces
// repaint requests into one animation frame. An optional transparent overlay canvas stacked
// over the base is sized alongside it and repainted on every scheduled frame, so cheap
// animations (pulsing markers) don't trigger the expensive base repaint.
import { is_dark_mode, watch_dark_mode } from '$lib/colors'
import {
  create_canvas_surface as create_surface,
  type CanvasFrame as BaseCanvasFrame,
} from 'svelte-widgets/canvas'

export interface CanvasFrame extends BaseCanvasFrame {
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

export function create_canvas_surface(
  inputs: Omit<Parameters<typeof create_surface>[0], 'draw' | 'draw_overlay'> & {
    draw: (frame: CanvasFrame) => void
    draw_overlay?: (frame: CanvasFrame) => void
  },
) {
  let dark_mode = $state(is_dark_mode())
  $effect(() => {
    const canvas = inputs.canvas()
    dark_mode = is_dark_mode(canvas)
    return watch_dark_mode((dark) => (dark_mode = dark), canvas)
  })
  const text_color = $derived(canvas_text_color(inputs.canvas(), dark_mode))
  const surface = create_surface({
    ...inputs,
    draw: (frame) => inputs.draw({ ...frame, text_color, dark_mode }),
    draw_overlay: (frame) => inputs.draw_overlay?.({ ...frame, text_color, dark_mode }),
    repaint_deps: () => [inputs.repaint_deps(), text_color, dark_mode],
  })
  return {
    get dims() {
      return surface.dims
    },
    get text_color() {
      return text_color
    },
    schedule: surface.schedule,
  }
}
