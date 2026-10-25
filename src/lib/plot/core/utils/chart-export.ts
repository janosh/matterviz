// The numbers behind a chart: CSV tables and export filenames (figures go through io/export).

import type { ExportSource } from '#lib/io/export.js'
import { html_to_text } from '#lib/utils.js'
import { escape_csv_field } from 'svelte-widgets/csv'

// === CSV ===

export type CsvCell = string | number | null | undefined

// Non-finite chart values represent missing data, not literal NaN/Infinity fields. Text
// starting like a formula (e.g. a label decoded from `&#61;SUM(...)`) gets a leading quote so
// spreadsheets show it rather than evaluate it.
const csv_cell = (cell: CsvCell): string =>
  escape_csv_field(
    typeof cell === `number` && !Number.isFinite(cell)
      ? null
      : typeof cell === `string` && /^[=+\-@\t\r]/.test(cell)
        ? `'${cell}`
        : cell,
  )

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
    const name = srs.label ? html_to_text(srs.label) : `series ${series_idx + 1}` // HTML label
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

// Slug safe for a filename across platforms, from a chart title or axis labels. Labels are
// HTML (E<sub>F</sub>) and may be non-ASCII (Énergie, ΔE): an ASCII-only \w dropped those
// letters. Capped at 100 UTF-8 bytes (filesystems allow 255, leaving the extension room), cut
// by code point so no pair splits, after dropping leading dashes and before trailing ones.
export const export_filename = (...parts: (string | undefined)[]): string => {
  const slug = parts
    .map((part) => html_to_text(part ?? ``).trim())
    .filter(Boolean)
    .join(`-`)
    .replaceAll(/[^\p{L}\p{M}\p{N}_.-]+/gu, `-`)
    .replaceAll(/-{2,}/g, `-`) // a label like "E (eV)" leaves a dash on both sides of ")"
  let [cut, n_bytes] = [``, 0]
  for (const char of slug.replace(/^-+/, ``)) {
    n_bytes += new TextEncoder().encode(char).length
    if (n_bytes > 100) break
    cut += char
  }
  return cut.replace(/-+$/, ``) || `chart`
}

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
