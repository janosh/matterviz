<script lang="ts">
  import {
    PhononModeExplorer,
    parse_born,
    parse_phonon_modes,
    spectrum_from_phonon_data,
  } from '$lib/spectral'
  import born_file from '$site/phonons/ir-raman/NaCl.BORN?raw'
  import band_yaml from '$site/phonons/ir-raman/NaCl-Gamma-X-band.yaml?raw'

  const mode_data = parse_phonon_modes(band_yaml)
  const spectrum = spectrum_from_phonon_data(mode_data, parse_born(born_file))
</script>

<h1>Phonon mode explorer</h1>
<PhononModeExplorer
  id="phonon-mode-explorer"
  {mode_data}
  {spectrum}
  auto_play={false}
  style="height: 720px"
/>
