<script lang="ts">
  import Bands from '$lib/bands/Bands.svelte'
  import type { BaseBandStructure } from '$lib/bands/types'

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
      { label: `M`, frac_coords: [0.5, 0.5, 0.0], distance: 1.707 },
    ],
    branches: [
      { start_index: 0, end_index: 2, name: `GAMMA-X` },
      { start_index: 2, end_index: 3, name: `X-M` },
    ],
    labels_dict: {
      GAMMA: [0.0, 0.0, 0.0],
      X: [0.5, 0.0, 0.0],
      M: [0.5, 0.5, 0.0],
    },
    distance: [0.0, 0.5, 1.0, 1.707],
    nb_bands: 4,
    bands: [
      [0.0, 1.0, 2.0, 2.5],
      [1.0, 2.0, 3.0, 3.5],
      [2.0, 3.0, 4.0, 4.5],
      [3.0, 4.0, 5.0, 5.5],
    ],
  }

  const bs2: BaseBandStructure = {
    ...mock_band_structure,
    bands: [
      [0.5, 1.5, 2.5, 3.0],
      [1.5, 2.5, 3.5, 4.0],
      [2.5, 3.5, 4.5, 5.0],
      [3.5, 4.5, 5.5, 6.0],
    ],
  }
</script>

<h1>Bands Component Test Page</h1>

<h2 id="single-bands">Single Band Structure</h2>
<Bands band_structs={mock_band_structure} />

<h2 id="multiple-bands">Multiple Band Structures</h2>
<Bands band_structs={{ BS1: mock_band_structure, BS2: bs2 }} />

<h2 id="custom-styling">Custom Line Styling</h2>
<Bands
  band_structs={mock_band_structure}
  line_kwargs={{ acoustic: { stroke: `red` }, optical: { stroke: `blue` } }}
/>

<h2 id="union-path">Union Path Mode</h2>
<Bands band_structs={mock_band_structure} path_mode="union" />

<h2 id="intersection-path">Intersection Path Mode</h2>
<Bands band_structs={mock_band_structure} path_mode="intersection" />

<h2 id="no-legend">No Legend</h2>
<Bands band_structs={{ BS1: mock_band_structure, BS2: bs2 }} show_legend={false} />

<style>
  h1 {
    margin-bottom: 2rem;
  }
  h2 {
    margin-top: 2rem;
    margin-bottom: 1rem;
  }
</style>
