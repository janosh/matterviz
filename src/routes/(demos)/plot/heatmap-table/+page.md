# Heatmap Table

A sortable, colorable data table component with heatmap-style cell coloring, column grouping, drag-and-drop column reordering, and customizable cell rendering.

## Basic Usage

A simple table with sortable columns and automatic heatmap coloring based on cell values:

```svelte example
<script>
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
<script>
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
        _symbol: el.symbol, // for navigation
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
      {#each categories as cat}
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
      {#each phases as phase}
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

## Color Scales and Scale Types

Choose from various D3 color scales and switch between linear and logarithmic scaling. Log scale is useful for properties spanning many orders of magnitude like electrical conductivity:

```svelte example
<script>
  import { HeatmapTable } from 'matterviz'

  const data = [
    [`Silicon`, 1.12, 1.56e-3, 150],
    [`Copper`, 0, 5.96e7, 401],
    [`Diamond`, 5.47, 1e-13, 2200],
    [`Germanium`, 0.67, 2.2, 60],
    [`GaAs`, 1.42, 1e-8, 55],
    [`SiC`, 3.26, 1e-6, 490],
    [`GaN`, 3.4, 1e-10, 130],
    [`InP`, 1.35, 1e-7, 68],
  ].map(([v1, v2, v3, v4]) => ({
    Material: v1,
    'E<sub>gap</sub>': v2,
    Conductivity: v3,
    'κ<sub>lattice</sub>': v4,
  }))

  let scale_type = $state(`log`)
  // deno-fmt-ignore
  const columns = [
    { label: `Material` },
    { label: `E<sub>gap</sub>`, better: `higher`, color_scale: `interpolatePlasma`, format: `.2f`, description: `Band gap (eV)` },
    { label: `Conductivity`, better: `higher`, color_scale: `interpolateYlOrRd`, scale_type, format: `.3~`, description: `Electrical conductivity (S/m)` },
    { label: `κ<sub>lattice</sub>`, better: `higher`, color_scale: `interpolateBlues`, format: `,.0f`, description: `Thermal conductivity (W/m·K)` },
  ]
</script>

<label style="display: block; margin-bottom: 1em">
  Conductivity Scale:
  <select bind:value={scale_type}>
    <option value="linear">Linear</option>
    <option value="log">Logarithmic</option>
  </select>
</label>

<HeatmapTable {data} {columns} style="margin: 0 auto" />
```

## Drag-and-Drop Column Reordering

Columns can be reordered by dragging within the same group. Useful for comparing specific metrics side-by-side:

```svelte example
<script>
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
<script>
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

