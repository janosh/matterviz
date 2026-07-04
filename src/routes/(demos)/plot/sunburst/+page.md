# Sunburst

Zoomable hierarchical part-of-whole charts (rings of nested categories, e.g. crystal system &rarr; spacegroup distributions). Built on [`d3-hierarchy`](https://github.com/d3/d3-hierarchy)'s partition layout with animated click-to-zoom drill-down, hover highlighting of ancestor/descendant chains, and theming via CSS variables.

## Basic Sunburst

Pass `data` as a nested tree (or array of trees). Leaves carry `value`; branch angles are the sum of their leaves by default. Depth-1 categories auto-cycle the default palette unless you set `color`, and descendants inherit their ancestor's color. Click a branch arc to zoom into it, click the center to zoom back out.

```svelte example
<script lang="ts">
  import { Sunburst, type SunburstNode } from 'matterviz'

  const data: SunburstNode[] = [
    {
      label: `Renewable`,
      children: [
        {
          label: `Solar`,
          children: [
            { label: `PV`, value: 24 },
            { label: `CSP`, value: 4 },
          ],
        },
        { label: `Wind`, value: 30 },
        { label: `Hydro`, value: 17 },
      ],
    },
    {
      label: `Fossil`,
      children: [
        { label: `Coal`, value: 22 },
        { label: `Gas`, value: 28 },
      ],
    },
    { label: `Nuclear`, value: 18 },
  ]
</script>

<Sunburst {data} style="height: 420px" />
```

## Crystal-structure taxonomy (5 levels)

Deeply nested trees are easiest to build from path rows via `sunburst_from_paths` (plotly-express style). This crystal-structure taxonomy spans five levels — crystal system &rarr; point group &rarr; space group &rarr; structure prototype &rarr; compound (with illustrative entry counts) — colored by crystal system with `level_lighten` brightening each ring outward. Several features combine here:

- when zoomed, a clickable breadcrumb trail (top-left) jumps straight to any ancestor; <kbd>Escape</kbd> zooms out one level and double-clicking empty background resets to the root
- the bindable `zoom_root_id` tracks the current drill-down root (and powers the reset button)
- `max_depth` limits how many rings show below the zoom root (like plotly's `maxdepth`) — switch to 3 rings and zooming reveals deeper levels progressively
- a custom `tooltip` snippet renders the `label_path` breadcrumb plus share-of-parent
- labels auto-hide on arcs too small to fit them, so zooming in reveals more labels; arrow keys move keyboard focus between siblings (left/right), children (down) and parents (up)
- the controls pane (gear icon, top-right) holds SVG/PNG export buttons

```svelte example
<script lang="ts">
  import { CRYSTAL_SYSTEM_COLORS, Sunburst, sunburst_from_paths } from 'matterviz'

  let zoom_root_id = $state<string | number | null>(null)
  let max_depth = $state(0)

  // [crystal system, point group, space group, structure prototype, compound, count]
  const compounds: [string, string, string, string, string, number][] = [
    [`cubic`, `m-3m`, `Fm-3m`, `rock salt`, `NaCl`, 65],
    [`cubic`, `m-3m`, `Fm-3m`, `rock salt`, `MgO`, 48],
    [`cubic`, `m-3m`, `Fm-3m`, `rock salt`, `TiC`, 35],
    [`cubic`, `m-3m`, `Fm-3m`, `fluorite`, `CaF₂`, 32],
    [`cubic`, `m-3m`, `Fm-3m`, `fluorite`, `UO₂`, 24],
    [`cubic`, `m-3m`, `Fm-3m`, `fluorite`, `CeO₂`, 18],
    [`cubic`, `m-3m`, `Fm-3m`, `full Heusler`, `Cu₂MnAl`, 22],
    [`cubic`, `m-3m`, `Fm-3m`, `full Heusler`, `Co₂MnSi`, 19],
    [`cubic`, `m-3m`, `Pm-3m`, `perovskite`, `SrTiO₃`, 42],
    [`cubic`, `m-3m`, `Pm-3m`, `perovskite`, `BaTiO₃`, 35],
    [`cubic`, `m-3m`, `Pm-3m`, `perovskite`, `KNbO₃`, 12],
    [`cubic`, `m-3m`, `Pm-3m`, `CsCl-type`, `CsCl`, 15],
    [`cubic`, `m-3m`, `Pm-3m`, `CsCl-type`, `NiAl`, 11],
    [`cubic`, `m-3m`, `Fd-3m`, `spinel`, `MgAl₂O₄`, 38],
    [`cubic`, `m-3m`, `Fd-3m`, `spinel`, `Fe₃O₄`, 30],
    [`cubic`, `m-3m`, `Fd-3m`, `spinel`, `LiMn₂O₄`, 21],
    [`cubic`, `m-3m`, `Fd-3m`, `diamond`, `Si`, 14],
    [`cubic`, `m-3m`, `Fd-3m`, `diamond`, `C`, 9],
    [`cubic`, `-43m`, `F-43m`, `zinc blende`, `GaAs`, 28],
    [`cubic`, `-43m`, `F-43m`, `zinc blende`, `ZnS`, 24],
    [`cubic`, `-43m`, `F-43m`, `zinc blende`, `InP`, 16],
    [`cubic`, `-43m`, `F-43m`, `half-Heusler`, `TiNiSn`, 13],
    [`cubic`, `-43m`, `F-43m`, `half-Heusler`, `ZrNiSn`, 9],
    [`hexagonal`, `6/mmm`, `P6₃/mmc`, `hcp`, `Ti`, 16],
    [`hexagonal`, `6/mmm`, `P6₃/mmc`, `hcp`, `Mg`, 12],
    [`hexagonal`, `6/mmm`, `P6₃/mmc`, `hcp`, `Zn`, 8],
    [`hexagonal`, `6/mmm`, `P6₃/mmc`, `graphite`, `C`, 11],
    [`hexagonal`, `6mm`, `P6₃mc`, `wurtzite`, `GaN`, 33],
    [`hexagonal`, `6mm`, `P6₃mc`, `wurtzite`, `ZnO`, 29],
    [`hexagonal`, `6mm`, `P6₃mc`, `wurtzite`, `AlN`, 18],
    [`tetragonal`, `4/mmm`, `P4₂/mnm`, `rutile`, `TiO₂`, 27],
    [`tetragonal`, `4/mmm`, `P4₂/mnm`, `rutile`, `SnO₂`, 17],
    [`tetragonal`, `4/mmm`, `I4/mmm`, `ThCr₂Si₂-type`, `BaFe₂As₂`, 19],
    [`tetragonal`, `4/mmm`, `I4/mmm`, `ThCr₂Si₂-type`, `SrFe₂As₂`, 12],
    [`trigonal`, `-3m`, `R-3m`, `layered rock salt`, `LiCoO₂`, 31],
    [`trigonal`, `-3m`, `R-3m`, `layered rock salt`, `NaCoO₂`, 9],
    [`trigonal`, `-3m`, `R-3m`, `tetradymite`, `Bi₂Te₃`, 23],
    [`trigonal`, `-3m`, `R-3m`, `tetradymite`, `Sb₂Te₃`, 13],
    [`orthorhombic`, `mmm`, `Pnma`, `olivine`, `LiFePO₄`, 26],
    [`orthorhombic`, `mmm`, `Pnma`, `olivine`, `Mg₂SiO₄`, 14],
    [`orthorhombic`, `mmm`, `Pnma`, `GdFeO₃-type`, `CaTiO₃`, 17],
    [`orthorhombic`, `mmm`, `Pnma`, `GdFeO₃-type`, `LaMnO₃`, 15],
  ]
  const data = sunburst_from_paths(
    compounds.map(([system, point_group, spacegroup, prototype, compound, count]) => ({
      path: [system, point_group, spacegroup, prototype, compound],
      value: count,
    })),
  )
  // color depth-1 arcs by crystal system (descendants inherit, lightened per ring)
  for (const node of data) {
    node.color = CRYSTAL_SYSTEM_COLORS[node.label as keyof typeof CRYSTAL_SYSTEM_COLORS]
  }
</script>

<div style="display: flex; gap: 1em; align-items: center; flex-wrap: wrap">
  <button onclick={() => (zoom_root_id = null)} disabled={zoom_root_id === null}>
    Reset zoom
  </button>
  <span>current root: <code>{zoom_root_id ?? `all`}</code></span>
  <label
    >Rings:
    <select bind:value={max_depth}>
      <option value={0}>all</option>
      <option value={3}>3</option>
      <option value={2}>2</option>
    </select>
  </label>
</div>

<Sunburst
  {data}
  bind:zoom_root_id
  {max_depth}
  level_lighten={0.3}
  inner_radius={0.08}
  style="height: 750px"
>
  {#snippet tooltip(info)}
    <strong>{info.label_path.join(` › `)}</strong>: {info.value} entries
    {#if info.depth > 1}({(info.parent_fraction * 100).toFixed(0)}% of parent){/if}
  {/snippet}
</Sunburst>
```

## Plotly-trace input and value modes

`sunburst_from_labels_parents` consumes plotly trace arrays (`labels`/`parents`/`values` plus optional `ids`), the format produced by pymatviz sunburst exports. `value_mode` controls how those values are interpreted (plotly's `branchvalues`): `total` treats every value as authoritative — children summing to less than their parent leave a visible gap — while `leaf-sum` (default) ignores parent values and `remainder` adds a parent's own value on top of its children. Toggle the mode to see the gaps appear and disappear. `sort="descending"` orders siblings by value, and the legend lists depth-1 categories (clicking an entry mutes that subtree).

```svelte example
<script lang="ts">
  import { Sunburst, sunburst_from_labels_parents, type SunburstValueMode } from 'matterviz'

  let value_mode = $state<SunburstValueMode>(`total`)

  // parents are worth more than their children sum to (unassigned remainder)
  const data = sunburst_from_labels_parents(
    [`metals`, `Fe`, `Cu`, `Al`, `ceramics`, `SiC`, `Al₂O₃`],
    [``, `metals`, `metals`, `metals`, ``, `ceramics`, `ceramics`],
    [120, 45, 30, 25, 70, 35, 20],
  )
</script>

<label>
  Value mode:
  <select bind:value={value_mode}>
    <option value="total">total</option>
    <option value="leaf-sum">leaf-sum</option>
    <option value="remainder">remainder</option>
  </select>
</label>

<Sunburst {data} {value_mode} sort="descending" show_legend style="height: 420px" />
```

## Icicle charts with value gaps

Passing `shape="icicle"` renders the same partition as stacked horizontal rows — well suited to deep hierarchies where outer sunburst rings get too thin to label. Rows don't have to be fully filled: with `value_mode="total"` each node's value is authoritative, so a parent whose children don't add up to its own value leaves a gap (the uncatalogued remainder). Here every level carries such a remainder, so the chart is a ragged staircase rather than a solid block. All interactions are shared (click a row to zoom in, breadcrumbs or <kbd>Escape</kbd> to zoom out, hover for tooltips, plus the controls pane).

```svelte example
<script lang="ts">
  import { Sunburst, sunburst_from_paths } from 'matterviz'

  // "path,value" rows (CSV-style). value_mode="total" makes each value authoritative,
  // so a parent whose children don't sum to it leaves a gap (uncatalogued remainder).
  const csv = `
Oxides,520
Oxides/Perovskites,180
Oxides/Perovskites/Titanates,70
Oxides/Perovskites/Titanates/SrTiO₃,28
Oxides/Perovskites/Titanates/BaTiO₃,22
Oxides/Perovskites/Niobates,45
Oxides/Perovskites/Niobates/KNbO₃,18
Oxides/Perovskites/Niobates/NaNbO₃,12
Oxides/Spinels,120
Oxides/Spinels/MgAl₂O₄,40
Oxides/Spinels/Fe₃O₄,35
Oxides/Spinels/Co₃O₄,20
Oxides/Rock salt,90
Oxides/Rock salt/MgO,38
Oxides/Rock salt/NiO,22
Intermetallics,300
Intermetallics/Heuslers,140
Intermetallics/Heuslers/full,60
Intermetallics/Heuslers/full/Cu₂MnAl,24
Intermetallics/Heuslers/full/Co₂MnSi,20
Intermetallics/Heuslers/half,50
Intermetallics/Heuslers/half/TiNiSn,18
Intermetallics/Heuslers/half/ZrNiSn,14
Intermetallics/Laves,80
Intermetallics/Laves/MgCu₂,30
Intermetallics/Laves/MgZn₂,22
Chalcogenides,160
Chalcogenides/Sulfides,90
Chalcogenides/Sulfides/MoS₂,32
Chalcogenides/Sulfides/FeS₂,24
Chalcogenides/Tellurides,50
Chalcogenides/Tellurides/Bi₂Te₃,26
Chalcogenides/Tellurides/Sb₂Te₃,14
`
  const data = sunburst_from_paths(
    csv
      .trim()
      .split(`\n`)
      .map((row) => {
        const [path, value] = row.split(`,`)
        return { path: path.split(`/`), value: Number(value) }
      }),
  )
</script>

<Sunburst shape="icicle" {data} value_mode="total" style="height: 460px" />
```

## Metric coloring

Pass `color_values` to color arcs by a numeric metric on a continuous d3 colormap instead of categorical inheritance — e.g. energy above hull per compound. Arcs whose accessor returns `null` (here: the branch levels) keep their categorical color, and a `ColorBar` shows the scale (pass `colorbar={null}` to hide it, or `color_range` to fix the domain).

```svelte example
<script lang="ts">
  import { Sunburst, sunburst_from_paths } from 'matterviz'

  // [structure prototype, compound, count, energy above hull (eV/atom)]
  const compounds: [string, string, number, number][] = [
    [`rock salt`, `NaCl`, 65, 0],
    [`rock salt`, `MgO`, 48, 0],
    [`rock salt`, `FeO`, 35, 0.021],
    [`perovskite`, `SrTiO₃`, 42, 0],
    [`perovskite`, `BaTiO₃`, 35, 0.004],
    [`perovskite`, `MgSiO₃`, 12, 0.062],
    [`spinel`, `MgAl₂O₄`, 38, 0],
    [`spinel`, `LiMn₂O₄`, 21, 0.011],
    [`wurtzite`, `ZnO`, 29, 0.034],
    [`wurtzite`, `GaN`, 33, 0],
    [`olivine`, `LiFePO₄`, 26, 0.008],
    [`olivine`, `Mg₂SiO₄`, 14, 0.045],
  ]
  const data = sunburst_from_paths(
    compounds.map(([prototype, compound, count, e_above_hull]) => ({
      path: [prototype, compound],
      value: count,
      metadata: { e_above_hull },
    })),
  )
</script>

<Sunburst
  {data}
  color_values={(arc) => (arc.metadata?.e_above_hull as number | undefined) ?? null}
  colorbar={{ title: `E<sub>hull</sub> (eV/atom)` }}
  style="height: 450px"
/>
```

## Spacegroup sunburst

`spacegroup_sunburst_data` builds the crystal-system &rarr; spacegroup hierarchy from a list of spacegroup numbers or Hermann-Mauguin symbols (one entry per structure), using the same colors and `"system/number"` ids as pymatviz's `spacegroup_sunburst` (as seen in [matbench-discovery's symmetry statistics](https://matbench-discovery.materialsproject.org/data#symmetry-statistics)). Real spacegroup distributions have long tails — `min_fraction` groups every spacegroup below a threshold share into one "Other" slice per crystal system, and `label_text` switches labels to include percentages.

```svelte example
<script lang="ts">
  import { spacegroup_sunburst_data, Sunburst, type Vec2 } from 'matterviz'

  let min_fraction = $state(0.02)

  // synthetic MP-like spacegroup distribution: [spacegroup, structure count]
  const distribution: Vec2[] = [
    [225, 380], // Fm-3m
    [221, 160], // Pm-3m
    [227, 140], // Fd-3m
    [194, 200], // P6₃/mmc
    [191, 90], // P6/mmm
    [166, 170], // R-3m
    [139, 190], // I4/mmm
    [123, 80], // P4/mmm
    [62, 240], // Pnma
    [63, 110], // Cmcm
    [12, 150], // C2/m
    [14, 130], // P2₁/c
    [2, 95], // P-1
    [1, 25], // P1
    // long tail of rare spacegroups
    [19, 18],
    [33, 15],
    [61, 12],
    [88, 10],
    [122, 9],
    [148, 14],
    [161, 8],
    [176, 11],
    [198, 7],
    [205, 13],
    [215, 6],
    [230, 9],
  ]
  const spacegroups = distribution.flatMap(([spg, count]) => Array(count).fill(spg))
</script>

<label>
  Group spacegroups below
  <select bind:value={min_fraction}>
    <option value={0}>0% (show all)</option>
    <option value={0.01}>1%</option>
    <option value={0.02}>2%</option>
    <option value={0.04}>4%</option>
  </select>
  of all structures into 'Other'
</label>

<Sunburst
  data={spacegroup_sunburst_data(spacegroups)}
  {min_fraction}
  label_text="label+percent"
  show_legend
  style="height: 500px"
/>
```

## Chemical system sunburst

`chem_sys_sunburst_data` builds the arity &rarr; chemical-system hierarchy from a list of formulas and/or chemical systems (one entry per occurrence), the counterpart to pymatviz's `chem_sys_sunburst`. Entries are normalized to alphabetical element order, so `Li2O`, `LiO` and `O-Li` all count toward `Li-O`.

```svelte example
<script lang="ts">
  import { chem_sys_sunburst_data, Sunburst } from 'matterviz'

  // synthetic dataset: [formula or chemical system, occurrence count]
  const distribution: [string, number][] = [
    [`Si`, 18],
    [`Fe`, 12],
    [`C`, 8], // unary
    [`Fe2O3`, 45],
    [`Li2O`, 30],
    [`GaN`, 25],
    [`Mo-S`, 20],
    [`Bi-Te`, 14], // binary
    [`LiCoO2`, 32],
    [`BaTiO3`, 28],
    [`MgAl2O4`, 22],
    [`Li-Mn-O`, 16],
    [`CsPbBr3`, 12], // ternary
    [`LiFePO4`, 38],
    [`Cu2ZnSnS4`, 9], // quaternary
  ]
  const entries = distribution.flatMap(([sys, count]) => Array(count).fill(sys))
</script>

<Sunburst
  data={chem_sys_sunburst_data(entries)}
  label_text="label+value"
  style="height: 450px"
/>
```
