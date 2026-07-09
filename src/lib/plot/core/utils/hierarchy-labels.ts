// Label/color helpers shared by the hierarchical part-of-whole charts
// (Sunburst, Treemap): per-node label strings, memoized contrast picking and
// text measurement, and SVG/PNG export. Pure + cache-factory functions so each
// component instance owns its caches without sharing global state.

import { pick_contrast_color } from '$lib/colors'
import { export_svg_as_png, export_svg_as_svg } from '$lib/io/export'
import { format_value } from '$lib/labels'
import { measure_text_width } from '$lib/plot/core/layout'
import type { SunburstLabelText } from '$lib/plot/sunburst/sunburst'

// The semantic node fields label formatting needs (subset of PositionedArc)
interface LabeledNode {
  id: string | number
  label?: string
  value: number
  fraction: number
  parent_fraction?: number
}

export const node_display_name = (node: LabeledNode): string => node.label ?? `${node.id}`

// What a node's label displays, per the label_text mode (plotly textinfo
// equivalent); percent is of the root total, parent-percent of the parent node
export function node_label_str(
  node: LabeledNode,
  label_text: SunburstLabelText,
  value_format: string,
): string {
  const name = node_display_name(node)
  if (label_text === `label`) return name
  const val = format_value(node.value, value_format)
  if (label_text === `value`) return val
  if (label_text === `label+value`) return `${name} ${val}`
  if (label_text === `label+parent-percent`) {
    return `${name} (${format_value(node.parent_fraction ?? node.fraction, `.0%`)})`
  }
  const pct = format_value(node.fraction, `.1%`)
  if (label_text === `percent`) return pct
  return `${name} ${pct}` // label+percent
}

const COMPOUND_LABEL_MODES: ReadonlySet<SunburstLabelText> = new Set([
  `label+value`,
  `label+percent`,
  `label+parent-percent`,
])

// Base + optional richer variant for fit-aware rendering: compound modes
// degrade to the bare label when the full text doesn't fit its node, instead
// of hiding the label entirely.
export function node_label_variants(
  node: LabeledNode,
  label_text: SunburstLabelText,
  value_format: string,
): { text: string; extended?: string } {
  const text = node_label_str(node, label_text, value_format)
  if (!COMPOUND_LABEL_MODES.has(label_text)) return { text }
  return { text: node_display_name(node), extended: text }
}

// Black/white label text, whichever contrasts with the given fill. Memoized per
// color string - parsing/luminance is too slow per label per frame, and distinct
// node colors are few.
export function make_cached_contrast(): (fill: string) => string {
  const cache = new Map<string, string>()
  return (fill) => {
    let contrast = cache.get(fill)
    if (contrast === undefined) {
      contrast = pick_contrast_color({ bg_color: fill })
      cache.set(fill, contrast)
    }
    return contrast
  }
}

// Memoized canvas text measurement (far too slow per visible node per frame)
export function make_cached_text_width(): (text: string, font: string) => number {
  const cache = new Map<string, number>()
  return (text, font) => {
    const key = `${font}|${text}`
    let text_width = cache.get(key)
    if (text_width === undefined) {
      if (cache.size > 10_000) cache.clear() // growth guard
      text_width = measure_text_width(text, font)
      cache.set(key, text_width)
    }
    return text_width
  }
}

// Styles these components apply via CSS that exported standalone SVGs must carry
// as presentation attributes (inlined onto a clone by the io/export helpers)
const EXPORT_INLINE_STYLES = [
  `fill`,
  `stroke`,
  `stroke-width`,
  `text-anchor`,
  `dominant-baseline`,
  `font-size`,
  `font-family`,
  `font-weight`,
  `opacity`,
]

export function export_hierarchy_chart(
  svg_element: SVGSVGElement | null,
  base_filename: string,
  format: `svg` | `png`,
): void {
  if (!svg_element) return
  const filename = `${base_filename}.${format}`
  if (format === `svg`) export_svg_as_svg(svg_element, filename, EXPORT_INLINE_STYLES)
  else export_svg_as_png(svg_element, filename, 150, EXPORT_INLINE_STYLES)
}
