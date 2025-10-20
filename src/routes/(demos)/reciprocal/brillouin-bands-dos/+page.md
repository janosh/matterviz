# Band Structure, DOS, and Brillouin Zone

Integrated visualization of band structures, density of states, and Brillouin zone with k-path synchronization.

## Basic Three-Panel View with Custom Styling

Phonon band structure with DOS and Brillouin zone, customized layout and styling:

```svelte example
<script>
  import { BrillouinBandsDos } from 'matterviz'
  import { phonon_bands, phonon_dos } from '$site/phonons'
  import phonon_data from '$site/phonons/mp-2758-Sr4Se4-pbe.json'

  const band_structs = [phonon_bands['mp-2758-Sr4Se4-pbe']]
  const doses = [phonon_dos['mp-2758-Sr4Se4-pbe']]
  const structure = phonon_data.primitive

  const bands_props = {
    line_kwargs: {
      acoustic: { stroke: '#e74c3c', stroke_width: 2 },
      optical: { stroke: '#3498db', stroke_width: 1.5 },
    },
  }

  const dos_props = { normalize: 'max', sigma: 0.15 }
</script>

<BrillouinBandsDos
  {structure}
  {band_structs}
  {doses}
  {bands_props}
  {dos_props}
  style="grid-template-columns: 35% 45% 20%; margin-block: 1em 2em"
  class="full-bleed"
/>
```

## With Interactive BZ Controls and Custom Colors

Enable Brillouin zone controls with custom appearance:

```svelte example
<script>
  import { BrillouinBandsDos } from 'matterviz'
  import { phonon_bands, phonon_dos } from '$site/phonons'
  import phonon_data from '$site/phonons/mp-2758-Sr4Se4-pbe.json'

  const band_structs = [phonon_bands['mp-2758-Sr4Se4-pbe']]
  const doses = [phonon_dos['mp-2758-Sr4Se4-pbe']]
  const structure = phonon_data.primitive

  let surface_color = $state('#9b59b6')
  let surface_opacity = $state(0.5)
  let edge_color = $state('#2c3e50')
</script>

<BrillouinBandsDos
  {structure}
  {band_structs}
  {doses}
  bz_props={{ show_controls: true, surface_color, surface_opacity, edge_color }}
  class="full-bleed"
  style="margin-block: 1em 2em"
/>
```

## Independent Y-Axes

Disable shared y-axis between bands and DOS panels:

```svelte example
<script>
  import { BrillouinBandsDos } from 'matterviz'
  import { phonon_bands, phonon_dos } from '$site/phonons'
  import phonon_data from '$site/phonons/mp-2758-Sr4Se4-pbe.json'

  const band_structs = [phonon_bands['mp-2758-Sr4Se4-pbe']]
  const doses = [phonon_dos['mp-2758-Sr4Se4-pbe']]
  const structure = phonon_data.primitive
</script>

<BrillouinBandsDos
  {structure}
  {band_structs}
  {doses}
  shared_y_axis={false}
  class="full-bleed"
  style="margin-block: 1em 2em"
/>
```

## Features

- **Three-panel layout**: Brillouin zone (30%), band structure (50%), and DOS (20%)
- **K-path visualization**: Band structure path displayed in Brillouin zone
- **Hover synchronization**: Hovering over bands highlights the corresponding point in reciprocal space
- **Shared y-axis**: Optional synchronization between bands and DOS panels
- **Interactive BZ**: Full 3D controls for rotating and exploring the Brillouin zone
- **Custom styling**: Individual control over each panel's appearance
- **Responsive**: Adapts to container size with adjustable column widths
