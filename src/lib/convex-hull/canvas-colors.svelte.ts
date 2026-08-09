import { is_dark_mode, watch_dark_mode } from '$lib/colors'
import { get_canvas_text_color } from './helpers'

// Canvas text colour for the hull renderers, kept in one place because 3D and 4D resolve it
// identically. Canvas takes a colour value, not a CSS variable, so the theme has to be read
// in JS and the canvas repainted on every flip.
export function create_canvas_text_color(): { readonly current: string } {
  let dark_mode = $state(is_dark_mode())
  $effect(() => watch_dark_mode((dark) => (dark_mode = dark)))

  const text = $derived(get_canvas_text_color(dark_mode))
  return {
    get current() {
      return text
    },
  }
}
