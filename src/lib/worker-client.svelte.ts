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
}

export function create_worker_client<Input extends object, Options, Result>(
  config: WorkerClientConfig<Input, Options, Result>,
): (input: Input, options: Options) => Promise<Result> {
  const { label, create_worker, compute_sync, build_payload } = config

  let worker: Worker | null = null
  let next_id = 0
  const pending = new Map<
    number,
    { resolve: (data: Result) => void; reject: (err: Error) => void }
  >()
  const pending_by_key = new Map<string, Promise<Result>>()

  let next_input_token = 0
  const input_tokens = new WeakMap<Input, number>()
  const input_token = (input: Input): number => {
    const existing = input_tokens.get(input)
    if (existing !== undefined) return existing
    const token = ++next_input_token
    input_tokens.set(input, token)
    return token
  }

  // Identity for the input, canonical JSON for the options. Hashing megabytes of positions
  // would cost more than the compute, so identity stands in for contents. A content hash is
  // not a safe substitute: chempot briefly keyed on a thermodynamic fingerprint that omitted
  // name and entry_id, so two runs differing only in labels shared a promise and the second
  // caller got the first one's entries back in min_entries and el_refs.
  // Keys are sorted at every depth, since nested option objects (msd's `fit`, vacf's `vdos`)
  // would otherwise make {a, b} and {b, a} two different requests.
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value === null || typeof value !== `object`) return value
    return Object.entries(value as Record<string, unknown>)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, val]) => [key, canonical(val)])
  }
  const request_key_of = (input: Input, options: Options): string =>
    `${input_token(input)}|${JSON.stringify(canonical(options ?? {}))}`

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
        if (error || result == null) {
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
    const request_key = request_key_of(input, options)
    const existing = pending_by_key.get(request_key)
    if (existing) return existing

    const wkr = get_worker()
    if (!wkr) {
      return track_pending(
        request_key,
        Promise.resolve().then(() => compute_sync(input, options)),
      )
    }

    const payload = build_payload(input)
    const promise = new Promise<Result>((resolve, reject) => {
      const id = ++next_id
      pending.set(id, { resolve, reject })
      try {
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
