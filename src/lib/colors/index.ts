import { rgb } from 'd3-color'
import * as d3_sc from 'd3-scale-chromatic'
import type { ELEM_SYMBOLS } from '../labels'
import alloy_colors from './alloy-colors.json' with { type: 'json' }
import dark_mode_colors from './dark-mode-colors.json' with { type: 'json' }
import jmol_colors from './jmol-colors.json' with { type: 'json' }
import muted_colors from './muted-colors.json' with { type: 'json' }
import pastel_colors from './pastel-colors.json' with { type: 'json' }
import vesta_colors from './vesta-colors.json' with { type: 'json' }

// Extract color scheme interpolate function names from d3-scale-chromatic
export type D3InterpolateName = keyof typeof d3_sc & `interpolate${string}`
export type D3ColorSchemeName = D3InterpolateName extends `interpolate${infer Name}`
  ? Name
  : never
export const COLOR_SCALE_TYPES = [`continuous`, `categorical`] as const
export type ColorScaleType = (typeof COLOR_SCALE_TYPES)[number]

// color values have to be in hex format since that's the only format
// <input type="color"> supports
// https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/color#value
export const DEFAULT_CATEGORY_COLORS: Record<string, string> = {
  'diatomic nonmetal': `#ff8c00`, // darkorange
  'noble gas': `#9932cc`, // darkorchid
  'alkali metal': `#006400`, // darkgreen
  'alkaline earth metal': `#483d8b`, // darkslateblue
  metalloid: `#b8860b`, // darkgoldenrod
  'polyatomic nonmetal': `#a52a2a`, // brown
  'transition metal': `#571e6c`,
  'post-transition metal': `#938d4a`,
  lanthanide: `#58748e`,
  actinide: `#6495ed`, // cornflowerblue
}

export const AXIS_COLORS = [
  // [axis name, color, hover color]
  [`x`, `#d75555`, `#e66666`],
  [`y`, `#55b855`, `#66c966`],
  [`z`, `#5555d7`, `#6666e6`],
] as const
export const NEG_AXIS_COLORS = [
  [`nx`, `#b84444`, `#cc5555`],
  [`ny`, `#44a044`, `#55b155`],
  [`nz`, `#4444b8`, `#5555c9`],
] as const

export type RGBColor = [number, number, number]
export type ElementColorScheme = Record<(typeof ELEM_SYMBOLS)[number], RGBColor>

const rgb_scheme_to_hex = (obj: Record<string, number[]>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(obj)
      .filter(([, val]) => val.length >= 3)
      .map(([key, val]) => [key, rgb(val[0], val[1], val[2]).formatHex()]),
  )

export const vesta_hex = rgb_scheme_to_hex(vesta_colors)
export const jmol_hex = rgb_scheme_to_hex(jmol_colors)
export const alloy_hex = rgb_scheme_to_hex(alloy_colors)
export const pastel_hex = rgb_scheme_to_hex(pastel_colors)
export const muted_hex = rgb_scheme_to_hex(muted_colors)
export const dark_mode_hex = rgb_scheme_to_hex(dark_mode_colors)

export const ELEMENT_COLOR_SCHEMES = {
  Vesta: vesta_hex,
  Jmol: jmol_hex,
  Alloy: alloy_hex,
  Pastel: pastel_hex,
  Muted: muted_hex,
  'Dark Mode': dark_mode_hex,
} as const

export type ColorSchemeName = keyof typeof ELEMENT_COLOR_SCHEMES
export const default_element_colors = { ...vesta_hex }

