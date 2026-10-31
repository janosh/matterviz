<script lang="ts">
  import Bands from '#lib/spectral/Bands.svelte'
  import type { BaseBandStructure } from '#lib/spectral/types.js'
  import { mock_band_structure_gxm as mock_band_structure } from '#site/spectral-mocks.js'
  import TestSection from '../TestSection.svelte'

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

  // Band structure with a discontinuity: the U→K jump is the gap between two branches
  const bs_with_discontinuity: BaseBandStructure = {
    ...mock_band_structure,
    qpoints: [
      { label: `GAMMA`, frac_coords: [0.0, 0.0, 0.0], distance: 0.0 },
      { label: null, frac_coords: [0.25, 0.0, 0.0], distance: 0.5 },
      { label: `X`, frac_coords: [0.5, 0.0, 0.0], distance: 1.0 },
      { label: `U`, frac_coords: [0.625, 0.25, 0.625], distance: 1.05 },
      { label: `K`, frac_coords: [0.375, 0.375, 0.75], distance: 1.05 },
      { label: null, frac_coords: [0.25, 0.25, 0.5], distance: 1.6 },
      { label: `L`, frac_coords: [0.5, 0.5, 0.5], distance: 2.0 },
    ],
    branches: [
      { start_index: 0, end_index: 2, name: `GAMMA-X` },
      { start_index: 2, end_index: 3, name: `X-U` },
      { start_index: 4, end_index: 6, name: `K-L` },
    ],
    labels_dict: {
      GAMMA: [0.0, 0.0, 0.0],
      X: [0.5, 0.0, 0.0],
      U: [0.625, 0.25, 0.625],
      K: [0.375, 0.375, 0.75],
      L: [0.5, 0.5, 0.5],
    },
    distance: [0.0, 0.5, 1.0, 1.05, 1.05, 1.6, 2.0],
    bands: [
      [0.0, 1.0, 2.0, 3.0, 3.2, 3.8, 4.5],
      [1.0, 2.0, 3.0, 4.0, 4.2, 4.8, 5.5],
      [2.0, 3.0, 4.0, 5.0, 5.2, 5.8, 6.5],
      [3.0, 4.0, 5.0, 6.0, 6.2, 6.8, 7.5],
    ],
  }

  // Semiconducting electronic band structure with spin-up and spin-down channels
  // (no band crosses E_F = 0, so the gap annotation renders)
  const electronic_bands_with_fermi: BaseBandStructure = {
    ...mock_band_structure,
    type: `electronic`,
    efermi: 0.0,
    bands: [
      [-1.2, -0.8, -0.5, -0.3],
      [-0.9, -0.6, -0.4, -0.2],
      [0.4, 0.8, 1.4, 2.0],
      [1.1, 1.7, 2.3, 2.9],
    ],
    spin_down_bands: [
      [-1.0, -0.7, -0.4, -0.1],
      [-0.8, -0.5, -0.3, -0.15],
      [0.6, 1.0, 1.6, 2.2],
      [1.3, 1.9, 2.5, 3.1],
    ],
  }

  const single = { '': mock_band_structure }
  const two_structs = { BS1: mock_band_structure, BS2: bs2 }
  const mismatched_paths = { canonical: mock_band_structure, alt_path: bs_alt_path }
  const electronic = { '': electronic_bands_with_fermi }
</script>

<h1>Bands test page</h1>

<TestSection title="Single band structure">
  <Bands band_structs={single} data-testid="single-bands-plot" />
</TestSection>

<TestSection title="Multiple band structures">
  <Bands band_structs={two_structs} data-testid="multiple-bands-plot" />
</TestSection>

<TestSection title="Union path mode">
  <Bands band_structs={single} path_mode="union" data-testid="union-path-plot" />
</TestSection>

<TestSection title="Intersection path mode">
  <Bands band_structs={single} path_mode="intersection" data-testid="intersection-path-plot" />
</TestSection>

<TestSection title="No legend">
  <Bands band_structs={two_structs} show_legend={false} data-testid="no-legend-plot" />
</TestSection>

<TestSection title="Union mode with non-canonical segments">
  <Bands
    band_structs={mismatched_paths}
    path_mode="union"
    data-testid="union-non-canonical-plot"
  />
</TestSection>

<TestSection title="Strict mode path mismatch error state">
  <Bands
    band_structs={mismatched_paths}
    path_mode="strict"
    data-testid="strict-mismatch-plot"
  />
</TestSection>

<TestSection title="Band structure with discontinuities">
  <Bands band_structs={{ '': bs_with_discontinuity }} data-testid="discontinuity-plot" />
</TestSection>

<TestSection title="Phonon units and highlight regions">
  <Bands
    band_structs={single}
    units="cm^-1"
    highlight_regions={[
      { y_min: 40, y_max: 90, color: `rgba(255, 193, 7, 0.35)`, label: `Target window` },
    ]}
    data-testid="phonon-units-highlight-plot"
  />
</TestSection>

<TestSection title="Electronic spin overlay and gap annotation">
  <Bands
    band_structs={electronic}
    band_spin_mode="overlay"
    data-testid="electronic-spin-overlay-plot"
  />
</TestSection>

<TestSection title="Electronic spin down only">
  <Bands
    band_structs={electronic}
    band_spin_mode="down_only"
    data-testid="electronic-spin-down-only-plot"
  />
</TestSection>
