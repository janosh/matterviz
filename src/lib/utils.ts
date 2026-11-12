import { to_error } from 'svelte-widgets/utils'

// Object literals, JSON mappings and null-prototype records; class instances are leaves.
export const is_plain_object = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== `object` || value === null) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

// Deep copy of the arrays and plain objects in `value`, the only things Svelte proxies (typed
// arrays, maps and class instances are kept as they are). $state.snapshot does the same but
// passes every number through structuredClone, which tripled the copy of 100k sites.
export const plain_copy = <Value>(value: Value): Value => {
  if (typeof value !== `object` || value === null) return value
  if (Array.isArray(value)) {
    const copy: unknown[] = Array(value.length)
    for (let idx = 0; idx < value.length; idx++) copy[idx] = plain_copy(value[idx])
    return copy as Value
  }
  if (!is_plain_object(value)) return value
  const copy: Record<string, unknown> = {}
  // Not Object.keys: it runs a proxy's getOwnPropertyDescriptor trap per key (~11% slower)
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === `string`) copy[key] = plain_copy(Reflect.get(value, key))
  }
  return copy as Value
}

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

// Tag-stripping, entity-decoding plain text of HTML (SSR-safe), shared with svelte-widgets
export { html_to_text } from 'svelte-widgets/utils'

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

// Tokens for values a key can't spell out (Maps, class instances, functions): those compare by
// identity, where JSON wrote a Map as {} and a function not at all
const identity_tokens = new WeakMap<object, number>()
let next_identity_token = 0
export const identity_token = (value: object): number => {
  let token = identity_tokens.get(value)
  if (token === undefined) identity_tokens.set(value, (token = ++next_identity_token))
  return token
}

// A value's identity for caches, change checks and worker-request dedupe: plain objects (keys
// sorted, undefined entries dropped like unset ones) and arrays by content, primitives tagged
// with their type, so 1 and "1", 0 and -0, and Infinity, NaN and null all differ (JSON.stringify
// writes the last three alike, which merged an unlimited option with an unset one), and
// anything else by identity. reject_functions throws on functions (no worker can receive
// them); symbols always throw.
export function value_key(value: unknown, reject_functions = false): string {
  const seen = new WeakMap<object, number>()
  let next_reference = 0
  const encode = (item: unknown): unknown[] => {
    if (item === null || item === undefined) return [String(item)]
    if (
      typeof item === `number` ||
      typeof item === `string` ||
      typeof item === `boolean` ||
      typeof item === `bigint`
    )
      return [typeof item, Object.is(item, -0) ? `-0` : String(item)]
    if (typeof item === `symbol` || (reject_functions && typeof item === `function`))
      throw new TypeError(`cannot contain ${typeof item} values`)
    const reference = seen.get(item)
    if (reference !== undefined) return [`reference`, reference]
    seen.set(item, next_reference++)
    if (Array.isArray(item))
      return [
        `array`,
        Array.from({ length: item.length }, (_unused, idx) =>
          Object.hasOwn(item, idx) ? encode(item[idx]) : [`hole`],
        ),
      ]
    if (is_plain_object(item))
      return [
        `object`,
        Object.entries(item)
          .filter(([, entry]) => entry !== undefined)
          .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, entry]) => [key, encode(entry)]),
      ]
    return [`identity`, Object.prototype.toString.call(item), identity_token(item)]
  }
  return JSON.stringify(encode(value))
}

// Keeps returning the first of a run of value-equal arguments (by value_key), so a caller that
// rebuilds an equal options object on every read hands its consumers one identity
export function same_while_equal<T>(): (value: T) => T {
  let last: { key: string; value: T } | undefined
  return (value) => {
    const key = value_key(value)
    if (last?.key !== key) last = { key, value }
    return last.value
  }
}

// Memo of a computation per input object and options key: the latest result is kept with
// the object (a WeakMap, so it goes when the object does) and reused while `key` repeats, so
// a list analysed entry by entry recomputes only its new members. By identity: an object
// edited in place keeps its stale result, pass a new one. A rejected promise is not kept.
export function memo_by_identity<Result>(): (
  target: object,
  key: string,
  compute: () => Result,
) => Result {
  const cache = new WeakMap<object, { key: string; result: Result }>()
  return (target, key, compute) => {
    const cached = cache.get(target)
    if (cached?.key === key) return cached.result
    const result = compute()
    cache.set(target, { key, result })
    if (result instanceof Promise) {
      result.catch(() => {
        if (cache.get(target)?.result === result) cache.delete(target)
      })
    }
    return result
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
