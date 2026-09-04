// Headless row logic for HeatmapTable: one numeric reading of a cell, sort comparison,
// search/filter predicates and date-time parsing/formatting. No DOM, so it's unit-testable
// and the component only wires these to events and markup.
import { HTML_TAG_SRC, normalize_unicode_minus, strip_html } from '$lib/utils'
import { fuzzy_match } from 'svelte-widgets/utils'
import type { CellVal, ColumnFilter, DateTimeFormatMode, Label, RowData } from './index'

// Columns discovered from the first rows when the caller passes none
export const discover_columns = (rows: RowData[]): Label[] => {
  const seen = new Set<string>()
  for (const row of rows.slice(0, 50)) {
    for (const key of Object.keys(row)) if (key !== `style` && key !== `class`) seen.add(key)
  }
  return [...seen].map((key) => ({ label: key }))
}

// Head and tail of a long cell string for a middle ellipsis, split on graphemes so combining
// marks and emoji aren't torn apart. Strings at or below MIDDLE_ELLIPSIS_MIN_LENGTH render whole.
export const MIDDLE_ELLIPSIS_MIN_LENGTH = 16
const grapheme_segmenter = new Intl.Segmenter(undefined, { granularity: `grapheme` })
export const middle_ellipsis_parts = (text: string): [string, string] => {
  const graphemes = [...grapheme_segmenter.segment(text)].map(({ segment }) => segment)
  const split_at = graphemes.length - Math.min(8, Math.floor(graphemes.length / 2))
  return [graphemes.slice(0, split_at).join(``), graphemes.slice(split_at).join(``)]
}

// Missing values, NaN and invalid dates render as n/a and sort to the bottom
export const is_invalid = (val: unknown): boolean =>
  val == null ||
  (typeof val === `number` && Number.isNaN(val)) ||
  (val instanceof Date && Number.isNaN(val.getTime()))

const HTML_MARKUP_RE = new RegExp(
  `${HTML_TAG_SRC}|&(?:#\\d+|#x[\\da-f]+|[a-z][\\da-z]+);`,
  `i`,
)
// Distinguish actual tags/entities from ordinary comparison and ampersand text so plain
// strings still receive middle ellipsis and a direct data-sort-value.
export const is_html_str = (val: unknown): val is string =>
  typeof val === `string` && HTML_MARKUP_RE.test(val)

const NUMERIC_WITH_ERROR_RE =
  /^(?<numeric>[-+−]?(?:\d+\.?\d*|\d*\.\d+)(?:[eE][-+−]?\d+)?)\s*(?:±|\+[-−]|\()/
const DATA_SORT_VALUE_RE = /data-sort-value="(?<value>[^"]*)"/

// Plain text of a cell: markup stripped, dates as ISO, objects as JSON, invalid as ``
export const cell_text = (val: CellVal): string => {
  if (is_invalid(val)) return ``
  if (val instanceof Date) return val.toISOString()
  if (typeof val === `object`) return JSON.stringify(val)
  return strip_html(String(val)).trim()
}

// A blank data-sort-value="" carries no sort key: Number('') is 0, which would sort and
// color the cell as zero and pull the column's mean toward it.
const get_data_sort_value = (val: string): string | null => {
  const captured = DATA_SORT_VALUE_RE.exec(val)?.groups?.value
  return captured?.trim() ? captured : null
}

const parse_numeric_string = (val: string): number | null => {
  const numeric_str = NUMERIC_WITH_ERROR_RE.exec(val)?.[1] ?? val
  if (numeric_str.trim() === ``) return null
  const num = Number(normalize_unicode_minus(numeric_str))
  return Number.isNaN(num) ? null : num
}

// The one numeric reading of a cell: an explicit data-sort-value wins, then the visible
// text with markup stripped and uncertainty notation ("1.23 ± 0.05", "1.23(5)") trimmed.
// Sorting, coloring, filtering and the summary row all go through this, so a cell can't
// sort as 10 while coloring as if it held no number.
export function parse_numeric_val(val: CellVal): number | null {
  if (typeof val === `number`) return Number.isFinite(val) ? val : null
  if (typeof val !== `string`) return null
  const sort_attr = get_data_sort_value(val)
  const num = sort_attr == null ? parse_numeric_string(strip_html(val)) : Number(sort_attr)
  return num !== null && Number.isFinite(num) ? num : null
}

// Sorting reads the same rendered text search, filters and export do, so a cell cannot sort
// by one string while showing another. Handing back the raw value instead meant `<b>Mango</b>`
// sorted under `<` (tag name, not content), and a boolean or object cell reached compare_rows
// as a non-string it could only answer "the other one first" to in BOTH directions - not a
// total order, so the same rows came out differently depending on the order they went in.
const get_sort_val = (val: CellVal): string | number => {
  if (val instanceof Date) return val.getTime()
  const num = parse_numeric_val(val)
  if (num !== null) return num
  // a data-sort-value that isn't a number still overrides the visible text
  if (typeof val === `string`) return get_data_sort_value(val) ?? cell_text(val)
  return cell_text(val)
}

