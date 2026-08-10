# Band Structure and DOS

## Electronic Bands with Fermi Level

This example uses bands and DOS from different materials.

```svelte example
<script lang="ts">
  import { BandsAndDos } from 'matterviz'
  import { electronic_bands } from '$site/electronic/bands'
  import { dos_spin_polarization } from '$site/electronic/dos'
</script>

<BandsAndDos
  band_structs={electronic_bands.cao_2605}
  doses={dos_spin_polarization}
  bands_props={{ y_axis: { label: 'Energy (eV)' } }}
  dos_props={{ y_axis: { label: '' } }}
  shared_y_axis
  class="full-bleed"
  style="aspect-ratio: 3"
/>
```

## Phonon Bands with Custom Styling

```svelte example
<script lang="ts">
  import { BandsAndDos } from 'matterviz'
  import { phonon_bands, phonon_dos } from '$site/phonons'
</script>

<BandsAndDos
  band_structs={[phonon_bands['mp-2758-Sr4Se4-pbe']]}
  doses={[phonon_dos['mp-2758-Sr4Se4-pbe']]}
  bands_props={{
    line_kwargs: {
      acoustic: { stroke: '#e74c3c', stroke_width: 2 },
      optical: { stroke: '#3498db', stroke_width: 1.5 },
    },
  }}
  dos_props={{ normalize: 'max', sigma: 0.15 }}
  shared_y_axis
  class="full-bleed"
  style="aspect-ratio: 3"
/>
```

## Multiple bands and DOS comparison

```svelte example
<script lang="ts">
  import { BandsAndDos } from 'matterviz'
  import { phonon_bands, phonon_dos } from '$site/phonons'
</script>

<BandsAndDos
  band_structs={{
    'DFT (PBE)': phonon_bands['mp-2758-Sr4Se4-pbe'],
    M3GNet: phonon_bands['mp-2758-Sr4Se4-m3gnet'],
    CHGNet: phonon_bands['mp-2758-Sr4Se4-chgnet-v0.3.0'],
  }}
  doses={{
    'DFT (PBE)': phonon_dos['mp-2758-Sr4Se4-pbe'],
    M3GNet: phonon_dos['mp-2758-Sr4Se4-m3gnet'],
    CHGNet: phonon_dos['mp-2758-Sr4Se4-chgnet-v0.3.0'],
  }}
  dos_props={{ normalize: 'max', sigma: 0.15 }}
  shared_y_axis
  class="full-bleed"
  style="aspect-ratio: 3"
/>
```

## Forwarding `Bands` Options

`bands_props` and `dos_props` forward options to the underlying plots.

```svelte example
<script lang="ts">
  import { BandsAndDos } from 'matterviz'
  import { electronic_bands } from '$site/electronic/bands'
  import { dos_spin_polarization } from '$site/electronic/dos'
</script>

<BandsAndDos
  band_structs={electronic_bands.vbr2_971787}
  doses={dos_spin_polarization}
  bands_props={{
    band_spin_mode: 'overlay',
    show_gap_annotation: true,
    path_mode: 'intersection',
    show_controls: true,
  }}
  dos_props={{ spin_mode: 'mirror', sigma: 0.1 }}
  shared_y_axis
  class="full-bleed"
  style="aspect-ratio: 3"
/>
```
