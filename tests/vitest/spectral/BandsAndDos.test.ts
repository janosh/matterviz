import BandsAndDos from '$lib/spectral/BandsAndDos.svelte'
import type { BaseBandStructure, PhononDos } from '$lib/spectral/types'
import { flushSync } from 'svelte'
import { describe, expect, it } from 'vitest'
import { mount_sized } from '../setup'

const band_structs: BaseBandStructure = {
  qpoints: [
    { label: `GAMMA`, frac_coords: [0, 0, 0], distance: 0 },
    { label: null, frac_coords: [0.25, 0, 0], distance: 0.5 },
    { label: `X`, frac_coords: [0.5, 0, 0], distance: 1 },
  ],
  branches: [{ start_index: 0, end_index: 2, name: `GAMMA-X` }],
  labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0] },
  distance: [0, 0.5, 1],
  nb_bands: 3,
  bands: [
    [0, 1, 2],
    [1, 2, 3],
    [2, 3, 4],
  ],
}

describe(`BandsAndDos`, () => {
  // The shared y range BandsAndDos pins on both panels equals (or nearly equals) the padded
  // range Bands derives from its own data whenever the DOS lies inside the bands. Bands must
  // not treat that pin as its own default and clear it, or the sync effect re-pins it and the
  // two loop until Svelte's effect_update_depth_exceeded
  it.each([
    [`DOS inside the bands range`, 4],
    [`DOS ending within tolerance of the bands range`, 4.0001],
  ])(`renders both panels without an effect loop (%s)`, async (_label, dos_max) => {
    const doses: PhononDos = {
      type: `phonon`,
      frequencies: [0, 1, 2, 3, dos_max],
      densities: [0, 1, 2, 1, 0],
    }
    const root = await mount_sized(
      BandsAndDos,
      { band_structs, doses },
      { selector: `.bands-and-dos`, width: 800, height: 400 },
    )
    expect(() => flushSync()).not.toThrow()
    const y_ticks = (plot: Element) =>
      [...plot.querySelectorAll(`.y-axis .tick text`)].map((el) => el.textContent)
    const [bands_plot, dos_plot] = [...root.querySelectorAll(`.scatter`)]
    expect(y_ticks(bands_plot)).toEqual(y_ticks(dos_plot))
    expect(y_ticks(bands_plot).length).toBeGreaterThan(2)
  })
})
