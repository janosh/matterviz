// Async wrapper for calc_vacf via a persistent Web Worker.
// Falls back to synchronous main-thread computation during SSR / where Worker is missing.
import { to_error } from '$lib/utils'
import { calc_vacf } from './calc-vacf'
import type { VacfInput, VacfOptions, VacfResult } from './index'

let worker: Worker | null = null
let next_id = 0
const pending = new Map<
  number,
  { resolve: (data: VacfResult) => void; reject: (err: Error) => void }
>()
const pending_by_key = new Map<string, Promise<VacfResult>>()

// Hashing megabytes of positions to build a request key would cost more than the compute,
// so identity tokens stand in for the buffer contents.
let next_input_token = 0
const input_tokens = new WeakMap<VacfInput, number>()

function input_token(input: VacfInput): number {
  const existing = input_tokens.get(input)
  if (existing !== undefined) return existing
  const token = ++next_input_token
  input_tokens.set(input, token)
  return token
}

function track_pending(
  request_key: string,
  promise: Promise<VacfResult>,
): Promise<VacfResult> {
  pending_by_key.set(request_key, promise)
  // .then(onOk, onErr) rather than .finally: the latter forwards the rejection into a
  // derived promise nobody awaits, which surfaces as an unhandled rejection
  const forget = () => pending_by_key.delete(request_key)
  promise.then(forget, forget)
  return promise
}

function get_worker(): Worker | null {
  if (typeof Worker === `undefined`) return null
  if (!worker) {
    // oxlint-disable-next-line eslint-plugin-unicorn/relative-url-style -- Vite worker detection requires the `./` prefix
    worker = new Worker(new URL(`./vacf-worker.js`, import.meta.url), { type: `module` })
    worker.addEventListener(`message`, ({ data: { id, result, error } }) => {
      const req = pending.get(id)
      if (!req) return
      pending.delete(id)
      if (error || !result) req.reject(new Error(error ?? `VACF worker returned null`))
      else req.resolve(result)
    })
    // Both handlers must tear the worker down: leaving `pending` entries unsettled would
    // hang every VacfPlot on `loading` forever and poison the dedupe key for good.
    const fail_all = (message: string) => {
      const err = new Error(message)
      for (const req of pending.values()) req.reject(err)
      pending.clear()
      worker?.terminate()
      worker = null
    }
    worker.addEventListener(`error`, (event) => {
      event.preventDefault()
      fail_all(event.message || `VACF worker initialization error`)
    })
    // A response that fails to deserialize never reaches the `message` handler
    worker.addEventListener(`messageerror`, () => {
      fail_all(`VACF worker sent a message that could not be deserialized`)
    })
  }
  return worker
}

export function compute_vacf_async(
  input: VacfInput,
  options: VacfOptions = {},
): Promise<VacfResult> {
  // Never throw synchronously: callers handle errors via .catch() only, so key
  // construction or Worker instantiation failures (e.g. CSP) must reject instead
  try {
    return compute_vacf_async_unsafe(input, options)
  } catch (err) {
    return Promise.reject(to_error(err))
  }
}

function compute_vacf_async_unsafe(
  input: VacfInput,
  options: VacfOptions,
): Promise<VacfResult> {
  const request_key = `${input_token(input)}|${JSON.stringify(options)}`
  const existing = pending_by_key.get(request_key)
  if (existing) return existing

  const wkr = get_worker()
  // SSR / no-Worker fallback: run synchronously (wrapped so throws become rejections)
  if (!wkr) {
    return track_pending(
      request_key,
      Promise.resolve().then(() => calc_vacf(input, options)),
    )
  }

  // Rebuild a plain payload field by field: Svelte 5 $state proxies are not
  // structured-cloneable, but a proxied Float64Array field still reads back as the raw
  // buffer, so this avoids snapshotting (i.e. copying) megabytes of positions.
  const payload: VacfInput = {
    positions: input.positions,
    velocities: input.velocities ?? null,
    velocity_unit: input.velocity_unit ?? null,
    n_frames: input.n_frames,
    n_atoms: input.n_atoms,
    coords_unwrapped: input.coords_unwrapped,
    frame_stride: input.frame_stride,
    elements: $state.snapshot(input.elements),
    lattice_matrices: $state.snapshot(input.lattice_matrices),
    pbc: $state.snapshot(input.pbc),
    steps: $state.snapshot(input.steps),
  }

  const promise = new Promise<VacfResult>((resolve, reject) => {
    const id = ++next_id
    pending.set(id, { resolve, reject })
    try {
      const message = { id, input: payload, options: $state.snapshot(options) }
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      wkr.postMessage(message, [])
    } catch (err) {
      pending.delete(id)
      reject(to_error(err))
    }
  })
  return track_pending(request_key, promise)
}
