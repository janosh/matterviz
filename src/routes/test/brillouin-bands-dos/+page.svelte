<script lang="ts">
  import { BrillouinBandsDos } from '$lib/bands'
  import type { BaseBandStructure, PhononDos } from '$lib/bands/types'
  import type { PymatgenStructure } from '$lib/structure'

  const mock_structure: PymatgenStructure = {
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
    lattice_rec: {
      matrix: [
        [0.15915494, 0.0, 0.0],
        [0.0, 0.15915494, 0.0],
        [0.0, 0.0, 0.15915494],
      ],
    },
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
    // deno-fmt-ignore
    distance: [0.0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.4, 2.6, 2.8, 3.0],
    nb_bands: 3,
    bands: [ // deno-fmt-ignore
      [0.0, 0.5, 0.8, 1.0, 0.8, 0.5, 0.8, 1.2, 1.5, 1.8, 2.0, 1.8, 1.5, 1.0, 0.5, 0.0], // deno-fmt-ignore
      [1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.4, 2.6, 2.8, 3.0, 2.8, 2.6, 2.4, 2.2, 1.0], // deno-fmt-ignore
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

<h1>BrillouinBandsDos Component Test Page</h1>

<h2 id="default">Default (Shared Y-axis)</h2>
<div data-testid="bz-bands-dos-default">
  <BrillouinBandsDos
    structure={mock_structure}
    band_structs={mock_band_structure}
    doses={mock_dos}
  />
</div>

<h2 id="custom-widths">Custom Column Widths (35% BZ, 45% Bands, 20% DOS)</h2>
<div data-testid="bz-bands-dos-custom-widths">
  <BrillouinBandsDos
    structure={mock_structure}
    band_structs={mock_band_structure}
    doses={mock_dos}
    style="grid-template-columns: 35% 45% 20%"
  />
</div>

<h2 id="bands-custom-styling">Custom Bands Styling</h2>
<div data-testid="bz-bands-dos-bands-styling">
  <BrillouinBandsDos
    structure={mock_structure}
    band_structs={mock_band_structure}
    doses={mock_dos}
    bands_props={{ line_kwargs: { stroke: `red`, stroke_width: 3 } }}
  />
</div>

<h2 id="dos-normalization">DOS with Normalization</h2>
<div data-testid="bz-bands-dos-dos-norm">
  <BrillouinBandsDos
    structure={mock_structure}
    band_structs={mock_band_structure}
    doses={mock_dos}
    dos_props={{ normalize: `max`, sigma: 0.2 }}
  />
</div>

<h2 id="independent-axes">Independent Y-axes (Mismatched Ranges)</h2>
<div data-testid="bz-bands-dos-independent-axes">
  <BrillouinBandsDos
    structure={mock_structure}
    band_structs={mock_band_structure}
    doses={high_freq_dos}
  />
</div>

<h2 id="custom-bz-colors">Custom Brillouin Zone Colors</h2>
<div data-testid="bz-bands-dos-custom-colors">
  <BrillouinBandsDos
    structure={mock_structure}
    band_structs={mock_band_structure}
    doses={mock_dos}
    bz_props={{
      surface_color: `#9b59b6`,
      surface_opacity: 0.5,
      edge_color: `#2c3e50`,
    }}
  />
</div>

<h2 id="with-bz-controls">With Brillouin Zone Controls</h2>
<div data-testid="bz-bands-dos-with-controls">
  <BrillouinBandsDos
    structure={mock_structure}
    band_structs={mock_band_structure}
    doses={mock_dos}
    bz_props={{ show_controls: true }}
  />
</div>

<h2 id="multiple-structures">Multiple Band Structures and DOS</h2>
<div data-testid="bz-bands-dos-multiple">
  <BrillouinBandsDos
    structure={mock_structure}
    band_structs={{
      'DFT': mock_band_structure,
      'Model': {
        ...mock_band_structure,
        bands: mock_band_structure.bands.map((band) =>
          band.map((freq) => freq * 1.1)
        ),
      },
    }}
    doses={{
      'DFT': mock_dos,
      'Model': {
        ...mock_dos,
        densities: mock_dos.densities.map((dens) => dens * 1.2),
      },
    }}
  >
    <div
      class="custom-overlay"
      style="position: absolute; top: 10px; right: 10px; background: rgba(255, 255, 255, 0.9); padding: 8px; border-radius: 4px; font-size: 12px; pointer-events: none; z-index: 10"
    >
      Custom Overlay
    </div>
  </BrillouinBandsDos>
</div>

<style>
  h1 {
    margin-bottom: 2rem;
  }
  h2 {
    margin-top: 2rem;
    margin-bottom: 1rem;
  }
  div[data-testid] {
    min-height: 600px;
  }
</style>
