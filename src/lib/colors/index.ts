import { rgb } from 'd3-color'
import * as d3_sc from 'd3-scale-chromatic'
import alloy_colors from './alloy-colors.json'
import dark_mode_colors from './dark-mode-colors.json'
import jmol_colors from './jmol-colors.json'
import type { elem_symbols } from './labels'
import muted_colors from './muted-colors.json'
import pastel_colors from './pastel-colors.json'
import vesta_colors from './vesta-colors.json'

// Extract color scheme interpolate function names from d3-scale-chromatic
export type D3InterpolateName = keyof typeof d3_sc & `interpolate${string}`
export type D3ColorSchemeName =
  D3InterpolateName extends `interpolate${infer Name}` ? Name : never

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

export type RGBColor = readonly [number, number, number]
export type ElementColorScheme = Record<(typeof elem_symbols)[number], RGBColor>

function rgb_scheme_to_hex(
  obj: Record<string, RGBColor>,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const val = obj[key]
      result[key] = rgb(...val).formatHex()
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
