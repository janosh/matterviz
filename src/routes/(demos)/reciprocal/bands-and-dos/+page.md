# Band Structure and DOS

Combined visualization of band structures with density of states.

## Electronic Bands with Fermi Level

Electronic band structures display the Fermi level (E<sub>F</sub>) as a dashed red line when `efermi` is present. Note: this example uses bands and DOS from different materials for demonstration purposes.

```svelte example
<script>
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

Phonon band structure with DOS side-by-side, synchronized axes and custom styling:

```svelte example
<script>
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

Compare band structures and DOS from different computational methods:

```svelte example
<script>
  import { BandsAndDos } from 'matterviz'
  import { phonon_bands, phonon_dos } from '$site/phonons'
</script>

<BandsAndDos
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
  dos_props={{ normalize: 'max', sigma: 0.15 }}
  shared_y_axis
  class="full-bleed"
  style="aspect-ratio: 3"
/>
```
