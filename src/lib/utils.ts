// Object literals, JSON mappings and null-prototype records; class instances are leaves.
export const is_plain_object = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== `object` || value === null) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

// Clamp a number to the [0, 1] range.
export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

// A tag opens with a letter, `/` or `!`: a bare `<[^>]*>` ate the prose between a comparison
// pair, so `T < 300 K and P > 1 bar` read back as `T  1 bar`.
export const HTML_TAG_SRC = String.raw`<(?:/?[a-z]|!)[^>]*>`
const HTML_TAG_RE = new RegExp(HTML_TAG_SRC, `gi`)
// Tags only, entities kept: the result is still HTML, fit for {@html}. Plain-text sinks
// (attributes, text nodes, exports, matching, width estimates) want html_to_text below.
export const strip_html = (str: string): string => str.replaceAll(HTML_TAG_RE, ``)

export const HTML_ENTITY_SRC = String.raw`&(?:#(?<dec>\d+)|#x(?<hex>[\da-f]+)|(?<name>[a-z][\da-z]+));`
// Named entities common in scientific tables. A Map, so `&constructor;` can't resolve to an
// Object.prototype member.
// oxfmt-ignore
const NAMED_ENTITIES = new Map(Object.entries({
  amp: `&`, lt: `<`, gt: `>`, quot: `"`, apos: `'`, nbsp: `\u00A0`, thinsp: `\u2009`,
  ndash: `–`, mdash: `—`, hellip: `…`, minus: `−`, plusmn: `±`, times: `×`, middot: `·`,
  sdot: `⋅`, deg: `°`, prime: `′`, le: `≤`, ge: `≥`, ne: `≠`, asymp: `≈`, infin: `∞`,
  sup2: `²`, sup3: `³`, rarr: `→`, larr: `←`, micro: `µ`, angst: `Å`, Aring: `Å`, aring: `å`,
  Auml: `Ä`, auml: `ä`, Ouml: `Ö`, ouml: `ö`, Uuml: `Ü`, uuml: `ü`, eacute: `é`, egrave: `è`,
  ccedil: `ç`, ntilde: `ñ`, szlig: `ß`, sigmaf: `ς`,
}))
const GREEK_NAMES = `alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega`
for (const [idx, name] of GREEK_NAMES.split(` `).entries()) {
  const letter = `αβγδεζηθικλμνξοπρστυφχψω`[idx]
  NAMED_ENTITIES.set(name, letter)
  NAMED_ENTITIES.set(name[0].toUpperCase() + name.slice(1), letter.toUpperCase())
}
const decode_entity = (entity: string, dec?: string, hex?: string, name?: string): string => {
  if (name) return NAMED_ENTITIES.get(name) ?? entity
  const code = hex ? Number.parseInt(hex, 16) : Number(dec)
  return code <= 0x10ffff ? String.fromCodePoint(code) : entity
}
// Visible text of an HTML string without a DOM (SSR-safe). One left-to-right pass drops tags and
// decodes entities, so `&lt;b&gt;` reads as the literal text `<b>`, `&amp;lt;` as `&lt;`, and a
// tag can't splice an entity together (`&l<i></i>t;` stays `&lt;`, as a browser shows it).
// Unknown entity names stay as written.
const HTML_TEXT_RE = new RegExp(`${HTML_TAG_SRC}|${HTML_ENTITY_SRC}`, `gi`)
export const html_to_text = (str: string): string =>
  str.replaceAll(HTML_TEXT_RE, (match, dec?: string, hex?: string, name?: string) =>
    match.startsWith(`<`) ? `` : decode_entity(match, dec, hex, name),
  )

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
export function to_error(value: unknown): Error {
  try {
    if (value instanceof Error) return value
    return new Error(String(value), { cause: value })
  } catch {
    return new Error(`Thrown value cannot be converted to a string`, { cause: value })
  }
}

// Release the caller even when a frame reader or consumer ignores cancellation.
export async function abortable<Value>(
  task: () => Value | Promise<Value>,
  signal: AbortSignal,
): Promise<Value> {
  signal.throwIfAborted()
  const stopped = Promise.withResolvers<never>()
  const abort = () => stopped.reject(to_error(signal.reason))
  signal.addEventListener(`abort`, abort, { once: true })
  try {
    return await Promise.race([Promise.resolve().then(task), stopped.promise])
  } finally {
    signal.removeEventListener(`abort`, abort)
  }
}

export function make_change_detector(): (value: unknown) => boolean {
  const unset = Symbol(`unset`)
  let prev: unknown = unset
  return (value: unknown) => {
    const changed = prev !== unset && value !== prev
    prev = value
    return changed
  }
}

// First item whose key repeats an earlier item's key, for duplicate-input warnings
export function first_duplicate<Item>(
  items: Iterable<Item>,
  key_of: (item: Item) => unknown = (item) => item,
): Item | undefined {
  const seen = new Set()
  for (const item of items) {
    const key = key_of(item)
    if (seen.has(key)) return item
    seen.add(key)
  }
  return undefined
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
