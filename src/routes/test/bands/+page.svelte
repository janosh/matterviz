<script lang="ts">
  import Bands from '$lib/spectral/Bands.svelte'
  import type { BaseBandStructure, RibbonConfig } from '$lib/spectral/types'

  const mock_band_structure: BaseBandStructure = {
    recip_lattice: {
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

  // Band structure with different segments (GAMMA-K, K-M instead of GAMMA-X, X-M)
  const bs_alt_path: BaseBandStructure = {
    ...mock_band_structure,
    qpoints: [
      { label: `GAMMA`, frac_coords: [0.0, 0.0, 0.0], distance: 0.0 },
      { label: `K`, frac_coords: [0.333, 0.333, 0.0], distance: 1.0 },
      { label: `M`, frac_coords: [0.5, 0.5, 0.0], distance: 1.8 },
    ],
    branches: [
      { start_index: 0, end_index: 1, name: `GAMMA-K` },
      { start_index: 1, end_index: 2, name: `K-M` },
    ],
    labels_dict: {
      GAMMA: [0.0, 0.0, 0.0],
      K: [0.333, 0.333, 0.0],
      M: [0.5, 0.5, 0.0],
    },
    distance: [0.0, 1.0, 1.8],
    bands: [
      [0.2, 1.5, 2.8],
      [1.2, 2.5, 3.8],
      [2.2, 3.5, 4.8],
      [3.2, 4.5, 5.8],
    ],
  }

  // Band structure with discontinuities (consecutive labeled points = k-space jumps)
  const bs_with_discontinuity: BaseBandStructure = {
    ...mock_band_structure,
    qpoints: [
      { label: `GAMMA`, frac_coords: [0.0, 0.0, 0.0], distance: 0.0 },
      { label: null, frac_coords: [0.25, 0.0, 0.0], distance: 0.5 },
      { label: `X`, frac_coords: [0.5, 0.0, 0.0], distance: 1.0 },
      { label: `U`, frac_coords: [0.625, 0.25, 0.625], distance: 1.05 },
      { label: `K`, frac_coords: [0.375, 0.375, 0.75], distance: 1.1 },
      { label: null, frac_coords: [0.25, 0.25, 0.5], distance: 1.6 },
      { label: `L`, frac_coords: [0.5, 0.5, 0.5], distance: 2.0 },
    ],
    branches: [
      { start_index: 0, end_index: 2, name: `GAMMA-X` },
      { start_index: 3, end_index: 4, name: `U-K` }, // Discontinuity: consecutive labeled points
      { start_index: 4, end_index: 6, name: `K-L` },
    ],
    labels_dict: {
      GAMMA: [0.0, 0.0, 0.0],
      X: [0.5, 0.0, 0.0],
      U: [0.625, 0.25, 0.625],
      K: [0.375, 0.375, 0.75],
      L: [0.5, 0.5, 0.5],
    },
    distance: [0.0, 0.5, 1.0, 1.05, 1.1, 1.6, 2.0],
    bands: [
      [0.0, 1.0, 2.0, 3.0, 3.2, 3.8, 4.5],
      [1.0, 2.0, 3.0, 4.0, 4.2, 4.8, 5.5],
      [2.0, 3.0, 4.0, 5.0, 5.2, 5.8, 6.5],
      [3.0, 4.0, 5.0, 6.0, 6.2, 6.8, 7.5],
    ],
  }

  // Band structure with fat bands (band_widths for electron-phonon coupling visualization)
  const bs_with_fat_bands: BaseBandStructure = {
    ...mock_band_structure,
    // Simulated electron-phonon coupling: varies by band and k-point
    band_widths: [
      [0.8, 0.6, 0.3, 0.5], // Band 0: strong at Γ, weaker at X
      [0.4, 0.7, 0.9, 0.6], // Band 1: peaks at X
      [0.2, 0.3, 0.4, 0.8], // Band 2: increases toward M
      [0.1, 0.2, 0.3, 0.4], // Band 3: weak coupling
    ],
  }

  // Ribbon configuration for fat bands
  const fat_bands_config: RibbonConfig = {
    color: `#e74c3c`,
    opacity: 0.4,
    max_width: 8,
    scale: 1.0,
  }
</script>

<h1>Bands Component Test Page</h1>

<h2 id="single-bands">Single Band Structure</h2>
<Bands band_structs={mock_band_structure} data-testid="single-bands-plot" />

<h2 id="multiple-bands">Multiple Band Structures</h2>
<Bands
  band_structs={{ BS1: mock_band_structure, BS2: bs2 }}
  data-testid="multiple-bands-plot"
/>

<h2 id="custom-styling">Custom Line Styling</h2>
<Bands
  band_structs={mock_band_structure}
  line_kwargs={{ acoustic: { stroke: `red` }, optical: { stroke: `blue` } }}
  data-testid="custom-styling-plot"
/>

<h2 id="union-path">Union Path Mode</h2>
<Bands
  band_structs={mock_band_structure}
  path_mode="union"
  data-testid="union-path-plot"
/>

<h2 id="intersection-path">Intersection Path Mode</h2>
<Bands
  band_structs={mock_band_structure}
  path_mode="intersection"
  data-testid="intersection-path-plot"
/>

<h2 id="no-legend">No Legend</h2>
<Bands
  band_structs={{ BS1: mock_band_structure, BS2: bs2 }}
  show_legend={false}
  data-testid="no-legend-plot"
/>

<h2 id="union-non-canonical">Union Mode with Non-Canonical Segments</h2>
<Bands
  band_structs={{ canonical: mock_band_structure, alt_path: bs_alt_path }}
  path_mode="union"
  data-testid="union-non-canonical-plot"
/>

<h2 id="discontinuity">Band Structure with Discontinuities</h2>
<Bands band_structs={bs_with_discontinuity} data-testid="discontinuity-plot" />

<h2 id="fat-bands">Fat Bands (Electron-Phonon Coupling)</h2>
<Bands
  band_structs={bs_with_fat_bands}
  ribbon_config={fat_bands_config}
  data-testid="fat-bands-plot"
/>

<h2 id="fat-bands-default">Fat Bands with Default Styling</h2>
<Bands band_structs={bs_with_fat_bands} data-testid="fat-bands-default-plot" />

<h2 id="fat-bands-multiple">Multiple Structures with Fat Bands</h2>
<Bands
  band_structs={{
    'Structure A': bs_with_fat_bands,
    'Structure B': {
      ...bs2,
      band_widths: [
        [0.3, 0.5, 0.7, 0.4],
        [0.5, 0.8, 0.6, 0.3],
        [0.2, 0.4, 0.6, 0.5],
        [0.1, 0.3, 0.5, 0.7],
      ],
    },
  }}
  ribbon_config={{ opacity: 0.35, max_width: 6 }}
  data-testid="fat-bands-multiple-plot"
/>

<style>
  h1 {
    margin-bottom: 2rem;
  }
  h2 {
    margin-top: 2rem;
    margin-bottom: 1rem;
  }
</style>
