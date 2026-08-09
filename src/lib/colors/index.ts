import { color as d3_color, rgb, type RGBColor } from 'd3-color'
import * as d3_sc from 'd3-scale-chromatic'
import {
  COLOR_THEMES,
  get_system_mode,
  get_theme_preference,
  is_valid_theme_name,
  resolve_theme_mode,
  THEME_STORAGE_KEY,
  THEME_TYPE,
} from '$lib/theme'
import { clamp01 } from '$lib/utils'
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
const d3_interpolators = Object.fromEntries(
  Object.entries(d3_sc).filter(
    ([name, candidate]) => name.startsWith(`interpolate`) && typeof candidate === `function`,
  ),
) as Record<D3InterpolateName, (t: number) => string>
export const D3_INTERPOLATE_NAMES = new Set(
  Object.keys(d3_interpolators),
) as ReadonlySet<D3InterpolateName>
export const is_d3_interpolate_name = (name: string): name is D3InterpolateName =>
  D3_INTERPOLATE_NAMES.has(name as D3InterpolateName)
export const get_d3_interpolator = (name: D3InterpolateName): ((t: number) => string) => {
  const interpolator = d3_interpolators[name]
  if (!interpolator) throw new Error(`Unknown D3 color interpolator: ${name}`)
  return interpolator
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

// Detect if a value is a CSS color string. d3-color parses hex, rgb()/rgba(),
// hsl()/hsla(), and named colors case-insensitively, rejecting arbitrary words like
// `pending`. It doesn't parse var()/color()/currentcolor, so match those explicitly.
export const is_color = (val: unknown): val is string => {
  if (typeof val !== `string`) return false
  const trimmed = val.trim()
  return /^(?:var|color)\([^)]+\)$|^currentcolor$/i.test(trimmed) || d3_color(trimmed) !== null
}
const to_rgb = (color: string): RGBColor | undefined => {
  const parsed = d3_color(color)?.rgb()
  if (!parsed) return undefined
  if (parsed.opacity === 0) return rgb(0, 0, 0, 0)
  if (![parsed.r, parsed.g, parsed.b].every(Number.isFinite)) return undefined
  return rgb(
    Math.max(0, Math.min(255, parsed.r)),
    Math.max(0, Math.min(255, parsed.g)),
    Math.max(0, Math.min(255, parsed.b)),
    clamp01(parsed.opacity),
  )
}
export const is_concrete_color = (val: unknown): val is string => {
  return typeof val === `string` && (to_rgb(val.trim())?.opacity ?? 0) > 0
}

