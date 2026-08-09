import { is_concrete_color, is_opaque_color, watch_dark_mode } from '$lib/colors'

const DEFAULT_BACKDROP_VAR = `--page-bg`

interface ColorOptions {
  fallback?: string | (() => string)
  require_opaque?: boolean
}

interface CssColorOptions extends ColorOptions {
  css_var?: string | readonly string[]
}

const resolve_live_color = (
  get_node: () => HTMLElement | null | undefined,
  read_colors: (node: HTMLElement) => readonly string[],
  options: ColorOptions,
): { readonly current: string } => {
  const { fallback = `white`, require_opaque = false } = options
  const resolve_fallback = () => (typeof fallback === `function` ? fallback() : fallback)
  const is_usable = require_opaque ? is_opaque_color : is_concrete_color
  let color = $state(resolve_fallback())

  $effect(() => {
    const node = get_node()
    if (!node) return undefined
    const read = () => {
      color = read_colors(node).find(is_usable) ?? resolve_fallback()
    }
    read()
    const stop_watching_theme = watch_dark_mode(read)
    const observer = new MutationObserver(read)
    let ancestor: Element | null = node
    while (ancestor) {
      observer.observe(ancestor, { attributes: true })
      const root = ancestor.getRootNode()
      ancestor =
        ancestor.parentElement ??
        (typeof ShadowRoot !== `undefined` && root instanceof ShadowRoot ? root.host : null)
    }
    return () => {
      stop_watching_theme()
      observer.disconnect()
    }
  })

  return {
    get current() {
      return color
    },
  }
}

// Live CSS color token on `node`, re-read after theme and ancestor-attribute changes.
// Named tokens work across gradients, canvases and shadow roots without guessing which
// rendered background belongs to the component.
export function resolve_css_color(
  get_node: () => HTMLElement | null | undefined,
  options: CssColorOptions = {},
): { readonly current: string } {
  const { css_var = DEFAULT_BACKDROP_VAR, ...color_options } = options
  const css_vars = typeof css_var === `string` ? [css_var] : css_var
  return resolve_live_color(
    get_node,
    (node) => {
      const style = getComputedStyle(node)
      return css_vars.map((name) => style.getPropertyValue(name).trim())
    },
    color_options,
  )
}

// Live computed CSS property on `node`, used when the authored color may be a var().
export const resolve_computed_color = (
  get_node: () => HTMLElement | null | undefined,
  css_property: string,
  options: ColorOptions = {},
): { readonly current: string } =>
  resolve_live_color(
    get_node,
    (node) => [getComputedStyle(node).getPropertyValue(css_property).trim()],
    options,
  )

// The opaque color painted behind `node`. Compositing a translucent fill needs an
// opaque base, so a translucent token is rejected in favour of the fallback.
export const resolve_backdrop = (
  get_node: () => HTMLElement | null | undefined,
  options: Omit<CssColorOptions, `require_opaque`> = {},
): { readonly current: string } =>
  resolve_css_color(get_node, { ...options, require_opaque: true })
