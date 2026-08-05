# IR and Raman Spectra

The `IrRamanSpectrum` component renders vibrational spectra from phonon modes at Γ. Infrared intensities are computed here from Born effective charges and phonon eigenvectors. Raman activities are **not** computed from eigenvectors. They need polarizability derivatives that phonopy does not produce, so supply per-mode tensors or precomputed activities.

## Where the data comes from

Three inputs are needed:

| Input                      | Source                                                   | Parser                               |
| -------------------------- | -------------------------------------------------------- | ------------------------------------ |
| Frequencies + eigenvectors | phonopy `band.yaml` / `qpoints.yaml` / `mesh.yaml`       | `parse_phonon_modes`                 |
| Born charges + dielectric  | phonopy `BORN`                                           | `parse_born`                         |
| Polarizability derivatives | LEPSILON finite differences (VASP, phonopy-spectroscopy) | supplied directly as `raman_tensors` |

Eigenvectors follow phonopy's convention: eigenvectors of the mass-weighted dynamical matrix, normalised to `sum |e|² = 1`, so the physical displacement of atom κ is `e_κ / sqrt(M_κ)`. `parse_phonon_modes` verifies the normalisation and rejects files that violate it.

> **NaCl** is real first-principles data: Γ-point modes and Born effective charges from [PhononDB](https://github.com/atztogo/phonondb) (PBEsol, [dataset](https://mdr.nims.go.jp/concern/datasets/gf06g7088), DOI [10.48505/nims.4197](https://doi.org/10.48505/nims.4197)), solved from the published force constants with phonopy. Its TO mode lands at 168.5 cm⁻¹ against ~164 cm⁻¹ measured.
>
> **α-quartz** is real too: Γ modes, Born charges and polarizability derivatives from the [Phonopy-Spectroscopy](https://github.com/skelton-group/Phonopy-Spectroscopy/tree/master/example/a-SiO2) VASP example (MIT, © 2017 Jonathan Michael Skelton). Its `Raman-Tensors.yaml` lists only the Raman-active modes, so the four IR-active A₂ modes and the three acoustic branches are zero-filled to give one tensor per mode.
>
> Every fixture rendered on this page is first-principles output. A synthetic CO₂ fixture remains in the test suite as an analytic oracle (a linear symmetric triatomic is the one case with a closed-form IR intensity check), but it is not shown here.

## Infrared spectrum of NaCl

Rocksalt NaCl has one triply degenerate T₁u optical mode. Its IR intensity is analytic, `Z*²/μ` with μ the reduced mass, which makes it a good end-to-end check of the pipeline.

```svelte example
<script lang="ts">
  import { IrRamanSpectrum } from '$lib/spectral'
  import { parse_born, parse_phonon_modes, spectrum_from_phonon_data } from '$lib/spectral'
  import born_file from '$site/phonons/ir-raman/NaCl.BORN?raw'
  import yaml_file from '$site/phonons/ir-raman/NaCl-gamma.yaml.gz?raw'

  const spectrum = spectrum_from_phonon_data(
    parse_phonon_modes(yaml_file),
    parse_born(born_file),
  )
</script>

<IrRamanSpectrum {spectrum} fwhm={8} style="height: 400px" />
```

The three acoustic modes are identified at Γ and excluded from the stick spectrum: with `sum_κ Z*_κ = 0` and every atom displaced identically, their dipole derivative cancels exactly.

## IR and Raman selection rules in α-quartz

α-quartz (SiO₂, P3₁2₁) has point group 32, where A₁ modes are Raman-active but IR-silent, A₂ modes are IR-active but Raman-silent, and the doubly degenerate E modes are both. Switch between the two spectra in the controls pane (hover the plot to reveal it): four A₂ modes carry IR intensity and no Raman activity, and they are the only ones missing from the Raman trace.

```svelte example
<script lang="ts">
  import { IrRamanSpectrum } from '$lib/spectral'
  import { parse_born, parse_phonon_modes, spectrum_from_phonon_data } from '$lib/spectral'
  import type { SpectrumKind } from '$lib/spectral'
  import raman_data from '$site/phonons/ir-raman/SiO2-raman-tensors.json.gz'
  import born_file from '$site/phonons/ir-raman/SiO2.BORN?raw'
  import yaml_file from '$site/phonons/ir-raman/SiO2-gamma.yaml.gz?raw'

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
  import born_file from '$site/phonons/ir-raman/SiO2.BORN?raw'
  import yaml_file from '$site/phonons/ir-raman/SiO2-gamma.yaml.gz?raw'

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

Selected computed quantities are available per mode, so the raw numbers can be tabulated instead of plotted.

```svelte example
<script lang="ts">
  import {
    convert_frequencies,
    parse_born,
    parse_phonon_modes,
    spectrum_from_phonon_data,
  } from '$lib/spectral'
  import { HeatmapTable, type Label } from '$lib/table'
  import raman_data from '$site/phonons/ir-raman/SiO2-raman-tensors.json.gz'
  import born_file from '$site/phonons/ir-raman/SiO2.BORN?raw'
  import yaml_file from '$site/phonons/ir-raman/SiO2-gamma.yaml.gz?raw'

  const spectrum = spectrum_from_phonon_data(
    parse_phonon_modes(yaml_file),
    parse_born(born_file),
    { raman_tensors: raman_data.raman_tensors },
  )
  const frequencies = convert_frequencies(
    spectrum.modes.map((mode) => mode.frequency),
    `cm-1`,
  )
  const mode_data = spectrum.modes.map((mode, idx) => {
    const activity = [
      mode.ir_intensity > 1e-12 && `IR`,
      (mode.raman_activity ?? 0) > 1e-12 && `Raman`,
    ]
      .filter(Boolean)
      .join(` + `)
    return {
      mode: raman_data.mode_labels[mode.mode_idx],
      frequency: frequencies[idx],
      ir_intensity: mode.ir_intensity,
      raman_activity: mode.raman_activity ?? 0,
      character: mode.is_acoustic ? `acoustic` : activity || `silent`,
    }
  })
  const mode_columns = [
    { label: `Mode`, key: `mode`, color_scale: null, sticky: true },
    { label: `ω (cm⁻¹)`, key: `frequency`, format: `.1f` },
    { label: `IR (e²/amu)`, key: `ir_intensity`, format: `.2~e`, scale_type: `log` },
    { label: `Raman (a.u.)`, key: `raman_activity`, format: `.2~e`, scale_type: `log` },
    { label: `Character`, key: `character`, color_scale: null },
  ] satisfies Label[]
</script>

<HeatmapTable data={mode_data} columns={mode_columns} />
```

## Traps this component deliberately avoids

- **`normalize_dos` is not used.** It assumes any frequency above 100 must be in cm⁻¹ and silently divides by 33.36. Vibrational spectra routinely reach 4000 cm⁻¹, so IR/Raman data uses its own `VibrationalSpectrum` type and never touches the DOS normalisation path.
- **`apply_gaussian_smearing` is not used.** It smears values already on a grid and renormalises to preserve their sum, which is not a stick-to-continuum convolution. Broadening goes through `broaden_peaks` from `$lib/lineshape` with an injected constant (or frequency-dependent) FWHM, so line shapes are area-normalised and the integrated intensity of each mode is preserved.
