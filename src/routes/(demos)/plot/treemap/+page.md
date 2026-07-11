# Treemap

Zoomable hierarchical part-of-whole charts as squarified nested rectangles (the plotly-treemap counterpart to [Sunburst](/plot/sunburst)). Cell areas are proportional to values, branch cells carry plotly-style header strips, and clicking any cell re-tiles its subtree to fill the viewport with an animated transition (clicking a zoomed-in leaf zooms back out). Treemaps consume the same node trees, data builders (`sunburst_from_paths`, `chem_sys_sunburst_data`, `spacegroup_sunburst_data`, …) and value semantics as Sunburst, so switching between the two charts is a one-line change.

## Basic Treemap

Pass `data` as a nested tree (or array of trees). Leaves carry `value`; cell areas are the sum of their leaves by default. Sibling cells tile largest-to-smallest from the top-left corner toward the bottom-right (pass `sort="none"` to keep input order instead). Depth-1 categories auto-cycle the default palette unless you set `color`, and descendants inherit their ancestor's color. Click any cell to zoom into it (plotly-style); the breadcrumb pathbar at the top (or <kbd>Escape</kbd> / double-clicking empty background) zooms back out.

```svelte example
<script lang="ts">
  import { Treemap, type TreemapNode } from 'matterviz'

  const data: TreemapNode[] = [
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

<Treemap {data} style="height: 420px" />
```

## Multiline labels and fitting

`label_formatter` returns one or more independently styled lines while preserving the default cell hover, focus, click, zoom, and tooltip behavior. Parent header labels default to 14 px (`parent_label_font_size`) while leaf labels use `--treemap-font-size` (11 px by default). `label_fit="shrink"` is the default and scales the label block's base font size between `label_min_font_size` and `label_max_font_size`. Use `"hide"` to omit labels that do not fit at full size, or `"clip"` to keep the maximum size and clip overflow (per-line `font_scale` multiplies on top of the fitted base size, so scaled lines can render outside those bounds). Parent headers use `parent_label_font_size` as their ceiling. Shrink and clip modes use an unrotated clipping wrapper, so even rotated labels stay inside their cells.

```svelte example
<script lang="ts">
  import { Treemap, sunburst_from_paths } from 'matterviz'

  const data = sunburst_from_paths([
    { path: [`src`, `App.svelte`], value: 320 },
    { path: [`src`, `plot`, `Treemap.svelte`], value: 180 },
    { path: [`src`, `plot`, `labels.ts`], value: 70 },
    { path: [`README.md`], value: 90 },
  ])
</script>

<Treemap
  {data}
  padding_top={30}
  label_min_font_size={3}
  label_max_font_size={28}
  label_formatter={(arc) => [
    {
      text: arc.label_path.slice(0, -1).join(`/`) || `.`,
      font_scale: 0.58,
      font_weight: 300,
      opacity: 0.72,
    },
    { text: arc.label ?? `${arc.id}`, font_weight: 650 },
  ]}
  style="height: 420px"
/>
```

## Chemical system treemap

`chem_sys_sunburst_data` builds the arity &rarr; chemical-system hierarchy from a list of formulas and/or chemical systems (one entry per occurrence) — the counterpart to pymatviz's `chem_sys_treemap`, sharing its data builder with the sunburst version. Entries are normalized to alphabetical element order, so `Li2O`, `LiO` and `O-Li` all count toward `Li-O`. Zoom into an arity group to compare its systems at full size.

```svelte example
<script lang="ts">
  import { chem_sys_sunburst_data, Treemap } from 'matterviz'

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

<Treemap
  data={chem_sys_sunburst_data(entries)}
  label_text="label+value"
  style="height: 500px"
/>
```

## Spacegroup treemap

`spacegroup_sunburst_data` builds the crystal-system &rarr; spacegroup hierarchy from spacegroup numbers or Hermann-Mauguin symbols (one entry per structure). Real spacegroup distributions have long tails — `min_fraction` groups every spacegroup below a threshold share into one "Other" cell per crystal system. Header strips label each crystal system, so no legend is needed.

