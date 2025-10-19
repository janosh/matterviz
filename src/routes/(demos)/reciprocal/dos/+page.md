# Density of States (DOS)

Interactive phonon and electronic density of states visualization.

## Basic Phonon DOS

A simple phonon DOS plot:

```svelte example
<script>
  import { Dos } from 'matterviz'
  import { phonon_dos } from '$site/phonons'
</script>

<Dos doses={[phonon_dos['mp-2758-Sr4Se4-pbe']]} />
```

## Normalized DOS

Normalize the DOS to maximum value:

```svelte example
<script>
  import { Dos } from 'matterviz'
  import { phonon_dos } from '$site/phonons'
</script>

<Dos doses={[phonon_dos['mp-2758-Sr4Se4-pbe']]} normalize="max" />
```

## Multiple DOS

```svelte example
<script>
  import { Dos } from 'matterviz'
  import { phonon_dos } from '$site/phonons'

  const dos = phonon_dos['mp-2758-Sr4Se4-pbe']

  // Create multiple versions for demo
  const doses = {
    'Total': dos,
    'Partial A': { ...dos, densities: dos.densities.map((d) => d * 0.6) },
    'Partial B': { ...dos, densities: dos.densities.map((d) => d * 0.4) },
  }
</script>

<Dos {doses} />
```

## With Gaussian Smearing

Apply Gaussian smearing to smooth the DOS:

```svelte example
<script>
  import { Dos } from 'matterviz'
  import { phonon_dos } from '$site/phonons'
</script>

<Dos doses={[phonon_dos['mp-2758-Sr4Se4-pbe']]} sigma={0.2} />
```

## Horizontal Orientation

For side-by-side layout with band structures:

```svelte example
<script>
  import { Dos } from 'matterviz'
  import { phonon_dos } from '$site/phonons'
</script>

<Dos doses={[phonon_dos['mp-2758-Sr4Se4-pbe']]} orientation="horizontal" />
```

## Unit Conversion

Convert frequencies to different units:

```svelte example
<script>
  import { Dos } from 'matterviz'
  import { phonon_dos } from '$site/phonons'

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

<Dos doses={[phonon_dos['mp-2758-Sr4Se4-pbe']]} units={selected_unit} />
```

## Features

- **Normalization**: Max, sum, or integral normalization
- **Stacking**: Area plots for multiple DOS
- **Smearing**: Gaussian broadening with configurable σ
- **Unit conversion**: THz, eV, meV, Ha, cm⁻¹
- **Orientation**: Vertical or horizontal for layout flexibility
- **Interactive**: Zoom, pan, hover tooltips
