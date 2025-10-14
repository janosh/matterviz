# Band Structures

Interactive phonon and electronic band structure visualization.

## Basic Phonon Band Structure

A simple phonon band structure plot showing acoustic and optical modes:

```svelte example
<script>
  import { Bands } from 'matterviz'
  import { phonon_bands } from '$site/phonons'

  const band_structs = [phonon_bands['mp-2758-Sr4Se4-pbe']]
</script>

<Bands {band_structs} />
```

## Custom Line Styling

Customize acoustic and optical modes with different styles:

```svelte example
<script>
  import { Bands } from 'matterviz'
  import { phonon_bands } from '$site/phonons'

  const band_structs = [phonon_bands['mp-2758-Sr4Se4-pbe']]

  const line_kwargs = {
    acoustic: { stroke: 'red', stroke_width: 2 },
    optical: { stroke: 'blue', stroke_width: 1 },
  }
</script>

<Bands {band_structs} {line_kwargs} />
```

## Multiple Band Structures

Compare multiple band structures on the same plot:

```svelte example
<script>
  import { Bands } from 'matterviz'
  import { phonon_bands } from '$site/phonons'

  const band_struct = phonon_bands['mp-2758-Sr4Se4-pbe']

  // Create multiple versions with slight variations for demo
  const band_structs = {
    'DFT': band_struct,
    'Model A': {
      ...band_struct,
      bands: band_struct.bands.map((band) => band.map((f) => f * 1.05)),
    },
    'Model B': {
      ...band_struct,
      bands: band_struct.bands.map((band) => band.map((f) => f * 0.95)),
    },
  }
</script>

<Bands {band_structs} />
```

## With Controls

Enable interactive controls for customization:

```svelte example
<script>
  import { Bands } from 'matterviz'
  import { phonon_bands } from '$site/phonons'

  const band_structs = [phonon_bands['mp-2758-Sr4Se4-pbe']]
</script>

<Bands {band_structs} controls={{ show: true, open: true }} />
```

## Features

- **High-symmetry points**: Automatic labeling with Greek letters (Γ, Δ, Σ)
- **Acoustic vs optical**: Different styling for phonon mode types
- **Shaded regions**: Highlight specific frequency ranges (e.g., imaginary modes)
- **Path modes**: When plotting multiple bands, choose from different path resolutions (union/intersection/strict = error on mismatch)
- **Interactive**: Zoom, pan, hover tooltips
- **Responsive**: Adapts to container size
