import { rgb } from 'd3-color'
import * as d3_sc from 'd3-scale-chromatic'
import type { Vec3 } from '$lib/math'
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
export const get_d3_interpolator = (
  name: D3InterpolateName,
): (t: number) => string => {
  const candidate = d3_sc[name]
  return typeof candidate === `function` ? candidate : d3_sc.interpolateViridis
}
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

export type RGBColor = Vec3
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

// Detect dark mode: checks data-theme attribute, localStorage, then OS preference
export function is_dark_mode(): boolean {
  if (typeof document === `undefined`) return false
  const data_theme = document.documentElement.dataset.theme
  if (data_theme === `dark` || data_theme === `light`) return data_theme === `dark`
  try {
    const stored = localStorage.getItem(`theme`)
    if (stored === `dark` || stored === `light`) return stored === `dark`
  } catch { /* localStorage throws in private browsing mode */ }
  return globalThis.matchMedia?.(`(prefers-color-scheme: dark)`).matches ?? false
}

// Watch for dark mode changes and call callback on each change. Returns cleanup function.
export function watch_dark_mode(on_change: (dark: boolean) => void): () => void {
  if (typeof document === `undefined`) return () => {} // No-op in SSR
  const notify = () => on_change(is_dark_mode())

  const observer = new MutationObserver(notify)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [`data-theme`],
  })

  const on_storage = (ev: StorageEvent) => {
    if (ev.key === `theme`) notify()
  }
  globalThis.addEventListener(`storage`, on_storage)

  const media_query = globalThis.matchMedia?.(`(prefers-color-scheme: dark)`)
  media_query?.addEventListener(`change`, notify)

  return () => {
    observer.disconnect()
    globalThis.removeEventListener(`storage`, on_storage)
    media_query?.removeEventListener(`change`, notify)
  }
}

// Convert a CSS color string to hex format for use with <input type="color">.
// Returns fallback for CSS variables, transparent, invalid colors, or undefined.
// Uses d3-color for robust parsing of named colors, rgb(), hsl(), etc.
export function css_color_to_hex(
  color: string | undefined,
  fallback: string,
): string {
  if (!color || color.startsWith(`var(`)) return fallback
  if (color === `transparent`) return `#ffffff`
  const parsed = rgb(color)
  return Number.isNaN(parsed.r) ? fallback : parsed.formatHex()
}

// Add or modify the alpha channel of a color.
// Supports hex (#rgb, #rgba, #rrggbb, #rrggbbaa), rgb(), and rgba() formats.
// Returns the color in rgba() format, or the original color if format is unsupported.
export function add_alpha(color: string, alpha: number): string {
  // Clamp alpha to valid CSS range [0, 1]
  const clamped_alpha = Math.max(0, Math.min(1, alpha))

  // Handle hex colors (#rgb, #rgba, #rrggbb, #rrggbbaa)
  if (color.startsWith(`#`)) {
    const hex = color.slice(1)
    // Guard against malformed hex (only 3, 4, 6, or 8 chars are valid)
    if (![3, 4, 6, 8].includes(hex.length)) return color

    // Extract RGB, ignoring any existing alpha channel
    const is_short = hex.length === 3 || hex.length === 4
    const r = parseInt(is_short ? hex[0] + hex[0] : hex.slice(0, 2), 16)
    const g = parseInt(is_short ? hex[1] + hex[1] : hex.slice(2, 4), 16)
    const b = parseInt(is_short ? hex[2] + hex[2] : hex.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${clamped_alpha})`
  }
  // Handle rgb() colors
  if (color.startsWith(`rgb(`)) {
    return color.replace(`rgb(`, `rgba(`).replace(`)`, `, ${clamped_alpha})`)
  }
  // Handle rgba() - replace existing alpha (supports scientific notation like 1e-5)
  if (color.startsWith(`rgba(`)) {
    return color.replace(/,\s*[\d.eE\-+]+\)$/, `, ${clamped_alpha})`)
  }
  return color
}
