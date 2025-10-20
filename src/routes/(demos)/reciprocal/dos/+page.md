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