<HeatmapTable {data} {columns} scroll_style="max-height: 400px;" style="margin: 0 auto" />
```

## Column Groups with Scrolling

Crystal structure prediction results grouped by property type. The sticky first column stays visible while scrolling through different metric groups:

```svelte example
<script>
  import { HeatmapTable } from 'matterviz'

  const structures = [
    [`mp-149 (Si)`, 5.43, 0.002, 8, 1.12, 0.89, 12.1, 150, 98],
    [`mp-2534 (GaAs)`, 5.65, 0.005, 8, 1.42, 0.74, 5.3, 55, 46],
    [`mp-22862 (CsPbI₃)`, 6.29, 0.018, 20, 1.73, 0.58, 0.5, 0.4, 38],
    [`mp-2657 (ZnO)`, 3.25, 0.003, 4, 3.44, 0.91, 54, 60, 9.1],
    [`mp-66 (Diamond)`, 3.57, 0.001, 8, 5.47, 0.95, 1e-13, 2200, 5.7],
    [`mp-5020 (NaCl)`, 5.64, 0.004, 8, 8.5, 0.82, 1e-17, 6.5, 5.9],
    [`mp-8062 (Fe₂O₃)`, 5.03, 0.012, 30, 2.2, 0.76, 1e-7, 20, 25],
    [`mp-5229 (TiO₂)`, 4.59, 0.008, 12, 3.2, 0.88, 1e-12, 8.5, 110],
    [`mp-1960 (MgO)`, 4.21, 0.002, 8, 7.8, 0.93, 1e-15, 60, 9.7],
    [`mp-804 (SiC)`, 4.36, 0.003, 8, 3.26, 0.91, 1e-6, 490, 9.7],
    [`mp-830 (GaN)`, 3.19, 0.004, 4, 3.4, 0.87, 1e-10, 130, 9.0],
    [`mp-20194 (InP)`, 5.87, 0.006, 8, 1.35, 0.79, 1e-7, 68, 12.4],
  ]

  const data = structures.map((
    [id, a, strain, natoms, gap, acc, cond, therm, diel],
  ) => ({
    'Structure': id,
    'a (Lattice)': a,
    'Strain (Lattice)': strain,
    'N atoms (Lattice)': natoms,
    'Gap (Electronic)': gap,
    'Accuracy (Electronic)': acc,
    'σ (Transport)': cond,
    'κ (Transport)': therm,
    'ε (Transport)': diel,
  }))

  // deno-fmt-ignore
  const columns = [
    { label: `Structure`, sticky: true, style: `min-width: 145px;` },
    { label: `a`, group: `Lattice`, color_scale: `interpolateBlues`, format: `.2f`, style: `min-width: 70px;`, description: `Lattice parameter (Å)` },
    { label: `Strain`, group: `Lattice`, better: `lower`, color_scale: `interpolateRdYlGn`, format: `.3f`, style: `min-width: 80px;` },
    { label: `N atoms`, group: `Lattice`, color_scale: `interpolatePurples`, format: `d`, style: `min-width: 85px;` },
    { label: `Gap`, group: `Electronic`, better: `higher`, color_scale: `interpolatePlasma`, format: `.2f`, style: `min-width: 70px;`, description: `Band gap (eV)` },
    { label: `Accuracy`, group: `Electronic`, better: `higher`, color_scale: `interpolateViridis`, format: `.2f`, style: `min-width: 90px;` },
    { label: `σ`, group: `Transport`, better: `higher`, color_scale: `interpolateOranges`, format: `.0e`, style: `min-width: 75px;`, scale_type: `log`, description: `Electrical conductivity (S/m)` },
    { label: `κ`, group: `Transport`, better: `higher`, color_scale: `interpolateReds`, format: `,.0f`, style: `min-width: 70px;`, description: `Thermal conductivity (W/m·K)` },
    { label: `ε`, group: `Transport`, color_scale: `interpolateGreens`, format: `.1f`, style: `min-width: 65px;`, description: `Dielectric constant` },
  ]
</script>

