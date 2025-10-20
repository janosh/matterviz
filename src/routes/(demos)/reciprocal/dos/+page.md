# Density of States (DOS)

Interactive phonon and electronic density of states visualization.

## Basic DOS with Normalization and Smearing

A phonon DOS plot with normalization and Gaussian smearing:

```svelte example
<script>
  import { Dos } from 'matterviz'
  import { phonon_dos } from '$site/phonons'
</script>

<Dos doses={[phonon_dos['mp-2758-Sr4Se4-pbe']]} normalize="max" sigma={0.15} />
```

## Multiple DOS with Unit Conversion

Compare multiple DOS curves with interactive unit conversion:

```svelte example
<script>
  import { Dos } from 'matterviz'
  import { phonon_dos } from '$site/phonons'

  const dos = phonon_dos['mp-2758-Sr4Se4-pbe']

  // Create multiple versions for demo
  const doses = {
    'Total': dos,
    'Partial A': { ...dos, densities: dos.densities.map((dens) => dens * 0.6) },
    'Partial B': { ...dos, densities: dos.densities.map((dens) => dens * 0.4) },
  }

  let selected_unit = $state('THz')
  const units = ['THz', 'eV', 'meV', 'Ha', 'cm-1']
</script>

<label>
  Unit:
  <select bind:value={selected_unit}>
    {#each units as unit}
      <option value={unit}>{unit}</option>
    {/each}
  </select>
</label>

<Dos {doses} units={selected_unit} />
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
