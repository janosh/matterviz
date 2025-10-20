# Band Structure, DOS, and Brillouin Zone

Integrated visualization of band structures, density of states, and Brillouin zone with k-path synchronization.

## Phonon bands in three-panel view with custom column widths

```svelte example
<script>
  import { BrillouinBandsDos } from 'matterviz'
  import { phonon_bands, phonon_dos } from '$site/phonons'
  import phonon_data from '$site/phonons/mp-2758-Sr4Se4-pbe.json'

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
  structure={phonon_data.primitive}
  {bands_props}
  dos_props={{ normalize: 'max', sigma: 0.15 }}
  style="grid-template-columns: 35% 45% 20%; margin-block: 1em 2em"
  class="full-bleed"
/>
```

## Custom Brillouin zone appearance

```svelte example
<script>
  import { BrillouinBandsDos } from 'matterviz'
  import { phonon_bands, phonon_dos } from '$site/phonons'
  import phonon_data from '$site/phonons/mp-2758-Sr4Se4-pbe.json'
</script>

<BrillouinBandsDos
  band_structs={[phonon_bands['mp-2758-Sr4Se4-pbe']]}
  doses={[phonon_dos['mp-2758-Sr4Se4-pbe']]}
  structure={phonon_data.primitive}
  bz_props={{ surface_color: '#9b59b6', surface_opacity: 0.5, edge_color: '#2c3e50' }}
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
</script>

<BrillouinBandsDos
  structure={[phonon_data.primitive]}
  band_structs={[phonon_bands['mp-2758-Sr4Se4-pbe']]}
  doses={[phonon_dos['mp-2758-Sr4Se4-pbe']]}
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