```svelte example
<script lang="ts">
  import { spacegroup_sunburst_data, Treemap, type Vec2 } from 'matterviz'

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

<label style="display: block; margin-block: 0 1em">
  Group spacegroups below
  <select bind:value={min_fraction}>
    <option value={0}>0% (show all)</option>
    <option value={0.01}>1%</option>
    <option value={0.02}>2%</option>
    <option value={0.04}>4%</option>
  </select>
  of all structures into 'Other'
</label>

<Treemap
  data={spacegroup_sunburst_data(spacegroups)}
  {min_fraction}
  label_text="label+percent"
  style="height: 500px"
/>
```

## Metric coloring and deep zoom

Pass `color_values` to color cells by a numeric metric on a continuous d3 colormap instead of categorical inheritance — e.g. energy above hull per compound (cells returning `null` keep their categorical color, and a `ColorBar` shows the scale). Deep trees built from path rows via `sunburst_from_paths` zoom level by level: `max_depth` limits how many levels render below the current root, so drilling down progressively reveals structure prototypes and compounds.

```svelte example
<script lang="ts">
  import { Treemap, type TreemapNode, sunburst_from_paths } from 'matterviz'

  let zoom_root_id = $state<string | number | null>(null)

  // [crystal system, structure prototype, compound, count, energy above hull (eV/atom)]
  const compounds: [string, string, string, number, number][] = [
    [`cubic`, `rock salt`, `NaCl`, 65, 0],
    [`cubic`, `rock salt`, `MgO`, 48, 0],
    [`cubic`, `rock salt`, `FeO`, 35, 0.021],
    [`cubic`, `perovskite`, `SrTiO₃`, 42, 0],
    [`cubic`, `perovskite`, `BaTiO₃`, 35, 0.004],
    [`cubic`, `perovskite`, `MgSiO₃`, 12, 0.062],
    [`cubic`, `spinel`, `MgAl₂O₄`, 38, 0],
    [`cubic`, `spinel`, `LiMn₂O₄`, 21, 0.011],
    [`hexagonal`, `wurtzite`, `ZnO`, 29, 0.034],
    [`hexagonal`, `wurtzite`, `GaN`, 33, 0],
    [`orthorhombic`, `olivine`, `LiFePO₄`, 26, 0.008],
    [`orthorhombic`, `olivine`, `Mg₂SiO₄`, 14, 0.045],
  ]
  const data = sunburst_from_paths(
    compounds.map(([system, prototype, compound, count, e_above_hull]) => ({
      path: [system, prototype, compound],
      value: count,
      metadata: { e_above_hull },
    })),
  )
  // Only compound leaves carry e_above_hull, but max_depth=2 hides them at root
  // zoom - attach the count-weighted mean to branch nodes so prototype/system
  // cells are metric-colored at every zoom level.
  const attach_mean_e_hull = (node: TreemapNode): [number, number] => {
    if (!node.children?.length) {
      const e_hull = (node.metadata?.e_above_hull as number) ?? 0
      return [e_hull * (node.value ?? 0), node.value ?? 0]
    }
    let [sum, weight] = [0, 0]
    for (const child of node.children) {
      const [child_sum, child_weight] = attach_mean_e_hull(child)
      sum += child_sum
      weight += child_weight
    }
    node.metadata = { e_above_hull: weight > 0 ? sum / weight : 0 }
    return [sum, weight]
  }
  data.forEach(attach_mean_e_hull)
</script>

<div style="display: flex; gap: 1em; align-items: center; margin-block: 0 1em">
  <button onclick={() => (zoom_root_id = null)} disabled={zoom_root_id === null}>
    Reset zoom
  </button>
  <span>current root: <code>{zoom_root_id ?? `all`}</code></span>
</div>

<Treemap
  {data}
  bind:zoom_root_id
  max_depth={2}
  color_values={(cell) => (cell.metadata?.e_above_hull as number | undefined) ?? null}
  colorbar={{ title: `E<sub>hull</sub> (eV/atom)` }}
  style="height: 500px"
>
  {#snippet tooltip(info)}
    <strong>{info.label_path.join(` › `)}</strong>: {info.value} entries
    {#if info.depth > 1}({(info.parent_fraction * 100).toFixed(0)}% of parent){/if}
  {/snippet}
</Treemap>
```
