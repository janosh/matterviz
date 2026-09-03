import { is_concrete_color, is_opaque_color } from '$lib/colors'
import { observe_theme_attributes } from '$lib/theme'

const DEFAULT_BACKDROP_VAR = `--page-bg`

interface ColorOptions {
  fallback?: string | (() => string)
  require_opaque?: boolean
  // A usable caller-supplied color skips token lookup and observation, avoiding an
  // ancestor walk and observer for every repeated child.
  override?: () => string | undefined
}

type CssColorOptions = ColorOptions & { css_var?: string | readonly string[] }

// Re-run a computed-color read when the theme or an ancestor selector may have changed. The
// walk reaches <html> itself, so watch_dark_mode would only re-register the same media query.
export const watch_css_color = (node: Element, read: () => void): (() => void) => {
  const ancestors: Element[] = []
  let ancestor: Element | null = node
  while (ancestor) {
    ancestors.push(ancestor)
    const root = ancestor.getRootNode()
    ancestor =
      ancestor.parentElement ??
      (typeof ShadowRoot !== `undefined` && root instanceof ShadowRoot ? root.host : null)
  }
  return observe_theme_attributes(ancestors, read)
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
  const override_color = $derived.by(() => {
    const supplied = override?.()
    return is_usable(supplied) ? supplied : undefined
  })

  const node = $derived(override_color === undefined ? get_node() : undefined)
  const read = () => {
    if (node) color = read_colors(node).find(is_usable) ?? resolve_fallback()
  }
  // Observers live as long as the node does. The initial read runs in its own effect so
  // a reactive `fallback` (e.g. a per-point tooltip color) re-reads without tearing down
  // and rebuilding the theme + ancestor observers on every change.
  $effect(() => (node ? watch_css_color(node, read) : undefined))
  $effect(read)

  return {
    get current() {
      return override_color ?? color
    },
  }
}

// Live CSS color token on `node`, re-read after theme and ancestor-attribute changes.
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

// Resolve an opaque backdrop, rejecting translucent tokens and overrides.
export const resolve_backdrop = (
  get_node: () => Element | null | undefined,
  options: Omit<CssColorOptions, `require_opaque`> = {},
): { readonly current: string } =>
  resolve_css_color(get_node, { ...options, require_opaque: true })
