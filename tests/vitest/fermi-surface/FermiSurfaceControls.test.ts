import FermiSurfaceControls from '$lib/fermi-surface/FermiSurfaceControls.svelte'
import type { ColorProperty, FermiSurfaceData } from '$lib/fermi-surface/types'
import { mount, tick, unmount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { bind_props } from '../setup'

const make_fermi_data = (band_indices = [0, 1]): FermiSurfaceData => ({
  isosurfaces: band_indices.map((band_index) => ({
    vertices: [],
    faces: [],
    normals: [],
    band_index,
    spin: null,
  })),
  k_lattice: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  fermi_energy: 0,
  reciprocal_cell: `parallelepiped`,
  metadata: {
    n_bands: band_indices.length,
    n_surfaces: band_indices.length,
    total_area: 0,
  },
})

describe(`FermiSurfaceControls`, () => {
  test.each([
    {
      name: `initializes missing selected bands and resets invalid custom coloring`,
      initial_selected_bands: undefined,
      initial_color_property: `custom` as ColorProperty,
      expected_selected_bands: [0, 1],
      expected_color_property: `band` as ColorProperty,
    },
    {
      name: `preserves existing selected bands and band coloring`,
      initial_selected_bands: [1],
      initial_color_property: `band` as ColorProperty,
      expected_selected_bands: [1],
      expected_color_property: `band` as ColorProperty,
    },
    {
      name: `does not select bands when none are available`,
      band_indices: [],
      initial_selected_bands: undefined,
      initial_color_property: `band` as ColorProperty,
      expected_selected_bands: undefined,
      expected_color_property: `band` as ColorProperty,
    },
  ])(
    `$name`,
    async ({
      band_indices,
      initial_selected_bands,
      initial_color_property,
      expected_selected_bands,
      expected_color_property,
    }) => {
      const state = {
        controls_open: true,
        selected_bands: initial_selected_bands,
        color_property: initial_color_property,
      }
      const component = mount(FermiSurfaceControls, {
        target: document.body,
        props: bind_props({ fermi_data: make_fermi_data(band_indices) }, state),
      })

      try {
        await tick()
        expect(state.selected_bands).toEqual(expected_selected_bands)
        expect(state.color_property).toBe(expected_color_property)
      } finally {
        await unmount(component)
      }
    },
  )
})