export const PLOT_COLORS = [
  // Color series for e.g. line plots
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

const parse_rgb = (color: string): RGBColor => {
  const parsed = to_rgb(color)
  if (!parsed || parsed.opacity === 0) throw new Error(`Invalid color: ${color}`)
  return parsed
}

let color_canvas_context: CanvasRenderingContext2D | null | undefined
const parse_rendered_rgb = (color: string): RGBColor => {
  const parsed = to_rgb(color)
  if (parsed) return parsed
  if (typeof document === `undefined`) throw new Error(`Invalid color: ${color}`)
  const context = (color_canvas_context ??= document
    .createElement(`canvas`)
    .getContext(`2d`, { willReadFrequently: true }))
  if (!context) throw new Error(`Browser cannot resolve CSS color: ${color}`)
  context.clearRect(0, 0, 1, 1)
  context.fillStyle = `rgba(0, 0, 0, 0)`
  context.fillStyle = color
  context.fillRect(0, 0, 1, 1)
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
  return rgb(red, green, blue, alpha / 255)
}
const is_visible_bg = (color: string): boolean =>
  color !== `` && color !== `transparent` && parse_rendered_rgb(color).opacity > 0

// Calculate human-perceived brightness from gamma-encoded RGB channels.
export function perceived_brightness(color: string): number {
  const { r: red, g: green, b: blue } = parse_rgb(color)

  return (0.299 * red + 0.587 * green + 0.114 * blue) / 255 // https://stackoverflow.com/a/596243
}

const rgb_luminance = ({ r: red, g: green, b: blue }: RGBColor): number => {
  const linearize = (channel: number): number => {
    const fraction = channel / 255
    return fraction <= 0.04045 ? fraction / 12.92 : ((fraction + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linearize(red) + 0.7152 * linearize(green) + 0.0722 * linearize(blue)
}

// Calculate WCAG relative luminance from linearized sRGB channels.
export const relative_luminance = (color: string): number => rgb_luminance(parse_rgb(color))
const contrast_ratio = (first_luminance: number, second_luminance: number): number =>
  (Math.max(first_luminance, second_luminance) + 0.05) /
  (Math.min(first_luminance, second_luminance) + 0.05)

const composite_rgb = (foreground: RGBColor, backdrop: RGBColor): RGBColor => {
  const foreground_alpha = clamp01(foreground.opacity)
  const backdrop_alpha = clamp01(backdrop.opacity)
  const opacity = foreground_alpha + backdrop_alpha * (1 - foreground_alpha)
  if (opacity === 0) return rgb(0, 0, 0, 0)
  const channel = (foreground_value: number, backdrop_value: number): number =>
    (foreground_value * foreground_alpha +
      backdrop_value * backdrop_alpha * (1 - foreground_alpha)) /
    opacity
  return rgb(
    channel(foreground.r, backdrop.r),
    channel(foreground.g, backdrop.g),
    channel(foreground.b, backdrop.b),
    opacity,
  )
}

export const composite_colors = (foreground: string, backdrop: string): string =>
  composite_rgb(parse_rgb(foreground), parse_rgb(backdrop)).formatRgb()

// Get the nearest visible background of a DOM node.
export function get_bg_color(elem: HTMLElement | null): string | undefined {
  let effective_bg: RGBColor | undefined
  for (let node = elem; node; node = node.parentElement) {
    const background = getComputedStyle(node).backgroundColor
    if (!background || background === `transparent`) continue
    const parsed = parse_rendered_rgb(background)
    if (parsed.opacity === 0) continue
    effective_bg = effective_bg ? composite_rgb(effective_bg, parsed) : parsed
    if (effective_bg.opacity === 1) return effective_bg.formatRgb()
  }
  return effective_bg ? composite_rgb(effective_bg, parse_rgb(`white`)).formatRgb() : undefined
}

export interface ContrastOptions {
  bg_color: string
  backdrop_color?: string
  choices?: readonly [string, string]
}

const DEFAULT_CONTRAST_CHOICES = [`black`, `white`] as const
const DEFAULT_CHOICE_LUMINANCES = [0, 1] as const

export function pick_contrast_color(options: ContrastOptions): string {
  const { bg_color, backdrop_color, choices = DEFAULT_CONTRAST_CHOICES } = options
  const parsed_bg = parse_rgb(bg_color)
  let effective_bg = parsed_bg
  if (parsed_bg.opacity < 1) {
    if (!backdrop_color) {
      throw new Error(`Translucent background requires backdrop_color: ${bg_color}`)
    }
    const backdrop = parse_rgb(backdrop_color)
    if (backdrop.opacity < 1) {
      throw new Error(`backdrop_color must be opaque: ${backdrop_color}`)
    }
    effective_bg = composite_rgb(parsed_bg, backdrop)
  }
  const bg_luminance = rgb_luminance(effective_bg)
  const choice_luminances =
    choices === DEFAULT_CONTRAST_CHOICES
      ? DEFAULT_CHOICE_LUMINANCES
      : choices.map((choice) => {
          const parsed_choice = parse_rgb(choice)
          return rgb_luminance(
            parsed_choice.opacity < 1
              ? composite_rgb(parsed_choice, effective_bg)
              : parsed_choice,
          )
        })
  return contrast_ratio(bg_luminance, choice_luminances[0]) >=
    contrast_ratio(bg_luminance, choice_luminances[1])
    ? choices[0]
    : choices[1]
}

// Attachment that picks the text color with the highest WCAG contrast against the
// node's nearest visible background.
export const contrast_color =
  (options: Omit<ContrastOptions, `bg_color`> & { bg_color?: string } = {}) =>
  (node: HTMLElement): (() => void) => {
    const previous_color = node.style.color
    node.style.color = pick_contrast_color({
      ...options,
      bg_color: options.bg_color ?? get_bg_color(node) ?? `white`,
      backdrop_color: options.backdrop_color ?? get_bg_color(node.parentElement) ?? `white`,
    })
    return () => {
      node.style.color = previous_color
    }
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
  // Prefer body background as it's more likely to be styled by the theme
  if (is_visible_bg(body_bg)) return body_bg
  if (is_visible_bg(html_bg)) return html_bg

  // Fall back to prefers-color-scheme
  const prefers_dark = globalThis.matchMedia?.(`(prefers-color-scheme: dark)`)?.matches
  return prefers_dark ? fallback_dark : fallback_light
}

// Detect dark mode: checks data-theme attribute, then the persisted theme
// preference (resolving `auto` against the OS), then falls back to OS preference.
export function is_dark_mode(): boolean {
  if (typeof document === `undefined`) return false
  // Prefer the resolved theme name on data-theme (light/dark/white/black), else
  // fall back to the persisted preference (resolving `auto` against the OS)
  const data_theme = document.documentElement.dataset.theme
  const theme_name =
    data_theme && is_valid_theme_name(data_theme)
      ? data_theme
      : resolve_theme_mode(get_theme_preference(), get_system_mode())
  return THEME_TYPE[theme_name] === COLOR_THEMES.dark
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

  const on_storage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) notify()
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
export function css_color_to_hex(color: string | undefined, fallback: string): string {
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
  const clamped_alpha = clamp01(alpha)

  // Handle hex colors (#rgb, #rgba, #rrggbb, #rrggbbaa)
  if (color.startsWith(`#`)) {
    const hex = color.slice(1)
    // Guard against malformed hex (only 3, 4, 6, or 8 chars are valid)
    if (![3, 4, 6, 8].includes(hex.length)) return color

    // Extract RGB, ignoring any existing alpha channel
    const is_short = hex.length === 3 || hex.length === 4
    const red = parseInt(is_short ? hex[0] + hex[0] : hex.slice(0, 2), 16)
    const green = parseInt(is_short ? hex[1] + hex[1] : hex.slice(2, 4), 16)
    const blue = parseInt(is_short ? hex[2] + hex[2] : hex.slice(4, 6), 16)
    return `rgba(${red}, ${green}, ${blue}, ${clamped_alpha})`
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
