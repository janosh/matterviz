# Band Structures

Interactive phonon and electronic band structure visualization.

## Basic Phonon Bands with Custom Styling

A phonon band structure plot with custom line styling for acoustic and optical modes:

```svelte example
<script>
  import { Bands } from 'matterviz'
  import { phonon_bands } from '$site/phonons'

  const band_structs = [phonon_bands['mp-2758-Sr4Se4-pbe']]

  const line_kwargs = {
    acoustic: { stroke: '#e74c3c', stroke_width: 2 },
    optical: { stroke: '#3498db', stroke_width: 1.5 },
  }
</script>

<Bands {band_structs} {line_kwargs} />
```

## Multiple Band Structures with Controls

Compare multiple band structures on the same plot with interactive controls:

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

<Bands {band_structs} controls={{ show: true, open: true }} />
```

## Features

- **High-symmetry points**: Automatic labeling with Greek letters (Γ, Δ, Σ)
- **Acoustic vs optical**: Different styling for phonon mode types
- **Shaded regions**: Highlight specific frequency ranges (e.g., imaginary modes)
- **Path modes**: When plotting multiple bands, choose from different path resolutions (union/intersection/strict = error on mismatch)
- **Interactive**: Zoom, pan, hover tooltips
- **Responsive**: Adapts to container size
