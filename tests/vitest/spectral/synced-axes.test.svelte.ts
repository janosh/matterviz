import {
  create_bands_dos_sync,
  shared_resolved_padding_floor,
} from '#lib/spectral/synced-axes.svelte.js'
import type { Vec2 } from '#lib/math.js'
import type { AxisConfig } from '#lib/plot/core/types.js'
import { DEFAULT_PLOT_PADDING } from '#lib/plot/core/layout.js'
import type { BaseBandStructure, FrequencyUnit, PhononDos } from '#lib/spectral/types.js'
import { flushSync } from 'svelte'
import { afterEach, expect, test } from 'vitest'

const roots: (() => void)[] = []
afterEach(() => {
  for (const destroy of roots.splice(0)) destroy()
})

const band_structs: BaseBandStructure = {
  type: `phonon`,
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
test.each([`phonon`, `electronic`] as const)(
  `%s panels mirror y view changes, stacked panels do not`,
  (type) => {
    const inputs = $state({ side_by_side: true, sync_zoom: true })
    let units = $state<FrequencyUnit>(`meV`)
    let sync: ReturnType<typeof create_bands_dos_sync> | undefined
    roots.push(
      $effect.root(() => {
        sync = create_bands_dos_sync({
          band_structs: () => ({ '': { ...band_structs, type } }),
          doses: () => ({
            '':
              type === `phonon`
                ? doses
                : { type, energies: doses.frequencies, densities: doses.densities },
          }),
          units: () => units,
          side_by_side: () => inputs.side_by_side,
          size: () => [600, 400],
          sync_zoom: () => inputs.sync_zoom,
          base_padding: DEFAULT_PLOT_PADDING, // as the viewers pass it: only t and b count
        })
      }),
    )
    flushSync()
    if (!sync) throw new Error(`sync not created`)
    expect(sync.shared_range?.[1]).toBeCloseTo(type === `phonon` ? 16.8735242034493 : 4.08, 12)
    units = `THz`
    flushSync()
    const shared = sync.shared_range
    if (!shared) throw new Error(`no shared range`)
    expect(sync.y_axes.map((axis) => axis.range)).toEqual([shared, shared])
    expect(sync.y_axes[1].label).toBe(``)
    expect(sync.dos_x_axis).toEqual({})

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

    // stacked, the DOS plots density on y: its side-by-side view (axes swapped) reads unset,
    // so the plot starts over, and its stacked view no longer takes part
    inputs.side_by_side = false
    flushSync()
    expect(sync.y_axes[1]).toEqual({})
    expect(sync.dos_x_axis).toEqual({ range: shared })
    expect(sync.views[1]).toBeUndefined()
    sync.views[1] = { x: [...shared], y: [0, 7] } // energy on x, density on y
    sync.views[0] = { x: [0, 1], y: [2, 3] }
    flushSync()
    expect(sync.views[1]).toEqual({ x: shared, y: [0, 7] })
    // side by side again, the stacked density range must not lead: the DOS follows the bands
    inputs.side_by_side = true
    flushSync()
    expect(sync.views[0]).toEqual({ x: [0, 1], y: [2, 3] })
    expect(sync.views[1]).toEqual({ y: [2, 3] })

    // a stacked panel's tall x-axis margin must not stay in the shared padding and shrink both
    // plots once side by side again; side-by-side reports raise it
    inputs.side_by_side = false
    flushSync()
    sync.raise_padding({ t: 20, b: 90, l: 40, r: 10 })
    inputs.side_by_side = true
    flushSync()
    expect(sync.shared_padding).toEqual({ t: 20, b: 50 })
    sync.raise_padding({ t: 20, b: 60, l: 40, r: 10 })
    flushSync()
    expect(sync.shared_padding).toEqual({ t: 20, b: 60 })
  },
)

// The first valid caller range wins: an invalid bands range defers to the DOS frequency axis
// (its y side by side, its x stacked); only with no valid one does the data extent apply
type AxisRange = AxisConfig[`range`]
test.each<
  [boolean, AxisRange, { x_axis?: AxisConfig; y_axis?: AxisConfig }, Vec2 | undefined]
>([
  [true, [Number.NaN, 2], { y_axis: { range: [-1, 3] } }, [-1, 3]],
  [false, undefined, { x_axis: { range: [-2, 5] } }, [-2, 5]],
  [true, [0, 6], { y_axis: { range: [-1, 3] } }, [0, 6]],
  [true, [null, null], {}, undefined],
])(
  `side_by_side=%s bands range %j, DOS props %j: shared range %j`,
  (side, bands, dos, expected) => {
    let sync: ReturnType<typeof create_bands_dos_sync> | undefined
    roots.push(
      $effect.root(() => {
        sync = create_bands_dos_sync({
          band_structs: () => ({ '': band_structs }),
          doses: () => ({ '': doses }),
          units: () => `THz`,
          bands_props: () => ({ y_axis: { range: bands } }),
          dos_props: () => dos,
          side_by_side: () => side,
          size: () => [600, 400],
          base_padding: { t: 20, b: 50 },
        })
      }),
    )
    flushSync()
    const shared = sync?.shared_range
    if (expected) expect(shared).toEqual(expected)
    else expect(shared?.[1]).toBeGreaterThan(4) // the data's padded extent
  },
)

test(`padding floor only rises at one size, ignores sub-pixel creep and undefined reports`, () => {
  let size = $state<Vec2>([600, 300])
  const floor = shared_resolved_padding_floor(() => size)
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
  // a new height or width drops the old margins and settles anew, even on lower ones
  size = [600, 500]
  expect(floor.value).toEqual({})
  floor.raise({ t: 10, b: 40, l: 0, r: 0 })
  expect(floor.value).toEqual({ t: 10, b: 40 })
  size = [400, 500]
  expect(floor.value).toEqual({})
})
