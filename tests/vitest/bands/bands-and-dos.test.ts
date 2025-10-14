import BandsAndDos from '$lib/bands/BandsAndDos.svelte'
import type { BaseBandStructure, PhononDos } from '$lib/bands/types'
import { render } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'

const mock_band_structure: BaseBandStructure = {
  lattice_rec: {
    matrix: [[0.15915494, 0.0, 0.0], [0.0, 0.15915494, 0.0], [0.0, 0.0, 0.09459882]],
  },
  qpoints: [
    { label: `GAMMA`, frac_coords: [0.0, 0.0, 0.0], distance: 0.0 },
    { label: null, frac_coords: [0.25, 0.0, 0.0], distance: 0.5 },
    { label: `X`, frac_coords: [0.5, 0.0, 0.0], distance: 1.0 },
  ],
  branches: [{ start_index: 0, end_index: 2, name: `GAMMA-X` }],
  labels_dict: { GAMMA: [0.0, 0.0, 0.0], X: [0.5, 0.0, 0.0] },
  distance: [0.0, 0.5, 1.0],
  nb_bands: 3,
  bands: [[0.0, 1.0, 2.0], [1.0, 2.0, 3.0], [2.0, 3.0, 4.0]],
}

const mock_dos: PhononDos = {
  type: `phonon`,
  frequencies: [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0],
  densities: [0.0, 1.0, 2.0, 3.0, 2.0, 1.0, 0.5, 0.2, 0.0],
}

describe(`BandsAndDos component`, () => {
  it(`renders with default props`, () => {
    const { container } = render(BandsAndDos, {
      props: { band_structs: mock_band_structure, doses: mock_dos },
    })
    expect(container.querySelector(`.bands-and-dos`)).toBeTruthy()
    expect(container.querySelector(`.bands-panel`)).toBeTruthy()
    expect(container.querySelector(`.dos-panel`)).toBeTruthy()
  })

  it.each([
    {
      name: `custom subplot widths`,
      props: { style: `grid-template-columns: 60% 40%;` },
      check: (container: HTMLElement) => {
        const wrapper = container.querySelector(`.bands-and-dos`) as HTMLElement
        expect(wrapper.style.gridTemplateColumns).toContain(`60%`)
        expect(wrapper.style.gridTemplateColumns).toContain(`40%`)
      },
    },
    {
      name: `bands_props for custom styling`,
      props: { bands_props: { line_kwargs: { stroke: `red` } } },
      check: (container: HTMLElement) => expect(container).toBeTruthy(),
    },
    {
      name: `dos_props for normalization`,
      props: { dos_props: { normalize: `max`, sigma: 0.2 } },
      check: (container: HTMLElement) => expect(container).toBeTruthy(),
    },
  ])(`renders with $name`, ({ props, check }) => {
    const { container } = render(BandsAndDos, {
      props: { band_structs: mock_band_structure, doses: mock_dos, ...props },
    })
    check(container)
  })

  it(`handles mismatched y-ranges with independent axes`, () => {
    const high_freq_dos = {
      type: `phonon` as const,
      frequencies: [10, 20, 30, 40],
      densities: [1, 2, 1, 0],
    }
    const { container } = render(BandsAndDos, {
      props: {
        band_structs: mock_band_structure,
        doses: high_freq_dos,
        shared_y_axis: false,
      },
    })
    expect(container.querySelector(`.bands-and-dos`)).toBeTruthy()
  })
})
