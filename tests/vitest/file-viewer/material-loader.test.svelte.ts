import { create_material_loader } from '#lib/file-viewer/material-loader.svelte.js'
import type { MaterialSource } from '#lib/file-viewer/open.js'
import { flushSync } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { create_drop_event } from '../setup'

afterEach(() => vi.unstubAllGlobals())

// The spinner shows while either a drop batch or a source (URL) load runs, whichever ends last
test(`a finishing drop batch keeps loading on while a newer URL load runs`, async () => {
  const url_fetch = Promise.withResolvers<Response>()
  vi.stubGlobal(
    `fetch`,
    vi.fn(() => url_fetch.promise),
  )
  const drop_delivered = Promise.withResolvers<undefined>()
  const on_file_drop = vi.fn(() => drop_delivered.promise)
  const loading_calls: boolean[] = []
  const state = $state<{ source: MaterialSource | undefined }>({ source: undefined })
  const node = document.createElement(`div`)
  const cleanup = $effect.root(() => {
    const attach = create_material_loader({
      source: () => state.source,
      current_value: () => undefined,
      allow_file_drop: () => true,
      on_file_drop: () => on_file_drop,
      set_loading: (loading) => loading_calls.push(loading),
      set_error: () => {},
      commit: () => {},
      report_error: () => {},
    })
    $effect(() => attach(node) ?? undefined)
  })
  flushSync()
  node.dispatchEvent(create_drop_event(new File([`2\n\nH 0 0 0\nH 0 0 1`], `a.xyz`)))
  await vi.waitFor(() => expect(on_file_drop).toHaveBeenCalledTimes(1))
  state.source = `https://example.com/b.xyz`
  flushSync()
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  // The superseded drop settles while the URL is still being fetched
  drop_delivered.resolve(undefined)
  await vi.waitFor(() => expect(loading_calls.length).toBeGreaterThan(2))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(loading_calls.at(-1)).toBe(true)
  url_fetch.resolve(new Response(`2\n\nH 0 0 0\nH 0 0 1`))
  await vi.waitFor(() => expect(on_file_drop).toHaveBeenCalledTimes(2))
  await vi.waitFor(() => expect(loading_calls.at(-1)).toBe(false))
  cleanup()
})
