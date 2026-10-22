import { HTML_TAG_SRC, to_error } from 'svelte-widgets/utils'

// Object literals, JSON mappings and null-prototype records; class instances are leaves.
export const is_plain_object = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== `object` || value === null) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

// Clamp a number to the [0, 1] range.
export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

export const HTML_ENTITY_SRC = String.raw`&(?:#(?<dec>\d+)|#x(?<hex>[\da-f]+)|(?<name>[a-z][\da-z]+));`
// Named entities common in science; a Map, so `&constructor;` can't hit Object.prototype
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
// Visible text of an HTML string without a DOM (SSR-safe). One pass drops tags and decodes
// entities, so `&amp;lt;` reads `&lt;` and `&l<i></i>t;` stays `&lt;` as in a browser. Unknown
// entities stay as written. NUL, surrogate and > U+10FFFF references read U+FFFD as in a browser,
// but &#128;-&#159; stay C1 controls (browsers remap those to Windows-1252: &#128; reads €).
const HTML_TEXT_RE = new RegExp(`${HTML_TAG_SRC}|${HTML_ENTITY_SRC}`, `gi`)
export const html_to_text = (str: string): string =>
  str.replaceAll(HTML_TEXT_RE, (match, dec?: string, hex?: string, name?: string) => {
    if (match.startsWith(`<`)) return ``
    if (name) return NAMED_ENTITIES.get(name) ?? match
    const code = hex ? Number.parseInt(hex, 16) : Number(dec)
    const invalid = code === 0 || (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff
    return invalid ? `\uFFFD` : String.fromCodePoint(code)
  })

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

// Yield one event-loop turn via a message task: setTimeout(0) is clamped to 4 ms once timers
// nest, which in a long chunked scan leaves the main thread idle for much of its budget.
export const yield_turn = (): Promise<void> =>
  new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel()
    port1.addEventListener(`message`, () => {
      port1.close() // closing one end closes the channel
      resolve()
    })
    port1.start() // addEventListener (unlike onmessage) does not start the port
    port2.postMessage(null)
  })

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

// Feature props come as `true` (enable with defaults), an object (override them) or off (null)
export const with_defaults = <Defaults extends object, Config extends object>(
  option: boolean | Config | undefined,
  defaults: Defaults,
): (Defaults & Config) | null =>
  option
    ? ({ ...defaults, ...(typeof option === `object` ? option : {}) } as Defaults & Config)
    : null
