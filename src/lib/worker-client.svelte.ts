// One persistent Web Worker per analysis module, with the request dedupe and teardown
// semantics they all need. Extracted after a fourth copy appeared: the three rules below
// were each learned from a bug, and keeping them in one place is the only way a fix reaches
// every caller. chempot-diagram's copy had drifted and was missing two of them.
//
// Wire protocol (worker side): every request arrives as `{ id, input, options }`. The worker
// replies with `{ id, result, error }` once, and may post any number of `{ id, progress }`
// messages before that for callers that passed `on_progress`.
import { to_error } from '$lib/utils'

interface WorkerClientConfig<Input, Options, Result> {
  // Names the module in error messages, e.g. `MSD`
  label: string
  // Must inline `new URL('./x-worker.js', import.meta.url)` at the call site: Vite detects
  // workers syntactically and cannot follow the URL through a variable.
  create_worker: () => Worker
  // SSR / no-Worker fallback, run on the main thread. Receives `undefined` when the caller
  // omitted options, exactly as the worker's compute does, so a defaulted `options = {}`
  // parameter serves both paths.
  compute_sync: (input: Input, options: Options | undefined) => Result
  // Plain, structured-cloneable stand-in for `input`. Svelte 5 $state proxies are not
  // cloneable, so callers rebuild field by field rather than deep-snapshotting - a proxied
  // typed array still reads back as its raw buffer, which keeps megabyte payloads cheap.
  build_payload: (input: Input) => unknown
  // Key requests by canonicalized payload + options, treating the top-level payload array
  // as a multiset. Nested arrays remain ordered.
  dedupe_by_payload?: `unordered`
}

export interface WorkerRequestOptions<Progress = unknown> {
  // Rejects this caller's promise with the signal's reason (an AbortError by default). The
  // worker itself is only torn down when no other caller still awaits a request on it, since
  // terminating it would lose their results too.
  signal?: AbortSignal
  // Receives every `{ id, progress }` message the worker posts for this request
  on_progress?: (progress: Progress) => void
  // Buffers inside the payload to move instead of copy. They are detached on the main
  // thread afterwards, so the caller must not read them again (nor rely on identity dedupe
  // re-posting the same input later).
  transfer?: Transferable[]
}

// The module's async entry point: modules export the client itself (e.g. `compute_vacf_async`)
// rather than wrapping it, so `.cancel` / `.release` travel with the function.
export type WorkerClient<Input, Options, Result, Progress = unknown> = {
  (
    input: Input,
    options?: Options,
    request_options?: WorkerRequestOptions<Progress>,
  ): Promise<Result>
  // Rejects every in-flight request and terminates the worker
  cancel: (reason?: string) => void
  // Terminates the worker only when nothing is in flight (a component's unmount path)
  release: () => void
}

export const abort_error = (signal: AbortSignal, label: string): Error =>
  signal.reason instanceof Error
    ? signal.reason
    : new DOMException(
        String(signal.reason ?? `${label} worker request aborted`),
        `AbortError`,
      )

export function create_worker_client<
  Input extends object,
  Options,
  Result,
  Progress = unknown,
