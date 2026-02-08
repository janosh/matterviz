# Heatmap Table

A sortable, colorable data table component with heatmap-style cell coloring, column grouping, drag-and-drop column reordering, and customizable cell rendering.

## Basic Usage

A simple table with sortable columns and automatic heatmap coloring based on cell values:

```svelte example
<script lang="ts">
  import { HeatmapTable } from 'matterviz'

  const data = [
    [`Fe₂O₃`, 0.0, 2.2, -8.5],
    [`TiO₂`, 0.0, 3.2, -9.8],
    [`ZnO`, 0.02, 3.4, -3.6],
    [`Cu₂O`, 0.05, 2.1, -1.7],
    [`SiO₂`, 0.0, 8.9, -9.1],
    [`Al₂O₃`, 0.0, 8.8, -17.4],
    [`MgO`, 0.0, 7.8, -6.2],
    [`CaTiO₃`, 0.03, 3.5, -16.1],
  ].map(([v1, v2, v3, v4]) => ({
    Formula: v1,
    'E<sub>above hull</sub>': v2,
    'E<sub>gap</sub>': v3,
    'E<sub>form</sub>': v4,
  }))

  // deno-fmt-ignore
  const columns = [
    { label: `Formula` },
    { label: `E<sub>above hull</sub>`, better: `lower`, color_scale: `interpolateRdYlGn`, format: `.2f` },
    { label: `E<sub>gap</sub>`, better: `higher`, color_scale: `interpolateViridis`, format: `.1f` },
    { label: `E<sub>form</sub>`, better: `lower`, color_scale: `interpolateBlues`, format: `.1f` },
  ]
</script>

<HeatmapTable
  {data}
  {columns}
  sort_hint={{ text: `Click column headers to sort`, position: `top`, permanent: true }}
  style="margin: 0 auto"
/>
```

## Periodic Table Elements

All 118 chemical elements with physical and chemical properties. Features column grouping, category/phase filters, row selection with statistics, double-click to open element pages, and radioactive element highlighting:

