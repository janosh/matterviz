# Band Structure, DOS, and Brillouin Zone

Integrated visualization of band structures, density of states, and Brillouin zone with k-path synchronization.

## Electronic Bands with Fermi Level

Electronic band structures display the Fermi level (E<sub>F</sub>) as a dashed red line when `efermi` is present. Note: this example uses bands and DOS from different materials for demonstration.

```svelte example
<script lang="ts">
  import { BrillouinBandsDos } from 'matterviz'
  import { electronic_bands } from '$site/electronic/bands'
  import { dos_spin_polarization } from '$site/electronic/dos'
  import { structure_map } from '$site/structures'
</script>

<BrillouinBandsDos
  band_structs={electronic_bands.cao_2605}
  doses={dos_spin_polarization}
  structure={structure_map.get('mp-1')}
  bands_props={{ y_axis: { label: 'Energy (eV)' } }}
  dos_props={{ y_axis: { label: '' } }}
  class="full-bleed"
  style="margin-block: 1em 2em"
/>
```

## Phonon Bands with Custom Styling

Phonon band structure with acoustic/optical mode styling:

```svelte example
<script lang="ts">
  import { BrillouinBandsDos } from 'matterviz'
  import { phonon_bands, phonon_data, phonon_dos } from '$site/phonons'

  const bands_props = {
    line_kwargs: {
      acoustic: { stroke: '#e74c3c', stroke_width: 2 },
      optical: { stroke: '#3498db', stroke_width: 1.5 },
    },
  }
</script>

<BrillouinBandsDos
  band_structs={[phonon_bands['mp-2758-Sr4Se4-pbe']]}
  doses={[phonon_dos['mp-2758-Sr4Se4-pbe']]}
  structure={phonon_data['mp-2758-Sr4Se4-pbe']?.primitive}
  {bands_props}
  dos_props={{ normalize: 'max', sigma: 0.15 }}
  style="margin-block: 1em 2em"
  class="full-bleed"
/>
```

## Features

- **Customizable responsive 3-panel layout**: Brillouin zone, band structure, and DOS in side-by-side or stacked views based on screen size (with customizable column widths)
- **K-path visualization**: Band structure path displayed in Brillouin zone
- **Hover synchronization**: Hovering over bands highlights the corresponding point in reciprocal space
- **DOS hover reference lines**: Hovering over DOS shows synchronized horizontal reference lines across both plots to identify contributing bands
- **Interactive BZ**: Full 3D controls for rotating and exploring the Brillouin zone
- **Custom styling**: Individual control over each panel's appearance
- **Multiple datasets**: Compare band structures and DOS from different methods or calculations

## Comparing DFT vs ML potential

Compare phonon predictions from DFT and machine learning potentials:

```svelte example
<script lang="ts">
  import { BrillouinBandsDos } from 'matterviz'
  import { phonon_bands, phonon_data, phonon_dos } from '$site/phonons'
</script>

<BrillouinBandsDos
  band_structs={{
    'DFT (PBE)': phonon_bands['mp-2667-Cs1Au1-pbe'],
    'CHGNet': phonon_bands['mp-2667-Cs1Au1-chgnet-v0.3.0'],
  }}
  doses={{
    'DFT (PBE)': phonon_dos['mp-2667-Cs1Au1-pbe'],
    'CHGNet': phonon_dos['mp-2667-Cs1Au1-chgnet-v0.3.0'],
  }}
  structure={phonon_data['mp-2667-Cs1Au1-pbe']?.primitive}
  dos_props={{ normalize: 'max', sigma: 0.15 }}
  class="full-bleed"
  style="margin-block: 1em 2em"
/>
```

## Custom Brillouin zone appearance with multiple inputs

Customize the Brillouin zone appearance (colors, opacity, edges) via `bz_props`.

```svelte example
<script lang="ts">
  import { BrillouinBandsDos } from 'matterviz'
  import { phonon_bands, phonon_data, phonon_dos } from '$site/phonons'
</script>

<BrillouinBandsDos
  band_structs={{
    'DFT (PBE)': phonon_bands['mp-2758-Sr4Se4-pbe'],
    'M3GNet': phonon_bands['mp-2758-Sr4Se4-m3gnet'],
    'CHGNet': phonon_bands['mp-2758-Sr4Se4-chgnet-v0.3.0'],
  }}
  doses={{
    'DFT (PBE)': phonon_dos['mp-2758-Sr4Se4-pbe'],
    'M3GNet': phonon_dos['mp-2758-Sr4Se4-m3gnet'],
    'CHGNet': phonon_dos['mp-2758-Sr4Se4-chgnet-v0.3.0'],
  }}
  structure={phonon_data['mp-2758-Sr4Se4-pbe']?.primitive}
  dos_props={{ normalize: 'max', sigma: 0.15 }}
  bz_props={{ surface_color: '#9b59b6', surface_opacity: 0.5, edge_color: '#2c3e50' }}
  class="full-bleed"
  style="margin-block: 1em 2em"
/>
```
