import { rgb } from 'd3-color'
import * as d3_sc from 'd3-scale-chromatic'
import type { elem_symbols } from '../labels'
import alloy_colors from './alloy-colors.json'
import dark_mode_colors from './dark-mode-colors.json'
import jmol_colors from './jmol-colors.json'
import muted_colors from './muted-colors.json'
import pastel_colors from './pastel-colors.json'
import vesta_colors from './vesta-colors.json'

// Extract color scheme interpolate function names from d3-scale-chromatic
export type D3InterpolateName = keyof typeof d3_sc & `interpolate${string}`
export type D3ColorSchemeName = D3InterpolateName extends `interpolate${infer Name}`
  ? Name
  : never

// color values have to be in hex format since that's the only format
// <input type="color"> supports
// https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/color#value
export const default_category_colors: Record<string, string> = {
  'diatomic-nonmetal': `#ff8c00`, // darkorange
  'noble-gas': `#9932cc`, // darkorchid
  'alkali-metal': `#006400`, // darkgreen
  'alkaline-earth-metal': `#483d8b`, // darkslateblue
  metalloid: `#b8860b`, // darkgoldenrod
  'polyatomic-nonmetal': `#a52a2a`, // brown
  'transition-metal': `#571e6c`,
  'post-transition-metal': `#938d4a`,
  lanthanide: `#58748e`,
  actinide: `#6495ed`, // cornflowerblue
}

export type RGBColor = [number, number, number]
export type ElementColorScheme = Record<(typeof elem_symbols)[number], RGBColor>

function rgb_scheme_to_hex(
  obj: Record<string, number[]>,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const key in obj) {
    if (Object.hasOwn(obj, key)) {
      const val = obj[key]
      if (val.length >= 3) {
        result[key] = rgb(val[0], val[1], val[2]).formatHex()
      }
    }
  }
  return result
}

export const vesta_hex = rgb_scheme_to_hex(vesta_colors)
export const jmol_hex = rgb_scheme_to_hex(jmol_colors)
export const alloy_hex = rgb_scheme_to_hex(alloy_colors)
export const pastel_hex = rgb_scheme_to_hex(pastel_colors)
export const muted_hex = rgb_scheme_to_hex(muted_colors)
export const dark_mode_hex = rgb_scheme_to_hex(dark_mode_colors)

export const element_color_schemes = {
  Vesta: vesta_hex,
  Jmol: jmol_hex,
  Alloy: alloy_hex,
  Pastel: pastel_hex,
  Muted: muted_hex,
  'Dark Mode': dark_mode_hex,
} as const

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

// Color series for e.g. line plots
export const plot_colors = [
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
