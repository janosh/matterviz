<script lang="ts">
  import { normalize_dos } from '#lib/spectral/index.js'
  import BandsAndDos from '#lib/spectral/BandsAndDos.svelte'
  import type { PhononDos } from '#lib/spectral/types.js'
  import { electronic_bands } from '#site/electronic/bands/index.js'
  import { dos_spin_polarization } from '#site/electronic/dos/index.js'
  import { custom_overlay_style, mock_band_structure, mock_dos } from '#site/spectral-mocks.js'
  import TestControls from '../TestControls.svelte'
  import TestSection from '../TestSection.svelte'

  // Testing: CaO bands + mp-865805 DOS (mismatched materials, no shifts applied)
  const electronic_dos = normalize_dos(dos_spin_polarization)
  if (!electronic_dos) throw new Error(`Invalid electronic DOS fixture`)

  const high_freq_dos: PhononDos = {
    type: `phonon`,
    frequencies: [10, 20, 30, 40],
    densities: [1, 2, 1, 0],
  }
  const phonon_props = { band_structs: { '': mock_band_structure }, doses: { '': mock_dos } }
  const electronic_dos_props = {
    doses: { '': electronic_dos },
    dos_props: { y_axis: { label: `` } },
  }
  let sync_y_zoom = $state(true)
</script>

<h1>BandsAndDos test page</h1>

<TestSection title="Default (shared y-axis)">
  <TestControls>
    <button data-testid="toggle-y-zoom-sync" onclick={() => (sync_y_zoom = !sync_y_zoom)}>
      {sync_y_zoom ? `Disable` : `Enable`} y zoom sync
    </button>
  </TestControls>
  <BandsAndDos {...phonon_props} {sync_y_zoom} data-testid="bands-and-dos-default" />
</TestSection>

<TestSection title="Custom subplot widths">
  <BandsAndDos
    {...phonon_props}
    style="grid-template-columns: 60% 40%"
    data-testid="bands-and-dos-custom-widths"
  />
</TestSection>

<TestSection title="Custom bands styling">
  <BandsAndDos
    {...phonon_props}
    bands_props={{ line_kwargs: { stroke: `red` } }}
    data-testid="bands-and-dos-bands-styling"
  />
</TestSection>

<TestSection title="Independent y-axes (mismatched ranges)" id="independent-axes">
  <BandsAndDos
    band_structs={{ '': mock_band_structure }}
    doses={{ '': high_freq_dos }}
    shared_y_axis={false}
    style="position: relative"
    data-testid="bands-and-dos-independent-axes"
  >
    <div class="custom-overlay" style={custom_overlay_style}>Custom Overlay</div>
  </BandsAndDos>
</TestSection>

<TestSection
  title="Electronic bands (CaO)"
  description="Electronic band structure. The Fermi level is detected automatically and drawn as a dashed red line."
  id="electronic-bands"
>
  <BandsAndDos
    band_structs={{ '': electronic_bands.cao_2605 }}
    {...electronic_dos_props}
    bands_props={{ y_axis: { label: `Energy (eV)` } }}
    data-testid="bands-and-dos-electronic"
  />
</TestSection>

<TestSection
  title="Electronic bands (VBr₂ spin-polarized)"
  description="Spin-polarized electronic band structure showing both spin channels and the Fermi level marker."
  id="electronic-spin-polarized"
>
  <BandsAndDos
    band_structs={{ '': electronic_bands.vbr2_971787 }}
    {...electronic_dos_props}
    bands_props={{ y_axis: { label: `Energy (eV)` }, line_kwargs: { stroke_width: 1.5 } }}
    data-testid="bands-and-dos-spin-polarized"
  />
</TestSection>
