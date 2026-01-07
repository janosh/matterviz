# Density of States (DOS)

The `Dos` component visualizes electronic and phonon density of states from pymatgen-compatible data.

## Basic Usage

Pass DOS data to the `doses` prop. The component auto-detects phonon vs electronic data:

```svelte example
<script>
  import { Dos } from 'matterviz'
  import { phonon_dos } from '$site/phonons'
</script>

<Dos doses={phonon_dos['mp-2758-Sr4Se4-pbe']} />
```

## Electronic DOS with Spin Polarization

Electronic DOS from pymatgen `CompleteDos` objects render directly. Spin-polarized data (stored as `{1: [...], -1: [...]}`) is automatically extracted. Use `shift_to_fermi()` to center energies at E_F = 0:

```svelte example
<script>
  import { Dos } from 'matterviz'
  import { shift_to_fermi } from '$lib/spectral/helpers'
  import { dos_spin_polarization } from '$site/electronic/dos'
</script>

<Dos doses={shift_to_fermi(dos_spin_polarization)} />
```

The built-in toolbar (hover to reveal) lets you toggle between spin modes:

- **↕ Mirror**: Spin-up above, spin-down below zero
- **≡ Overlay**: Both spins on positive axis
- **↑/↓**: Single spin channel

## Projected DOS (pDOS)

Extract atom-resolved or orbital-resolved projections from `CompleteDos` using `pdos_type`:

```svelte example
<script>
  import { Dos } from 'matterviz'
  import { shift_to_fermi } from '$lib/spectral/helpers'
  import { dos_spin_polarization } from '$site/electronic/dos'

  let pdos_type = $state('atom')
</script>

<label style="display: block; margin-bottom: 0.5em">
  Projection:
  <select bind:value={pdos_type}>
    <option value="atom">Atom-resolved (Ta, Zn, Co)</option>
    <option value="orbital">Orbital-resolved (s, p, d)</option>
  </select>
</label>

<Dos
  doses={shift_to_fermi(dos_spin_polarization)}
  {pdos_type}
  stack
  spin_mode="up_only"
/>
```

## Stacking and Smearing

Multiple DOS curves can be stacked as filled areas. Gaussian smearing (σ) smooths noisy data:

```svelte example
<script>
  import { Dos } from 'matterviz'
  import { phonon_dos } from '$site/phonons'

  const dos = phonon_dos['mp-2758-Sr4Se4-pbe']
  const doses = {
    'Mode A': { ...dos, densities: dos.densities.map((d) => d * 0.45) },
    'Mode B': { ...dos, densities: dos.densities.map((d) => d * 0.35) },
    'Mode C': { ...dos, densities: dos.densities.map((d) => d * 0.2) },
  }
</script>

<Dos {doses} normalize="max" sigma={0.1} stack />
```

## Interactive Explorer

Browse all available DOS files. Click to load, use controls to adjust visualization:

```svelte example
<script>
  import { Dos, FilePicker } from 'matterviz'
  import { shift_to_fermi } from '$lib/spectral/helpers'
  import { dos_spin_polarization, lobster_complete_dos } from '$site/electronic/dos'
  import { phonon_dos } from '$site/phonons'

  const files = [
    {
      name: 'mp-865805 (Ta-Zn-Co)',
      data: shift_to_fermi(dos_spin_polarization),
      category: 'Electronic',
      category_icon: '⚡',
    },
    {
      name: 'KF Lobster',
      data: lobster_complete_dos,
      category: 'Electronic',
      category_icon: '⚡',
    },
    ...Object.entries(phonon_dos).map(([key, data]) => ({
      name: key.replace('mp-', '').replace(/-/g, ' '),
      data,
      category: 'Phonon',
      category_icon: '🔊',
    })),
  ]

  let active_file = $state(files[0].name)
  let pdos_type = $state(null)

  const current_dos = $derived(files.find((f) => f.name === active_file)?.data)
  const is_electronic = $derived(
    files.find((f) => f.name === active_file)?.category === 'Electronic',
  )
</script>

<div
  style="display: flex; gap: 1em; margin-bottom: 0.5em; align-items: center; flex-wrap: wrap"
>
  <FilePicker
    files={files.map((f) => ({
      name: f.name,
      category: f.category,
      category_icon: f.category_icon,
    }))}
    active_files={[active_file]}
    show_category_filters
    on_click={(file) => [active_file, pdos_type] = [file.name, null]}
  />
  {#if is_electronic}
    <select bind:value={pdos_type} style="padding: 4px">
      <option value={null}>Total DOS</option>
      <option value="atom">Atom pDOS</option>
      <option value="orbital">Orbital pDOS</option>
    </select>
  {/if}
</div>

<Dos
  doses={current_dos}
  {pdos_type}
  stack={pdos_type !== null}
  show_normalize_control
  show_units_control={!is_electronic}
/>
```

## Features

| Feature           | Description                            |
| ----------------- | -------------------------------------- |
| **Spin modes**    | Mirror, overlay, up-only, down-only    |
| **Projected DOS** | Atom and orbital (s, p, d) projections |
| **Stacking**      | Filled area plots                      |
| **Smearing**      | Gaussian broadening (σ slider)         |
| **Normalization** | Max, sum, integral                     |
| **Units**         | THz, eV, meV, Ha, cm⁻¹                 |
| **Formats**       | `CompleteDos`, `LobsterCompleteDos`    |