```svelte example
<script lang="ts">
  import { element_data, HeatmapTable } from 'matterviz'

  // Get unique categories and phases for filters
  const categories = [...new Set(element_data.map((el) => el.category))].sort()
  const phases = [...new Set(element_data.map((el) => el.phase))].sort()

  let category_filter = $state(`all`)
  let phase_filter = $state(`all`)
  let selected_rows = $state([])

  // Transform and filter element data
  let data = $derived(
    element_data
      .filter((el) => category_filter === `all` || el.category === category_filter)
      .filter((el) => phase_filter === `all` || el.phase === phase_filter)
      .map((el) => ({
        Symbol: el.radioactive ? `☢️ ${el.symbol}` : el.symbol,
        Name: el.name,
        'Z': el.number,
        'Mass (u)': el.atomic_mass,
        Category: el.category,
        Period: el.period,
        Group: el.column,
        'n<sub>val</sub>': el.n_valence,
        'ρ (g/cm³)': el.density,
        'r<sub>atom</sub> (Å)': el.atomic_radius,
        'r<sub>cov</sub> (Å)': el.covalent_radius,
        'χ': el.electronegativity,
        'EA (kJ/mol)': el.electron_affinity,
        'IE<sub>1</sub> (eV)': el.first_ionization,
        'C<sub>p</sub>': el.specific_heat,
        'T<sub>m</sub> (K)': el.melting_point,
        'T<sub>b</sub> (K)': el.boiling_point,
        Phase: el.phase,
        Year: el.year,
        _symbol: el.symbol, // raw symbol for selected row display
      })),
  )

  // Calculate statistics for selected elements
  let stats = $derived.by(() => {
    if (selected_rows.length === 0) return null
    const nums = (key) => selected_rows.map((r) => r[key]).filter((v) => v != null)
    const avg = (arr) =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null
    return {
      count: selected_rows.length,
      avg_mass: avg(nums(`Mass (u)`))?.toFixed(2),
      avg_density: avg(nums(`ρ (g/cm³)`))?.toFixed(2),
      avg_electronegativity: avg(nums(`χ`))?.toFixed(2),
    }
  })

  // deno-fmt-ignore
  const columns = [
    // Identity
    { label: `Symbol`, sticky: true, style: `min-width: 75px; font-weight: 600;` },
    { label: `Name`, group: `Identity`, style: `min-width: 100px;` },
    { label: `Z`, group: `Identity`, color_scale: `interpolateViridis`, format: `d` },
    { label: `Mass (u)`, group: `Identity`, color_scale: `interpolateBlues`, format: `.2f` },
    { label: `Category`, group: `Identity`, style: `min-width: 160px;` },
    // Structure
    { label: `Period`, group: `Structure`, color_scale: `interpolatePurples`, format: `d` },
    { label: `Group`, group: `Structure`, color_scale: `interpolateGreens`, format: `d` },
    { label: `n<sub>val</sub>`, group: `Structure`, color_scale: `interpolateCool`, format: `d`, description: `Valence electrons` },
    // Physical
    { label: `ρ (g/cm³)`, group: `Physical`, better: `higher`, color_scale: `interpolateOranges`, format: `.3~`, scale_type: `log`, description: `Density` },
    { label: `r<sub>atom</sub> (Å)`, group: `Physical`, color_scale: `interpolatePlasma`, format: `.2f`, description: `Atomic radius` },
    { label: `r<sub>cov</sub> (Å)`, group: `Physical`, color_scale: `interpolateMagma`, format: `.2f`, description: `Covalent radius` },
    { label: `Phase`, group: `Physical`, style: `min-width: 60px;` },
    // Chemical
    { label: `χ`, group: `Chemical`, better: `higher`, color_scale: `interpolateRdYlBu`, format: `.2f`, description: `Electronegativity (Pauling)` },
    { label: `EA (kJ/mol)`, group: `Chemical`, color_scale: `interpolateRdYlGn`, format: `.1f`, description: `Electron affinity` },
    { label: `IE<sub>1</sub> (eV)`, group: `Chemical`, better: `higher`, color_scale: `interpolateInferno`, format: `.2f`, description: `First ionization energy` },
    // Thermal
    { label: `C<sub>p</sub>`, group: `Thermal`, color_scale: `interpolateYlOrRd`, format: `.2f`, description: `Specific heat (J/g·K)` },
    { label: `T<sub>m</sub> (K)`, group: `Thermal`, color_scale: `interpolateCool`, format: `,.0f`, description: `Melting point` },
    { label: `T<sub>b</sub> (K)`, group: `Thermal`, color_scale: `interpolateWarm`, format: `,.0f`, description: `Boiling point` },
    // Discovery
    { label: `Year`, group: `Discovery`, color_scale: `interpolateGreys`, format: `d`, description: `Year of discovery` },
  ]
</script>

<div
  style="display: flex; gap: 1em; margin-bottom: 1em; flex-wrap: wrap; align-items: center"
>
  <label>
    Category:
    <select bind:value={category_filter}>
      <option value="all">All ({element_data.length})</option>
      {#each categories as cat (cat)}
        <option value={cat}>
          {cat} ({element_data.filter((el) => el.category === cat).length})
        </option>
      {/each}
    </select>
  </label>
  <label>
    Phase:
    <select bind:value={phase_filter}>
      <option value="all">All</option>
      {#each phases as phase (phase)}
        <option value={phase}>{phase}</option>
      {/each}
    </select>
  </label>
  {#if stats}
    <span style="font-size: 0.9em; opacity: 0.8; margin-left: auto">
      Selected: <strong>{stats.count}</strong> | Avg mass: <strong>{
        stats.avg_mass
      }</strong> u | Avg ρ: <strong>{stats.avg_density}</strong> g/cm³ | Avg χ: <strong>{
        stats.avg_electronegativity
      }</strong>
    </span>
  {/if}
</div>

<HeatmapTable
  {data}
  {columns}
  scroll_style="max-height: 500px;"
  search
  export_data
  show_column_toggle
  show_row_select
  bind:selected_rows
  pagination={{ page_size: 20 }}
  sort_hint="Click headers to sort, Shift+click for multi-sort"
  onrowdblclick={(_, row) => window.open(`/${row.Name.toLowerCase()}`, `_blank`)}
  style="margin: 0 auto"
/>

{#if selected_rows.length > 0}
  <p style="margin-top: 0.5em; font-size: 0.9em; color: var(--text-muted)">
    Double-click a row to open element page. Selected: {
      selected_rows.map((r) => r._symbol).join(`, `)
    }
  </p>
{/if}
```

## Drag-and-Drop Column Reordering

Columns can be reordered by dragging within the same group. Useful for comparing specific metrics side-by-side:

```svelte example
<script lang="ts">
  import { HeatmapTable } from 'matterviz'

  const data = [
    [`Perovskite`, 0.042, 0.089, 0.94, 0.31],
    [`Spinel`, 0.038, 0.076, 0.96, 0.28],
    [`Rocksalt`, 0.051, 0.102, 0.91, 0.45],
    [`Wurtzite`, 0.029, 0.058, 0.97, 0.19],
    [`Fluorite`, 0.044, 0.091, 0.93, 0.33],
    [`Pyrite`, 0.035, 0.071, 0.95, 0.24],
    [`Zincblende`, 0.031, 0.063, 0.96, 0.21],
    [`Rutile`, 0.047, 0.095, 0.92, 0.38],
  ].map(([v1, v2, v3, v4, v5]) => ({
    Structure: v1,
    MAE: v2,
    RMSE: v3,
    'R²': v4,
    'Max Error': v5,
  }))

  // deno-fmt-ignore
  const columns = [
    { label: `Structure` },
    { label: `MAE`, better: `lower`, color_scale: `interpolateRdYlGn`, format: `.3f` },
    { label: `RMSE`, better: `lower`, color_scale: `interpolateRdYlGn`, format: `.3f` },
    { label: `R²`, better: `higher`, color_scale: `interpolateViridis`, format: `.2f` },
    { label: `Max Error`, better: `lower`, color_scale: `interpolateOranges`, format: `.2f` },
  ]

  let column_order = $state([])
</script>

<p style="color: var(--text-muted); margin-bottom: 1em">
  Drag column headers to reorder. Current order: {column_order.join(`, `) || `(default)`}
</p>

<HeatmapTable {data} {columns} bind:column_order style="margin: 0 auto" />
```

## Large Table with Scrolling

A comprehensive ML model benchmark comparison with sticky first column. Scroll horizontally to compare models across different datasets:

```svelte example
<script lang="ts">
  import { HeatmapTable } from 'matterviz'

  const models = [
    [`MACE-MP-0`, 0.83, 0.91, 0.88, 0.79, 0.92, 0.85, 0.87, 0.90, 0.82, 0.86],
    [`CHGNet`, 0.79, 0.88, 0.84, 0.76, 0.89, 0.81, 0.83, 0.86, 0.78, 0.82],
    [`M3GNet`, 0.75, 0.84, 0.80, 0.72, 0.85, 0.77, 0.79, 0.82, 0.74, 0.78],
    [`ALIGNN`, 0.81, 0.89, 0.86, 0.77, 0.90, 0.83, 0.85, 0.88, 0.80, 0.84],
    [`SchNet`, 0.68, 0.76, 0.72, 0.65, 0.77, 0.70, 0.72, 0.75, 0.67, 0.71],
    [`DimeNet++`, 0.77, 0.86, 0.82, 0.74, 0.87, 0.79, 0.81, 0.84, 0.76, 0.80],
    [`GemNet-T`, 0.80, 0.88, 0.85, 0.76, 0.89, 0.82, 0.84, 0.87, 0.79, 0.83],
    [`NequIP`, 0.82, 0.90, 0.87, 0.78, 0.91, 0.84, 0.86, 0.89, 0.81, 0.85],
    [`PaiNN`, 0.76, 0.85, 0.81, 0.73, 0.86, 0.78, 0.80, 0.83, 0.75, 0.79],
    [`CGCNN`, 0.65, 0.73, 0.69, 0.62, 0.74, 0.67, 0.69, 0.72, 0.64, 0.68],
    [`MEGNet`, 0.71, 0.79, 0.75, 0.68, 0.80, 0.73, 0.75, 0.78, 0.70, 0.74],
    [`BOWSR`, 0.58, 0.66, 0.62, 0.55, 0.67, 0.60, 0.62, 0.65, 0.57, 0.61],
    [`Wrenformer`, 0.73, 0.81, 0.77, 0.70, 0.82, 0.75, 0.77, 0.80, 0.72, 0.76],
    [`SevenNet`, 0.84, 0.92, 0.89, 0.80, 0.93, 0.86, 0.88, 0.91, 0.83, 0.87],
    [`EquiformerV2`, 0.85, 0.93, 0.90, 0.81, 0.94, 0.87, 0.89, 0.92, 0.84, 0.88],
    [`Graphormer`, 0.72, 0.80, 0.76, 0.69, 0.81, 0.74, 0.76, 0.79, 0.71, 0.75],
    [`TorchMD-NET`, 0.78, 0.87, 0.83, 0.75, 0.88, 0.80, 0.82, 0.85, 0.77, 0.81],
    [`SpookyNet`, 0.74, 0.83, 0.79, 0.71, 0.84, 0.76, 0.78, 0.81, 0.73, 0.77],
    [`ForceNet`, 0.69, 0.77, 0.73, 0.66, 0.78, 0.71, 0.73, 0.76, 0.68, 0.72],
    [`SphereNet`, 0.75, 0.84, 0.80, 0.72, 0.85, 0.77, 0.79, 0.82, 0.74, 0.78],
    [`ComENet`, 0.70, 0.78, 0.74, 0.67, 0.79, 0.72, 0.74, 0.77, 0.69, 0.73],
    [`EGNN`, 0.66, 0.74, 0.70, 0.63, 0.75, 0.68, 0.70, 0.73, 0.65, 0.69],
    [`VisNet`, 0.77, 0.86, 0.82, 0.74, 0.87, 0.79, 0.81, 0.84, 0.76, 0.80],
    [`Allegro`, 0.81, 0.89, 0.86, 0.77, 0.90, 0.83, 0.85, 0.88, 0.80, 0.84],
    [`SO3krates`, 0.76, 0.85, 0.81, 0.73, 0.86, 0.78, 0.80, 0.83, 0.75, 0.79],
    [`MACE-OFF`, 0.86, 0.94, 0.91, 0.82, 0.95, 0.88, 0.90, 0.93, 0.85, 0.89],
    [`Orb`, 0.79, 0.88, 0.84, 0.76, 0.89, 0.81, 0.83, 0.86, 0.78, 0.82],
    [`FAENet`, 0.67, 0.75, 0.71, 0.64, 0.76, 0.69, 0.71, 0.74, 0.66, 0.70],
  ]

  const benchmarks = `MP JARVIS OQMD AFLOW MC3D GNoME WBM COD ICSD Perovskites`
    .split(` `)

  const data = models.map(([name, ...scores]) => {
    const row = { Model: name }
    benchmarks.forEach((bench, idx) => {
      row[bench] = scores[idx]
    })
    return row
  })

  const columns = [
    { label: `Model`, sticky: true, style: `min-width: 120px; font-weight: 600;` },
    ...benchmarks.map((bench) => ({
      label: bench,
      better: `higher`,
      color_scale: `interpolateViridis`,
      format: `.2f`,
      style: `min-width: 95px;`,
    })),
  ]
</script>

<p style="color: var(--text-muted); margin-bottom: 0.5em; font-size: 0.9em">
  ↔️ Scroll horizontally to see all datasets &nbsp;|&nbsp; ↕️ Scroll vertically for all
  models &nbsp;|&nbsp; Model column stays pinned
</p>

<HeatmapTable
  {data}
  {columns}
  scroll_style="max-height: 400px; border-inline: none"
  style="margin: 0 auto"
/>
```