export type SortCriterion = { key: string; ascending: boolean }
const sort_collator = new Intl.Collator(undefined, { numeric: true, sensitivity: `base` })

// Comparator over row keys: invalid values sink to the bottom regardless of direction,
// numbers sort before strings, strings compare natural-order and case-insensitively.
export function compare_rows(row1: RowData, row2: RowData, criteria: SortCriterion[]): number {
  for (const { key, ascending } of criteria) {
    const val1 = row1[key]
    const val2 = row2[key]
    if (val1 === val2) continue
    const invalid1 = is_invalid(val1)
    const invalid2 = is_invalid(val2)
    // both invalid ranks them equally low, so let the next criterion break the tie —
    // `val1 === val2` above never catches it, since NaN !== NaN and null !== undefined
    if (invalid1 && invalid2) continue
    if (invalid1 || invalid2) return Number(invalid1) - Number(invalid2)
    const sort_val1 = get_sort_val(val1)
    const sort_val2 = get_sort_val(val2)
    const modifier = ascending ? 1 : -1
    if (typeof sort_val1 === `string` && typeof sort_val2 === `string`) {
      const cmp = sort_collator.compare(sort_val1, sort_val2)
      if (cmp !== 0) return cmp * modifier
    } else if (typeof sort_val1 !== typeof sort_val2) {
      // number<string is false both ways, breaking the comparator: numbers sort first
      return (typeof sort_val1 === `number` ? -1 : 1) * modifier
    } else if (sort_val1 !== sort_val2) {
      return sort_val1 < sort_val2 ? -modifier : modifier
    }
  }
  return 0
}

// === Search and per-column filters ===

// Case-insensitive substring (optionally subsequence, e.g. "mdla" matches "Model A") match of
// a lower-cased query against the row's values, or only the given keys.
export const row_matches_query = (
  row: RowData,
  query: string,
  { keys, fuzzy = false }: { keys?: string[]; fuzzy?: boolean } = {},
): boolean =>
  (keys ? keys.map((key) => row[key]) : Object.values(row)).some((val) => {
    if (val == null) return false
    const clean_val = cell_text(val).toLowerCase()
    return clean_val.includes(query) || (fuzzy && fuzzy_match(query, clean_val))
  })

export const cell_matches_filter = (val: CellVal, filter: ColumnFilter): boolean => {
  if (filter.kind === `numeric`) {
    const num = parse_numeric_val(val)
    if (num === null) return false
    return (
      (filter.min == null || num >= filter.min) && (filter.max == null || num <= filter.max)
    )
  }
  const text = cell_text(val)
  if (filter.kind === `category`) return filter.values.includes(text)
  return text.toLowerCase().includes(filter.text.toLowerCase())
}

// Above this many distinct values a column gets a substring box instead of a checklist
export const CATEGORY_LIMIT = 40
type FilterPanel = { kind: `numeric` | `category` | `text`; options: string[] }

// Options and control type for one column's filter panel. Distinct values come from the
// unfiltered rows, so a column's own filter never removes the options you'd use to widen it.
// The cap applies only to auto-detection: an explicit `category` column must list them all
// or its checklist renders empty.
export function column_filter_panel(
  col: Label,
  rows: RowData[],
  row_key: string,
  is_numeric: boolean,
): FilterPanel {
  const capped = col.filter !== `category`
  const seen = new Set<string>()
  for (const row of rows) {
    const val = row[row_key]
    if (!is_invalid(val)) seen.add(cell_text(val))
    if (capped && seen.size > CATEGORY_LIMIT) {
      seen.clear() // too many to pick from: fall back to a substring box
      break
    }
  }
  const options = [...seen].toSorted()
  const configured = col.filter && col.filter !== `auto` ? col.filter : null
  const detected = is_numeric ? `numeric` : options.length > 0 ? `category` : `text`
  return { options, kind: configured ?? detected }
}

// A numeric filter with neither bound, or a category filter allowing everything, is the same
// as no filter: both collapse to undefined so the funnel icon and row count stay honest.
export function with_numeric_bound(
  current: ColumnFilter | undefined,
  bound: `min` | `max`,
  raw: string,
): ColumnFilter | undefined {
  const base = current?.kind === `numeric` ? current : { kind: `numeric` as const }
  const value = raw.trim() === `` ? undefined : Number(raw)
  const next = { ...base, [bound]: Number.isFinite(value) ? value : undefined }
  return next.min == null && next.max == null ? undefined : next
}
export function with_category_toggled(
  current: ColumnFilter | undefined,
  value: string,
  options: string[],
): ColumnFilter | undefined {
  const selected = current?.kind === `category` ? current.values : options
  const next = selected.includes(value)
    ? selected.filter((entry) => entry !== value)
    : [...selected, value]
  return next.length === options.length ? undefined : { kind: `category`, values: next }
}

// === Date/time columns ===

