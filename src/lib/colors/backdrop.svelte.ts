import { is_concrete_color, is_opaque_color, watch_dark_mode } from '$lib/colors'

// Theme token that every matterviz surface ultimately sits on.
export const DEFAULT_BACKDROP_VAR = `--page-bg`

interface CssColorOptions {
  css_var?: string | readonly string[]
  fallback?: string | (() => string)
  require_opaque?: boolean
}

// Live value of a CSS custom property on `node`, re-read whenever the theme changes.
// Reading one named token beats walking ancestor background-colors: it survives
// gradients, canvases and shadow roots, and hosts that restyle the token still win.
// The theme subscription is the part a one-shot DOM lookup gets wrong -- it leaves text
// at its old contrast (white on white) after a switch.
export function resolve_css_color(
  get_node: () => HTMLElement | null | undefined,
  options: CssColorOptions = {},
): { readonly current: string } {
  const {
    css_var = DEFAULT_BACKDROP_VAR,
    fallback = `white`,
    require_opaque = false,
  } = options
  const css_vars = typeof css_var === `string` ? [css_var] : css_var
  const resolve_fallback = () => (typeof fallback === `function` ? fallback() : fallback)
  const is_usable = require_opaque ? is_opaque_color : is_concrete_color
  let color = $state(resolve_fallback())

  $effect(() => {
    const node = get_node()
    if (!node) return undefined
    const read = () => {
      const style = getComputedStyle(node)
      color =
        css_vars.map((name) => style.getPropertyValue(name).trim()).find(is_usable) ??
        resolve_fallback()
    }
    read()
    return watch_dark_mode(read)
  })

  return {
    get current() {
      return color
    },
  }
}

// The opaque color painted behind `node`. Compositing a translucent fill needs an
// opaque base, so a translucent token is rejected in favour of the fallback.
export const resolve_backdrop = (
  get_node: () => HTMLElement | null | undefined,
  options: Omit<CssColorOptions, `require_opaque`> = {},
): { readonly current: string } =>
  resolve_css_color(get_node, { ...options, require_opaque: true })
