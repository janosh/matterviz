// Serializers for HeatmapTable's export menu and clipboard copy. All work from one plain-text
// matrix (`TableMatrix`), so CSV, TSV, markdown and LaTeX can't drift apart.
import { strip_html } from '$lib/utils'
import { csv_line } from 'svelte-widgets/csv'
import type { RowData } from './index'

export type ExportFormat = `csv` | `json` | `md` | `tex`
export const EXPORT_MIME_TYPES: Record<ExportFormat, string> = {
  csv: `text/csv`,
  json: `application/json`,
  md: `text/markdown`,
  tex: `text/x-tex`,
}

export type TableMatrix = {
  headers: string[]
  rows: string[][]
  numeric: boolean[] // per column, drives right-alignment in md/tex
}

// Delimited text. TSV skips quoting (cell newlines and tabs collapse to spaces); CSV goes
// through the shared RFC 4180 escaper.
export const table_to_delimited = (
  { headers, rows }: TableMatrix,
  delimiter: `,` | `\t`,
): string => {
  const to_line = (cells: string[]): string =>
    delimiter === `,`
      ? csv_line(cells)
      : cells.map((str) => str.replaceAll(/[\t\r\n]+/g, ` `)).join(delimiter)
  return [headers, ...rows].map(to_line).join(`\n`)
}

// JSON array of row objects keyed by header. Unlike the matrix exporters this keeps numbers,
// dates and nested values as they are; only string cells and headers lose their markup.
export const table_to_json = (
  rows: RowData[],
  columns: { label: string; key: string }[],
): string =>
  JSON.stringify(
    rows.map((row) =>
      Object.fromEntries(
        columns.map(({ label, key }) => {
          const val = row[key]
          return [strip_html(label), typeof val === `string` ? strip_html(val) : val]
        }),
      ),
    ),
    null,
    2,
  )

// GitHub-flavoured markdown: header, alignment row, then the body. Backslash is escaped
// first (or it would re-escape the one added for `|`), and newlines become <br>: a literal
// line break would end the table row mid-cell.
export function table_to_markdown({ headers, rows, numeric }: TableMatrix): string {
  const align = numeric.map((is_numeric) => (is_numeric ? `---:` : `:---`))
  const escape_md = (text: string) =>
    text.replaceAll(`\\`, `\\\\`).replaceAll(`|`, `\\|`).replaceAll(/\r?\n/g, `<br>`)
  const line = (cells: string[]) => `| ${cells.map(escape_md).join(` | `)} |`
  return [line(headers), line(align), ...rows.map(line)].join(`\n`)
}

// One pass over a character map: escaping in stages would re-escape the backslashes and
// braces of the replacements themselves.
const TEX_ESCAPES: Record<string, string> = {
  '\\': `\\textbackslash{}`,
  '^': `\\textasciicircum{}`,
  '~': `\\textasciitilde{}`,
  '&': `\\&`,
  '%': `\\%`,
  $: `\\$`,
  '#': `\\#`,
  _: `\\_`,
  '{': `\\{`,
  '}': `\\}`,
}
const escape_tex = (text: string) =>
  text.replaceAll(/[\\^~&%$#_{}]/g, (char) => TEX_ESCAPES[char] ?? char)

// LaTeX booktabs tabular, numeric columns right-aligned
export function table_to_latex({ headers, rows, numeric }: TableMatrix): string {
  const line = (cells: string[]) => `  ${cells.map(escape_tex).join(` & `)} \\\\`
  const spec = numeric.map((is_numeric) => (is_numeric ? `r` : `l`)).join(``)
  return [
    `\\begin{tabular}{${spec}}`,
    `  \\toprule`,
    line(headers),
    `  \\midrule`,
    ...rows.map(line),
    `  \\bottomrule`,
    `\\end{tabular}`,
  ].join(`\n`)
}
