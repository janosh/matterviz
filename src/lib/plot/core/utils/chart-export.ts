// The numbers behind a chart: CSV tables and export filenames (figures go through io/export).

import type { ExportSource } from '#lib/io/export.js'
import { escape_csv_field } from 'svelte-widgets/csv'

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
  x: readonly (number | string)[] // category names for categorical bar charts
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
  title_config?: { text?: string } | null
  axes: { x: { label?: string }; y: { label?: string } }
}

export const chart_export_filename = (frame: ChartExportSource): string =>
  export_filename(frame.title_config?.text, frame.axes.x.label, frame.axes.y.label)

// CSV export source from a lazily built table
export const csv_source =
  (table: () => { header: readonly string[]; rows: CsvCell[][] }): ExportSource =>
  () => {
    const { header, rows } = table()
    return to_csv(header, rows)
  }
