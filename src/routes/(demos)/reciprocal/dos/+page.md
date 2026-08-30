# Density of States (DOS)

The `Dos` component visualizes electronic and phonon density of states from pymatgen-compatible data.

## Basic Usage

Pass DOS data to the `doses` prop. The component auto-detects phonon vs electronic data:

```svelte example
<script lang="ts">
  import { Dos } from 'matterviz'
  import { phonon_dos } from '$site/phonons'
</script>

<Dos doses={phonon_dos['mp-2758-Sr4Se4-pbe']} />
```

## Electronic DOS with Spin Polarization

Electronic DOS from pymatgen `CompleteDos` and `LobsterCompleteDos` objects render directly. Spin-polarized data (stored as `{1: [...], -1: [...]}`) is automatically extracted and drawn according to `spin_mode`: `mirror` (default, spin-down below zero), `overlay`, `up_only` or `down_only`. Use `shift_to_fermi()` to center energies at E_F = 0:

```svelte example
<script lang="ts">
  import { Dos } from 'matterviz'
  import { shift_to_fermi } from '$lib/spectral/helpers'
  import { dos_spin_polarization } from '$site/electronic/dos'
</script>

<Dos doses={shift_to_fermi(dos_spin_polarization)} />
```

## Projected DOS (pDOS)

Extract atom-resolved or orbital-resolved projections from `CompleteDos` using `pdos_type`:

```svelte example
<script lang="ts">
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

<Dos doses={shift_to_fermi(dos_spin_polarization)} {pdos_type} stack spin_mode="up_only" />
```

## Stacking and Smearing

Use `stack` for filled areas, `sigma` for Gaussian smearing and `normalize` (`max`, `sum`, `integral`). Phonon DOS also accepts `units` (`THz`, `eV`, `meV`, `Ha`, `cm^-1`).

```svelte example
<script lang="ts">
  import { Dos } from 'matterviz'
  import { phonon_dos } from '$site/phonons'

  const dos = phonon_dos['mp-2758-Sr4Se4-pbe']
  const doses = {
    'Mode A': { ...dos, densities: dos.densities.map((density) => density * 0.45) },
    'Mode B': { ...dos, densities: dos.densities.map((density) => density * 0.35) },
    'Mode C': { ...dos, densities: dos.densities.map((density) => density * 0.2) },
  }
</script>

<Dos {doses} normalize="max" sigma={0.1} stack />
```

## Thermal Properties

`thermal_properties(dos, temperatures, unit)` integrates the Bose–Einstein occupation over a phonon DOS to give the harmonic free energy F, internal energy U, entropy S and heat capacity C<sub>v</sub> (eV and eV/K per whatever the DOS integrates to, 3N modes per cell here). `PhononThermalPlot` draws them against temperature, in phonopy's kJ/mol and J/(K·mol) by default, with F and U on the left axis and S and C<sub>v</sub> on the right. For this simulated Sr<sub>4</sub>Se<sub>4</sub> DOS (2 atoms in the primitive cell) C<sub>v</sub> tends to the classical limit of 6 k<sub>B</sub> ≈ 49.9 J/(K·mol), reaching 49.5 by 500 K:

```svelte example
<script lang="ts">
  import { PhononThermalPlot, format_num } from 'matterviz'
  import type { ThermalProperties } from 'matterviz'
  import { phonon_dos } from '$site/phonons'

  let energy_unit = $state<'kJ/mol' | 'eV'>(`kJ/mol`)
  let thermal = $state<ThermalProperties>()
  const temperatures = Array.from({ length: 81 }, (_, idx) => 10 * idx)
</script>

<label style="display: block; margin-bottom: 1ex">
  Units
  <select bind:value={energy_unit}>
    <option value="kJ/mol">kJ/mol, J/(K·mol)</option>
    <option value="eV">eV, meV/K</option>
  </select>
  {#if thermal}
    · zero-point energy {format_num(thermal.zero_point_energy, `.4f`)} eV/cell
  {/if}
</label>

<PhononThermalPlot
  dos={phonon_dos['mp-2758-Sr4Se4-pbe']}
  {temperatures}
  {energy_unit}
  bind:thermal
/>
```

## Interactive Explorer

Browse all available DOS files. Click to load, use controls to adjust visualization:

```svelte example
<script lang="ts">
  import { Dos, FilePicker } from 'matterviz'
  import { shift_to_fermi } from '$lib/spectral/helpers'
  import { dos_spin_polarization, get_dos } from '$site/electronic/dos'
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
      data: get_dos('lobster'),
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

  const current_dos = $derived(files.find((file) => file.name === active_file)?.data)
  const is_electronic = $derived(
    files.find((file) => file.name === active_file)?.category === 'Electronic',
  )
</script>

<div
  style="display: flex; gap: 1em; margin-bottom: 0.5em; align-items: center; flex-wrap: wrap"
>
  <FilePicker
    files={files.map((file) => ({
      name: file.name,
      category: file.category,
      category_icon: file.category_icon,
    }))}
    active_files={[active_file]}
    show_category_filters
    on_click={(file) => ([active_file, pdos_type] = [file.name, null])}
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
