// Segment data and label helpers shared by PieChart, BubbleChart and BarChart
import { type ColorSchemeName, ELEMENT_COLOR_SCHEMES, pick_contrast_color } from '$lib/colors'
import type { CompositionType } from '$lib/composition'
import type { ElementSymbol } from '$lib/element'
import { format_num } from '$lib/labels'
import { format_amount } from './format'
import { fractional_composition } from './parse'

export type ChartSegment = {
  element: ElementSymbol
  amount: number
  fraction: number
  color: string
  text_color: string // contrast color for text drawn on top of the segment fill
}

export type ChartLabelOptions = { show_amounts: boolean; show_percentages: boolean }

// Positive-amount elements in insertion order with their atomic fraction and scheme color
export const composition_segments = (
  composition: CompositionType,
  color_scheme: ColorSchemeName,
): ChartSegment[] => {
  const fractions = fractional_composition(composition)
  const colors = ELEMENT_COLOR_SCHEMES[color_scheme] ?? ELEMENT_COLOR_SCHEMES.Vesta
  return (Object.entries(fractions) as [ElementSymbol, number][]).map(
    ([element, fraction]) => {
      const color = colors[element] ?? `#cccccc`
      return {
        element,
        amount: composition[element] ?? 0,
        fraction,
        color,
        text_color: pick_contrast_color({ background: color }),
      }
    },
  )
}

// Amount/percentage suffix rendered after the element symbol; `=` separates amount from
// percentage when both are shown (Fe2=20%)
export const segment_suffix = (
  { amount, fraction }: ChartSegment,
  { show_amounts, show_percentages }: ChartLabelOptions,
): string =>
  (show_amounts ? format_amount(amount) : ``) +
  (show_amounts && show_percentages ? `=` : ``) +
  (show_percentages ? format_num(fraction, `.1~%`) : ``)

// Hover/aria text: "Fe: 2 atoms (40%)"
export const segment_title = ({ element, amount, fraction }: ChartSegment): string =>
  `${element}: ${amount} ${amount === 1 ? `atom` : `atoms`} (${format_num(fraction, `.1~%`)})`

// Shrink `base_scale` so a label of `n_chars` characters (≈0.6em each) fits `available_space`
// px, never below `min_scale_factor` of the base
export const fit_font_scale = (
  base_scale: number,
  n_chars: number,
  available_space: number,
  min_scale_factor = 0.7,
  base_font_size = 16,
): number => {
  const text_width = n_chars * 0.6 * base_font_size * base_scale
  return available_space > 0 && text_width > available_space
    ? Math.max(base_scale * (available_space / text_width), base_scale * min_scale_factor)
    : base_scale
}
