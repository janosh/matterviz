// Saving a figure and saving the numbers behind it, shared by every chart. The
// hierarchy charts had this wired up privately; the Cartesian ones had no way to get
// a figure out at all, which for a scientific viewer is a routine ask.

import { DEFAULT_PNG_DPI } from '$lib/constants'
import { export_svg_as_png, export_svg_as_svg } from '$lib/io/export'
import { download } from '$lib/io/fetch'
import { unique_id } from '../utils'
import type { FileExportContext, FileSaver } from '$lib/io/file-export.svelte'
import { escape_csv_field } from 'svelte-widgets/csv'

export type ChartExportFormat = `png` | `svg` | `csv`

// Styles these components apply via CSS that an exported standalone SVG must carry as
// presentation attributes (inlined onto a clone by the io/export helpers), since a
// detached SVG drops the page stylesheets that Svelte component styles live in.
const CHART_EXPORT_INLINE_STYLES = [
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
const CHART_EXPORT_OPTIONS = { viewbox_padding: `stroke` } as const

// === HTML overlays ===

// Legends and color bars are HTML laid over the chart SVG, so an export of the SVG alone lost
// them. Components mark such roots with `data-export-overlay`; at export time each is redrawn
// as static SVG at its on-screen position.
const SVG_NS = `http://www.w3.org/2000/svg`

const set_attrs = <El extends Element>(
  element: El,
  attrs: Record<string, string | number>,
) => {
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value))
  return element
}
const svg_el = <Tag extends keyof SVGElementTagNameMap>(
  tag: Tag,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[Tag] => set_attrs(document.createElementNS(SVG_NS, tag), attrs)

const GRADIENT_VECTORS: Record<string, [number, number, number, number]> = {
  right: [0, 0, 1, 0],
  left: [1, 0, 0, 0],
  top: [0, 1, 0, 0],
  bottom: [0, 0, 0, 1],
}

// ColorBar's computed `linear-gradient(to <side>, <color> <offset>, ...)` as an SVG gradient
// vector plus [color, offset] stops, or null for any other background
export function parse_linear_gradient(background_image: string) {
  const { side = ``, args = `` } =
    /^linear-gradient\(to (?<side>\w+), (?<args>.*)\)$/s.exec(background_image.trim())
      ?.groups ?? {}
  const vector = GRADIENT_VECTORS[side]
  if (!vector) return null
  // split on commas outside parentheses (color functions like rgb(1, 2, 3) nest their own),
  // then each stop at the space before its offset
  const stops = args.split(/,(?![^(]*\))/).map((stop) => stop.trim().split(/\s+(?=\S+$)/))
  return { vector, stops }
}

const is_transparent = (color: string): boolean =>
  !color || color === `transparent` || /rgba\([^)]*,\s*0\)$/.test(color)

// Redraw an HTML overlay as SVG in the coordinate frame of `origin` (the chart SVG's box):
// solid and gradient backgrounds become rects, nested SVGs (legend markers) are cloned in
// place, text runs become <text> at their laid-out position with the computed font.
function overlay_to_svg(root: HTMLElement, origin: DOMRect): SVGGElement {
  // clipPath and linearGradient never render themselves, so they can live in the group
  const group = svg_el(`g`, { class: `export-overlay` })
  const box = (rect: DOMRect) => ({
    x: rect.left - origin.left,
    y: rect.top - origin.top,
    width: rect.width,
    height: rect.height,
  })
  // A scrolling legend shows only what fits its box
  if (getComputedStyle(root).overflowY !== `visible`) {
    const clip_id = unique_id(`export-overlay-clip`)
    const clip = svg_el(`clipPath`, { id: clip_id })
    const root_box = box(root.getBoundingClientRect())
    clip.append(svg_el(`rect`, root_box))
    group.append(clip)
    group.setAttribute(`clip-path`, `url(#${clip_id})`)
  }

  const add_background = (element: Element, style: CSSStyleDeclaration, opacity: number) => {
    const rect = box(element.getBoundingClientRect())
    if (!(rect.width > 0 && rect.height > 0)) return
    // oxlint-disable-next-line unicorn/prefer-number-coercion -- computed CSS lengths include px
    const radius = Number.parseFloat(style.borderTopLeftRadius) || 0
    const gradient = parse_linear_gradient(style.backgroundImage)
    let fill = style.backgroundColor
    if (gradient) {
      const id = unique_id(`export-overlay-gradient`)
      const [x1, y1, x2, y2] = gradient.vector
      const element_gradient = svg_el(`linearGradient`, { id, x1, y1, x2, y2 })
      for (const [color, offset] of gradient.stops) {
        element_gradient.append(svg_el(`stop`, { offset, 'stop-color': color }))
      }
      group.append(element_gradient)
      fill = `url(#${id})`
    } else if (is_transparent(fill)) return
    group.append(svg_el(`rect`, { ...rect, rx: radius, fill, opacity }))
  }

  const add_text = (node: Text, style: CSSStyleDeclaration, opacity: number) => {
    const text = node.textContent?.replaceAll(/\s+/g, ` `).trim()
    if (!text) return
    const range = document.createRange()
    range.selectNodeContents(node)
    const rect = box(range.getBoundingClientRect())
    if (!(rect.width > 0 || rect.height > 0)) return
    const text_el = svg_el(`text`, {
      x: rect.x,
      y: rect.y + rect.height / 2,
      'dominant-baseline': `central`,
      fill: style.color,
      'font-size': style.fontSize,
      'font-family': style.fontFamily,
      'font-weight': style.fontWeight,
      'font-style': style.fontStyle,
      opacity,
    })
    text_el.textContent = text
    group.append(text_el)
  }

  const walk = (element: Element, parent_opacity: number) => {
    // Interactive controls have no static rendering (and raster exports must stay untainted)
    if (element.matches(`input, select, button, textarea, [data-export-exclude]`)) return
    const style = getComputedStyle(element)
    if (style.display === `none` || style.visibility === `hidden`) return
    const opacity = parent_opacity * (style.opacity === `` ? 1 : Number(style.opacity))
    if (!(opacity > 0)) return
    if (element instanceof SVGSVGElement) {
      const rect = box(element.getBoundingClientRect())
      group.append(set_attrs(element.cloneNode(true) as SVGSVGElement, { ...rect, opacity }))
      return
    }
    add_background(element, style, opacity)
    for (const child of element.childNodes) {
      if (child instanceof Text) add_text(child, style, opacity)
      else if (child instanceof Element) walk(child, opacity)
    }
  }
  walk(root, 1)
  return group
}

