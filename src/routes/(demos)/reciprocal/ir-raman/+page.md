# IR and Raman Spectra

The `IrRamanSpectrum` component renders vibrational spectra from phonon modes at Γ. Infrared intensities are computed here from Born effective charges and phonon eigenvectors. Raman activities are **not** computed from eigenvectors — they require polarizability derivatives that phonopy does not produce, so they must be supplied as per-mode tensors or precomputed activities.

## Where the data comes from

Three inputs are needed:

| Input                      | Source                                                   | Parser                               |
| -------------------------- | -------------------------------------------------------- | ------------------------------------ |
| Frequencies + eigenvectors | phonopy `band.yaml` / `qpoints.yaml` / `mesh.yaml`       | `parse_phonon_modes`                 |
| Born charges + dielectric  | phonopy `BORN`                                           | `parse_born`                         |
| Polarizability derivatives | LEPSILON finite differences (VASP, phonopy-spectroscopy) | supplied directly as `raman_tensors` |

Eigenvectors follow phonopy's convention: eigenvectors of the mass-weighted dynamical matrix, normalised to `sum |e|² = 1`, so the physical displacement of atom κ is `e_κ / sqrt(M_κ)`. `parse_phonon_modes` verifies the normalisation and rejects files that violate it.

> The two fixtures used below are **synthetic**. Their eigenvectors are exact — every mode of a two-atom cell and of a linear symmetric triatomic is fixed by symmetry alone — and their frequencies are experimental, but no DFT run produced them. See the header comments in the YAML files.

## Infrared spectrum of NaCl

Rocksalt NaCl has one triply degenerate T₁u optical mode. Its IR intensity is analytic, `Z*²/μ` with μ the reduced mass, which makes it a good end-to-end check of the pipeline.

```svelte example
<script lang="ts">
  import { IrRamanSpectrum } from '$lib/spectral'
  import { parse_born, parse_phonon_modes, spectrum_from_phonon_data } from '$lib/spectral'
  import born_file from '$site/phonons/ir-raman/NaCl.BORN?raw'
  import yaml_file from '$site/phonons/ir-raman/NaCl-gamma.yaml?raw'

  const spectrum = spectrum_from_phonon_data(
    parse_phonon_modes(yaml_file),
    parse_born(born_file),
  )
</script>

<IrRamanSpectrum {spectrum} fwhm={8} style="height: 400px" />
```

The three acoustic modes are identified at Γ and excluded from the stick spectrum: with `sum_κ Z*_κ = 0` and every atom displaced identically, their dipole derivative cancels exactly.

## Mutual exclusion in centrosymmetric CO₂

CO₂ has an inversion centre, so no mode can be both IR and Raman active. Switch between the two spectra in the controls pane (hover the plot to reveal it): the ν₂ bend at 667 cm⁻¹ and ν₃ antisymmetric stretch at 2349 cm⁻¹ appear only in the IR, the ν₁ symmetric stretch at 1333 cm⁻¹ only in the Raman.

```svelte example
<script lang="ts">
  import { IrRamanSpectrum } from '$lib/spectral'
  import { parse_born, parse_phonon_modes, spectrum_from_phonon_data } from '$lib/spectral'
  import type { SpectrumKind } from '$lib/spectral'
  import raman_data from '$site/phonons/ir-raman/CO2-raman-tensors.json'
  import born_file from '$site/phonons/ir-raman/CO2.BORN?raw'
  import yaml_file from '$site/phonons/ir-raman/CO2-gamma.yaml?raw'

  const spectrum = spectrum_from_phonon_data(
    parse_phonon_modes(yaml_file),
    parse_born(born_file),
    { raman_tensors: raman_data.raman_tensors },
  )

  let kind = $state<SpectrumKind>('ir')
</script>

<label style="display: block; margin-bottom: 0.5em">
  Spectrum:
  <select bind:value={kind}>
    <option value="ir">Infrared</option>
    <option value="raman">Raman</option>
  </select>
</label>

<IrRamanSpectrum {spectrum} bind:kind fwhm={25} style="height: 400px" />
```

## Transmittance presentation

IR spectra are conventionally plotted as transmittance, with absorption bands pointing down. Set `presentation="transmittance"`; the peak shape (Gaussian ↔ Lorentzian) and width are adjustable in the controls pane.

```svelte example
<script lang="ts">
  import { IrRamanSpectrum } from '$lib/spectral'
  import { parse_born, parse_phonon_modes, spectrum_from_phonon_data } from '$lib/spectral'
  import born_file from '$site/phonons/ir-raman/CO2.BORN?raw'
  import yaml_file from '$site/phonons/ir-raman/CO2-gamma.yaml?raw'

  const spectrum = spectrum_from_phonon_data(
    parse_phonon_modes(yaml_file),
    parse_born(born_file),
  )
</script>

<IrRamanSpectrum
  {spectrum}
  presentation="transmittance"
  fwhm={30}
  shape_factor={1}
  style="height: 400px"
/>
```

## Mode table

Every computed quantity is available per mode, so the raw numbers can be tabulated instead of plotted.

```svelte example
<script lang="ts">
  import { format_num } from '$lib/labels'
  import { convert_frequencies } from '$lib/spectral'
  import { parse_born, parse_phonon_modes, spectrum_from_phonon_data } from '$lib/spectral'
  import raman_data from '$site/phonons/ir-raman/CO2-raman-tensors.json'
  import born_file from '$site/phonons/ir-raman/CO2.BORN?raw'
  import yaml_file from '$site/phonons/ir-raman/CO2-gamma.yaml?raw'

  const spectrum = spectrum_from_phonon_data(
    parse_phonon_modes(yaml_file),
    parse_born(born_file),
    { raman_tensors: raman_data.raman_tensors },
  )
  const labels = raman_data.mode_labels
</script>

<table>
  <thead>
    <tr>
      <th>Mode</th>
      <th>ω (cm⁻¹)</th>
      <th>IR (e²/amu)</th>
      <th>Raman (a.u.)</th>
      <th>Character</th>
    </tr>
  </thead>
  <tbody>
    {#each spectrum.modes as mode (mode.mode_idx)}
      <tr>
        <td>{labels[mode.mode_idx]}</td>
        <td>{format_num(convert_frequencies([mode.frequency], 'cm-1')[0], '.1f')}</td>
        <td>{format_num(mode.ir_intensity, '.2~e')}</td>
        <td>{format_num(mode.raman_activity ?? 0, '.2~e')}</td>
        <td
          >{mode.is_acoustic
            ? 'acoustic'
            : mode.ir_intensity > 1e-12
              ? 'IR'
              : 'Raman/silent'}</td
        >
      </tr>
    {/each}
  </tbody>
</table>
```

## Traps this component deliberately avoids

- **`normalize_dos` is not used.** It assumes any frequency above 100 must be in cm⁻¹ and silently divides by 33.36. Vibrational spectra routinely reach 4000 cm⁻¹, so IR/Raman data uses its own `VibrationalSpectrum` type and never touches the DOS normalisation path.
- **`apply_gaussian_smearing` is not used.** It smears values already on a grid and renormalises to preserve their sum, which is not a stick-to-continuum convolution. Broadening goes through `broaden_peaks` from the XRD module with an injected constant (or frequency-dependent) FWHM, so line shapes are area-normalised and the integrated intensity of each mode is preserved.
