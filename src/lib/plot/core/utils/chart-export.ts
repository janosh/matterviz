// Saving a figure and saving the numbers behind it, shared by every chart. The
// hierarchy charts had this wired up privately; the Cartesian ones had no way to get
// a figure out at all, which for a scientific viewer is a routine ask.

import { DEFAULT_PNG_DPI } from '$lib/constants'
import { export_svg_as_png, export_svg_as_svg } from '$lib/io/export'
import { download } from '$lib/io/fetch'
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

export function export_chart_image(
  svg_element: SVGElement | null,
  base_filename: string,
  format: `svg` | `png`,
): void {
  if (!svg_element) return
  const filename = `${base_filename}.${format}`
  if (format === `svg`) {
    export_svg_as_svg(svg_element, filename, CHART_EXPORT_INLINE_STYLES, CHART_EXPORT_OPTIONS)
  } else {
    export_svg_as_png(
      svg_element,
      filename,
      DEFAULT_PNG_DPI,
      CHART_EXPORT_INLINE_STYLES,
      CHART_EXPORT_OPTIONS,
    )
  }
}

// === CSV ===

export type CsvCell = string | number | null | undefined

// Non-finite chart values represent missing data, not literal NaN/Infinity fields.
const csv_cell = (cell: CsvCell): string =>
  escape_csv_field(typeof cell === `number` && !Number.isFinite(cell) ? null : cell)

export const to_csv = (header: readonly string[], rows: readonly CsvCell[][]): string =>
  [header, ...rows].map((row) => row.map(csv_cell).join(`,`)).join(`\n`)

function export_csv(
  header: readonly string[],
  rows: readonly CsvCell[][],
  base_filename: string,
): void {
  download(to_csv(header, rows), `${base_filename}.csv`, `text/csv;charset=utf-8`)
}

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

// Charts differ only in the table they write: the svg, the filename recipe and the
// csv/image branch are the same everywhere, so they live here rather than once per chart.
export const create_chart_exporter =
  (
    frame: {
      svg_element: SVGElement | null
      title_config?: { text?: string } | null
      axes: { x: { label?: string }; y: { label?: string } }
    },
    csv: () => { header: readonly string[]; rows: CsvCell[][] },
  ) =>
  (format: ChartExportFormat): void => {
    const name = export_filename(
      frame.title_config?.text,
      frame.axes.x.label,
      frame.axes.y.label,
    )
    if (format !== `csv`) return export_chart_image(frame.svg_element, name, format)
    const { header, rows } = csv()
    export_csv(header, rows, name)
  }
