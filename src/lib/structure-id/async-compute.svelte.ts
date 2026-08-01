// Async wrapper for calc_structure_id via a persistent Web Worker.
// Falls back to synchronous main-thread computation during SSR / where Worker is missing.
import type { AnyStructure } from '$lib/structure'
import { to_error } from '$lib/utils'
import { calc_structure_id } from './calc-structure-id'
import type { StructureIdOptions, StructureIdResult } from './index'

let worker: Worker | null = null
let next_id = 0
const pending = new Map<
  number,
  { resolve: (data: StructureIdResult) => void; reject: (err: Error) => void }
>()
const pending_by_key = new Map<string, Promise<StructureIdResult>>()

// Serializing a 100k-site structure to build a request key would cost more than the analysis,
// so identity tokens stand in for the structure contents.
let next_input_token = 0
const input_tokens = new WeakMap<AnyStructure, number>()

function input_token(structure: AnyStructure): number {
  const existing = input_tokens.get(structure)
  if (existing !== undefined) return existing
  const token = ++next_input_token
  input_tokens.set(structure, token)
  return token
}

function track_pending(
  request_key: string,
  promise: Promise<StructureIdResult>,
): Promise<StructureIdResult> {
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
    worker = new Worker(new URL(`./structure-id-worker.js`, import.meta.url), {
      type: `module`,
    })
    worker.addEventListener(`message`, ({ data: { id, result, error } }) => {
      const req = pending.get(id)
      if (!req) return
      pending.delete(id)
      if (error || !result) {
        req.reject(new Error(error ?? `structure-id worker returned null`))
      } else req.resolve(result)
    })
    // Both handlers must tear the worker down: leaving `pending` entries unsettled would hang
    // every caller on `loading` forever and poison the dedupe key for good.
    const fail_all = (message: string) => {
      const err = new Error(message)
      for (const req of pending.values()) req.reject(err)
      pending.clear()
      worker?.terminate()
      worker = null
    }
    worker.addEventListener(`error`, (event) => {
      event.preventDefault()
      fail_all(event.message || `structure-id worker initialization error`)
    })
    // A response that fails to deserialize never reaches the `message` handler
    worker.addEventListener(`messageerror`, () => {
      fail_all(`structure-id worker sent a message that could not be deserialized`)
    })
  }
  return worker
}

export function compute_structure_id_async(
  structure: AnyStructure,
  options: StructureIdOptions = {},
): Promise<StructureIdResult> {
  // Never throw synchronously: callers handle errors via .catch() only, so key construction
  // or Worker instantiation failures (e.g. CSP headers) must reject instead
  try {
    return compute_structure_id_async_unsafe(structure, options)
  } catch (err) {
    return Promise.reject(to_error(err))
  }
}

function compute_structure_id_async_unsafe(
  structure: AnyStructure,
  options: StructureIdOptions,
): Promise<StructureIdResult> {
  const request_key = `${input_token(structure)}|${JSON.stringify(options)}`
  const existing = pending_by_key.get(request_key)
  if (existing) return existing

  const wkr = get_worker()
  // SSR / no-Worker fallback: run synchronously (wrapped so throws become rejections)
  if (!wkr) {
    return track_pending(
      request_key,
      Promise.resolve().then(() => calc_structure_id(structure, options)),
    )
  }

  // Svelte 5 $state proxies are not structured-cloneable, and unlike MSD's flat position buffer
  // a structure is a deep object graph, so the whole thing has to be snapshotted. Only the two
  // fields the analysis reads are carried across: sites (xyz + properties) and the lattice.
  const payload = {
    sites: structure.sites.map(({ xyz, abc, species, label }) => ({
      xyz: $state.snapshot(xyz),
      abc: $state.snapshot(abc),
      species: $state.snapshot(species),
      label,
      // Dropped on purpose: properties can hold arbitrary non-cloneable values (functions,
      // DOM nodes) and nothing in the analysis reads them.
      properties: {},
    })),
    ...(`lattice` in structure ? { lattice: $state.snapshot(structure.lattice) } : {}),
  }

  const promise = new Promise<StructureIdResult>((resolve, reject) => {
    const id = ++next_id
    pending.set(id, { resolve, reject })
    try {
      const message = { id, structure: payload, options: $state.snapshot(options) }
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      wkr.postMessage(message, [])
    } catch (err) {
      pending.delete(id)
      reject(to_error(err))
    }
  })
  return track_pending(request_key, promise)
}
