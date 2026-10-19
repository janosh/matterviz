import { is_concrete_color, is_opaque_color } from '#lib/colors/index.js'
import { watch_theme_changes } from '#lib/theme/index.js'

const DEFAULT_BACKDROP_VAR = `--page-bg`

interface ColorOptions {
  fallback?: string | (() => string)
  require_opaque?: boolean
  // A usable caller-supplied color skips token lookup and observation (an ancestor walk and
  // observer for every repeated child)
  override?: () => string | undefined
  // Inline custom properties the color depends on through the stylesheet (e.g. a canvas whose
  // CSS color is var(--x)), so an ancestor setting --x inline re-reads it (see watch_theme_changes)
  watch?: readonly string[]
}

type CssColorOptions = ColorOptions & { css_var?: string | readonly string[] }

// Custom property names a CSS value reads (`var(--a, var(--b, red))` -> --a, --b), so a color
// read can watch exactly the inline variables it depends on (see watch_theme_changes)
export const css_var_names = (value: string): string[] =>
  [...value.matchAll(/var\(\s*(?<name>--[\w-]+)/g)].flatMap(({ groups }) =>
    groups?.name ? [groups.name] : [],
  )

const resolve_live_color = (
  get_node: () => Element | null | undefined,
  read_colors: (node: Element) => readonly string[],
  watched_props: readonly string[],
  options: ColorOptions,
): { readonly current: string } => {
  const { fallback = `white`, require_opaque = false, override, watch = [] } = options
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
  // Observers live as long as the node does. The read runs in its own effect so a reactive
  // `fallback` (e.g. a per-point tooltip color) re-reads without rebuilding the observers.
  $effect(() =>
    node ? watch_theme_changes(node, read, [...watched_props, ...watch]) : undefined,
  )
  $effect(read)

  return {
    get current() {
      return override_color ?? color
    },
  }
}

// A token defined as a color function (`--page-bg: light-dark(...)`, var(), color-mix()) computes
// to that literal string, not a color. Resolve it as a probe's `color`: the probe inherits the
// node's color-scheme, which picks the light-dark() branch. Rejected values stay as they are.
export const resolve_color_token = (node: Element, value: string): string => {
  if (!value || is_concrete_color(value)) return value
  const probe = document.createElement(`span`)
  probe.style.color = value
  if (!probe.style.color) return value
  const host = node instanceof HTMLElement ? node : (node.parentElement ?? document.body)
  host.append(probe)
  const color = getComputedStyle(probe).color
  probe.remove()
  return color || value
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
      return css_vars.map((name) =>
        resolve_color_token(node, style.getPropertyValue(name).trim()),
      )
    },
    css_vars,
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
    [css_property],
    options,
  )

// Resolve an opaque backdrop, rejecting translucent tokens and overrides.
export const resolve_backdrop = (
  get_node: () => Element | null | undefined,
  options: Omit<CssColorOptions, `require_opaque`> = {},
): { readonly current: string } =>
  resolve_css_color(get_node, { ...options, require_opaque: true })
