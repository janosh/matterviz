# Heatmap Table

A sortable, colorable data table component with heatmap-style cell coloring, column grouping, drag-and-drop column reordering, and customizable cell rendering.

## Basic Usage

A simple table with sortable columns and automatic heatmap coloring based on cell values:

```svelte example
<script>
  import { HeatmapTable } from 'matterviz'

  const data = [
    { Formula: `Fe₂O₃`, 'E above hull': 0.0, Bandgap: 2.2, 'Formation E': -8.5 },
    { Formula: `TiO₂`, 'E above hull': 0.0, Bandgap: 3.2, 'Formation E': -9.8 },
    { Formula: `ZnO`, 'E above hull': 0.02, Bandgap: 3.4, 'Formation E': -3.6 },
    { Formula: `Cu₂O`, 'E above hull': 0.05, Bandgap: 2.1, 'Formation E': -1.7 },
    { Formula: `SiO₂`, 'E above hull': 0.0, Bandgap: 8.9, 'Formation E': -9.1 },
    { Formula: `Al₂O₃`, 'E above hull': 0.0, Bandgap: 8.8, 'Formation E': -17.4 },
    { Formula: `MgO`, 'E above hull': 0.0, Bandgap: 7.8, 'Formation E': -6.2 },
    { Formula: `CaTiO₃`, 'E above hull': 0.03, Bandgap: 3.5, 'Formation E': -16.1 },
  ]

  // deno-fmt-ignore
  const columns = [
    { label: `Formula` },
    { label: `E above hull`, better: `lower`, color_scale: `interpolateRdYlGn`, format: `.2f` },
    { label: `Bandgap`, better: `higher`, color_scale: `interpolateViridis`, format: `.1f` },
    { label: `Formation E`, better: `lower`, color_scale: `interpolateBlues`, format: `.1f` },
  ]
</script>

<HeatmapTable {data} {columns} sort_hint="Click column headers to sort" />
```

## Color Scales and Scale Types

Choose from various D3 color scales and switch between linear and logarithmic scaling. Log scale is useful for properties spanning many orders of magnitude like electrical conductivity:

```svelte example
<script>
  import { HeatmapTable } from 'matterviz'

  const data = [
    { Material: `Silicon`, Bandgap: 1.12, Conductivity: 1.56e-3, 'Thermal κ': 150 },
    { Material: `Copper`, Bandgap: 0, Conductivity: 5.96e7, 'Thermal κ': 401 },
    { Material: `Diamond`, Bandgap: 5.47, Conductivity: 1e-13, 'Thermal κ': 2200 },
    { Material: `Germanium`, Bandgap: 0.67, Conductivity: 2.2, 'Thermal κ': 60 },
    { Material: `GaAs`, Bandgap: 1.42, Conductivity: 1e-8, 'Thermal κ': 55 },
    { Material: `SiC`, Bandgap: 3.26, Conductivity: 1e-6, 'Thermal κ': 490 },
    { Material: `GaN`, Bandgap: 3.4, Conductivity: 1e-10, 'Thermal κ': 130 },
    { Material: `InP`, Bandgap: 1.35, Conductivity: 1e-7, 'Thermal κ': 68 },
  ]

  let scale_type = $state(`log`)
  // deno-fmt-ignore
  const columns = [
    { label: `Material` },
    { label: `Bandgap`, better: `higher`, color_scale: `interpolatePlasma`, format: `.2f`, description: `Band gap (eV)` },
    { label: `Conductivity`, better: `higher`, color_scale: `interpolateYlOrRd`, scale_type, format: `.2~e`, description: `Electrical conductivity (S/m)` },
    { label: `Thermal κ`, better: `higher`, color_scale: `interpolateBlues`, format: `,.0f`, description: `Thermal conductivity (W/m·K)` },
  ]
</script>

<label style="display: block; margin-bottom: 1em">
  Conductivity Scale:
  <select bind:value={scale_type}>
    <option value="linear">Linear</option>
    <option value="log">Logarithmic</option>
  </select>
</label>

<HeatmapTable {data} {columns} />
```

## Drag-and-Drop Column Reordering

Columns can be reordered by dragging within the same group. Useful for comparing specific metrics side-by-side:

