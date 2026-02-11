import Bands from '$lib/spectral/Bands.svelte'
import type { BaseBandStructure } from '$lib/spectral/types'
import type { ComponentProps } from 'svelte'
import { mount, tick } from 'svelte'
import { describe, expect, it } from 'vitest'

const base_band_structure: BaseBandStructure = {
  recip_lattice: { matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] },
  qpoints: [
    { label: `GAMMA`, frac_coords: [0, 0, 0] },
    { label: null, frac_coords: [0.25, 0, 0] },
    { label: null, frac_coords: [0.5, 0, 0] },
    { label: `X`, frac_coords: [0.75, 0, 0] },
  ],
  branches: [{ start_index: 0, end_index: 3, name: `GAMMA-X` }],
  labels_dict: { GAMMA: [0, 0, 0], X: [0.75, 0, 0] },
  distance: [0, 1, 2, 3],
  nb_bands: 4,
  bands: [
    [0.0, 0.5, 1.0, 1.5],
    [0.8, 1.3, 1.8, 2.3],
    [1.6, 2.1, 2.6, 3.1],
    [2.4, 2.9, 3.4, 3.9],
  ],
}

const path_mismatch_structure: BaseBandStructure = {
  ...base_band_structure,
  qpoints: [
    { label: `GAMMA`, frac_coords: [0, 0, 0] },
    { label: null, frac_coords: [0.3, 0.3, 0] },
    { label: `K`, frac_coords: [0.5, 0.5, 0] },
  ],
  branches: [{ start_index: 0, end_index: 2, name: `GAMMA-K` }],
  labels_dict: { GAMMA: [0, 0, 0], K: [0.5, 0.5, 0] },
  distance: [0, 1, 2],
  nb_bands: 4,
  bands: [
    [0.1, 0.7, 1.2],
    [0.9, 1.5, 2.0],
    [1.7, 2.3, 2.8],
    [2.5, 3.1, 3.6],
  ],
}

const spin_polarized_electronic = {
  ...base_band_structure,
  bands: [
    [-1.2, -0.6, -0.1, 0.3],
    [-0.6, -0.1, 0.4, 0.9],
    [0.2, 0.8, 1.4, 2.0],
    [1.1, 1.7, 2.3, 2.9],
  ],
  spin_down_bands: [
    [-1.0, -0.4, 0.1, 0.5],
    [-0.4, 0.1, 0.6, 1.1],
    [0.4, 1.0, 1.6, 2.2],
    [1.3, 1.9, 2.5, 3.1],
  ],
  efermi: 0,
} as BaseBandStructure & { efermi: number; spin_down_bands: number[][] }

const mount_bands = async (
  props: ComponentProps<typeof Bands>,
): Promise<void> => {
  mount(Bands, { target: document.body, props })
  await tick()
}

const line_count = (): number => document.querySelectorAll(`svg path[fill="none"]`).length

describe(`Bands component`, () => {
  it.each([
    {
      name: `single structure`,
      props: { band_structs: base_band_structure },
      expected_line_count: 4,
    },
    {
      name: `electronic spin overlay`,
      props: {
        band_structs: spin_polarized_electronic,
        band_type: `electronic` as const,
        band_spin_mode: `overlay` as const,
      },
      expected_line_count: 8,
    },
    {
      name: `electronic spin up only`,
      props: {
        band_structs: spin_polarized_electronic,
        band_type: `electronic` as const,
        band_spin_mode: `up_only` as const,
      },
      expected_line_count: 4,
    },
    {
      name: `electronic spin down only`,
      props: {
        band_structs: spin_polarized_electronic,
        band_type: `electronic` as const,
        band_spin_mode: `down_only` as const,
      },
      expected_line_count: 4,
    },
  ])(`renders expected line count for $name`, async ({ props, expected_line_count }) => {
    await mount_bands(props)
    expect(line_count()).toBe(expected_line_count)
  })

  it(`renders strict-mode mismatch as EmptyState with message`, async () => {
    await mount_bands({
      band_structs: { canonical: base_band_structure, alt: path_mismatch_structure },
      path_mode: `strict`,
      'data-testid': `strict-mismatch-plot`,
      role: `status`,
      'aria-label': `Bands unavailable`,
    })
    expect(document.querySelector(`[data-testid="strict-mismatch-plot"]`)).toBeTruthy()
    expect(
      document.querySelector(`[role="status"][aria-label="Bands unavailable"]`),
    ).toBeTruthy()
    expect(document.querySelector(`.empty-state`)).toBeTruthy()
    expect(document.body.textContent).toContain(`different q-point paths`)
    expect(line_count()).toBe(0)
  })

  it(`updates phonon y-axis label when units change`, async () => {
    await mount_bands({ band_structs: base_band_structure, units: `cm-1` })
    expect(document.body.textContent).toContain(`Frequency (cm-1)`)
  })

  it(`renders one highlight fill region from props`, async () => {
    await mount_bands({
      band_structs: base_band_structure,
      highlight_regions: [{ y_min: 0.5, y_max: 1.5, label: `Window` }],
    })
    const fill_region_paths = document.querySelectorAll(
      `g.fill-region path[fill-opacity]`,
    )
    expect(fill_region_paths.length).toBe(1)
  })

  it(`shows band-gap annotation when electronic gap exists`, async () => {
    await mount_bands({
      band_structs: spin_polarized_electronic,
      band_type: `electronic`,
      band_spin_mode: `up_only`,
      show_gap_annotation: true,
    })
    expect(document.body.textContent).toContain(`Eg:`)
  })
})
