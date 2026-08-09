import { is_concrete_color, is_opaque_color, watch_dark_mode } from '$lib/colors'

const DEFAULT_BACKDROP_VAR = `--page-bg`

interface ColorOptions {
  fallback?: string | (() => string)
  require_opaque?: boolean
}

interface CssColorOptions extends ColorOptions {
  css_var?: string | readonly string[]
}

// Re-run a computed-color read when the theme or an ancestor selector may have changed.
export const watch_css_color = (node: Element, read: () => void): (() => void) => {
  const stop_watching_theme = watch_dark_mode(read)
  const observer = new MutationObserver(read)
  let ancestor: Element | null = node
  while (ancestor) {
    observer.observe(ancestor, {
      attributes: true,
      attributeFilter: [`class`, `data-theme`, `style`],
    })
    const root = ancestor.getRootNode()
    ancestor =
      ancestor.parentElement ??
      (typeof ShadowRoot !== `undefined` && root instanceof ShadowRoot ? root.host : null)
  }
  return () => {
    stop_watching_theme()
    observer.disconnect()
  }
}

const resolve_live_color = (
  get_node: () => Element | null | undefined,
  read_colors: (node: Element) => readonly string[],
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
    return watch_css_color(node, read)
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
  get_node: () => Element | null | undefined,
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
  get_node: () => Element | null | undefined,
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
// Components that expose a `backdrop` prop pass it as `override`: a caller-supplied
// backdrop short-circuits the lookup, so no token read or observer is set up at all.
// That matters for repeated children -- a periodic table would otherwise walk the
// ancestor chain once per tile.
export const resolve_backdrop = (
  get_node: () => Element | null | undefined,
  options: Omit<CssColorOptions, `require_opaque`> & {
    override?: () => string | undefined
  } = {},
): { readonly current: string } => {
  const { override, ...css_options } = options
  // Derived, not a plain call: `current` is read once per child and each read would
  // otherwise re-parse the override, which is the per-child work `override` exists to skip.
  const opaque_override = $derived.by(() => {
    const color = override?.()
    return is_opaque_color(color) ? color : undefined
  })
  const resolved = resolve_css_color(
    () => (opaque_override === undefined ? get_node() : undefined),
    { ...css_options, require_opaque: true },
  )
  return {
    get current() {
      return opaque_override ?? resolved.current
    },
  }
}