// The chart's HTML overlays drawn into its SVG for the duration of an export: an export-only
// group (hidden in the live view, shown in the serialized clone) that `run` sees
async function with_export_overlays<Result>(
  svg_element: SVGElement,
  run: () => Result,
): Promise<Awaited<Result>> {
  const host = svg_element.parentElement
  const overlays = [
    ...(host?.querySelectorAll<HTMLElement>(`[data-export-overlay]`) ?? []),
  ].filter((overlay) => !svg_element.contains(overlay))
  if (overlays.length === 0) return await run()
  const origin = svg_element.getBoundingClientRect()
  const layer = svg_el(`g`, { 'data-export-only': ``, display: `none` })
  for (const overlay of overlays) layer.append(overlay_to_svg(overlay, origin))
  svg_element.append(layer)
  try {
    return await run()
  } finally {
    layer.remove()
  }
}

export function export_chart_image(
  svg_element: SVGElement | null,
  base_filename: string,
  format: `svg` | `png`,
  save: FileSaver = download,
): Promise<void> | undefined {
  if (!svg_element) return undefined
  const filename = `${base_filename}.${format}`
  const args = [CHART_EXPORT_INLINE_STYLES, CHART_EXPORT_OPTIONS, save] as const
  return with_export_overlays(svg_element, () =>
    format === `svg`
      ? export_svg_as_svg(svg_element, filename, ...args)
      : export_svg_as_png(svg_element, filename, DEFAULT_PNG_DPI, ...args),
  )
}

// === CSV ===

export type CsvCell = string | number | null | undefined

// Non-finite chart values represent missing data, not literal NaN/Infinity fields.
const csv_cell = (cell: CsvCell): string =>
  escape_csv_field(typeof cell === `number` && !Number.isFinite(cell) ? null : cell)

export const to_csv = (header: readonly string[], rows: readonly CsvCell[][]): string =>
  [header, ...rows].map((row) => row.map(csv_cell).join(`,`)).join(`\n`)

// Long format (one row per point, series named in a column) rather than wide: series
// can differ in length, sit on different axes and carry different extra channels, none
// of which a shared-x column layout can represent without inventing blanks.
export interface CsvSeries {
  label?: string
  x: readonly number[]
  y: readonly number[]
  // Extra per-point channels, emitted as their own columns when any series has them
  extras?: Record<string, readonly (number | null | undefined)[] | undefined>
}

export function series_to_csv_rows(series: readonly CsvSeries[]): {
  header: string[]
  rows: CsvCell[][]
} {
  const extra_keys = [
    ...new Set(series.flatMap((srs) => Object.keys(srs.extras ?? {}))),
  ].toSorted()
  const header = [`series`, `x`, `y`, ...extra_keys]
  const rows: CsvCell[][] = []
  series.forEach((srs, series_idx) => {
    const name = srs.label ?? `series ${series_idx + 1}`
    const count = Math.min(srs.x.length, srs.y.length)
    for (let idx = 0; idx < count; idx++) {
      rows.push([
        name,
        srs.x[idx],
        srs.y[idx],
        ...extra_keys.map((key) => srs.extras?.[key]?.[idx] ?? null),
      ])
    }
  })
  return { header, rows }
}

// Slug safe for a filename across platforms, from a chart title or axis labels
export const export_filename = (...parts: (string | undefined)[]): string =>
  parts
    .filter((part): part is string => Boolean(part?.trim()))
    .join(`-`)
    .replaceAll(/[^\w.-]+/g, `-`)
    .replaceAll(/-{2,}/g, `-`) // a label like "E (eV)" leaves a dash on both sides of ")"
    .replaceAll(/^-+|-+$/g, ``)
    .slice(0, 100) || `chart`

type ChartExportSource = {
  svg_element: SVGElement | null
  title_config?: { text?: string } | null
  axes: { x: { label?: string }; y: { label?: string } }
}

export const chart_export_filename = (frame: ChartExportSource): string =>
  export_filename(frame.title_config?.text, frame.axes.x.label, frame.axes.y.label)

// Charts differ only in the table they write: the svg, the filename recipe and the
// csv/image branch are the same everywhere, so they live here rather than once per chart.
export const create_chart_exporter =
  (frame: ChartExportSource, csv: () => { header: readonly string[]; rows: CsvCell[][] }) =>
  (format: ChartExportFormat, context?: FileExportContext): void | Promise<void> => {
    const name = context?.filename ?? chart_export_filename(frame)
    const save = context?.save ?? download
    if (format !== `csv`) return export_chart_image(frame.svg_element, name, format, save)
    const { header, rows } = csv()
    return save(to_csv(header, rows), `${name}.csv`, `text/csv;charset=utf-8`)
  }
