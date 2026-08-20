import { color as d3_color, rgb, type RGBColor } from 'd3-color'
import * as d3_sc from 'd3-scale-chromatic'
import type { ColorSchemeName } from '$lib/constants'
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

export * from './backdrop.svelte'
export { ELEMENT_COLOR_SCHEME_NAMES, type ColorSchemeName } from '$lib/constants'

// Extract color scheme interpolate function names from d3-scale-chromatic
// Color scale names are always the prefixed d3 export name (`interpolateViridis`), which
// is what get_d3_interpolator, the settings defaults and every dropdown value use. Bare
// names are a display concern only -- strip the prefix at render time.
export type D3InterpolateName = keyof typeof d3_sc & `interpolate${string}`
const d3_interpolators = Object.fromEntries(
  Object.entries(d3_sc).filter(
    ([name, candidate]) => name.startsWith(`interpolate`) && typeof candidate === `function`,
  ),
) as Record<D3InterpolateName, (t: number) => string>
export const D3_INTERPOLATE_NAMES = Object.keys(
  d3_interpolators,
) as readonly D3InterpolateName[]
export const is_d3_interpolate_name = (name: string): name is D3InterpolateName =>
  Object.hasOwn(d3_interpolators, name)
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

export const ELEMENT_COLOR_SCHEMES = {
  Vesta: rgb_scheme_to_hex(vesta_colors),
  Jmol: rgb_scheme_to_hex(jmol_colors),
  Alloy: rgb_scheme_to_hex(alloy_colors),
  Pastel: rgb_scheme_to_hex(pastel_colors),
  Muted: rgb_scheme_to_hex(muted_colors),
  'Dark Mode': rgb_scheme_to_hex(dark_mode_colors),
} as const satisfies Record<ColorSchemeName, Record<string, string>>
export const default_element_colors = ELEMENT_COLOR_SCHEMES.Vesta

// Detect if a value is a CSS color string. d3-color parses hex, rgb()/rgba(),
// hsl()/hsla(), and named colors case-insensitively, rejecting arbitrary words like
// `pending`. It doesn't parse var()/color()/currentcolor, so match those explicitly.
export const is_color = (val: unknown): val is string => {
  if (typeof val !== `string`) return false
  const trimmed = val.trim()
  return (
    /^(?:var|color)\([^)]+\)$|^currentcolor$/i.test(trimmed) ||
    to_rendered_rgb(trimmed) !== undefined
  )
}
const parse_rgb_function = (color: string): RGBColor | undefined => {
  const match = /^rgba?\(\s*(?<channels>[^/]+?)(?:\s*\/\s*(?<alpha>[^,\s]+))?\s*\)$/i.exec(
    color,
  )
  if (!match?.groups) return undefined
  const { channels: channel_text, alpha: slash_alpha } = match.groups
  const comma_syntax = channel_text.includes(`,`)
  const channels = channel_text.trim().split(comma_syntax ? /\s*,\s*/ : /\s+/)
  let alpha: string | undefined = slash_alpha
  if (comma_syntax && alpha) return undefined
  if (comma_syntax && channels.length === 4 && color.toLowerCase().startsWith(`rgba`))
    alpha = channels.pop()
  if (channels.length !== 3) return undefined
  const parse_component = (value: string, percent_scale: number): number =>
    value.endsWith(`%`) ? (Number(value.slice(0, -1)) * percent_scale) / 100 : Number(value)
  const [red, green, blue] = channels.map((value) => parse_component(value, 255))
  return rgb(red, green, blue, parse_component(alpha ?? `1`, 1))
}
const to_rgb = (color: string): RGBColor | undefined => {
  const parsed = parse_rgb_function(color) ?? d3_color(color)?.rgb()
  if (!parsed) return undefined
  // The `transparent` keyword has NaN channels; normalize only that case without
  // discarding channels from explicit rgba(..., 0).
  if (![parsed.r, parsed.g, parsed.b].every(Number.isFinite))
    return parsed.opacity === 0 ? rgb(0, 0, 0, 0) : undefined
  const clamp_channel = (channel: number) => Math.max(0, Math.min(255, channel))
  return rgb(
    clamp_channel(parsed.r),
    clamp_channel(parsed.g),
    clamp_channel(parsed.b),
    clamp01(parsed.opacity),
  )
}
let color_canvas_context: CanvasRenderingContext2D | null | undefined
function to_rendered_rgb(color: string): RGBColor | undefined {
  const parsed = to_rgb(color)
  if (parsed) return parsed
  if (
    typeof document === `undefined` ||
    typeof CanvasRenderingContext2D === `undefined` ||
    /^(?:var\(|currentcolor$)/i.test(color)
  )
    return undefined
  const context = (color_canvas_context ??= document
    .createElement(`canvas`)
    .getContext(`2d`, { willReadFrequently: true }))
  if (!context) return undefined
  context.fillStyle = `black`
  context.fillStyle = color
  const parsed_style = context.fillStyle
  context.fillStyle = `white`
  context.fillStyle = color
  if (context.fillStyle !== parsed_style) return undefined
  context.clearRect(0, 0, 1, 1)
  context.fillRect(0, 0, 1, 1)
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
  return rgb(red, green, blue, alpha / 255)
}
export const is_concrete_color = (val: unknown): val is string =>
  typeof val === `string` && (to_rendered_rgb(val.trim())?.opacity ?? 0) > 0
export const is_opaque_color = (val: unknown): val is string =>
  typeof val === `string` && to_rendered_rgb(val.trim())?.opacity === 1

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
  const parsed = to_rendered_rgb(color)
  if (!parsed) throw new Error(`Invalid color: ${color}`)
  return parsed
}