>(
  config: WorkerClientConfig<Input, Options, Result>,
): WorkerClient<Input, Options, Result, Progress> {
  const {
    label,
    create_worker,
    compute_sync,
    build_payload,
    dedupe_by_payload = false,
  } = config

  interface Request {
    key: string
    // postMessage id; null for sync fallbacks, which never enter `pending`
    id: number | null
    promise: Promise<Result>
    resolve: (data: Result) => void
    reject: (err: Error) => void
    // Callers still awaiting this request; the last one to abort drops it
    waiters: number
    progress_listeners: Set<(progress: Progress) => void>
  }

  let worker: Worker | null = null
  let next_id = 0
  const pending = new Map<number, Request>()
  const pending_by_key = new Map<string, Request>()

  const terminate_worker = (): void => {
    worker?.terminate()
    worker = null
  }
  // Also the teardown path for worker `error`/`messageerror` events and id-less error replies
  const cancel = (reason = `${label} worker request cancelled`): void => {
    const error = new Error(reason)
    for (const request of pending_by_key.values()) request.reject(error)
    pending.clear()
    pending_by_key.clear()
    terminate_worker()
  }

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
  const request_key_of = (
    input: Input,
    options: Options | undefined,
    payload?: unknown,
  ): string => {
    const input_key = dedupe_by_payload
      ? payload_key_of(payload)
      : `input:${input_token(input)}`
    const options_key = canonical_key_of(options ?? {})
    return `${input_key.length}:${input_key}${options_key}`
  }

  // Forget a request once it settles. .then(onOk, onErr) rather than .finally: the latter
  // forwards the rejection into a derived promise nobody awaits, which surfaces as an
  // unhandled rejection
  const forget = (request: Request): void => {
    if (pending_by_key.get(request.key) === request) pending_by_key.delete(request.key)
    if (request.id !== null && pending.get(request.id) === request) pending.delete(request.id)
  }
  const track = (key: string, id: number | null): Request => {
    const request: Request = {
      key,
      id,
      ...Promise.withResolvers<Result>(),
      waiters: 0,
      progress_listeners: new Set(),
    }
    request.promise.then(
      () => forget(request),
      () => forget(request),
    )
    pending_by_key.set(key, request)
    if (id !== null) pending.set(id, request)
    return request
  }

  // Terminate the worker unless it still has requests in flight (a component's unmount path,
  // which must not reject requests other mounted components of the same module still await)
  const release = (): void => {
    if (pending.size === 0) terminate_worker()
  }
  // Stop caring about a request nobody awaits anymore. Only reachable from an abort, so the
  // dropped request is still executing inside the worker: terminating at once frees the CPU
  // it was burning (an idle-timer variant left every follow-up request queued behind the
  // abandoned compute - N keystrokes over an 8 s VACF meant N serial 8 s waits). The
  // replacement is constructed immediately so its module graph loads while the user types.
  const drop = (request: Request): void => {
    forget(request)
    // Another request is still in flight on this worker; terminating it would lose that
    // result, so the abandoned compute is left to finish on its own
    if (pending.size > 0) return
    terminate_worker()
    ensure_worker()
  }

  // Hand one caller a view of a (possibly shared) request that honours its own signal and
  // progress callback without affecting the other callers
  const join = (
    request: Request,
    { signal, on_progress }: WorkerRequestOptions<Progress>,
  ): Promise<Result> => {
    request.waiters++
    if (on_progress) request.progress_listeners.add(on_progress)
    if (!signal) return request.promise
    const leave = () => {
      if (on_progress) request.progress_listeners.delete(on_progress)
      if (--request.waiters === 0) drop(request)
    }
    const { promise, resolve, reject } = Promise.withResolvers<Result>()
    const on_abort = () => {
      leave()
      reject(abort_error(signal, label))
    }
    signal.addEventListener(`abort`, on_abort, { once: true })
    // Once settled, a late abort must not run `leave` (it would drop a finished request)
    void request.promise
      .then(resolve, reject)
      .then(() => signal.removeEventListener(`abort`, on_abort))
    return promise
  }

  // Set when the constructor itself throws (CSP, a cross-origin script URL, or a host that
  // inlined the bundle so `new URL(..., import.meta.url)` has no usable base): the module
  // then computes on the main thread like an environment without Worker at all.
  let worker_unusable = false
  // Construct the worker (if none is alive) and wire its listeners. Shared by the request
  // path and by `drop`, which pre-warms the replacement for the next request.
  function ensure_worker(): Worker | null {
    if (typeof Worker === `undefined` || worker_unusable) return null
    if (worker) return worker
    try {
      worker = create_worker()
    } catch (error) {
      worker_unusable = true
      console.warn(
        `${label} worker could not be constructed; computing on the main thread:`,
        error,
      )
      return null
    }
    worker.addEventListener(`message`, ({ data: { id, result, error, progress } }) => {
      // serve_worker's own `messageerror` reply: the request that failed to deserialize
      // on the worker side has no id, so nothing can be settled individually
      if (id === null) {
        cancel(error ?? `${label} worker reported an error with no request id`)
        return
      }
      const request = pending.get(id)
      if (!request) return
      if (progress !== undefined) {
        for (const listener of request.progress_listeners) listener(progress)
        return
      }
      pending.delete(id)
      if (error || result === undefined) {
        request.reject(
          new Error(error ?? `${label} worker returned no result for request ${id}`),
        )
      } else request.resolve(result)
    })
    // Both handlers must tear the worker down: an unsettled `pending` entry leaves every
    // caller awaiting forever, and its key stays in `pending_by_key` so each identical
    // retry is handed the same promise that will never settle.
    worker.addEventListener(`error`, (event) => {
      event.preventDefault()
      cancel(event.message || `${label} worker initialization error`)
    })
    // A response that fails to deserialize never reaches the `message` handler
    worker.addEventListener(`messageerror`, () => {
      cancel(`${label} worker sent a message that could not be deserialized`)
    })
    return worker
  }

  const compute_unsafe = (
    input: Input,
    options: Options | undefined,
    request_options: WorkerRequestOptions<Progress>,
  ): Promise<Result> => {
    const { signal } = request_options
    if (signal?.aborted) return Promise.reject(abort_error(signal, label))
    // Content-keyed clients build once before the lookup and reuse that same snapshot for
    // postMessage. Identity-keyed clients defer payload construction until a cache miss.
    const keyed_payload = dedupe_by_payload ? build_payload(input) : undefined
    const request_key = request_key_of(input, options, keyed_payload)
    const existing = pending_by_key.get(request_key)
    if (existing) return join(existing, request_options)

    const wkr = ensure_worker()
    if (!wkr) {
      const request = track(request_key, null)
      Promise.resolve()
        .then(() => compute_sync(input, options))
        .then(request.resolve, (err: unknown) => request.reject(to_error(err)))
      return join(request, request_options)
    }

    const payload = dedupe_by_payload ? keyed_payload : build_payload(input)
    const id = ++next_id
    const request = track(request_key, id)
    try {
      // Empty transfer list by default: callers keep ownership of typed-array buffers
      // (dedupe reuses the same input). Transferring would detach them.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      wkr.postMessage(
        { id, input: payload, options: $state.snapshot(options) },
        request_options.transfer ?? [],
      )
    } catch (err) {
      request.reject(to_error(err))
    }
    return join(request, request_options)
  }

  // Never throw synchronously: callers handle errors via .catch() only, so key construction
  // or Worker instantiation failures (e.g. CSP) must reject instead
  const client = (
    input: Input,
    options?: Options,
    request_options: WorkerRequestOptions<Progress> = {},
  ): Promise<Result> => {
    try {
      return compute_unsafe(input, options, request_options)
    } catch (err) {
      return Promise.reject(to_error(err))
    }
  }
  client.cancel = cancel
  client.release = release
  return client
}