```svelte example
<script>
  import { HeatmapTable } from 'matterviz'

  const data = [
    {
      Structure: `Perovskite`,
      MAE: 0.042,
      RMSE: 0.089,
      'R²': 0.94,
      'Max Error': 0.31,
    },
    { Structure: `Spinel`, MAE: 0.038, RMSE: 0.076, 'R²': 0.96, 'Max Error': 0.28 },
    { Structure: `Rocksalt`, MAE: 0.051, RMSE: 0.102, 'R²': 0.91, 'Max Error': 0.45 },
    { Structure: `Wurtzite`, MAE: 0.029, RMSE: 0.058, 'R²': 0.97, 'Max Error': 0.19 },
    { Structure: `Fluorite`, MAE: 0.044, RMSE: 0.091, 'R²': 0.93, 'Max Error': 0.33 },
    { Structure: `Pyrite`, MAE: 0.035, RMSE: 0.071, 'R²': 0.95, 'Max Error': 0.24 },
    {
      Structure: `Zincblende`,
      MAE: 0.031,
      RMSE: 0.063,
      'R²': 0.96,
      'Max Error': 0.21,
    },
    { Structure: `Rutile`, MAE: 0.047, RMSE: 0.095, 'R²': 0.92, 'Max Error': 0.38 },
  ]

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

<HeatmapTable {data} {columns} bind:column_order />
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

<HeatmapTable {data} {columns} scroll_style="max-height: 400px;" />
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

<HeatmapTable {data} {columns} scroll_style="max-width: 750px;" />
```

## Interactive Features

Enable search, export, column visibility, row selection, and pagination for a full-featured data exploration experience:

