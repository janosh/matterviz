// Serializers for HeatmapTable's export menu and clipboard copy. All work from one plain-text
// matrix (`TableMatrix`), so CSV, TSV, markdown and LaTeX can't drift apart.
import { html_to_text } from '#lib/utils.js'
import { csv_line } from 'svelte-widgets/csv'
import type { RowData } from './index'

// Every format a table can export, for opting in: <HeatmapTable export_formats={TABLE_EXPORT_FORMATS}>
export const TABLE_EXPORT_FORMATS = [`csv`, `json`, `md`, `tex`] as const

export type TableMatrix = {
  headers: string[]
  rows: string[][]
  numeric: boolean[] // per column, drives right-alignment in md/tex
}

// TSV skips quoting, so the tabs and newlines that would split a cell collapse to spaces
export const tsv_cell = (text: string): string => text.replaceAll(/[\t\r\n]+/g, ` `)

// Delimited text: TSV through tsv_cell, CSV through the shared RFC 4180 escaper
export const table_to_delimited = (
  { headers, rows }: TableMatrix,
  delimiter: `,` | `\t`,
): string => {
  const to_line = (cells: string[]): string =>
    delimiter === `,` ? csv_line(cells) : cells.map(tsv_cell).join(delimiter)
  return [headers, ...rows].map(to_line).join(`\n`)
}

// JSON uses stable column IDs, so repeated or renamed headers never overwrite values.
// Numbers, dates and nested values are preserved; string cells lose their markup.
export const table_to_json = (
  rows: RowData[],
  columns: { id: string; key: string }[],
): string =>
  JSON.stringify(
    rows.map((row) =>
      Object.fromEntries(
        columns.map(({ id: identifier, key }) => {
          const val = row[key]
          return [identifier, typeof val === `string` ? html_to_text(val) : val]
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
  // escape `<` and entity-like `&` (before adding <br>) so decoded `<b>` or `&lt;` stays text
  const escape_md = (text: string) =>
    text
      .replaceAll(/&(?=#?[\da-z]+;)/gi, `&amp;`)
      .replaceAll(`<`, `&lt;`)
      .replaceAll(`\\`, `\\\\`)
      .replaceAll(`|`, `\\|`)
      .replaceAll(/\r?\n/g, `<br>`)
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
