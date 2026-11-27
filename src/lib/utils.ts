import { is_plain_object } from 'svelte-widgets/utils'

// A finite number (not NaN or ±Infinity), narrowing an unknown value's type
export const is_finite_number = (value: unknown): value is number => Number.isFinite(value)

// JSON value kinds for input validation: each kind's test and the phrase its errors use
export const JSON_KINDS = {
  string: [(value: unknown) => typeof value === `string`, `a string`],
  number: [Number.isFinite, `a finite number`],
  boolean: [(value: unknown) => typeof value === `boolean`, `a boolean`],
  array: [Array.isArray, `an array`],
  object: [is_plain_object, `an object`],
} as const satisfies Record<string, readonly [(value: unknown) => boolean, string]>

// Clamp a number to the [0, 1] range.
export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

// Calls `report` once with each whole percent (at most `cap`) a growing 0-1 fraction reaches
export const whole_percent_reporter = (report: (percent: number) => void, cap = 100) => {
  let last = -1
  return (fraction: number): void => {
    const percent = Math.min(cap, Math.floor(100 * fraction))
    if (percent > last) report((last = percent))
  }
}

// Normalize unicode minus (U+2212) to ASCII hyphen-minus.
export const normalize_unicode_minus = (value: string): string => value.replaceAll(`−`, `-`)

// Normalize scientific notation variants (d/D exponent, Mathematica *^).
export const normalize_scientific_notation = (value: string): string =>
  normalize_unicode_minus(value).toLowerCase().replaceAll(`d`, `e`).replaceAll(`*^`, `e`)

// Number(token) that treats blank strings as NaN, not 0 like Number(``) does
export const parse_num_token = (token: string): number =>
  token.trim() === `` ? NaN : Number(token)

// Parse a line's first whitespace-separated token: tolerates trailing
// tokens/comments (`1.0 ! scale` -> 1.0) like parseFloat, blank lines are NaN
export const parse_leading_num = (line: string): number =>
  parse_num_token(line.trim().split(/\s+/)[0])

// Append `item`, or drop every copy of it when already present; keeps insertion order
export const toggle_item = <T>(items: readonly T[], item: T): T[] =>
  items.includes(item) ? items.filter((entry) => entry !== item) : [...items, item]

// First item whose key repeats an earlier one's (adding it leaves the Set's size unchanged)
export const first_duplicate = <Item>(
  items: readonly Item[],
  key_of: (item: Item) => unknown = (item) => item,
): Item | undefined => {
  const seen = new Set()
  return items.find((item) => seen.size === seen.add(key_of(item)).size)
}

// Plain loop, not Uint8Array.from(str, cb): the callback form walks the iterator protocol and
// measured 1058 ms against 35 ms on a 30 MB payload (every VS Code payload arrives base64)
export const base64_to_array_buffer = (base64: string): ArrayBuffer => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let idx = 0; idx < binary.length; idx++) bytes[idx] = binary.charCodeAt(idx)
  return bytes.buffer
}

// Decode a URL-safe base64 string (RFC 4648 §5) of UTF-8 text. atob alone yields one
// Latin-1 char per byte, which garbles any non-ASCII text. Undefined if decoding fails.
export function decode_url_safe_base64(encoded: string): string | undefined {
  const std_b64 = encoded.replaceAll(`-`, `+`).replaceAll(`_`, `/`)
  const padded = std_b64 + `=`.repeat((4 - (std_b64.length % 4)) % 4)
  try {
    const bytes = base64_to_array_buffer(padded)
    return new TextDecoder(`utf-8`, { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}
