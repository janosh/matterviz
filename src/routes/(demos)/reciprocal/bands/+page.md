# Band Structures

Interactive phonon and electronic band structure visualization. The `Bands` component natively renders pymatgen band structure objects without manual data transformation.

## Phonon Bands with Custom Styling

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

## Electronic Band Structures

Pymatgen's `BandStructureSymmLine` objects render directly, handling spin-keyed bands (`"1"` for spin-up, `"-1"` for spin-down):

```svelte example
<script>
  import { Bands } from 'matterviz'
  import { electronic_bands } from '$site/electronic/bands'
</script>

<Bands band_structs={electronic_bands.cao_2605} y_axis={{ label: 'Energy (eV)' }} />
```

### Spin-Polarized Electronic Bands

This example shows a spin-polarized electronic band structure (VBr₂). The component automatically extracts the first spin channel:

```svelte example
<script>
  import { Bands } from 'matterviz'
  import { electronic_bands } from '$site/electronic/bands'
</script>

<Bands band_structs={electronic_bands.vbr2_971787} y_axis={{ label: 'Energy (eV)' }} />
```

## Comparing Multiple Band Structures

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
      bands: band_struct.bands.map((band) => band.map((freq) => freq * 1.05)),
    },
    'Model B': {
      ...band_struct,
      bands: band_struct.bands.map((band) => band.map((freq) => freq * 0.95)),
    },
  }
</script>

<Bands {band_structs} controls={{ show: true, open: true }} />
```

## Fat Bands (Band-Resolved Quantities)

The `Bands` component supports "fat bands" visualization, where the width of each band at each k/q-point is proportional to a quantity like electron-phonon coupling (λ<sub>nk</sub> for electronic bands, λ<sub>qν</sub> for phonon modes) or orbital character.

### Basic Fat Bands

Add `band_widths` to your band structure data - a 2D array matching the shape of `bands` where each value represents the ribbon width at that point:

```svelte example
<script>
  import { Bands } from 'matterviz'
  import { phonon_bands } from '$site/phonons'

  const base_bs = phonon_bands['mp-2758-Sr4Se4-pbe']

  // Simulate electron-phonon coupling: only certain bands couple strongly
  const coupled_bands = [1, 4, 7] // bands with significant coupling
  const band_widths = base_bs.bands.map((band, idx) =>
    band.map((_, q) => {
      const pos = q / band.length
      const envelope = Math.sin(pos * Math.PI) ** 0.5 // smooth peak at zone boundary
      return coupled_bands.includes(idx) ? envelope * (0.6 + 0.4 * Math.cos(idx)) : 0
    })
  )

  const band_struct = { ...base_bs, band_widths }
</script>

<Bands band_structs={band_struct} ribbon_config={{ opacity: 0.4, max_width: 8 }} />
```

### Custom Ribbon Styling

Customize the ribbon appearance with `ribbon_config`. You can set color, opacity, maximum width, and scale factor:

```svelte example
<script>
  import { Bands } from 'matterviz'
  import { phonon_bands } from '$site/phonons'

  const base_bs = phonon_bands['mp-2758-Sr4Se4-pbe']

  // Simulate d-orbital character: peaks at specific k-points for select bands
  const band_widths = base_bs.bands.map((band, idx) =>
    band.map((_, q) => {
      const pos = q / band.length
      if (idx === 2) return Math.exp(-8 * (pos - 0.3) ** 2) // Gaussian peak near Γ
      if (idx === 5) return Math.exp(-8 * (pos - 0.7) ** 2) // Peak near zone edge
      if (idx === 8) return 0.5 * Math.sin(pos * Math.PI) ** 2 // Weaker, broad
      return 0
    })
  )

  const band_struct = { ...base_bs, band_widths }
</script>

<Bands
  band_structs={band_struct}
  ribbon_config={{ color: '#e74c3c', opacity: 0.4, max_width: 10 }}
  line_kwargs={{ stroke: '#2c3e50', stroke_width: 1.2 }}
/>
```

### Comparing Structures with Fat Bands

When comparing multiple band structures, each can have its own `band_widths`. The ribbon color defaults to the line color for each structure:

```svelte example
<script>
  import { Bands } from 'matterviz'
  import { phonon_bands } from '$site/phonons'

  const base_bs = phonon_bands['mp-2758-Sr4Se4-pbe']

  // DFT vs ML: coupling on different bands with smooth Gaussian profiles
  const gauss = (pos, center, width) => Math.exp(-((pos - center) ** 2) / width)
  const make_widths = (active_bands, centers) =>
    base_bs.bands.map((band, idx) =>
      band.map((
        _,
        q,
      ) => (active_bands.includes(idx)
        ? gauss(q / band.length, centers[idx % centers.length], 0.08)
        : 0)
      )
    )

  const band_structs = {
    DFT: { ...base_bs, band_widths: make_widths([1, 3, 6], [0.3, 0.5, 0.7]) },
    'ML model': {
      ...base_bs,
      bands: base_bs.bands.map((b) => b.map((f) => f * 1.015)),
      band_widths: make_widths([2, 5, 8], [0.4, 0.6, 0.8]),
    },
  }
</script>

<Bands {band_structs} ribbon_config={{ opacity: 0.4, max_width: 10 }} />
```

## Features

- **High-symmetry points**: Automatic labeling with Greek letters (Γ, Δ, Σ)
- **Acoustic vs optical**: Different styling for phonon mode types
- **Fat bands**: Visualize band-resolved quantities like electron-phonon coupling λ<sub>nk</sub>
- **Shaded regions**: Highlight specific frequency ranges (e.g. imaginary modes)
- **Path modes**: When plotting multiple bands, choose from different path resolutions (union/intersection/strict = error on mismatch)
- **Interactive**: Zoom, pan, hover tooltips
- **Responsive**: Adapts to container size

## Supported Formats

The `Bands` component automatically detects and handles:

| Format              | Key Fields                                                          | Description                                 |
| ------------------- | ------------------------------------------------------------------- | ------------------------------------------- |
| Pymatgen Electronic | `@class: "BandStructureSymmLine"`, `kpoints`, `bands` (dict)        | Standard pymatgen electronic band structure |
| Pymatgen Phonon     | `@class: "PhononBandStructureSymmLine"`, `qpoints`, `bands` (array) | Pymatgen phonon band structure              |
| Native matterviz    | `qpoints`, `bands` (array), `branches`                              | Internal matterviz format                   |
