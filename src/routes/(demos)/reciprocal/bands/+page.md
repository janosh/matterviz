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

  const band_struct = electronic_bands['CaO (mp-2605)']
</script>

<Bands band_structs={band_struct} y_axis={{ label: 'Energy (eV)' }} />
```

### Spin-Polarized Electronic Bands

This example shows a spin-polarized electronic band structure (VBr₂). The component automatically extracts the first spin channel:

```svelte example
<script>
  import { Bands } from 'matterviz'
  import { electronic_bands } from '$site/electronic/bands'

  const band_struct = electronic_bands['VBr₂ (mp-971787, spin-polarized)']
</script>

<Bands band_structs={band_struct} y_axis={{ label: 'Energy (eV)' }} />
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

## Features

- **High-symmetry points**: Automatic labeling with Greek letters (Γ, Δ, Σ)
- **Acoustic vs optical**: Different styling for phonon mode types
- **Shaded regions**: Highlight specific frequency ranges (e.g., imaginary modes)
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
