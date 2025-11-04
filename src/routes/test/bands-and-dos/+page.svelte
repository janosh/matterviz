<script lang="ts">
  import BandsAndDos from '$lib/bands/BandsAndDos.svelte'
  import type { BaseBandStructure, PhononDos } from '$lib/bands/types'

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

  const high_freq_dos: PhononDos = {
    type: `phonon`,
    frequencies: [10, 20, 30, 40],
    densities: [1, 2, 1, 0],
  }
</script>

<h1>BandsAndDos Component Test Page</h1>

<h2 id="default">Default (Shared Y-axis)</h2>
<BandsAndDos band_structs={mock_band_structure} doses={mock_dos} />

<h2 id="custom-widths">Custom Subplot Widths</h2>
<BandsAndDos
  band_structs={mock_band_structure}
  doses={mock_dos}
  style="grid-template-columns: 60% 40%"
/>

<h2 id="bands-custom-styling">Custom Bands Styling</h2>
<BandsAndDos
  band_structs={mock_band_structure}
  doses={mock_dos}
  bands_props={{ line_kwargs: { stroke: `red` } }}
/>

<h2 id="dos-normalization">DOS with Normalization</h2>
<BandsAndDos
  band_structs={mock_band_structure}
  doses={mock_dos}
  dos_props={{ normalize: `max`, sigma: 0.2 }}
/>

<h2 id="independent-axes">Independent Y-axes (Mismatched Ranges)</h2>
<BandsAndDos
  band_structs={mock_band_structure}
  doses={high_freq_dos}
  shared_y_axis={false}
>
  <div
    class="custom-overlay"
    style="position: absolute; top: 10px; right: 10px; background: rgba(255, 255, 255, 0.9); padding: 8px; border-radius: 4px; font-size: 12px; pointer-events: none"
  >
    Custom Overlay
  </div>
</BandsAndDos>

<style>
  h1 {
    margin-bottom: 2rem;
  }
  h2 {
    margin-top: 2rem;
    margin-bottom: 1rem;
  }
</style>
