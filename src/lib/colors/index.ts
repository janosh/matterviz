import { color as d3_color, rgb, type RGBColor } from 'd3-color'
import type { ColorSchemeName } from '#lib/constants.js'
import { evict_oldest } from '#lib/labels.js'
import { clamp } from '#lib/math.js'
import { get_system_mode, nearest_declared, watch_theme_changes } from '#lib/theme/index.js'
import { clamp01 } from '#lib/utils.js'
import alloy_colors from './alloy-colors.json' with { type: 'json' }
import dark_mode_colors from './dark-mode-colors.json' with { type: 'json' }
import jmol_colors from './jmol-colors.json' with { type: 'json' }
import muted_colors from './muted-colors.json' with { type: 'json' }
import pastel_colors from './pastel-colors.json' with { type: 'json' }
import vesta_colors from './vesta-colors.json' with { type: 'json' }

export * from './backdrop.svelte'
export * from './scale-names'
export { ELEMENT_COLOR_SCHEME_NAMES, type ColorSchemeName } from '#lib/constants.js'

// Highlight colours shared by every viewer, so one state reads the same everywhere. A hover
// glows in the hovered mark's own hue instead (brighten_hex, with highlight_edge_color for
// outlines, in scene/colors). select: picked sites, phases and entries; pin: marked or pinned
// points (k-points, active band ticks); emphasis: caller-highlighted marks and destructive
// targets (a bond about to be deleted).
export const HIGHLIGHT = Object.freeze({
  select: `#66f0ff`,
  pin: `#ff2020`,
  emphasis: `#ff4444`,
})

export const COLOR_SCALE_TYPES = [`continuous`, `categorical`] as const
export type ColorScaleType = (typeof COLOR_SCALE_TYPES)[number]

// Hex since that's the only format <input type="color"> supports
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

