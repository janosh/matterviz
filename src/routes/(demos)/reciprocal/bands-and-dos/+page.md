# Band Structure and DOS

Combined visualization of band structures with density of states.

## Basic Combined Plot

Phonon band structure with DOS side-by-side:

```svelte example
<script>
  import { BandsAndDos } from 'matterviz'
  import { phonon_bands, phonon_dos } from '$site/phonons'

  const band_structs = [phonon_bands['mp-2758-Sr4Se4-pbe']]
  const doses = [phonon_dos['mp-2758-Sr4Se4-pbe']]
</script>

<BandsAndDos {band_structs} {doses} class="full-bleed" style="aspect-ratio: 3" />
```

## Custom Subplot Widths

Adjust the relative widths of the band structure and DOS panels:

```svelte example
<script>
  import { BandsAndDos } from 'matterviz'
  import { phonon_bands, phonon_dos } from '$site/phonons'

  const band_structs = [phonon_bands['mp-2758-Sr4Se4-pbe']]
  const doses = [phonon_dos['mp-2758-Sr4Se4-pbe']]
</script>

<BandsAndDos
  {band_structs}
  {doses}
  class="full-bleed"
  style="aspect-ratio: 3; grid-template-columns: 55% 45%"
/>
```

## Multiple Structures

Compare multiple band structures and DOS:

```svelte example
<script>
  import { BandsAndDos } from 'matterviz'
  import { phonon_bands, phonon_dos } from '$site/phonons'

  const bands_single = phonon_bands['mp-2758-Sr4Se4-pbe']
  const dos = phonon_dos['mp-2758-Sr4Se4-pbe']

  // Create multiple versions for comparison
  const band_structs = {
    'DFT': bands_single,
    'Model': {
      ...bands_single,
      bands: bands_single.bands.map((band) => band.map((f) => f * 1.05)),
    },
  }

  const doses = {
    'DFT': dos,
    'Model': {
      ...dos,
      densities: dos.densities.map((d) => d * 1.1),
    },
  }
</script>

<BandsAndDos {band_structs} {doses} class="full-bleed" style="aspect-ratio: 3" />
```

## With Custom Styling

Apply custom styling to both panels:

```svelte example
<script>
  import { BandsAndDos } from 'matterviz'
  import { phonon_bands, phonon_dos } from '$site/phonons'

  const band_structs = [phonon_bands['mp-2758-Sr4Se4-pbe']]
  const doses = [phonon_dos['mp-2758-Sr4Se4-pbe']]

  const bands_props = {
    line_kwargs: {
      acoustic: { stroke: '#e74c3c', stroke_width: 2 },
      optical: { stroke: '#3498db', stroke_width: 1.5 },
    },
  }

  const dos_props = { normalize: 'max', sigma: 0.15 }
</script>

<BandsAndDos
  {band_structs}
  {doses}
  {bands_props}
  {dos_props}
  class="full-bleed"
  style="aspect-ratio: 3"
/>
```

## Shared Y-Axis

Synchronize the y-axes between panels:

```svelte example
<script>
  import { BandsAndDos } from 'matterviz'
  import { phonon_bands, phonon_dos } from '$site/phonons'

  const band_structs = [phonon_bands['mp-2758-Sr4Se4-pbe']]
  const doses = [phonon_dos['mp-2758-Sr4Se4-pbe']]
</script>

<BandsAndDos
  {band_structs}
  {doses}
  shared_y_axis
  class="full-bleed"
  style="aspect-ratio: 3"
/>
```

## With Controls

Enable interactive controls for both panels:

```svelte example
<script>
  import { BandsAndDos } from 'matterviz'
  import { phonon_bands, phonon_dos } from '$site/phonons'

  const band_structs = [phonon_bands['mp-2758-Sr4Se4-pbe']]
  const doses = [phonon_dos['mp-2758-Sr4Se4-pbe']]

  const bands_props = { controls: { show: true, open: false } }
  const dos_props = { controls: { show: true, open: false } }
</script>

<BandsAndDos
  {band_structs}
  {doses}
  {bands_props}
  {dos_props}
  class="full-bleed"
  style="aspect-ratio: 3"
/>
```

## Features

- **Side-by-side layout**: Band structure and DOS in synchronized panels
- **Shared axes**: Optional y-axis synchronization
- **Custom widths**: Adjust relative panel sizes
- **All band features**: Includes all band structure customization options
- **All DOS features**: Includes all DOS customization options
- **Responsive**: Adapts to container size
- **Interactive**: Synchronized zoom and pan between panels