## Values with Uncertainties

The table correctly handles numeric strings with uncertainty notation for both sorting and heatmap coloring. Values like `1.23 ± 0.05`, `1.23 +- 0.05`, and `1.23(5)` are parsed to extract the primary number:

```svelte example
<script lang="ts">
  import { HeatmapTable } from 'matterviz'

  // Experimental measurements with uncertainties in various formats
  const data = [
    [`mp-149`, `Si`, `1.12 ± 0.02`, `2.329 ± 0.005`, `148 +- 3`],
    [`mp-32`, `GaAs`, `1.42 ± 0.03`, `5.317 ± 0.008`, `55 +- 2`],
    [`mp-2133`, `ZnO`, `3.44 ± 0.05`, `5.606 ± 0.012`, `60 +- 4`],
    [`mp-390`, `TiO₂`, `3.20 ± 0.04`, `4.230 ± 0.007`, `8.5 +- 0.5`],
    [`mp-66`, `Diamond`, `5.47 ± 0.01`, `3.515 ± 0.002`, `2200 +- 50`],
    [`mp-1143`, `Al₂O₃`, `8.80 ± 0.10`, `3.987 ± 0.004`, `30 +- 2`],
    [`mp-1265`, `MgO`, `7.83 ± 0.08`, `3.583 ± 0.003`, `60 +- 3`],
    [`mp-804`, `SiC`, `3.26 ± 0.04`, `3.217 ± 0.005`, `490 +- 20`],
    [`mp-35`, `GaN`, `3.40 ± 0.05`, `6.150 ± 0.010`, `130 +- 8`],
    [`mp-5020`, `NaCl`, `8.50 ± 0.12`, `2.165 ± 0.003`, `6.5 +- 0.3`],
  ].map(([id, formula, gap, density, thermal]) => ({
    ID: id,
    Formula: formula,
    'E<sub>gap</sub> (eV)': gap,
    'ρ (g/cm³)': density,
    'κ (W/m·K)': thermal,
  }))

  // deno-fmt-ignore
  const columns = [
    { label: `ID` },
    { label: `Formula` },
    { label: `E<sub>gap</sub> (eV)`, better: `higher`, color_scale: `interpolateViridis`, description: `Band gap with measurement uncertainty` },
    { label: `ρ (g/cm³)`, color_scale: `interpolateBlues`, description: `Density with uncertainty` },
    { label: `κ (W/m·K)`, better: `higher`, color_scale: `interpolateOranges`, description: `Thermal conductivity with uncertainty` },
  ]
</script>

<p style="color: var(--text-muted); margin-bottom: 0.5em; font-size: 0.9em">
  Click column headers to sort — values are sorted by the primary number, ignoring the ±
  uncertainty
</p>

<HeatmapTable
  {data}
  {columns}
  initial_sort="E<sub>gap</sub> (eV)"
  style="margin: 0 auto"
/>
```

