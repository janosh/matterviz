<script lang="ts">
  import { BrillouinBandsDos } from '#lib/spectral/index.js'
  import type { BaseBandStructure, PhononDos } from '#lib/spectral/types.js'
  import type { Crystal } from '#lib/structure/index.js'

  const mock_structure: Crystal = {
    lattice: {
      matrix: [
        [4.0, 0.0, 0.0],
        [0.0, 4.0, 0.0],
        [0.0, 0.0, 4.0],
      ],
      pbc: [true, true, true],
      a: 4.0,
      b: 4.0,
      c: 4.0,
      alpha: 90.0,
      beta: 90.0,
      gamma: 90.0,
      volume: 64.0,
    },
    sites: [
      {
        species: [{ element: `Si`, occu: 1, oxidation_state: 0 }],
        abc: [0.0, 0.0, 0.0],
        xyz: [0.0, 0.0, 0.0],
        label: `Si`,
        properties: {},
      },
      {
        species: [{ element: `Si`, occu: 1, oxidation_state: 0 }],
        abc: [0.5, 0.5, 0.5],
        xyz: [2.0, 2.0, 2.0],
        label: `Si`,
        properties: {},
      },
    ],
  }

  const mock_band_structure: BaseBandStructure = {
    type: `phonon`,
    qpoints: [
      { label: `GAMMA`, frac_coords: [0.0, 0.0, 0.0], distance: 0.0 },
      { label: null, frac_coords: [0.1, 0.0, 0.0], distance: 0.2 },
      { label: null, frac_coords: [0.2, 0.0, 0.0], distance: 0.4 },
      { label: null, frac_coords: [0.3, 0.0, 0.0], distance: 0.6 },
      { label: null, frac_coords: [0.4, 0.0, 0.0], distance: 0.8 },
      { label: `X`, frac_coords: [0.5, 0.0, 0.0], distance: 1.0 },
      { label: null, frac_coords: [0.5, 0.1, 0.0], distance: 1.2 },
      { label: null, frac_coords: [0.5, 0.2, 0.0], distance: 1.4 },
      { label: null, frac_coords: [0.5, 0.3, 0.0], distance: 1.6 },
      { label: null, frac_coords: [0.5, 0.4, 0.0], distance: 1.8 },
      { label: `M`, frac_coords: [0.5, 0.5, 0.0], distance: 2.0 },
      { label: null, frac_coords: [0.4, 0.4, 0.0], distance: 2.2 },
      { label: null, frac_coords: [0.3, 0.3, 0.0], distance: 2.4 },
      { label: null, frac_coords: [0.2, 0.2, 0.0], distance: 2.6 },
      { label: null, frac_coords: [0.1, 0.1, 0.0], distance: 2.8 },
      { label: `GAMMA`, frac_coords: [0.0, 0.0, 0.0], distance: 3.0 },
    ],
    branches: [
      { start_index: 0, end_index: 5, name: `GAMMA-X` },
      { start_index: 5, end_index: 10, name: `X-M` },
      { start_index: 10, end_index: 15, name: `M-GAMMA` },
    ],
    labels_dict: {
      GAMMA: [0.0, 0.0, 0.0],
      X: [0.5, 0.0, 0.0],
      M: [0.5, 0.5, 0.0],
    },
    // oxfmt-ignore
    distance: [0.0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.4, 2.6, 2.8, 3.0],
    nb_bands: 3,
    bands: [
      // oxfmt-ignore
      [0.0, 0.5, 0.8, 1.0, 0.8, 0.5, 0.8, 1.2, 1.5, 1.8, 2.0, 1.8, 1.5, 1.0, 0.5, 0.0], // oxfmt-ignore
      [1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.4, 2.6, 2.8, 3.0, 2.8, 2.6, 2.4, 2.2, 1.0], // oxfmt-ignore
      [2.0, 2.2, 2.4, 2.6, 2.8, 3.0, 3.2, 3.4, 3.6, 3.8, 4.0, 3.8, 3.6, 3.2, 2.8, 2.0],
    ],
  }

  const mock_dos: PhononDos = {
    type: `phonon`,
    frequencies: [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5],
    densities: [0.0, 1.0, 2.0, 3.0, 2.5, 2.0, 1.5, 1.0, 0.5, 0.0],
  }

  const high_freq_dos: PhononDos = {
    type: `phonon`,
    frequencies: [10, 15, 20, 25, 30],
    densities: [1, 2, 1.5, 0.5, 0],
  }
</script>

<h1 id="brillouinbandsdos-component-test-page">BrillouinBandsDos Component Test Page</h1>

<h2 id="default">Default (Shared Y-axis)</h2>
<BrillouinBandsDos
  structure={mock_structure}
  band_structs={{ '': mock_band_structure }}
  doses={{ '': mock_dos }}
  data-testid="bz-bands-dos-default"
/>

<h2 id="bands-custom-styling">Custom Bands Styling</h2>
<BrillouinBandsDos
  structure={mock_structure}
  band_structs={{ '': mock_band_structure }}
  doses={{ '': mock_dos }}
  bands_props={{ line_kwargs: { stroke: `red`, stroke_width: 3 } }}
  data-testid="bz-bands-dos-bands-styling"
/>

<h2 id="independent-axes">Independent Y-axes (Mismatched Ranges)</h2>
<BrillouinBandsDos
  structure={mock_structure}
  band_structs={{ '': mock_band_structure }}
  doses={{ '': high_freq_dos }}
  data-testid="bz-bands-dos-independent-axes"
/>

<h2 id="with-bz-controls">With Brillouin Zone Controls</h2>
<BrillouinBandsDos
  structure={mock_structure}
  band_structs={{ '': mock_band_structure }}
  doses={{ '': mock_dos }}
  bz_props={{ show_controls: true }}
  data-testid="bz-bands-dos-with-controls"
/>

<h2 id="multiple-structures">Multiple Band Structures and DOS</h2>
<BrillouinBandsDos
  structure={mock_structure}
  band_structs={{
    DFT: mock_band_structure,
    Model: {
      ...mock_band_structure,
      bands: mock_band_structure.bands.map((band) => band.map((freq) => freq * 1.1)),
    },
  }}
  doses={{
    DFT: mock_dos,
    Model: {
      ...mock_dos,
      densities: mock_dos.densities.map((dens) => dens * 1.2),
    },
  }}
  data-testid="bz-bands-dos-multiple"
>
  <div
    class="custom-overlay"
    style="position: absolute; top: 10px; right: 10px; background: rgba(255, 255, 255, 0.9); padding: 8px; border-radius: var(--border-radius); font-size: 12px; pointer-events: none; z-index: 10"
  >
    Custom Overlay
  </div>
</BrillouinBandsDos>

<style>
  h1 {
    margin-bottom: 2rem;
  }
  h2 {
    margin-top: 2rem;
    margin-bottom: 1rem;
  }
  :global(.bands-dos-brillouin[data-testid]) {
    min-height: 600px;
  }
</style>
