// One persistent Web Worker per analysis module, with the request dedupe and teardown
// semantics they all need. Extracted after a fourth copy appeared: the three rules below
// were each learned from a bug, and keeping them in one place is the only way a fix reaches
// every caller. chempot-diagram's copy had drifted and was missing two of them.
import { to_error } from '$lib/utils'

export interface WorkerClientConfig<Input, Options, Result> {
  // Names the module in error messages, e.g. `MSD`
  label: string
  // Must inline `new URL('./x-worker.js', import.meta.url)` at the call site: Vite detects
  // workers syntactically and cannot follow the URL through a variable.
  create_worker: () => Worker
  // SSR / no-Worker fallback, run on the main thread
  compute_sync: (input: Input, options: Options) => Result
  // Plain, structured-cloneable stand-in for `input`. Svelte 5 $state proxies are not
  // cloneable, so callers rebuild field by field rather than deep-snapshotting - a proxied
  // typed array still reads back as its raw buffer, which keeps megabyte payloads cheap.
  build_payload: (input: Input) => unknown
  // Key requests by canonicalized payload + options, treating the top-level payload array
  // as a multiset. Nested arrays remain ordered.
  dedupe_by_payload?: `unordered`
}

export function create_worker_client<Input extends object, Options, Result>(
  config: WorkerClientConfig<Input, Options, Result>,
): (input: Input, options: Options) => Promise<Result> {
  const {
    label,
    create_worker,
    compute_sync,
    build_payload,
    dedupe_by_payload = false,
  } = config

  let worker: Worker | null = null
  let next_id = 0
  const pending = new Map<
    number,
    { resolve: (data: Result) => void; reject: (err: Error) => void }
  >()
  const pending_by_key = new Map<string, Promise<Result>>()

  const make_tokenizer = () => {
    let next_token = 0
    const tokens = new WeakMap<object, number>()
    return (value: object): number => {
      const existing = tokens.get(value)
      if (existing !== undefined) return existing
      tokens.set(value, ++next_token)
      return next_token
    }
  }
  const input_token = make_tokenizer()
  const non_plain_token = make_tokenizer()

  // Identity for the input, canonical serialization for the options. Hashing megabytes of positions
  // would cost more than the compute, so identity stands in for contents. A content hash is
  // not a safe substitute: chempot briefly keyed on a thermodynamic fingerprint that omitted
  // name and entry_id, so two runs differing only in labels shared a promise and the second
  // caller got the first one's entries back in min_entries and el_refs.
  // Plain-object keys are sorted at every depth and arrays retain order. Non-plain values
  // use identity: no current worker option schema needs value semantics for them.
  const canonical_key_of = (value: unknown): string => {
    const seen = new WeakMap<object, number>()
    let next_reference = 0
    const encode = (item: unknown): unknown => {
      if (item === null || item === undefined) return [String(item)]
      if (typeof item === `number`) {
        return [`number`, Object.is(item, -0) ? `-0` : String(item)]
      }
      if (typeof item === `string` || typeof item === `boolean` || typeof item === `bigint`) {
        return [typeof item, String(item)]
      }
      if (typeof item !== `object`) {
        throw new TypeError(`${label} worker options cannot contain ${typeof item} values`)
      }

      const existing_reference = seen.get(item)
      if (existing_reference !== undefined) return [`reference`, existing_reference]
      seen.set(item, next_reference++)

      if (Array.isArray(item)) {
        return [
          `array`,
          Array.from({ length: item.length }, (_unused, idx) =>
            Object.hasOwn(item, idx) ? encode(item[idx]) : [`hole`],
          ),
        ]
      }

      const prototype = Object.getPrototypeOf(item)
      if (prototype === Object.prototype || prototype === null) {
        return [
          `object`,
          Object.entries(item)
            .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
            .map(([key, entry_value]) => [key, encode(entry_value)]),
        ]
      }

      return [`identity`, Object.prototype.toString.call(item), non_plain_token(item)]
    }
    const key = JSON.stringify(encode(value))
    if (key === undefined) throw new TypeError(`${label} worker could not key its request`)
    return key
  }
  const payload_key_of = (payload: unknown): string => {
    if (!Array.isArray(payload)) {
      throw new TypeError(`${label} worker unordered payload dedupe requires an array payload`)
    }
    const item_keys = Array.from({ length: payload.length }, (_unused, idx) =>
      Object.hasOwn(payload, idx) ? canonical_key_of(payload[idx]) : `hole`,
    )
    return JSON.stringify(item_keys.toSorted())
  }
  const request_key_of = (input: Input, options: Options, payload?: unknown): string => {
    const input_key = dedupe_by_payload
      ? payload_key_of(payload)
      : `input:${input_token(input)}`
    const options_key = canonical_key_of(options ?? {})
    return `${input_key.length}:${input_key}${options_key}`
  }

  const track_pending = (request_key: string, promise: Promise<Result>): Promise<Result> => {
    pending_by_key.set(request_key, promise)
    // .then(onOk, onErr) rather than .finally: the latter forwards the rejection into a
    // derived promise nobody awaits, which surfaces as an unhandled rejection
    const forget = () => pending_by_key.delete(request_key)
    promise.then(forget, forget)
    return promise
  }

  const get_worker = (): Worker | null => {
    if (typeof Worker === `undefined`) return null
    if (!worker) {
      worker = create_worker()
      worker.addEventListener(`message`, ({ data: { id, result, error } }) => {
        const req = pending.get(id)
        if (!req) return
        pending.delete(id)
        if (error || result === undefined) {
          req.reject(
            new Error(error ?? `${label} worker returned no result for request ${id}`),
          )
        } else req.resolve(result)
      })
      // Both handlers must tear the worker down: an unsettled `pending` entry leaves every
      // caller awaiting forever, and its key stays in `pending_by_key` so each identical
      // retry is handed the same promise that will never settle.
      const fail_all = (message: string) => {
        const err = new Error(message)
        for (const req of pending.values()) req.reject(err)
        pending.clear()
        worker?.terminate()
        worker = null
      }
      worker.addEventListener(`error`, (event) => {
        event.preventDefault()
        fail_all(event.message || `${label} worker initialization error`)
      })
      // A response that fails to deserialize never reaches the `message` handler
      worker.addEventListener(`messageerror`, () => {
        fail_all(`${label} worker sent a message that could not be deserialized`)
      })
    }
    return worker
  }

  const compute_unsafe = (input: Input, options: Options): Promise<Result> => {
    // Content-keyed clients build once before the lookup and reuse that same snapshot for
    // postMessage. Identity-keyed clients defer payload construction until a cache miss.
    const keyed_payload = dedupe_by_payload ? build_payload(input) : undefined
    const request_key = request_key_of(input, options, keyed_payload)
    const existing = pending_by_key.get(request_key)
    if (existing) return existing

    const wkr = get_worker()
    if (!wkr) {
      return track_pending(
        request_key,
        Promise.resolve().then(() => compute_sync(input, options)),
      )
    }

    const payload = dedupe_by_payload ? keyed_payload : build_payload(input)
    const promise = new Promise<Result>((resolve, reject) => {
      const id = ++next_id
      pending.set(id, { resolve, reject })
      try {
        // Empty transfer list on purpose: callers keep ownership of typed-array buffers
        // (dedupe reuses the same input). Transferring would detach them.
        // oxlint-disable-next-line unicorn/require-post-message-target-origin
        wkr.postMessage({ id, input: payload, options: $state.snapshot(options) }, [])
      } catch (err) {
        pending.delete(id)
        reject(to_error(err))
      }
    })
    return track_pending(request_key, promise)
  }

  // Never throw synchronously: callers handle errors via .catch() only, so key construction
  // or Worker instantiation failures (e.g. CSP) must reject instead
  return (input: Input, options: Options): Promise<Result> => {
    try {
      return compute_unsafe(input, options)
    } catch (err) {
      return Promise.reject(to_error(err))
    }
  }
}
