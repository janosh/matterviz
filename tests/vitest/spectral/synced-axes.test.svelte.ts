import {
  create_bands_dos_sync,
  shared_resolved_padding_floor,
} from '$lib/spectral/synced-axes.svelte'
import type { BaseBandStructure, PhononDos } from '$lib/spectral/types'
import { flushSync } from 'svelte'
import { afterEach, expect, test } from 'vitest'

const roots: (() => void)[] = []
afterEach(() => {
  for (const destroy of roots.splice(0)) destroy()
})

const band_structs: BaseBandStructure = {
  qpoints: [
    { label: `GAMMA`, frac_coords: [0, 0, 0], distance: 0 },
    { label: `X`, frac_coords: [0.5, 0, 0], distance: 1 },
  ],
  branches: [{ start_index: 0, end_index: 1, name: `GAMMA-X` }],
  labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0] },
  distance: [0, 1],
  nb_bands: 2,
  bands: [
    [0, 1],
    [2, 4],
  ],
}
const doses: PhononDos = { type: `phonon`, frequencies: [0, 2, 4], densities: [0, 1, 0] }

// Each panel binds its `view`; the sync mirrors the y view of whichever panel moved into
// the other, so a zoom or reset in either panel reaches both
test(`side-by-side panels mirror y view changes, stacked panels don't`, () => {
  const inputs = $state({ side_by_side: true, sync_zoom: true })
  let sync: ReturnType<typeof create_bands_dos_sync> | undefined
  roots.push(
    $effect.root(() => {
      sync = create_bands_dos_sync({
        band_structs: () => band_structs,
        doses: () => doses,
        bands_y_axis: () => undefined,
        dos_y_axis: () => undefined,
        bands_padding: () => undefined,
        dos_padding: () => undefined,
        side_by_side: () => inputs.side_by_side,
        sync_zoom: () => inputs.sync_zoom,
        base_padding: { t: 20, b: 50 },
      })
    }),
  )
  flushSync()
  if (!sync) throw new Error(`sync not created`)
  const shared = sync.shared_range
  if (!shared) throw new Error(`no shared range`)
  expect(sync.y_axes.map((axis) => axis.range)).toEqual([shared, shared])
  expect(sync.y_axes[1].label).toBe(``)

  // both panels report their initial view (the shared pin); nothing to mirror yet
  sync.views[0] = { x: [0, 1], y: [...shared] }
  sync.views[1] = { x: [0, 5], y: [...shared] }
  flushSync()
  expect(sync.views[1]).toEqual({ x: [0, 5], y: shared })

  // a zoom in the bands panel reaches the DOS panel's y view, and only y
  sync.views[0] = { x: [0, 1], y: [1, 3] }
  flushSync()
  expect(sync.views[1]).toEqual({ x: [0, 5], y: [1, 3] })
  // a reset of the DOS panel (back to the shared range) reaches the bands panel
  sync.views[1] = { x: [0, 5], y: [...shared] }
  flushSync()
  expect(sync.views[0]).toEqual({ x: [0, 1], y: shared })
  // the mirrored range is copied, never aliased between the two panels' views
  expect(sync.views[0]?.y).not.toBe(sync.views[1]?.y)

  // with the link off, panels zoom independently
  inputs.sync_zoom = false
  flushSync()
  sync.views[1] = { x: [0, 5], y: [1, 2] }
  flushSync()
  expect(sync.views[0]).toEqual({ x: [0, 1], y: shared })
  // re-enabling the link lets the panel that left the shared range lead
  inputs.sync_zoom = true
  flushSync()
  expect(sync.views[0]).toEqual({ x: [0, 1], y: [1, 2] })

  // stacked, the DOS plots density on y: its view no longer takes part
  inputs.side_by_side = false
  flushSync()
  expect(sync.y_axes[1]).toEqual({})
  sync.views[0] = { x: [0, 1], y: [2, 3] }
  flushSync()
  expect(sync.views[1]).toEqual({ x: [0, 5], y: [1, 2] })
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