type DateTimeColumnKind = `date` | `time` | `datetime`
export const DATETIME_MODES_BY_KIND: Record<DateTimeColumnKind, DateTimeFormatMode[]> = {
  date: [`date`, `relative`],
  time: [`time`],
  datetime: [`date`, `time`, `datetime`, `iso`, `relative`],
}
export const DATETIME_MODE_LABELS: Record<DateTimeFormatMode, string> = {
  date: `Date`,
  time: `Time`,
  datetime: `Date + time`,
  iso: `ISO`,
  relative: `Since now`,
}

const DATE_ONLY_RE = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/
const DATE_TIME_RE =
  /^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/

// Epoch seconds (2001–2286) or milliseconds; anything else is not a timestamp
const normalize_timestamp = (val: number): number | null => {
  if (!Number.isFinite(val)) return null
  const abs = Math.abs(val)
  if (abs >= 1e12 && abs < 1e14) return val
  if (abs >= 1e9 && abs < 1e12) return val * 1000
  return null
}

const is_date_only_string = (val: unknown): boolean =>
  typeof val === `string` && DATE_ONLY_RE.test(strip_html(val).trim())

const parse_datetime_string = (val: string): number | null => {
  const clean = strip_html(val).trim()
  const date_only = DATE_ONLY_RE.exec(clean)?.groups
  // built as local midnight, where Date.parse would read a bare date as UTC
  if (date_only) {
    const { year, month, day } = date_only
    return new Date(Number(year), Number(month) - 1, Number(day)).getTime()
  }
  if (!DATE_TIME_RE.test(clean)) return null
  const parsed = Date.parse(
    clean.replace(` `, `T`).replace(/\.(?<millis>\d{3})\d+/, `.$<millis>`),
  )
  return Number.isNaN(parsed) ? null : parsed
}

// Epoch milliseconds for a cell, or null when it isn't a date. Numbers and numeric strings
// only count as timestamps in columns that declare a datetime format.
export const parse_datetime_val = (val: CellVal, col: Label): number | null => {
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val.getTime()
  if (typeof val === `number`) {
    return col.datetime_format ? normalize_timestamp(val) : null
  }
  if (typeof val !== `string`) return null
  const parsed_text = parse_datetime_string(val)
  if (parsed_text !== null) return parsed_text
  if (!col.datetime_format) return null
  const sort_attr = get_data_sort_value(val)
  return normalize_timestamp(Number(sort_attr ?? strip_html(val).trim()))
}

// A column's date/time kind from its config, else from a sample of its values: a single
// value carrying a time of day makes it a datetime column; bare dates only settle it if
// nothing richer turns up in the sample.
export function infer_datetime_kind(col: Label, sample: CellVal[]): DateTimeColumnKind | null {
  if (col.datetime_format === `date`) return `date`
  if (col.datetime_format === `time`) return `time`
  if (col.datetime_format) return `datetime`
  let has_date_value = false
  for (const val of sample) {
    if (is_date_only_string(val)) has_date_value = true
    else if (parse_datetime_val(val, col) !== null) return `datetime`
  }
  return has_date_value ? `date` : null
}

const pad2 = (val: number) => String(val).padStart(2, `0`)

// "2h 5m ago" / "3d from now": up to three leading non-zero units, minute granularity
function format_since(timestamp: number, now_ms: number): string {
  const diff = now_ms - timestamp
  let remaining_minutes = Math.max(0, Math.floor(Math.abs(diff) / 60_000))
  const parts: string[] = []
  const units = [
    [`y`, 365 * 24 * 60],
    [`mo`, 30 * 24 * 60],
    [`w`, 7 * 24 * 60],
    [`d`, 24 * 60],
    [`h`, 60],
    [`m`, 1],
  ] as const
  for (const [suffix, minutes_per_unit] of units) {
    const value = Math.floor(remaining_minutes / minutes_per_unit)
    // the minutes term only fills in when no coarser unit rendered, so no trailing 0m
    if (value > 0 || (suffix === `m` && parts.length === 0)) parts.push(`${value}${suffix}`)
    remaining_minutes -= value * minutes_per_unit
    if (parts.length >= 3) break
  }
  return `${parts.join(` `)} ${diff >= 0 ? `ago` : `from now`}`
}

// Local-time rendering of an epoch timestamp in the given mode. Not toISOString() for the
// date/time modes, which would shift to UTC.
export function format_datetime(
  timestamp: number,
  mode: DateTimeFormatMode,
  now_ms = Date.now(),
): string {
  if (mode === `relative`) return format_since(timestamp, now_ms)
  const stamp = new Date(timestamp)
  if (mode === `iso`) return stamp.toISOString()
  const date = `${stamp.getFullYear()}-${pad2(stamp.getMonth() + 1)}-${pad2(stamp.getDate())}`
  const time = `${pad2(stamp.getHours())}:${pad2(stamp.getMinutes())}`
  return mode === `date` ? date : mode === `time` ? time : `${date} ${time}`
}