```svelte example
<script>
  import { HeatmapTable } from 'matterviz'

  // Comprehensive materials database with realistic properties
  // deno-fmt-ignore
  const data = [
    { ID: `mp-1234`, Formula: `Fe₂O₃`, Spacegroup: `R-3c`, Crystal: `Trigonal`, 'E form': -2.51, 'E hull': 0.0, Bandgap: 2.2, 'DOS eff': 3.4, Density: 5.24, Volume: 302.7, 'Bulk mod': 231, Stability: `Stable` },
    { ID: `mp-390`, Formula: `TiO₂`, Spacegroup: `P4₂/mnm`, Crystal: `Tetragonal`, 'E form': -3.42, 'E hull': 0.0, Bandgap: 3.2, 'DOS eff': 2.1, Density: 4.23, Volume: 62.4, 'Bulk mod': 211, Stability: `Stable` },
    { ID: `mp-2133`, Formula: `ZnO`, Spacegroup: `P6₃mc`, Crystal: `Hexagonal`, 'E form': -1.52, 'E hull': 0.02, Bandgap: 3.4, 'DOS eff': 1.8, Density: 5.61, Volume: 23.8, 'Bulk mod': 142, Stability: `Stable` },
    { ID: `mp-361`, Formula: `Cu₂O`, Spacegroup: `Pn-3m`, Crystal: `Cubic`, 'E form': -0.68, 'E hull': 0.05, Bandgap: 2.1, 'DOS eff': 4.2, Density: 6.10, Volume: 77.8, 'Bulk mod': 111, Stability: `Metastable` },
    { ID: `mp-6930`, Formula: `SiO₂`, Spacegroup: `P3₁21`, Crystal: `Trigonal`, 'E form': -4.13, 'E hull': 0.0, Bandgap: 8.9, 'DOS eff': 0.9, Density: 2.65, Volume: 113.0, 'Bulk mod': 37, Stability: `Stable` },
    { ID: `mp-1143`, Formula: `Al₂O₃`, Spacegroup: `R-3c`, Crystal: `Trigonal`, 'E form': -3.47, 'E hull': 0.0, Bandgap: 8.8, 'DOS eff': 1.2, Density: 3.99, Volume: 254.8, 'Bulk mod': 252, Stability: `Stable` },
    { ID: `mp-1265`, Formula: `MgO`, Spacegroup: `Fm-3m`, Crystal: `Cubic`, 'E form': -3.01, 'E hull': 0.0, Bandgap: 7.8, 'DOS eff': 1.0, Density: 3.58, Volume: 18.7, 'Bulk mod': 163, Stability: `Stable` },
    { ID: `mp-4019`, Formula: `CaTiO₃`, Spacegroup: `Pnma`, Crystal: `Orthorhombic`, 'E form': -3.89, 'E hull': 0.03, Bandgap: 3.5, 'DOS eff': 2.8, Density: 4.04, Volume: 228.2, 'Bulk mod': 175, Stability: `Stable` },
    { ID: `mp-5986`, Formula: `BaTiO₃`, Spacegroup: `P4mm`, Crystal: `Tetragonal`, 'E form': -3.72, 'E hull': 0.0, Bandgap: 3.2, 'DOS eff': 3.1, Density: 6.02, Volume: 64.3, 'Bulk mod': 162, Stability: `Stable` },
    { ID: `mp-5229`, Formula: `SrTiO₃`, Spacegroup: `Pm-3m`, Crystal: `Cubic`, 'E form': -3.65, 'E hull': 0.0, Bandgap: 3.3, 'DOS eff': 2.9, Density: 5.12, Volume: 59.6, 'Bulk mod': 183, Stability: `Stable` },
    { ID: `mp-22526`, Formula: `LiCoO₂`, Spacegroup: `R-3m`, Crystal: `Trigonal`, 'E form': -2.18, 'E hull': 0.0, Bandgap: 2.7, 'DOS eff': 4.5, Density: 5.05, Volume: 32.9, 'Bulk mod': 145, Stability: `Stable` },
    { ID: `mp-19017`, Formula: `LiFePO₄`, Spacegroup: `Pnma`, Crystal: `Orthorhombic`, 'E form': -3.21, 'E hull': 0.0, Bandgap: 3.8, 'DOS eff': 3.9, Density: 3.60, Volume: 291.4, 'Bulk mod': 98, Stability: `Stable` },
    { ID: `mp-149`, Formula: `Si`, Spacegroup: `Fd-3m`, Crystal: `Cubic`, 'E form': 0.0, 'E hull': 0.0, Bandgap: 1.12, 'DOS eff': 1.1, Density: 2.33, Volume: 40.9, 'Bulk mod': 98, Stability: `Stable` },
    { ID: `mp-32`, Formula: `GaAs`, Spacegroup: `F-43m`, Crystal: `Cubic`, 'E form': -0.31, 'E hull': 0.0, Bandgap: 1.42, 'DOS eff': 0.8, Density: 5.32, Volume: 45.2, 'Bulk mod': 75, Stability: `Stable` },
    { ID: `mp-661`, Formula: `CdTe`, Spacegroup: `F-43m`, Crystal: `Cubic`, 'E form': -0.42, 'E hull': 0.0, Bandgap: 1.5, 'DOS eff': 0.9, Density: 5.86, Volume: 54.8, 'Bulk mod': 42, Stability: `Stable` },
    { ID: `mp-2534`, Formula: `SnO₂`, Spacegroup: `P4₂/mnm`, Crystal: `Tetragonal`, 'E form': -2.54, 'E hull': 0.0, Bandgap: 3.6, 'DOS eff': 2.4, Density: 6.95, Volume: 71.5, 'Bulk mod': 205, Stability: `Stable` },
    { ID: `mp-2657`, Formula: `WO₃`, Spacegroup: `P2₁/c`, Crystal: `Monoclinic`, 'E form': -2.89, 'E hull': 0.01, Bandgap: 2.6, 'DOS eff': 3.2, Density: 7.16, Volume: 52.1, 'Bulk mod': 194, Stability: `Stable` },
    { ID: `mp-764`, Formula: `V₂O₅`, Spacegroup: `Pmmn`, Crystal: `Orthorhombic`, 'E form': -2.67, 'E hull': 0.0, Bandgap: 2.3, 'DOS eff': 2.7, Density: 3.36, Volume: 178.9, 'Bulk mod': 52, Stability: `Stable` },
    { ID: `mp-540`, Formula: `NiO`, Spacegroup: `Fm-3m`, Crystal: `Cubic`, 'E form': -1.23, 'E hull': 0.0, Bandgap: 4.3, 'DOS eff': 5.1, Density: 6.67, Volume: 18.3, 'Bulk mod': 195, Stability: `Stable` },
    { ID: `mp-48`, Formula: `CoO`, Spacegroup: `Fm-3m`, Crystal: `Cubic`, 'E form': -1.15, 'E hull': 0.04, Bandgap: 2.4, 'DOS eff': 4.8, Density: 6.44, Volume: 19.5, 'Bulk mod': 180, Stability: `Metastable` }, // codespell:ignore
    { ID: `mp-1968`, Formula: `MnO₂`, Spacegroup: `P4₂/mnm`, Crystal: `Tetragonal`, 'E form': -2.13, 'E hull': 0.0, Bandgap: 0.3, 'DOS eff': 6.2, Density: 5.03, Volume: 56.2, 'Bulk mod': 267, Stability: `Stable` },
    { ID: `mp-2691`, Formula: `Cr₂O₃`, Spacegroup: `R-3c`, Crystal: `Trigonal`, 'E form': -3.78, 'E hull': 0.0, Bandgap: 3.4, 'DOS eff': 3.6, Density: 5.22, Volume: 96.7, 'Bulk mod': 238, Stability: `Stable` },
    { ID: `mp-1960`, Formula: `MoS₂`, Spacegroup: `P6₃/mmc`, Crystal: `Hexagonal`, 'E form': -1.24, 'E hull': 0.0, Bandgap: 1.8, 'DOS eff': 2.3, Density: 5.06, Volume: 106.4, 'Bulk mod': 45, Stability: `Stable` },
    { ID: `mp-1821`, Formula: `WS₂`, Spacegroup: `P6₃/mmc`, Crystal: `Hexagonal`, 'E form': -1.18, 'E hull': 0.0, Bandgap: 1.9, 'DOS eff': 2.1, Density: 7.50, Volume: 107.2, 'Bulk mod': 56, Stability: `Stable` },
    { ID: `mp-10695`, Formula: `Li₃PS₄`, Spacegroup: `Pnma`, Crystal: `Orthorhombic`, 'E form': -1.87, 'E hull': 0.08, Bandgap: 4.1, 'DOS eff': 1.5, Density: 1.88, Volume: 412.8, 'Bulk mod': 24, Stability: `Metastable` },
    { ID: `mp-3163`, Formula: `Na₃AlF₆`, Spacegroup: `P2₁/c`, Crystal: `Monoclinic`, 'E form': -4.52, 'E hull': 0.0, Bandgap: 6.8, 'DOS eff': 0.8, Density: 2.97, Volume: 226.7, 'Bulk mod': 51, Stability: `Stable` },
    { ID: `mp-7000`, Formula: `CuFeS₂`, Spacegroup: `I-42d`, Crystal: `Tetragonal`, 'E form': -0.89, 'E hull': 0.0, Bandgap: 0.5, 'DOS eff': 5.8, Density: 4.19, Volume: 145.2, 'Bulk mod': 75, Stability: `Stable` },
    { ID: `mp-35`, Formula: `GaN`, Spacegroup: `P6₃mc`, Crystal: `Hexagonal`, 'E form': -0.82, 'E hull': 0.0, Bandgap: 3.4, 'DOS eff': 1.6, Density: 6.15, Volume: 22.9, 'Bulk mod': 210, Stability: `Stable` },
    { ID: `mp-13`, Formula: `AlN`, Spacegroup: `P6₃mc`, Crystal: `Hexagonal`, 'E form': -1.47, 'E hull': 0.0, Bandgap: 6.2, 'DOS eff': 1.2, Density: 3.26, Volume: 20.9, 'Bulk mod': 201, Stability: `Stable` },
    { ID: `mp-804`, Formula: `SiC`, Spacegroup: `F-43m`, Crystal: `Cubic`, 'E form': -0.35, 'E hull': 0.0, Bandgap: 2.4, 'DOS eff': 1.4, Density: 3.22, Volume: 20.7, 'Bulk mod': 225, Stability: `Stable` },
  ]

  // deno-fmt-ignore
  const columns = [
    { label: `ID`, sticky: true, style: `min-width: 80px;` },
    { label: `Formula`, style: `min-width: 90px;` },
    { label: `Spacegroup`, style: `min-width: 95px;` },
    { label: `Crystal`, style: `min-width: 100px;` },
    { label: `E form`, better: `lower`, color_scale: `interpolateRdYlGn`, format: `.2f`, description: `Formation energy (eV/atom)` },
    { label: `E hull`, better: `lower`, color_scale: `interpolateRdYlGn`, format: `.2f`, description: `Energy above hull (eV/atom)` },
    { label: `Bandgap`, better: `higher`, color_scale: `interpolateViridis`, format: `.1f`, description: `Electronic bandgap (eV)` },
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
  show_search
  show_export
  show_column_toggle
  show_row_select
  bind:selected_rows
  sort_hint="Shift+click for multi-sort"
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
      'E form': -(Math.random() * 5 + 1).toFixed(2),
      Bandgap: (Math.random() * 8).toFixed(2),
      Density: (2 + Math.random() * 8).toFixed(2),
    }
  })

  const columns = [
    { label: `ID` },
    { label: `Formula` },
    {
      label: `E form`,
      better: `lower`,
      color_scale: `interpolateRdYlGn`,
      format: `.2f`,
    },
    {
      label: `Bandgap`,
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
  show_pagination
  show_search
  page_size={15}
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
    { Material: `Si`, 'Formation E': 0, Bandgap: 1.12 },
    { Material: `Ge`, 'Formation E': 0, Bandgap: 0.67 },
    { Material: `GaAs`, 'Formation E': -0.74, Bandgap: 1.42 },
    { Material: `ZnO`, 'Formation E': -3.63, Bandgap: 3.44 },
    { Material: `TiO₂`, 'Formation E': -9.73, Bandgap: 3.20 },
    { Material: `SiO₂`, 'Formation E': -9.08, Bandgap: 8.90 },
    { Material: `Al₂O₃`, 'Formation E': -17.37, Bandgap: 8.80 },
    { Material: `MgO`, 'Formation E': -6.23, Bandgap: 7.80 },
    { Material: `CaO`, 'Formation E': -6.35, Bandgap: 7.10 },
    { Material: `BaTiO₃`, 'Formation E': -16.82, Bandgap: 3.20 },
  ]

  let columns = $derived([
    { label: `Material` },
    { label: `Formation E`, better, color_scale: selected_scale, format: `.2f` },
    { label: `Bandgap`, better, color_scale: selected_scale, format: `.2f` },
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

<HeatmapTable {data} {columns} />
```
