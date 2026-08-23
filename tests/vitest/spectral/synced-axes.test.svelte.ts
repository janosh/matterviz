import { create_synced_y_axes } from '$lib/spectral/synced-axes.svelte'
import { flushSync } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

const roots: (() => void)[] = []
afterEach(() => {
  for (const destroy of roots.splice(0)) destroy()
})

test(`axes rebuild only when a source changes identity or the source list grows`, () => {
  const sources = $state<{ list: unknown[] }>({ list: [`bands`] })
  const default_axes = vi.fn(() => [{ label: `y` }])
  let synced: ReturnType<typeof create_synced_y_axes> | undefined
  roots.push(
    $effect.root(() => {
      synced = create_synced_y_axes({
        default_axes,
        sources: () => sources.list,
        shared_range: () => undefined,
        sync_zoom: () => false,
      })
    }),
  )
  flushSync()
  // Construction built the axes; the first effect run must not build them again
  expect(default_axes).toHaveBeenCalledOnce()
  const initial_axes = synced?.y_axes

  // Same identities: nothing happens
  sources.list = [`bands`]
  flushSync()
  expect(default_axes).toHaveBeenCalledOnce()
  expect(synced?.y_axes).toBe(initial_axes)

  // A longer list whose leading entries match used to be missed entirely
  sources.list = [`bands`, `dos`]
  flushSync()
  expect(default_axes).toHaveBeenCalledTimes(2)

  sources.list = [`other`, `dos`]
  flushSync()
  expect(default_axes).toHaveBeenCalledTimes(3)
})
