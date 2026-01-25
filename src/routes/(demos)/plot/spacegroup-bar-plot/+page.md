# Spacegroup Bar Plot

Visualize crystallographic space group distributions with automatic crystal system coloring and annotations.

## Basic Usage with Interactive Controls

Pass space group numbers (1-230) to visualize their distribution with automatic crystal system coloring and region annotations:

```svelte example
<script lang="ts">
  import { SpacegroupBarPlot } from 'matterviz'

  // Sample data: space group numbers from a materials database
  // deno-fmt-ignore
  const diverse_materials = [
    221, 221, 221, // Cubic perovskites
    225, 225, 225, 225, 225, 229, 229, 229, // Cubic metals
    194, 194, 194, 194, // Hexagonal metals
    167, 167, 166, // Trigonal
    139, 129, 123, 123, // Tetragonal
    62, 62, 62, 62, 62, 62, 59, 61, 63, // Orthorhombic
    15, 15, 15, 14, 14, 14, 14, 12, 11, // Monoclinic
    2, 2, 1, // Triclinic
  ]

  let show_counts = $state(true)
</script>

<div
  style="margin-bottom: 1em; padding: 8pt; background: rgba(255, 255, 255, 0.05); border-radius: 4px"
>
  <strong>Tip:</strong> Hover over any bar to see space group number, crystal system, and
  count. Click and drag to zoom into specific regions. Double-click to reset.
</div>

<label style="margin-bottom: 1em; display: block">
  <input type="checkbox" bind:checked={show_counts} />
  Show count annotations
</label>

<SpacegroupBarPlot data={diverse_materials} {show_counts} style="height: 450px" />
```

## Space Group Symbols

The component also accepts space group symbols (Hermann-Mauguin notation):

```svelte example
<script lang="ts">
  import { SpacegroupBarPlot } from 'matterviz'

  // deno-fmt-ignore
  const spacegroups_symbols = [
    'Fm-3m', 'Fm-3m', 'Fd-3m', 'Im-3m', 'Fm-3m', // Cubic
    'P63/mmc', 'P63/mmc', 'P63mc', 'P6/mmm', // Hexagonal
    'R-3m', 'R-3c', 'R-3m', 'R-3', // Trigonal
    'I4/mmm', 'P4/mmm', 'I4/mmm', 'P4/nmm', // Tetragonal
    'Pnma', 'Cmcm', 'Pbca', 'Pnma', 'Pnma', 'Cmcm', // Orthorhombic
    'C2/c', 'P21/c', 'C2/m', 'P21/c', 'C2/c', // Monoclinic
    'P-1', 'P1', 'P-1', // Triclinic
  ]
</script>

<SpacegroupBarPlot data={spacegroups_symbols} style="height: 450px" />
```

## Horizontal Orientation

Display spacegroup distributions horizontally:

```svelte example
<script lang="ts">
  import { SpacegroupBarPlot } from 'matterviz'

  // deno-fmt-ignore
  const high_symmetry = [
    225, 225, 225, 225, 225, 225, 225, 225, 225, 225, // Fm-3m
    229, 229, 229, 229, 229, 229, // Im-3m
    227, 227, 227, 227, 227, // Fd-3m
    221, 221, 221, 221, 221, 221, 221, 221, // Pm-3m
    194, 194, 194, 194, 194, 194, // P63/mmc
    166, 166, 166, 166, 166, // R-3m
    139, 139, 139, 139, // I4/mmm
    62, 62, 62, 62, 62, 62, 62, 62, // Pnma
  ]

  let orientation = $state('vertical')
  let plot_style = $derived(
    orientation === 'horizontal' ? `height: 700px` : `height: 450px`,
  )
</script>

<div style="margin-bottom: 1em; display: flex; gap: 1em">
  <label><input type="radio" bind:group={orientation} value="vertical" /> Vertical</label>
  <label><input type="radio" bind:group={orientation} value="horizontal" />
    Horizontal</label>
</div>

<SpacegroupBarPlot
  data={high_symmetry}
  {orientation}
  style={plot_style}
/>
```

## Real-World Example: Materials Project Data

Simulated space group distributions from Materials Project database:

```svelte example
<script lang="ts">
  import { SpacegroupBarPlot } from 'matterviz'

  // Simulated distribution resembling Materials Project statistics
  // Based on typical prevalence: more orthorhombic and monoclinic, fewer triclinic
  const generate_distribution = () => {
    const data = []

    // Triclinic (1-2): ~1-2% of materials
    for (let idx = 0; idx < 8; idx++) data.push(Math.random() < 0.7 ? 2 : 1)

    // Monoclinic (3-15): ~20-25% of materials, especially 14 and 15
    for (let idx = 0; idx < 100; idx++) {
      const sg = Math.random() < 0.6
        ? (Math.random() < 0.5 ? 14 : 15)
        : Math.floor(Math.random() * 13) + 3
      data.push(sg)
    }

    // Orthorhombic (16-74): ~30-35% of materials, especially 62, 63
    for (let idx = 0; idx < 140; idx++) {
      const sg = Math.random() < 0.5
        ? (Math.random() < 0.5 ? 62 : 63)
        : Math.floor(Math.random() * 59) + 16
      data.push(sg)
    }

    // Tetragonal (75-142): ~10-15% of materials
    for (let idx = 0; idx < 50; idx++) {
      data.push(Math.floor(Math.random() * 68) + 75)
    }

    // Trigonal (143-167): ~5-8% of materials, R-3 family common
    for (let idx = 0; idx < 30; idx++) {
      const sg = Math.random() < 0.4
        ? (Math.random() < 0.5 ? 148 : 166)
        : Math.floor(Math.random() * 25) + 143
      data.push(sg)
    }

    // Hexagonal (168-194): ~5-8% of materials, P63/mmc common
    for (let idx = 0; idx < 28; idx++) {
      const sg = Math.random() < 0.4 ? 194 : Math.floor(Math.random() * 27) + 168
      data.push(sg)
    }

    // Cubic (195-230): ~15-20% of materials, Fm-3m very common
    for (let idx = 0; idx < 70; idx++) {
      const sg = Math.random() < 0.4
        ? 225
        : (Math.random() < 0.3 ? 229 : Math.floor(Math.random() * 36) + 195)
      data.push(sg)
    }

    return data
  }

  const materials_db = generate_distribution()
</script>

<div
  style="margin-bottom: 1em; padding: 8pt; background: rgba(255, 255, 255, 0.05); border-radius: var(--border-radius); font-size: 0.9em"
>
  <strong>Dataset:</strong> {materials_db.length} materials with distribution resembling
  real materials databases. Notice how certain space groups like 225 (Fm-3m), 62 (Pnma),
  and 14/15 (monoclinic) are much more common.
</div>

<SpacegroupBarPlot data={materials_db} style="height: 500px" />
```
