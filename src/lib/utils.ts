// Loose: any non-null non-array object, so Date/Map/RegExp/typed arrays pass (what the
// JSON-validation callers want). Use is_plain_record where a class instance is a leaf.
export const is_plain_object = (val: unknown): val is Record<string, unknown> =>
  typeof val === `object` && val !== null && !Array.isArray(val)

// Strict: object literals, JSON.parse output and null-prototype objects only
export const is_plain_record = (val: unknown): val is Record<string, unknown> => {
  if (typeof val !== `object` || val === null) return false
  const proto: unknown = Object.getPrototypeOf(val)
  return proto === Object.prototype || proto === null
}

// Clamp a number to the [0, 1] range.
export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

// A tag opens with a letter, `/` or `!`: a bare `<[^>]*>` ate the prose between a comparison
// pair, so `T < 300 K and P > 1 bar` read back as `T  1 bar`.
export const HTML_TAG_SRC = String.raw`<(?:/?[a-z]|!)[^>]*>`
const HTML_TAG_RE = new RegExp(HTML_TAG_SRC, `gi`)
export const strip_html = (str: string): string => str.replaceAll(HTML_TAG_RE, ``)

// Escape HTML special characters to prevent XSS attacks
export const escape_html = (unsafe_string: string): string =>
  unsafe_string
    .replaceAll(`&`, `&amp;`)
    .replaceAll(`<`, `&lt;`)
    .replaceAll(`>`, `&gt;`)
    .replaceAll(`"`, `&quot;`)
    .replaceAll(`'`, `&#39;`)

// Normalize unicode minus (U+2212) to ASCII hyphen-minus.
export const normalize_unicode_minus = (value: string): string => value.replaceAll('−', `-`)

// Normalize scientific notation variants (d/D exponent, Mathematica *^).
export const normalize_scientific_notation = (value: string): string =>
  normalize_unicode_minus(value).toLowerCase().replaceAll('d', `e`).replaceAll('*^', `e`)

// Number(token) that treats blank strings as NaN, not 0 like Number(``) does
export const parse_num_token = (token: string): number =>
  token.trim() === `` ? NaN : Number(token)

// Parse a line's first whitespace-separated token: tolerates trailing
// tokens/comments (`1.0 ! scale` -> 1.0) like parseFloat, blank lines are NaN
export const parse_leading_num = (line: string): number =>
  parse_num_token(line.trim().split(/\s+/)[0])

// Coerce an unknown thrown value into an Error (for typed Promise rejections / error callbacks).
export const to_error = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value))

export function make_change_detector(): (value: unknown) => boolean {
  const unset = Symbol(`unset`)
  let prev: unknown = unset
  return (value: unknown) => {
    const changed = prev !== unset && value !== prev
    prev = value
    return changed
  }
}

// Decode a URL-safe base64 string (RFC 4648 §5) to its original text.
// Converts `-` → `+`, `_` → `/`, restores padding, then decodes.
// Returns undefined if decoding fails.
export function decode_url_safe_base64(encoded: string): string | undefined {
  const std_b64 = encoded.replaceAll('-', `+`).replaceAll('_', `/`)
  const padded = std_b64 + `=`.repeat((4 - (std_b64.length % 4)) % 4)
  try {
    return atob(padded)
  } catch {
    return undefined
  }
}

// Viewer keyboard convention: a handler returns `true` when it handled the event, so
// handle_and_prevent can suppress the browser default (page scroll, find, ...) in one place
// instead of scattered preventDefault() calls in every `onkeydown` binding.
type KeydownHandler = (event: KeyboardEvent) => boolean

export const handle_and_prevent =
  (handle: KeydownHandler) =>
  (event: KeyboardEvent): void => {
    if (handle(event)) event.preventDefault()
  }