## Color Scales

Explore different D3 color scales, scale types (linear vs logarithmic), and the `better` prop which controls whether high or low values get the "good" end of the scale. Log scale is useful for properties spanning many orders of magnitude like electrical conductivity:

```svelte example
<script lang="ts">
  import { HeatmapTable } from 'matterviz'

  const color_scales = [
    `interpolateViridis`,
    `interpolatePlasma`,
    `interpolateInferno`,
    `interpolateMagma`,
    `interpolateCividis`,
    `interpolateCool`,
    `interpolateWarm`,
    `interpolateRdYlBu`,
    `interpolateRdYlGn`,
    `interpolateSpectral`,
    `interpolatePurples`,
    `interpolateBlues`,
    `interpolateGreens`,
    `interpolateOranges`,
    `interpolateReds`,
  ]

  let selected_scale = $state(`interpolateViridis`)
  let better = $state(`higher`)
  let scale_type = $state(`linear`)
  let heatmap_opacity = $state(1)

  // Materials with properties spanning different orders of magnitude
  const data = [
    [`Si`, 1.12, 1.56e-3, 150],
    [`Copper`, 0, 5.96e7, 401],
    [`Diamond`, 5.47, 1e-13, 2200],
    [`GaAs`, 1.42, 1e-8, 55],
    [`ZnO`, 3.44, 1e-6, 60],
    [`SiC`, 3.26, 1e-6, 490],
    [`GaN`, 3.40, 1e-10, 130],
    [`Al₂O₃`, 8.80, 1e-14, 30],
    [`MgO`, 7.80, 1e-15, 60],
    [`TiO₂`, 3.20, 1e-12, 8.5],
  ].map(([v1, v2, v3, v4]) => ({
    Material: v1,
    'E<sub>gap</sub> (eV)': v2,
    'σ (S/m)': v3,
    'κ (W/m·K)': v4,
  }))

  let columns = $derived([
    { label: `Material` },
    {
      label: `E<sub>gap</sub> (eV)`,
      better,
      color_scale: selected_scale,
      format: `.2f`,
      description: `Band gap`,
    },
    {
      label: `σ (S/m)`,
      better,
      color_scale: selected_scale,
      scale_type,
      format: `.2e`,
      description: `Electrical conductivity — try log scale!`,
    },
    {
      label: `κ (W/m·K)`,
      better,
      color_scale: selected_scale,
      format: `,.0f`,
      description: `Thermal conductivity`,
    },
  ])
</script>

<div style="display: flex; gap: 2em; margin-bottom: 1em; flex-wrap: wrap">
  <label>
    Color Scale:
    <select bind:value={selected_scale}>
      {#each color_scales as scale (scale)}
        <option value={scale}>{scale.replace(`interpolate`, ``)}</option>
      {/each}
    </select>
  </label>
  <label>
    Better:
    <select bind:value={better}>
      <option value="higher">Higher</option>
      <option value="lower">Lower</option>
    </select>
  </label>
  <label>
    Scale Type:
    <select bind:value={scale_type}>
      <option value="linear">Linear</option>
      <option value="log">Logarithmic</option>
    </select>
  </label>
  <label>
    Opacity: {Math.round(heatmap_opacity * 100)}%
    <input type="range" min="0" max="1" step="0.01" bind:value={heatmap_opacity} />
  </label>
</div>

<HeatmapTable
  {data}
  {columns}
  bind:heatmap_opacity
  style="margin: 0 auto"
/>
```
