<script lang="ts">
  import { BrillouinBandsDos } from '$lib/spectral'
  import type { BaseBandStructure, DosData, PhononDos } from '$lib/spectral/types'
  import type { Crystal } from '$lib/structure'
  import { electronic_bands } from '$site/electronic/bands'
  import { dos_spin_polarization } from '$site/electronic/dos'

  // Testing: CaO bands + mp-865805 DOS (mismatched materials, no shifts applied)
  const electronic_dos = dos_spin_polarization as unknown as DosData

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
    recip_lattice: {
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
      style="position: absolute; top: 10px; right: 10px; background: rgba(255, 255, 255, 0.9); padding: 8px; border-radius: var(--border-radius); font-size: 12px; pointer-events: none; z-index: 10"
    >
      Custom Overlay
    </div>
  </BrillouinBandsDos>
</div>

<h2 id="electronic-bands">Electronic Bands (CaO)</h2>
<p style="color: var(--text-muted); font-size: 0.9em; margin-bottom: 1rem">
  Electronic band structure with 3D Brillouin zone visualization. The Fermi level (E<sub
  >F</sub>) is automatically detected and displayed as a dashed red line in both the bands
  and DOS plots. Note: Using mock Si structure for BZ (actual CaO structure unavailable).
</p>
<div data-testid="bz-bands-dos-electronic">
  <BrillouinBandsDos
    structure={mock_structure}
    band_structs={electronic_bands.cao_2605}
    doses={electronic_dos}
    bands_props={{ y_axis: { label: `Energy (eV)` } }}
    dos_props={{ y_axis: { label: `` } }}
  />
</div>

<h2 id="electronic-with-controls">Electronic Bands with BZ Controls</h2>
<p style="color: var(--text-muted); font-size: 0.9em; margin-bottom: 1rem">
  Same electronic data but with Brillouin zone controls enabled for interactive
  exploration.
</p>
<div data-testid="bz-bands-dos-electronic-controls">
  <BrillouinBandsDos
    structure={mock_structure}
    band_structs={electronic_bands.cao_2605}
    doses={electronic_dos}
    bz_props={{ show_controls: true }}
    bands_props={{
      y_axis: { label: `Energy (eV)` },
      line_kwargs: { stroke_width: 1.5 },
    }}
    dos_props={{ y_axis: { label: `` } }}
  />
</div>

<h2 id="comparison">Electronic vs Phonon Comparison</h2>
<p style="color: var(--text-muted); font-size: 0.9em; margin-bottom: 1rem">
  Side-by-side comparison: Electronic bands show Fermi level marker (E<sub>F</sub>),
  phonon bands do not (no Fermi energy concept for phonons).
</p>
<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem">
  <div>
    <h3 style="text-align: center; margin-bottom: 0.5rem">Electronic (CaO)</h3>
    <div data-testid="bz-bands-dos-electronic-compare" style="min-height: 500px">
      <BrillouinBandsDos
        structure={mock_structure}
        band_structs={electronic_bands.cao_2605}
        doses={electronic_dos}
        bands_props={{ y_axis: { label: `E (eV)` } }}
        dos_props={{ y_axis: { label: `` } }}
      />
    </div>
  </div>
  <div>
    <h3 style="text-align: center; margin-bottom: 0.5rem">Phonon (Mock Si)</h3>
    <div data-testid="bz-bands-dos-phonon-compare" style="min-height: 500px">
      <BrillouinBandsDos
        structure={mock_structure}
        band_structs={mock_band_structure}
        doses={mock_dos}
        bands_props={{ y_axis: { label: `ν (THz)` } }}
      />
    </div>
  </div>
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
