import { to_error } from '$lib/utils'
import type { FileLoadMeta } from './types'
import { basename_from_url, load_from_url } from './url-drop'

// Everything an `on_load` callback needs to commit a fetched payload safely.
export interface DataUrlLoadContext<Value> {
  content: string | ArrayBuffer
  filename: string
  metadata: FileLoadMeta
  // False once a newer request (or the effect teardown) has superseded this one. Must be
  // re-checked after every await: a slow fetch must not clobber a newer one's result.
  is_current: () => boolean
  // Record that this URL produced `value`. Later requests treat that exact value as
  // URL-owned rather than caller-supplied, and the URL is not fetched again while it
  // stays loaded. Call with no argument when a host handler consumed the payload and
  // there is no value to attribute.
  mark_owned: (value?: Value) => void
}

export interface DataUrlRequest<Value> {
  url: string | undefined
  // The value the component currently holds, whatever its source. When it is not the one
  // this loader produced, the caller owns it and the URL is left alone. Omit to skip the
  // ownership check entirely (viewers whose value can only come from the URL).
  current_value?: Value
  // Further reason to not fetch, e.g. a sibling prop already supplied the data.
  skip?: boolean
  set_loading: (loading: boolean) => void
  clear_error: () => void
  // Awaited before loading is cleared, so a streaming parse keeps the spinner up
  on_load: (ctx: DataUrlLoadContext<Value>) => unknown
  // Transport failures only. Parse failures belong to on_load, which owns their wording
  // and decides whether to mark_owned.
  on_error: (error: Error, filename: string) => void
}

export interface DataUrlLoader<Value> {
  // Run inside an $effect and return its result as the teardown, so a URL change,
  // an incoming caller value or unmount invalidates whatever is in flight.
  request: (req: DataUrlRequest<Value>) => () => void
  // URL whose payload is currently loaded, if any. Plain state, not reactive.
  readonly loaded_url: string | undefined
  // Value this loader produced from `loaded_url`, if any. Plain state, not reactive.
  readonly owned_value: Value | undefined
  // Re-attribute the held value to the loaded URL after the component edits it in place.
  // Without this an edited value looks caller-supplied and the loader stops defending it.
  claim: (value: Value) => void
}

const noop = () => {}

// Race-safe loader for a `data_url` prop, shared by the structure, trajectory, Brillouin
// zone and Fermi surface viewers. A monotonic id makes stale completions no-ops, and the
// value last produced from a URL is remembered so a caller-supplied one takes precedence.
export function create_data_url_loader<Value>(): DataUrlLoader<Value> {
  let load_id = 0
  let loaded_url: string | undefined
  let url_owned_value: Value | undefined

  const request = (req: DataUrlRequest<Value>): (() => void) => {
    const { url, current_value, skip, set_loading, clear_error, on_load, on_error } = req
    if (!url || skip || (current_value !== undefined && current_value !== url_owned_value)) {
      loaded_url = undefined
      url_owned_value = undefined
      return noop
    }
    if (loaded_url === url) return noop

    const request_id = ++load_id
    const is_current = () => request_id === load_id
    const mark_owned = (value?: Value) => {
      if (!is_current()) return
      url_owned_value = value
      loaded_url = url
    }
    set_loading(true)
    clear_error()

    load_from_url(url, async (content, filename, metadata) => {
      if (!is_current()) return
      try {
        await on_load({ content, filename, metadata, is_current, mark_owned })
      } catch (error) {
        // Keep parse/consumer failures out of the transport-only on_error callback.
        if (is_current())
          console.error(`Failed to process loaded URL '${filename}':`, to_error(error))
      }
    })
      .catch((error: unknown) => {
        if (is_current()) on_error(to_error(error), basename_from_url(url))
      })
      .finally(() => {
        if (is_current()) set_loading(false)
      })

    return () => {
      if (!is_current()) return
      load_id += 1 // invalidate the in-flight load
      set_loading(false)
    }
  }

  return {
    request,
    get loaded_url() {
      return loaded_url
    },
    get owned_value() {
      return url_owned_value
    },
    claim: (value: Value) => {
      url_owned_value = value
    },
  }
}
