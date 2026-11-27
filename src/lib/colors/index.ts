import { evict_oldest } from 'svelte-widgets/utils'
import { rgb, type RGBColor } from 'd3-color'
import {
  type ContrastOptions,
  parse_color,
  pick_contrast_color,
} from 'svelte-widgets/attachments'
import type { ColorSchemeName } from '#lib/constants'
import { clamp01 } from '#lib/utils'
import alloy_colors from './alloy-colors.json' with { type: 'json' }
import dark_mode_colors from './dark-mode-colors.json' with { type: 'json' }
import jmol_colors from './jmol-colors.json' with { type: 'json' }
import muted_colors from './muted-colors.json' with { type: 'json' }
import pastel_colors from './pastel-colors.json' with { type: 'json' }
import vesta_colors from './vesta-colors.json' with { type: 'json' }

export * from './backdrop.svelte'
export * from './scale-names'
export { ELEMENT_COLOR_SCHEME_NAMES, type ColorSchemeName } from '#lib/constants'

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

// One var()/color() call spanning the whole string: its parentheses may nest (a fallback like
// `var(--a, var(--b, rgb(0 0 0)))`) but the opening one closes only at the very end, so
// `var(--a) var(--b)` and `var(--a); background: url(x)` are not colors
const is_single_color_call = (text: string): boolean => {
  if (!/^(?:var|color)\(/i.test(text) || /[;{}]/.test(text)) return false
  let depth = 0
  for (let idx = 0; idx < text.length; idx++) {
    if (text[idx] === `(`) depth++
    else if (text[idx] === `)` && --depth === 0) return idx === text.length - 1
  }
  return false
}

// Detect CSS color strings. d3-color parses hex, rgb(), hsl() and named colors (rejecting
// words like `pending`) but not var()/color()/currentcolor, so match those explicitly.
export const is_color = (val: unknown): val is string => {
  if (typeof val !== `string`) return false
  const trimmed = val.trim()
  return (
    /^currentcolor$/i.test(trimmed) ||
    is_single_color_call(trimmed) ||
    to_rendered_rgb(trimmed) !== undefined
  )
}
// svelte-widgets' parse_color (browser canvas for color-mix() and friends) as a d3 color
function to_rendered_rgb(color: string): RGBColor | undefined {
  const parsed = parse_color(color)
  return parsed ? rgb(...parsed) : undefined
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
// rendered DOM: bg_color on the element itself, backdrop the opaque color behind it, only
// consulted (and only required) when bg_color is translucent.
export type Paint = ContrastOptions & { bg_color: string }

// Like pick_contrast_color but gives up on backgrounds JS cannot resolve (CSS vars,
// currentcolor), where inheriting the surrounding text color is the only honest answer.
export const contrast_text_color = (paint: Paint): string =>
  is_concrete_color(paint.bg_color) ? pick_contrast_color(paint) : `currentColor`

// Black/white against an opaque background; translucent or unresolvable (CSS var,
// currentcolor, transparent) backgrounds inherit, since without a known backdrop there is
// nothing to contrast against. For marks drawn in place with the color the user supplies.
export const opaque_contrast_color = (background: string): string =>
  is_opaque_color(background) ? pick_contrast_color({ bg_color: background }) : `currentColor`

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
  return { background, color: pick_contrast_color({ bg_color: opaque.formatRgb() }) }
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
            bg_color: alpha === undefined ? background : add_alpha(background, alpha),
            backdrop,
          })
        : null
      evict_oldest(memo, CONTRAST_MEMO_LIMIT)
      memo.set(background, contrast)
    }
    return contrast
  }
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