// Helper function to detect if a value is a color string
export const is_color = (val: unknown): val is string => {
  if (typeof val !== `string`) return false
  // Check for hex colors, rgb/rgba, hsl/hsla, color(), var(), and named colors
  // Exclude incomplete function prefixes like 'rgb', 'hsl', 'var', 'color'
  return /^(#[0-9a-f]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|color\([^)]+\)|var\([^)]+\)|(?!rgb$|hsl$|var$|color$)[a-z]+)$/i
    .test(
      val.toString().trim(),
    )
}

export const PLOT_COLORS = [ // Color series for e.g. line plots
  `#63b3ed`,
  `#68d391`,
  `#fbd38d`,
  `#fc8181`,
  `#d6bcfa`,
  `#4fd1c7`,
  `#f687b3`,
  `#fed7d7`,
  `#bee3f8`,
  `#c6f6d5`,
] as const

// calculate human-perceived brightness from RGB color
export function luminance(clr: string) {
  const { r, g, b } = rgb(clr)

  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 // https://stackoverflow.com/a/596243
}

// get background color of passed DOM node, or recurse up the DOM tree if current node is transparent
export function get_bg_color(
  elem: HTMLElement | null,
  bg_color: string | null = null,
): string {
  if (bg_color) return bg_color
  // recurse up the DOM tree to find the first non-transparent background color
  const transparent = `rgba(0, 0, 0, 0)`
  if (!elem) return transparent // if no DOM node, return transparent

  const bg = getComputedStyle(elem).backgroundColor // get node background color
  if (bg !== transparent) return bg // if not transparent, return it
  return get_bg_color(elem.parentElement) // otherwise recurse up the DOM tree
}

export interface ContrastOptions {
  bg_color?: string
  luminance_threshold?: number
  choices?: [string, string]
}

export function pick_contrast_color(options: ContrastOptions = {}) {
  const { bg_color, luminance_threshold = 0.7, choices = [`black`, `white`] } = options
  const light_bg = luminance(bg_color ?? `white`) > luminance_threshold
  return light_bg ? choices[0] : choices[1] // dark text for light backgrounds, light for dark
}

// Svelte attachment that automatically picks dark or light text color to maximize contrast with node's background color
export const contrast_color = (options: ContrastOptions = {}) => (node: HTMLElement) => {
  node.style.color = pick_contrast_color({ ...options, bg_color: get_bg_color(node) })
}

// Detect and return the page background color from html/body elements or user preferences
export function get_page_background(
  fallback_dark = `#1a1a1a`,
  fallback_light = `#ffffff`,
): string {
  if (typeof window === `undefined`) return ``

  // Try to get background from html or body
  const html_bg = getComputedStyle(document.documentElement).backgroundColor
  const body_bg = getComputedStyle(document.body).backgroundColor

  // Check if background is not transparent/unset
  const is_valid_bg = (bg: string) =>
    bg && bg !== `rgba(0, 0, 0, 0)` && bg !== `transparent`

  // Prefer body background as it's more likely to be styled by the theme
  if (is_valid_bg(body_bg)) return body_bg
  if (is_valid_bg(html_bg)) return html_bg

  // Fall back to prefers-color-scheme
  const prefers_dark = globalThis.matchMedia(`(prefers-color-scheme: dark)`).matches
  return prefers_dark ? fallback_dark : fallback_light
}

// Detect dark mode from site theme (data-theme, localStorage) or OS preference
export function is_dark_mode(): boolean {
  if (typeof document === `undefined`) return false
  const { theme } = document.documentElement.dataset
  if (theme === `dark` || theme === `light`) return theme === `dark`
  const local = localStorage.getItem(`theme`)
  if (local === `dark` || local === `light`) return local === `dark`
  return globalThis.matchMedia?.(`(prefers-color-scheme: dark)`).matches ?? false
}

// Watch for dark mode changes and call callback. Returns cleanup function.
export function watch_dark_mode(on_change: (dark: boolean) => void): () => void {
  const observer = new MutationObserver(() => on_change(is_dark_mode()))
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [`data-theme`],
  })

  const on_storage = (ev: StorageEvent) => ev.key === `theme` && on_change(is_dark_mode())
  globalThis.addEventListener(`storage`, on_storage)

  const mq = globalThis.matchMedia?.(`(prefers-color-scheme: dark)`)
  const on_media = () => on_change(is_dark_mode())
  mq?.addEventListener(`change`, on_media)

  return () => {
    observer.disconnect()
    globalThis.removeEventListener(`storage`, on_storage)
    mq?.removeEventListener(`change`, on_media)
  }
}
