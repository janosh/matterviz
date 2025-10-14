import Bands from '$lib/bands/Bands.svelte'
import type { BaseBandStructure } from '$lib/bands/types'
import { render } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'

const mock_band_structure: BaseBandStructure = {
  lattice_rec: {
    matrix: [
      [0.15915494, 0.0, 0.0],
      [0.0, 0.15915494, 0.0],
      [0.0, 0.0, 0.09459882],
    ],
  },
  qpoints: [
    { label: `GAMMA`, frac_coords: [0.0, 0.0, 0.0], distance: 0.0 },
    { label: null, frac_coords: [0.25, 0.0, 0.0], distance: 0.5 },
    { label: `X`, frac_coords: [0.5, 0.0, 0.0], distance: 1.0 },
  ],
  branches: [{ start_index: 0, end_index: 2, name: `GAMMA-X` }],
  labels_dict: {
    GAMMA: [0.0, 0.0, 0.0],
    X: [0.5, 0.0, 0.0],
  },
  distance: [0.0, 0.5, 1.0],
  nb_bands: 3,
  bands: [
    [0.0, 1.0, 2.0],
    [1.0, 2.0, 3.0],
    [2.0, 3.0, 4.0],
  ],
}

describe(`Bands component`, () => {
  it(`renders single band structure`, () => {
    const { container } = render(Bands, {
      props: { band_structs: mock_band_structure },
    })
    const svg = container.querySelector(`svg`)
    expect(svg).toBeTruthy()
    // Should have 3 bands * 3 points = data rendered
    const paths = svg?.querySelectorAll(`path`)
    expect(paths && paths.length > 0).toBe(true)
  })

  it(`renders multiple band structures with legend`, () => {
    const { container } = render(Bands, {
      props: {
        band_structs: { BS1: mock_band_structure, BS2: mock_band_structure },
      },
    })
    const svg = container.querySelector(`svg`)
    expect(svg).toBeTruthy()
    // Multiple structures should show legend
    const legend = svg?.querySelector(`.legend`)
    expect(legend).toBeTruthy()
  })

  it.each([
    {
      name: `mode-specific line styling`,
      props: {
        line_kwargs: { acoustic: { stroke: `red` }, optical: { stroke: `blue` } },
      },
    },
    { name: `union path mode`, props: { path_mode: `union` } },
    { name: `intersection path mode`, props: { path_mode: `intersection` } },
  ])(`applies $name`, ({ props }) => {
    const { container } = render(Bands, {
      props: { band_structs: mock_band_structure, ...props },
    })
    expect(container.querySelector(`svg`)).toBeTruthy()
  })

  it(`handles mismatched paths in union mode`, () => {
    const bs2: BaseBandStructure = {
      ...mock_band_structure,
      qpoints: [
        { label: `GAMMA`, frac_coords: [0.0, 0.0, 0.0], distance: 0.0 },
        { label: `Y`, frac_coords: [0.0, 0.5, 0.0], distance: 1.0 },
      ],
      branches: [{ start_index: 0, end_index: 1, name: `GAMMA-Y` }],
      distance: [0.0, 1.0],
      bands: [
        [0.0, 1.5],
        [1.0, 2.5],
      ],
    }
    const { container } = render(Bands, {
      props: {
        band_structs: { BS1: mock_band_structure, BS2: bs2 },
        path_mode: `union`,
      },
    })
    expect(container.querySelector(`svg`)).toBeTruthy()
  })
})
