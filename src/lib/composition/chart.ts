// Segment data and label helpers shared by PieChart, BubbleChart and BarChart
import { format_num } from 'svelte-widgets/format'
import type { ColorSchemeName } from '#lib/colors/index'
import { ELEMENT_COLOR_SCHEMES, opaque_contrast_color } from '#lib/colors/index'
import type { ElementSymbol } from '#lib/element/index'
import { superscript_digits } from '#lib/labels'
import type { FillPattern, ResolvedPattern } from '#lib/plot/core/patterns'
import { resolve_pattern } from '#lib/plot/core/patterns'
import type { SVGAttributes } from 'svelte/elements'
import { format_amount } from './format'
import type { SpeciesComposition } from './parse'
import { format_charge, parse_species_composition, parse_species_key } from './parse'

export type ChartSegment = {
  species: string // canonical species key (Fe2+, O2-, or the bare element), unique per chart
  element: ElementSymbol // colors and patterns follow the element, not the species
  charge: string // drawn as a superscript after the element (2+, -), empty for none
  amount: number
  fraction: number
  color: string
  text_color: string // contrast color for text drawn on top of the segment fill
  pattern?: ResolvedPattern // hatch/texture fill drawn over `color`, see ElementPatterns
}

// Per-element hatch/texture fills for the composition charts, e.g. { Fe: 'diagonal', O: '.' }
export type ElementPatterns = Partial<Record<ElementSymbol, FillPattern>>

export type ChartLabelOptions = { show_amounts: boolean; show_percentages: boolean }

// Shared SVG, data, color and label contract for all three composition charts.
export type CompositionChartProps = SVGAttributes<SVGSVGElement> & {
  // Amounts keyed by element or species (Fe2+, O2-), see parse_species_composition
  composition: SpeciesComposition
  size?: number
  show_labels?: boolean
  show_amounts?: boolean
  show_percentages?: boolean
  // Element color scheme used for the segment colors
  color_scheme?: ColorSchemeName
  patterns?: ElementPatterns // hatch/texture fill per element symbol
  svg_node?: SVGSVGElement | null
}

// Fill for elements a color scheme has no entry for
export const MISSING_ELEMENT_COLOR = `#cccccc`

// Positive-amount species in insertion order with their atomic fraction and the scheme
// color of their element. Keys are canonicalized by parse_species_composition (Fe^2+ ->
// Fe2+); one element in two oxidation states gives two segments of the same color.
// `pattern_prefix` scopes the SVG <pattern> ids so several charts can share a page.
export const composition_segments = (
  composition: SpeciesComposition,
  color_scheme: ColorSchemeName,
  patterns: ElementPatterns,
  pattern_prefix: string,
): ChartSegment[] => {
  const amounts = Object.entries(parse_species_composition(composition)) as [string, number][]
  const total = amounts.reduce((sum, [, amount]) => sum + amount, 0)
  const colors = ELEMENT_COLOR_SCHEMES[color_scheme] ?? ELEMENT_COLOR_SCHEMES.Vesta
  return amounts.map(([species, amount]) => {
    const { element, oxidation_state } = parse_species_key(species)
    const color = colors[element] ?? MISSING_ELEMENT_COLOR
    const spec = patterns[element]
    const pattern = spec && resolve_pattern(spec, color, pattern_prefix)
    return {
      species,
      element,
      charge: format_charge(oxidation_state),
      amount,
      fraction: amount / total,
      color,
      // Labels sit on the tile backdrop: the segment color, or the page in `replace` mode
      text_color: opaque_contrast_color(pattern?.bg ?? color),
      pattern,
    }
  })
}

// Labels' superscript charge rises this far (em of the small font); the amount subscript that
// follows drops 0.75em below the baseline, so its dy undoes the rise first
export const CHARGE_RISE_EM = 0.8
export const subscript_dy = ({ charge }: ChartSegment): number =>
  0.75 + (charge ? CHARGE_RISE_EM : 0)

// Species as one plain string with a Unicode superscript charge (Fe²⁺), for tooltips and aria
export const segment_name = ({ element, charge }: ChartSegment): string =>
  element + superscript_digits(charge)

// Amount/percentage suffix rendered after the element symbol; `=` separates amount from
// percentage when both are shown (Fe2=20%)
export const segment_suffix = (
  { amount, fraction }: ChartSegment,
  { show_amounts, show_percentages }: ChartLabelOptions,
): string =>
  (show_amounts ? format_amount(amount) : ``) +
  (show_amounts && show_percentages ? `=` : ``) +
  (show_percentages ? format_num(fraction, `.1~%`) : ``)

// Hover/aria text: "Fe: 2 atoms (40%)", amount rounded like the visible labels
// Noun follows the shown number so 1.0000001 reads "1 atom"
export const segment_title = (segment: ChartSegment): string => {
  const shown = format_amount(segment.amount)
  return `${segment_name(segment)}: ${shown} ${shown === `1` ? `atom` : `atoms`} (${format_num(segment.fraction, `.1~%`)})`
}

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