// Calculate human-perceived brightness from gamma-encoded RGB channels.
export function perceived_brightness(color: string): number {
  const { r: red, g: green, b: blue } = parse_rgb(color)

  return (0.299 * red + 0.587 * green + 0.114 * blue) / 255 // https://stackoverflow.com/a/596243
}

// WCAG relative luminance from linearized sRGB channels
const rgb_luminance = ({ r: red, g: green, b: blue }: RGBColor): number => {
  const linearize = (channel: number): number => {
    const fraction = channel / 255
    return fraction <= 0.04045 ? fraction / 12.92 : ((fraction + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linearize(red) + 0.7152 * linearize(green) + 0.0722 * linearize(blue)
}

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

// Explicit description of what gets painted where, so text contrast can be computed
// from data instead of inferred by inspecting rendered DOM. `background` is the color
// painted on the element itself; `backdrop` is the opaque color behind it and is only
// consulted (and only required) when `background` is translucent.
export interface Paint {
  background: string
  backdrop?: string
  choices?: readonly [string, string]
}

const DEFAULT_CONTRAST_CHOICES = [`black`, `white`] as const

export function pick_contrast_color(paint: Paint): string {
  const { background, backdrop, choices = DEFAULT_CONTRAST_CHOICES } = paint
  const parsed_bg = parse_rgb(background)
  let effective_bg = parsed_bg
  if (parsed_bg.opacity < 1) {
    if (!backdrop) {
      throw new Error(`Translucent background requires a backdrop: ${background}`)
    }
    const parsed_backdrop = parse_rgb(backdrop)
    if (parsed_backdrop.opacity < 1) {
      throw new Error(`backdrop must be opaque: ${backdrop}`)
    }
    effective_bg = composite_rgb(parsed_bg, parsed_backdrop)
  }
  const bg_luminance = rgb_luminance(effective_bg)
  const choice_luminances = choices.map((choice) => {
    const parsed_choice = parse_rgb(choice)
    return rgb_luminance(
      parsed_choice.opacity < 1 ? composite_rgb(parsed_choice, effective_bg) : parsed_choice,
    )
  })
  return contrast_ratio(bg_luminance, choice_luminances[0]) >=
    contrast_ratio(bg_luminance, choice_luminances[1])
    ? choices[0]
    : choices[1]
}

// Like pick_contrast_color but gives up on backgrounds JS cannot resolve (CSS vars,
// currentcolor), where inheriting the surrounding text color is the only honest answer.
export const contrast_text_color = (paint: Paint): string =>
  is_concrete_color(paint.background) ? pick_contrast_color(paint) : `currentColor`

// Detect dark mode: checks data-theme attribute, then the persisted theme
// preference (resolving `auto` against the OS), then falls back to OS preference.
export function is_dark_mode(): boolean {
  if (typeof document === `undefined`) return false
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
export function css_color_to_hex(color: string | undefined, fallback: string): string {
  if (!color) return fallback
  if (color.trim().toLowerCase() === `transparent`) return `#ffffff`
  return to_rendered_rgb(color)?.formatHex() ?? fallback
}

// Return a concrete CSS color with a replaced alpha channel.
export function add_alpha(color: string, alpha: number): string {
  const parsed = to_rendered_rgb(color)
  return parsed ? rgb(parsed.r, parsed.g, parsed.b, clamp01(alpha)).formatRgb() : color
}
