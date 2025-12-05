# Density of States (DOS)

Interactive phonon and electronic density of states visualization. The `Dos` component natively renders pymatgen DOS formats including `CompleteDos` and `LobsterCompleteDos`.

## Phonon DOS with Normalization and Smearing

A phonon DOS plot with normalization and Gaussian smearing:

```svelte example
<script>
  import { Dos } from 'matterviz'
  import { phonon_dos } from '$site/phonons'
</script>

<Dos doses={[phonon_dos['mp-2758-Sr4Se4-pbe']]} normalize="max" sigma={0.15} />
```

## Electronic DOS (Pymatgen CompleteDos)

Pymatgen's `CompleteDos` objects render directly, automatically extracting spin channels from `{1: [...], -1: [...]}` format:

```svelte example
<script>
  import { Dos } from 'matterviz'
  import { dos_spin_polarization } from '$site/electronic/dos'
</script>

<Dos doses={dos_spin_polarization} />
```

## Fermi Energy Shifting

Pymatgen DOS data includes `efermi` - use `shift_to_fermi()` to shift energies so E_F = 0:

```svelte example
<script>
  import { Dos } from 'matterviz'
  import { shift_to_fermi } from '$lib/spectral/helpers'
  import { dos_spin_polarization } from '$site/electronic/dos'

  // Shift energies so Fermi level (efermi=5.36 eV) is at E=0
  const dos_shifted = shift_to_fermi(dos_spin_polarization)
</script>

<Dos doses={dos_shifted} reference_frequency={0} />
```

## Multiple DOS with Interactive Controls

Compare multiple DOS curves with interactive unit conversion, normalization, and smearing:

```svelte example
<script>
  import { Dos } from 'matterviz'
  import { phonon_dos } from '$site/phonons'

  const dos = phonon_dos['mp-2758-Sr4Se4-pbe']
  const doses = {
    'Total': dos,
    'Partial A': { ...dos, densities: dos.densities.map((dens) => dens * 0.6) },
    'Partial B': { ...dos, densities: dos.densities.map((dens) => dens * 0.4) },
  }

  let selected_unit = $state('THz')
  const units = ['THz', 'meV']

  let normalize = $state('none')
  const normalize_options = ['none', 'max', 'sum', 'integral']
  let sigma = $state(0.15)
</script>

<div style="display: flex; gap: 1em; margin-block: 1em">
  <label>
    Unit:
    <select bind:value={selected_unit}>
      {#each units as unit (unit)}
        <option value={unit}>{unit}</option>
      {/each}
    </select>
  </label>

  <label>
    Normalize:
    <select bind:value={normalize}>
      {#each normalize_options as value (value)}
        <option {value}>{value}</option>
      {/each}
    </select>
  </label>

  <label>
    Smearing (σ):
    <input type="number" bind:value={sigma} min={0} max={1} step={0.05} />
  </label>
</div>

<Dos {doses} units={selected_unit} {normalize} {sigma} />
```

## Horizontal Orientation

For side-by-side layout with band structures:

```svelte example
<script>
  import { Dos } from 'matterviz'
  import { phonon_dos } from '$site/phonons'
</script>

<Dos doses={[phonon_dos['mp-2758-Sr4Se4-pbe']]} orientation="horizontal" sigma={0.15} />
```

## Features

- **Normalization**: Max, sum, or integral normalization
- **Stacking**: Area plots for multiple DOS
- **Smearing**: Gaussian broadening with configurable σ
- **Unit conversion**: THz, eV, meV, Ha, cm⁻¹
- **Orientation**: Vertical or horizontal for layout flexibility
- **Interactive**: Zoom, pan, hover tooltips
- **Pymatgen support**: `CompleteDos`, `LobsterCompleteDos`, spin-polarized data
