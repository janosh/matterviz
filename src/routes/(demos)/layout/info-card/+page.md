# InfoCard

A grid of labeled key-value pairs for displaying material properties and metadata.

## Basic Usage

```svelte example
<script lang="ts">
  import { InfoCard } from 'matterviz/layout'

  const data = [
    { title: `Band Gap`, value: 1.12, unit: `eV` },
    { title: `Density`, value: 5.32, unit: `g/cm³` },
    { title: `Space Group`, value: `Fm-3m` },
    { title: `Crystal System`, value: `Cubic` },
    { title: `Volume`, value: 43.56, unit: `Å³`, fmt: `.2f` },
    { title: `Formula`, value: `Si` },
  ]
</script>

<InfoCard {data} title="Silicon Properties" />
```

## Conditional Display and Custom Formatting

Items with `condition: false` or `null`/`undefined` values are hidden. Use `fmt` per item or globally.

```svelte example
<script lang="ts">
  import { InfoCard } from 'matterviz/layout'

  const data = [
    { title: `Energy`, value: -5.234567, unit: `eV/atom`, fmt: `.4f` },
    { title: `Formation Energy`, value: -0.123, unit: `eV/atom`, fmt: `.3f` },
    { title: `Stability`, value: `Stable` },
    { title: `Hidden Item`, value: `Secret`, condition: false },
    { title: `Also Hidden`, value: null },
    { title: `Atoms`, value: 4 },
    { title: `Magnetic Moment`, value: [1.2, -1.2, 0.0], unit: `μB` },
  ]
</script>

<InfoCard {data} title="Energy Properties" fmt=".3f" />
```

## Without Title

```svelte example
<script lang="ts">
  import { InfoCard } from 'matterviz/layout'

  const data = [
    { title: `Melting Point`, value: 1687, unit: `K` },
    { title: `Boiling Point`, value: 3538, unit: `K` },
    { title: `Electronegativity`, value: 1.90 },
  ]
</script>

<InfoCard {data} fallback="No data available" />
```
