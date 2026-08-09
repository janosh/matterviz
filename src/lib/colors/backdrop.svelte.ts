import { is_concrete_color, is_opaque_color, watch_dark_mode } from '$lib/colors'

const DEFAULT_BACKDROP_VAR = `--page-bg`

interface ColorOptions {
  fallback?: string | (() => string)
  require_opaque?: boolean
  // Color the caller already knows, which short-circuits the lookup: no token read and no
  // observer. Matters for repeated children -- a periodic table would otherwise walk the
  // ancestor chain and install an observer once per tile. Ignored unless it is usable.
  override?: () => string | undefined
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
  const { fallback = `white`, require_opaque = false, override } = options
  const resolve_fallback = () => (typeof fallback === `function` ? fallback() : fallback)
  const is_usable = require_opaque ? is_opaque_color : is_concrete_color
  let color = $state(resolve_fallback())
  // Derived, not a plain call: `current` is read once per child and each read would
  // otherwise re-parse the override, which is the per-child work it exists to skip.
  const overridden = $derived.by(() => {
    const supplied = override?.()
    return is_usable(supplied) ? supplied : undefined
  })

  $effect(() => {
    const node = overridden === undefined ? get_node() : undefined
    if (!node) return undefined
    const read = () => {
      color = read_colors(node).find(is_usable) ?? resolve_fallback()
    }
    read()
    return watch_css_color(node, read)
  })

  return {
    get current() {
      return overridden ?? color
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

// The opaque color painted behind `node`. Compositing a translucent fill needs an opaque
// base, so a translucent token -- or a translucent `override` -- is rejected in favour of
// the fallback. Components exposing a `backdrop` prop pass it straight through as `override`.
export const resolve_backdrop = (
  get_node: () => Element | null | undefined,
  options: Omit<CssColorOptions, `require_opaque`> = {},
): { readonly current: string } =>
  resolve_css_color(get_node, { ...options, require_opaque: true })