<HeatmapTable {data} {columns} scroll_style="max-width: 750px;" style="margin: 0 auto" />
```

## Interactive Features

Enable search, export, column visibility, row selection, and pagination for a full-featured data exploration experience:

```svelte example
<script>
  import { HeatmapTable } from 'matterviz'

  // Comprehensive materials database with realistic properties
  // deno-fmt-ignore
  const data = [
    [`mp-1234`, `Fe₂O₃`, `R-3c`, `Trigonal`, -2.51, 0.0, 2.2, 3.4, 5.24, 302.7, 231, `Stable`],
    [`mp-390`, `TiO₂`, `P4₂/mnm`, `Tetragonal`, -3.42, 0.0, 3.2, 2.1, 4.23, 62.4, 211, `Stable`],
    [`mp-2133`, `ZnO`, `P6₃mc`, `Hexagonal`, -1.52, 0.02, 3.4, 1.8, 5.61, 23.8, 142, `Stable`],
    [`mp-361`, `Cu₂O`, `Pn-3m`, `Cubic`, -0.68, 0.05, 2.1, 4.2, 6.10, 77.8, 111, `Metastable`],
    [`mp-6930`, `SiO₂`, `P3₁21`, `Trigonal`, -4.13, 0.0, 8.9, 0.9, 2.65, 113.0, 37, `Stable`],
    [`mp-1143`, `Al₂O₃`, `R-3c`, `Trigonal`, -3.47, 0.0, 8.8, 1.2, 3.99, 254.8, 252, `Stable`],
    [`mp-1265`, `MgO`, `Fm-3m`, `Cubic`, -3.01, 0.0, 7.8, 1.0, 3.58, 18.7, 163, `Stable`],
    [`mp-4019`, `CaTiO₃`, `Pnma`, `Orthorhombic`, -3.89, 0.03, 3.5, 2.8, 4.04, 228.2, 175, `Stable`],
    [`mp-5986`, `BaTiO₃`, `P4mm`, `Tetragonal`, -3.72, 0.0, 3.2, 3.1, 6.02, 64.3, 162, `Stable`],
    [`mp-5229`, `SrTiO₃`, `Pm-3m`, `Cubic`, -3.65, 0.0, 3.3, 2.9, 5.12, 59.6, 183, `Stable`],
    [`mp-22526`, `LiCoO₂`, `R-3m`, `Trigonal`, -2.18, 0.0, 2.7, 4.5, 5.05, 32.9, 145, `Stable`],
    [`mp-19017`, `LiFePO₄`, `Pnma`, `Orthorhombic`, -3.21, 0.0, 3.8, 3.9, 3.60, 291.4, 98, `Stable`],
    [`mp-149`, `Si`, `Fd-3m`, `Cubic`, 0.0, 0.0, 1.12, 1.1, 2.33, 40.9, 98, `Stable`],
    [`mp-32`, `GaAs`, `F-43m`, `Cubic`, -0.31, 0.0, 1.42, 0.8, 5.32, 45.2, 75, `Stable`],
    [`mp-661`, `CdTe`, `F-43m`, `Cubic`, -0.42, 0.0, 1.5, 0.9, 5.86, 54.8, 42, `Stable`],
    [`mp-2534`, `SnO₂`, `P4₂/mnm`, `Tetragonal`, -2.54, 0.0, 3.6, 2.4, 6.95, 71.5, 205, `Stable`],
    [`mp-2657`, `WO₃`, `P2₁/c`, `Monoclinic`, -2.89, 0.01, 2.6, 3.2, 7.16, 52.1, 194, `Stable`],
    [`mp-764`, `V₂O₅`, `Pmmn`, `Orthorhombic`, -2.67, 0.0, 2.3, 2.7, 3.36, 178.9, 52, `Stable`],
    [`mp-540`, `NiO`, `Fm-3m`, `Cubic`, -1.23, 0.0, 4.3, 5.1, 6.67, 18.3, 195, `Stable`],
    [`mp-48`, `CoO`, `Fm-3m`, `Cubic`, -1.15, 0.04, 2.4, 4.8, 6.44, 19.5, 180, `Metastable`], // codespell:ignore
    [`mp-1968`,`MnO₂`, `P4₂/mnm`, `Tetragonal`, -2.13, 0.0, 0.3, 6.2, 5.03, 56.2, 267, `Stable` ],
    [`mp-2691`, `Cr₂O₃`, `R-3c`, `Trigonal`, -3.78, 0.0, 3.4, 3.6, 5.22, 96.7, 238, `Stable` ],
    [`mp-1960`, `MoS₂`, `P6₃/mmc`, `Hexagonal`, -1.24, 0.0, 1.8, 2.3, 5.06, 106.4, 45, `Stable` ],
    [`mp-1821`, `WS₂`, `P6₃/mmc`, `Hexagonal`, -1.18, 0.0, 1.9, 2.1, 7.50, 107.2, 56, `Stable` ],
    [`mp-10695`, `Li₃PS₄`, `Pnma`, `Orthorhombic`, -1.87, 0.08, 4.1, 1.5, 1.88, 412.8, 24, `Metastable` ],
    [`mp-3163`, `Na₃AlF₆`, `P2₁/c`, `Monoclinic`, -4.52, 0.0, 6.8, 0.8, 2.97, 226.7, 51, `Stable` ],
    [`mp-7000`, `CuFeS₂`, `I-42d`, `Tetragonal`, -0.89, 0.0, 0.5, 5.8, 4.19, 145.2, 75, `Stable` ],
    [`mp-35`, `GaN`, `P6₃mc`, `Hexagonal`, -0.82, 0.0, 3.4, 1.6, 6.15, 22.9, 210, `Stable` ],
    [`mp-13`, `AlN`, `P6₃mc`, `Hexagonal`, -1.47, 0.0, 6.2, 1.2, 3.26, 20.9, 201, `Stable` ],
    [`mp-804`, `SiC`, `F-43m`, `Cubic`, -0.35, 0.0, 2.4, 1.4, 3.22, 20.7, 225, `Stable`],
  ].map(([v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12]) => (
    { ID: v1, Formula: v2, Spacegroup: v3, Crystal: v4, 'E<sub>form</sub>': v5, 'E<sub>above hull</sub>': v6, 'E<sub>gap</sub>': v7, 'DOS eff': v8, Density: v9, Volume: v10, 'Bulk mod': v11, Stability: v12 })
  )
  // deno-fmt-ignore
  const columns = [
    { label: `ID`, sticky: true, style: `min-width: 80px;` },
    { label: `Formula`, style: `min-width: 90px;` },
    { label: `Spacegroup`, style: `min-width: 95px;` },
    { label: `Crystal`, style: `min-width: 100px;` },
    { label: `E<sub>form</sub>`, better: `lower`, color_scale: `interpolateRdYlGn`, format: `.2f`, description: `Formation energy (eV/atom)` },
    { label: `E<sub>above hull</sub>`, better: `lower`, color_scale: `interpolateRdYlGn`, format: `.2f`, description: `Energy above hull (eV/atom)` },
    { label: `E<sub>gap</sub>`, better: `higher`, color_scale: `interpolateViridis`, format: `.1f`, description: `Electronic bandgap (eV)` },
    { label: `DOS eff`, color_scale: `interpolatePlasma`, format: `.1f`, description: `Effective DOS mass` },
    { label: `Density`, color_scale: `interpolateBlues`, format: `.2f`, description: `Density (g/cm³)` },
    { label: `Volume`, color_scale: `interpolatePurples`, format: `.1f`, description: `Cell volume (Å³)` },
    { label: `Bulk mod`, better: `higher`, color_scale: `interpolateOranges`, format: `d`, description: `Bulk modulus (GPa)` },
    { label: `Stability` },
  ]

  let selected_rows = $state([])
