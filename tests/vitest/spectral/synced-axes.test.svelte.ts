import {
  create_synced_y_axes,
  shared_resolved_padding_floor,
} from '$lib/spectral/synced-axes.svelte'
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

test(`padding floor only ever rises, ignores sub-pixel creep and undefined reports`, () => {
  const floor = shared_resolved_padding_floor()
  floor.raise(undefined)
  expect(floor.value).toEqual({})
  floor.raise({ t: 20, b: 50, l: 40, r: 10 })
  const raised = floor.value
  expect(raised).toEqual({ t: 20, b: 50 })
  // within the half-pixel tolerance and lower values keep the same object (no re-render churn)
  floor.raise({ t: 20.4, b: 30, l: 0, r: 0 })
  expect(floor.value).toBe(raised)
  floor.raise({ t: 5, b: 58, l: 0, r: 0 })
  expect(floor.value).toEqual({ t: 20, b: 58 })
})
