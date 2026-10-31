<script lang="ts">
  import { calc_lattice_params, type Matrix3x3, type Vec3 } from '#lib/math.js'
  import { BandsAndDos } from '#lib/spectral/index.js'
  import type { Crystal, Site } from '#lib/structure/index.js'
  import {
    custom_overlay_style,
    mock_band_structure_gxmg as mock_band_structure,
    mock_dos_gxmg as mock_dos,
  } from '#site/spectral-mocks.js'
  import TestSection from '../TestSection.svelte'

  const matrix: Matrix3x3 = [
    [4.0, 0.0, 0.0],
    [0.0, 4.0, 0.0],
    [0.0, 0.0, 4.0],
  ]
  const si_site = (abc: Vec3): Site => ({
    species: [{ element: `Si`, occu: 1, oxidation_state: 0 }],
    abc,
    xyz: [abc[0] * 4, abc[1] * 4, abc[2] * 4],
    label: `Si`,
    properties: {},
  })
  const mock_structure: Crystal = {
    lattice: { matrix, pbc: [true, true, true], ...calc_lattice_params(matrix) },
    sites: [si_site([0.0, 0.0, 0.0]), si_site([0.5, 0.5, 0.5])],
  }

  const shared_props = {
    structure: mock_structure,
    band_structs: { '': mock_band_structure },
    doses: { '': mock_dos },
    style: `min-height: 600px; position: relative`, // relative anchors the custom overlay
  }
</script>

<h1>BandsAndDos with Brillouin zone test page</h1>

<TestSection title="Default (shared y-axis)">
  <BandsAndDos {...shared_props} data-testid="bz-bands-dos-default" />
</TestSection>

<TestSection title="Custom bands styling">
  <BandsAndDos
    {...shared_props}
    bands_props={{ line_kwargs: { stroke: `red`, stroke_width: 3 } }}
    data-testid="bz-bands-dos-bands-styling"
  />
</TestSection>

<TestSection title="With Brillouin zone controls">
  <BandsAndDos
    {...shared_props}
    bz_props={{ show_controls: true }}
    data-testid="bz-bands-dos-with-controls"
  />
</TestSection>

<TestSection title="Multiple band structures and DOS" id="multiple-structures">
  <BandsAndDos
    {...shared_props}
    band_structs={{
      DFT: mock_band_structure,
      Model: {
        ...mock_band_structure,
        bands: mock_band_structure.bands.map((band) => band.map((freq) => freq * 1.1)),
      },
    }}
    doses={{
      DFT: mock_dos,
      Model: { ...mock_dos, densities: mock_dos.densities.map((dens) => dens * 1.2) },
    }}
    data-testid="bz-bands-dos-multiple"
  >
    <div class="custom-overlay" style={custom_overlay_style}>Custom Overlay</div>
  </BandsAndDos>
</TestSection>