</script>

<HeatmapTable
  {data}
  {columns}
  scroll_style="max-height: 450px;"
  search
  export_data
  show_column_toggle
  show_row_select
  bind:selected_rows
  sort_hint="Shift+click for multi-sort"
  style="margin: 0 auto"
/>

{#if selected_rows.length > 0}
  <p style="margin-top: 1em; color: var(--text-muted)">
    Selected: {selected_rows.map((r) => r.Formula).join(`, `)}
  </p>
{/if}
```

## Pagination

For large datasets, pagination keeps the table responsive while allowing navigation through all data:

```svelte example
<script>
  import { HeatmapTable } from 'matterviz'

  // Generate 100 materials
  const formulas = [`Li`, `Na`, `K`, `Mg`, `Ca`, `Fe`, `Co`, `Ni`, `Cu`, `Zn`]
  const anions = [`O`, `S`, `N`, `F`, `Cl`]
  const data = Array.from({ length: 100 }, (_, idx) => {
    const cat = formulas[idx % formulas.length]
    const an = anions[Math.floor(idx / 20)]
    return {
      ID: `mp-${1000 + idx}`,
      Formula: `${cat}₂${an}`,
      'E<sub>form</sub>': -(Math.random() * 5 + 1).toFixed(2),
      'E<sub>gap</sub>': (Math.random() * 8).toFixed(2),
      Density: (2 + Math.random() * 8).toFixed(2),
    }
  })

  const columns = [
    { label: `ID` },
    { label: `Formula` },
    {
      label: `E<sub>form</sub>`,
      better: `lower`,
      color_scale: `interpolateRdYlGn`,
      format: `.2f`,
    },
    {
      label: `E<sub>gap</sub>`,
      better: `higher`,
      color_scale: `interpolateViridis`,
      format: `.2f`,
    },
    { label: `Density`, color_scale: `interpolateBlues`, format: `.2f` },
  ]
</script>

<HeatmapTable
  {data}
  {columns}
  pagination={{ page_size: 15 }}
  search
  style="margin: 0 auto"
/>
```

## Values with Uncertainties

The table correctly handles numeric strings with uncertainty notation for sorting. Values like `1.23 ± 0.05`, `1.23 +- 0.05`, and `1.23(5)` are parsed to extract the primary number for sorting. Note that heatmap colors only apply to numeric values, so string columns display the uncertainty text without coloring while numeric columns show full heatmap coloring:

```svelte example
<script>
  import { HeatmapTable } from 'matterviz'

  // Experimental measurements: strings with uncertainty for display, numbers for heatmap
  const data = [
    [`mp-149`, `Si`, `1.12 ± 0.02`, 1.12, `148 +- 3`, 148],
    [`mp-32`, `GaAs`, `1.42 ± 0.03`, 1.42, `55 +- 2`, 55],
    [`mp-2133`, `ZnO`, `3.44 ± 0.05`, 3.44, `60 +- 4`, 60],
    [`mp-390`, `TiO₂`, `3.20 ± 0.04`, 3.20, `8.5 +- 0.5`, 8.5],
    [`mp-66`, `Diamond`, `5.47 ± 0.01`, 5.47, `2200 +- 50`, 2200],
    [`mp-1143`, `Al₂O₃`, `8.80 ± 0.10`, 8.80, `30 +- 2`, 30],
    [`mp-1265`, `MgO`, `7.83 ± 0.08`, 7.83, `60 +- 3`, 60],
    [`mp-804`, `SiC`, `3.26 ± 0.04`, 3.26, `490 +- 20`, 490],
    [`mp-35`, `GaN`, `3.40 ± 0.05`, 3.40, `130 +- 8`, 130],
    [`mp-5020`, `NaCl`, `8.50 ± 0.12`, 8.50, `6.5 +- 0.3`, 6.5],
  ].map(([id, formula, gap_str, gap_num, thermal_str, thermal_num]) => ({
    ID: id,
    Formula: formula,
    'E<sub>gap</sub> (± err)': gap_str,
    'E<sub>gap</sub>': gap_num,
    'κ (± err)': thermal_str,
    'κ': thermal_num,
  }))

  // deno-fmt-ignore
  const columns = [
    { label: `ID` },
    { label: `Formula` },
    { label: `E<sub>gap</sub> (± err)`, description: `Band gap with uncertainty (string) — sortable but no heatmap` },
    { label: `E<sub>gap</sub>`, better: `higher`, color_scale: `interpolateViridis`, format: `.2f`, description: `Band gap (eV) — numeric with heatmap` },
    { label: `κ (± err)`, description: `Thermal conductivity with uncertainty (string) — sortable but no heatmap` },
    { label: `κ`, better: `higher`, color_scale: `interpolateOranges`, format: `.0f`, description: `Thermal conductivity (W/m·K) — numeric with heatmap` },
  ]
</script>

<p style="color: var(--text-muted); margin-bottom: 0.5em; font-size: 0.9em">
  Click column headers to sort — string columns with ± are sorted by the primary number,
  numeric columns show heatmap colors
</p>

<HeatmapTable
  {data}
  {columns}
  initial_sort="E<sub>gap</sub> (± err)"
  style="margin: 0 auto"
/>
```

## All Color Scales

Explore different D3 color scales. The `better` prop controls whether high or low values get the "good" end of the scale:

```svelte example
<script>
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

  // Formation energies and bandgaps for common materials
  const data = [
    [`Si`, 0, 1.12],
    [`Ge`, 0, 0.67],
    [`GaAs`, -0.74, 1.42],
    [`ZnO`, -3.63, 3.44],
    [`TiO₂`, -9.73, 3.20],
    [`SiO₂`, -9.08, 8.90],
    [`Al₂O₃`, -17.37, 8.80],
    [`MgO`, -6.23, 7.80],
    [`CaO`, -6.35, 7.10],
    [`BaTiO₃`, -16.82, 3.20],
  ].map(([v1, v2, v3]) => ({
    Material: v1,
    'E<sub>form</sub>': v2,
    'E<sub>gap</sub>': v3,
  }))

  let columns = $derived([
    { label: `Material` },
    { label: `E<sub>form</sub>`, better, color_scale: selected_scale, format: `.2f` },
    { label: `E<sub>gap</sub>`, better, color_scale: selected_scale, format: `.2f` },
  ])
</script>

<div style="display: flex; gap: 2em; margin-bottom: 1em; flex-wrap: wrap">
  <label>
    Color Scale:
    <select bind:value={selected_scale}>
      {#each color_scales as scale}
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
</div>

<HeatmapTable {data} {columns} style="margin: 0 auto" />
```
