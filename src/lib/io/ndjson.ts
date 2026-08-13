// NDJSON (newline-delimited JSON, also .jsonl) parsing and row flattening.

export interface NdjsonParseResult {
  rows: Record<string, unknown>[]
  skipped_lines: number
}

export const is_ndjson_filename = (filename: string): boolean =>
  /\.(?:jsonl|ndjson)$/i.test(filename.trim())

// Parse newline-delimited JSON. Blank lines are ignored; lines that fail to
// parse or don't hold a plain object (bare numbers, torn tails from files a
// running job is still writing) are counted in skipped_lines instead of
// throwing, so a partially written manifest stays inspectable.
export const parse_ndjson = (content: string): NdjsonParseResult => {
  const rows: Record<string, unknown>[] = []
  let skipped_lines = 0
  for (const line of content.split(`\n`)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (parsed && typeof parsed === `object` && !Array.isArray(parsed)) {
        rows.push(parsed as Record<string, unknown>)
      } else skipped_lines++
    } catch {
      skipped_lines++
    }
  }
  return { rows, skipped_lines }
}

const DEEP_OBJECT_PLACEHOLDER = `…`

const flatten_value = (value: unknown): unknown => {
  // Compact small primitive arrays (e.g. Miller indices) into `(1,1,1)` so they render as
  // sortable/groupable table cells. Anything else object-shaped collapses to a placeholder.
  if (Array.isArray(value)) {
    const primitive = value.every((it) => typeof it === `number` || typeof it === `string`)
    return value.length <= 6 && primitive ? `(${value.join(`,`)})` : DEEP_OBJECT_PLACEHOLDER
  }
  return value && typeof value === `object` ? DEEP_OBJECT_PLACEHOLDER : value
}

// Dot-path flatten nested objects up to max_depth levels, so a manifest row's
// nested `key` object becomes `key.pair_id`, `key.film_miller`, ... columns.
// Objects nested deeper than max_depth collapse to a `…` placeholder cell.
export const flatten_row = (
  row: Record<string, unknown>,
  max_depth = 2,
): Record<string, unknown> => {
  const flat: Record<string, unknown> = {}
  const visit = (obj: Record<string, unknown>, prefix: string, depth: number): void => {
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key
      if (value && typeof value === `object` && !Array.isArray(value) && depth < max_depth) {
        visit(value as Record<string, unknown>, path, depth + 1)
      } else if (path === `__proto__`) {
        // Plain assignment would hit Object.prototype's setter and drop the column
        const shape = { enumerable: true, configurable: true, writable: true }
        Object.defineProperty(flat, path, { ...shape, value: flatten_value(value) })
      } else flat[path] = flatten_value(value)
    }
  }
  visit(row, ``, 1)
  return flat
}