// Detect CSS color strings. d3-color parses hex, rgb(), hsl() and named colors (rejecting
// words like `pending`) but not var()/color()/currentcolor, so match those explicitly.
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
  // rgb() and rgba() are aliases (CSS Color 4): either takes an optional fourth alpha
  if (comma_syntax && channels.length === 4) alpha = channels.pop()
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
  const [red, green, blue] = [parsed.r, parsed.g, parsed.b].map((val) => clamp(val, 0, 255))
  return rgb(red, green, blue, clamp01(parsed.opacity))
}
let color_canvas_context: CanvasRenderingContext2D | null | undefined
// Canvas-parsed colors by string (FIFO-bounded): each parse is a pixel write + readback
const canvas_rgb_memo = new Map<string, RGBColor | undefined>()
function to_rendered_rgb(color: string): RGBColor | undefined {
  const parsed = to_rgb(color)
  if (parsed) return parsed
  if (
    typeof document === `undefined` ||
    typeof CanvasRenderingContext2D === `undefined` ||
    /^(?:var\(|currentcolor$)/i.test(color)
  )
    return undefined
  if (canvas_rgb_memo.has(color)) return canvas_rgb_memo.get(color)
  color_canvas_context ??= document
    .createElement(`canvas`)
    .getContext(`2d`, { willReadFrequently: true })
  const context = color_canvas_context
  if (!context) return undefined
  const rendered = canvas_rgb(context, color)
  evict_oldest(canvas_rgb_memo)
  canvas_rgb_memo.set(color, rendered)
  return rendered
}
// The browser's own parse of `color`, undefined if rejected: a rejected assignment keeps the
// previous fillStyle, so black and white priors then read back differently
const canvas_rgb = (
  context: CanvasRenderingContext2D,
  color: string,
): RGBColor | undefined => {
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

// The single series palette (d3 schemeTableau10) every core and domain plot (ScatterPlot,
// BarPlot, Sankey, RDF, XRD, bands, DOS, …) cycles through by series index
export const PLOT_COLORS = [
  `#4e79a7`, // blue
  `#f28e2c`, // orange
  `#e15759`, // red
  `#76b7b2`, // teal
  `#59a14f`, // green
  `#edc949`, // yellow
  `#af7aa1`, // purple
  `#ff9da7`, // pink
  `#9c755f`, // brown
  `#bab0ab`, // gray
] as const

// Series color for the idx-th trace, cycling through PLOT_COLORS
export const plot_color = (idx: number): string => PLOT_COLORS[idx % PLOT_COLORS.length]

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

// WCAG 2 contrast ratio between two relative luminances, from 1 (same) to 21 (black on white)
const wcag_contrast = (lum_a: number, lum_b: number): number =>
  (Math.max(lum_a, lum_b) + 0.05) / (Math.min(lum_a, lum_b) + 0.05)

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

// What gets painted where, so text contrast is computed from data instead of inferred from
// rendered DOM. `background` is painted on the element itself; `backdrop` is the opaque color
// behind it, only consulted (and only required) when `background` is translucent.
export interface Paint {
  background: string
  backdrop?: string
  choices?: readonly [string, string]
}

const DEFAULT_CONTRAST_CHOICES = [`black`, `white`] as const
const WCAG_AA = 4.5

// The lighter choice whenever it reaches WCAG AA (4.5:1), else the higher-contrast one (black
// or white always reaches 4.58:1). Pure max-ratio flips near-ties like steelblue (both 4.6:1)
// to black, which reads worse; APCA put white on mid-tones at 2.7-3.3:1.
export function pick_contrast_color(paint: Paint): string {
  const { background, backdrop, choices = DEFAULT_CONTRAST_CHOICES } = paint
  const parsed_bg = parse_rgb(background)
  if (parsed_bg.opacity === 1) return contrast_on(parsed_bg, choices)
  if (!backdrop) throw new Error(`Translucent background requires a backdrop: ${background}`)
  const parsed_backdrop = parse_rgb(backdrop)
  if (parsed_backdrop.opacity < 1) throw new Error(`backdrop must be opaque: ${backdrop}`)
  return contrast_on(composite_rgb(parsed_bg, parsed_backdrop), choices)
}
const contrast_on = (bg: RGBColor, choices: readonly [string, string]): string => {
  const bg_luminance = rgb_luminance(bg)
  const choice_luminances = choices.map((choice) => {
    const parsed_choice = parse_rgb(choice)
    return rgb_luminance(
      parsed_choice.opacity < 1 ? composite_rgb(parsed_choice, bg) : parsed_choice,
    )
  })
  const ratios = choice_luminances.map((lum) => wcag_contrast(lum, bg_luminance))
  const lighter_idx = choice_luminances[1] >= choice_luminances[0] ? 1 : 0
  if (ratios[lighter_idx] >= WCAG_AA) return choices[lighter_idx]
  return ratios[0] >= ratios[1] ? choices[0] : choices[1]
}

// Like pick_contrast_color but gives up on backgrounds JS cannot resolve (CSS vars,
// currentcolor), where inheriting the surrounding text color is the only honest answer.
export const contrast_text_color = (paint: Paint): string =>
  is_concrete_color(paint.background) ? pick_contrast_color(paint) : `currentColor`

// Black/white against an opaque background; translucent or unresolvable (CSS var,
// currentcolor, transparent) backgrounds inherit, since without a known backdrop there is
// nothing to contrast against. For marks drawn in place with the color the user supplies.
export const opaque_contrast_color = (background: string): string =>
  is_opaque_color(background) ? pick_contrast_color({ background }) : `currentColor`

export interface TooltipPaint {
  background: string
  color: string
}
// Paint a tooltip in its hovered mark's color: an opaque fill as is, a translucent one
// flattened to its opaque hue, each with black/white text by WCAG contrast. Null for fills JS
// cannot resolve (var(), currentcolor, transparent, none): the neutral theme chip.
export const tooltip_paint = (fill: unknown): TooltipPaint | null => {
  if (typeof fill !== `string`) return null
  const parsed = to_rendered_rgb(fill.trim())
  if (!parsed?.opacity) return null
  const opaque = parsed.copy({ opacity: 1 })
  const background = parsed.opacity === 1 ? fill : opaque.formatRgb()
  return { background, color: contrast_on(opaque, DEFAULT_CONTRAST_CHOICES) }
}

// Distinct backgrounds a memo holds at once (a continuous scale yields a string per value).
// Past this the oldest goes (FIFO), so a working set just over the limit still mostly hits.
export const CONTRAST_MEMO_LIMIT = 10_000

// pick_contrast_color memoized by background string, for grids with far fewer distinct fills
// than cells. `alpha` applies to every background before compositing; the cache drops when
// `backdrop` or `alpha` change. Null for backgrounds JS cannot resolve (CSS vars,
// currentcolor, null). `pick` swaps the picker (custom choices, or a spy). A plain Map:
// entries are written during render, which a SvelteMap would reject.
export const contrast_color_memo = (
  opts: {
    backdrop?: () => string | undefined
    alpha?: () => number
    pick?: (paint: Paint) => string
  } = {},
): ((background: string | null | undefined) => string | null) => {
  const { pick = pick_contrast_color } = opts
  const memo = new Map<string, string | null>()
  let memo_backdrop: string | undefined
  let memo_alpha: number | undefined
  return (background) => {
    const backdrop = opts.backdrop?.()
    const alpha = opts.alpha?.()
    if (backdrop !== memo_backdrop || alpha !== memo_alpha) {
      memo.clear()
      memo_backdrop = backdrop
      memo_alpha = alpha
    }
    // Memo before parse: is_concrete_color parses, so testing it first would cost a hit that
    // parse. Non-concrete strings memoize to null so they too parse only once.
    if (background == null) return null
    let contrast = memo.get(background)
    if (contrast === undefined) {
      contrast = is_concrete_color(background)
        ? pick({
            background: alpha === undefined ? background : add_alpha(background, alpha),
            backdrop,
          })
        : null
      evict_oldest(memo, CONTRAST_MEMO_LIMIT)
      memo.set(background, contrast)
    }
    return contrast
  }
}

// Whether `element` renders in the dark scheme: its computed color-scheme, which every
// light-dark() token around it resolves against. `normal`/`light dark` mean nothing was
// declared, so the OS preference decides.
export function is_dark_mode(
  element: Element | undefined = globalThis.document?.documentElement,
): boolean {
  return element !== undefined && (nearest_declared(element) ?? get_system_mode()) === `dark`
}

// Call `on_change` whenever the scheme `element` renders in may have changed: a theme class,
// data-theme or inline color-scheme on it or any ancestor (apply_theme_to_dom on the root, a
// shadow host's for embedded widgets), or the OS preference. Not on subscribe — callers
// subscribe inside effects whose callback writes state, and a synchronous first call would
// re-trigger that effect. Read is_dark_mode(element) for the initial value. Returns the cleanup.
export function watch_dark_mode(
  on_change: (dark: boolean) => void,
  element: Element | undefined = globalThis.document?.documentElement,
): () => void {
  if (!element) return () => {} // No-op in SSR
  return watch_theme_changes(element, () => on_change(is_dark_mode(element)))
}

// Convert a CSS color string to hex format for use with <input type="color">.
// Transparent displays white; CSS variables, invalid colors and undefined use the fallback.
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
