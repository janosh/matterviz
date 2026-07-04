# Sankey

Flow diagrams for visualizing weighted transitions between categories (energy flows, budget allocations, before/after correspondences, ...). Built on [`d3-sankey`](https://github.com/d3/d3-sankey) with horizontal and vertical orientations, hover highlighting, and theming via CSS variables.

## Basic Sankey

Pass `data` as `{ nodes, links }`. Each link references nodes by `id` (defaults to array index) and carries a `value` that controls ribbon thickness. Node colors auto-cycle the default palette unless you set `color`.

```svelte example
<script lang="ts">
  import { Sankey, type SankeyData } from 'matterviz'

  const data: SankeyData = {
    nodes: [
      { label: `Coal` },
      { label: `Gas` },
      { label: `Solar` },
      { label: `Grid` },
      { label: `Homes` },
      { label: `Industry` },
    ],
    links: [
      { source: `Coal`, target: `Grid`, value: 20 },
      { source: `Gas`, target: `Grid`, value: 15 },
      { source: `Solar`, target: `Grid`, value: 10 },
      { source: `Grid`, target: `Homes`, value: 25 },
      { source: `Grid`, target: `Industry`, value: 20 },
    ],
  }
</script>

<Sankey {data} style="height: 380px" />
```

Note nodes reference each other by `label` here because no explicit `id` is set, so the
label doubles as the id. Set `id` explicitly when labels are not unique.

## Multi-layer flow (5 levels)

The layout handles arbitrary multi-layer DAGs. Node columns are derived from the graph
topology, so this strictly layered energy-flow graph (sources to conversion to carrier to
distribution to end use) renders as five columns. Flows are conserved at every node
(`value in == value out`).

```svelte example
<script lang="ts">
  import { Sankey, type SankeyData } from 'matterviz'

  const data: SankeyData = {
    nodes: [
      // L0 sources
      { label: `Coal`, color: `#6b6b6b` },
      { label: `Gas`, color: `#9c755f` },
      { label: `Nuclear`, color: `#af7aa1` },
      { label: `Wind`, color: `#76b7b2` },
      { label: `Solar`, color: `#edc949` },
      // L1 conversion
      { label: `Power Plants`, color: `#e15759` },
      { label: `Renewable Farms`, color: `#59a14f` },
      // L2 carrier
      { label: `Electricity`, color: `#4e79a7` },
      { label: `Heat`, color: `#f28e2c` },
      // L3 distribution
      { label: `Grid`, color: `#4e79a7` },
      { label: `District Heating`, color: `#f28e2c` },
      // L4 end use
      { label: `Residential`, color: `#59a14f` },
      { label: `Industry`, color: `#e15759` },
      { label: `Transport`, color: `#76b7b2` },
      { label: `Commercial`, color: `#edc949` },
    ],
    links: [
      { source: `Coal`, target: `Power Plants`, value: 30 },
      { source: `Gas`, target: `Power Plants`, value: 25 },
      { source: `Nuclear`, target: `Power Plants`, value: 20 },
      { source: `Wind`, target: `Renewable Farms`, value: 18 },
      { source: `Solar`, target: `Renewable Farms`, value: 12 },
      { source: `Power Plants`, target: `Electricity`, value: 55 },
      { source: `Power Plants`, target: `Heat`, value: 20 },
      { source: `Renewable Farms`, target: `Electricity`, value: 30 },
      { source: `Electricity`, target: `Grid`, value: 85 },
      { source: `Heat`, target: `District Heating`, value: 20 },
      { source: `Grid`, target: `Residential`, value: 30 },
      { source: `Grid`, target: `Industry`, value: 35 },
      { source: `Grid`, target: `Transport`, value: 10 },
      { source: `Grid`, target: `Commercial`, value: 10 },
      { source: `District Heating`, target: `Residential`, value: 12 },
      { source: `District Heating`, target: `Industry`, value: 8 },
    ],
  }
</script>

<Sankey {data} link_color_mode="gradient" value_format="," style="height: 520px" />
```

## Branching funnel (vertical, 4 levels)

A materials-screening funnel with drop-offs at each stage. Nodes without outgoing links
(dead ends like `Unstable`) would be pushed to the last column under the default `justify`
alignment, so funnels read better with `node_align="left"`, which positions every node by
its depth from the sources.

```svelte example
<script lang="ts">
  import { Sankey, type SankeyData } from 'matterviz'

  const data: SankeyData = {
    nodes: [
      { label: `Candidates`, color: `#4e79a7` },
      { label: `Stable`, color: `#59a14f` },
      { label: `Unstable`, color: `#e15759` },
      { label: `Synthesizable`, color: `#76b7b2` },
      { label: `Metastable`, color: `#edc949` },
      { label: `Experimentally Made`, color: `#59a14f` },
      { label: `Predicted Only`, color: `#af7aa1` },
    ],
    links: [
      { source: `Candidates`, target: `Stable`, value: 700 },
      { source: `Candidates`, target: `Unstable`, value: 300 },
      { source: `Stable`, target: `Synthesizable`, value: 500 },
      { source: `Stable`, target: `Metastable`, value: 200 },
      { source: `Synthesizable`, target: `Experimentally Made`, value: 350 },
      { source: `Synthesizable`, target: `Predicted Only`, value: 150 },
      { source: `Metastable`, target: `Predicted Only`, value: 200 },
    ],
  }
</script>

<Sankey
  {data}
  orientation="vertical"
  node_align="left"
  value_format=","
  style="height: 520px"
/>
```

## Orientation, alignment and link coloring

All layout knobs are reactive props (also exposed in the settings pane): `orientation`, `node_align`, `node_width`, `node_padding`, `link_opacity`, `link_color_mode` (`source` | `target` | `gradient` | `static`) and `show_node_labels`.

```svelte example
<script lang="ts">
  import { Sankey, type SankeyData, type SankeyLinkColorMode } from 'matterviz'

  let orientation = $state<'horizontal' | 'vertical'>(`horizontal`)
  let link_color_mode = $state<SankeyLinkColorMode>(`gradient`)

  const data: SankeyData = {
    nodes: [
      { label: `A`, color: `#4e79a7` },
      { label: `B`, color: `#f28e2c` },
      { label: `X`, color: `#59a14f` },
      { label: `Y`, color: `#e15759` },
      { label: `Out`, color: `#b07aa1` },
    ],
    links: [
      { source: `A`, target: `X`, value: 6 },
      { source: `A`, target: `Y`, value: 4 },
      { source: `B`, target: `X`, value: 3 },
      { source: `B`, target: `Y`, value: 7 },
      { source: `X`, target: `Out`, value: 9 },
      { source: `Y`, target: `Out`, value: 11 },
    ],
  }
</script>

<div style="display: flex; gap: 1em; margin-bottom: 1em; flex-wrap: wrap">
  <label
    >Orientation:
    <select bind:value={orientation}>
      <option value="horizontal">Horizontal</option>
      <option value="vertical">Vertical</option>
    </select>
  </label>
  <label
    >Link color:
    <select bind:value={link_color_mode}>
      <option value="source">Source</option>
      <option value="target">Target</option>
      <option value="gradient">Gradient</option>
      <option value="static">Static</option>
    </select>
  </label>
</div>

<Sankey {data} {orientation} {link_color_mode} style="height: 420px" />
```

## Bipartite diagram from flat arrays

`sankey_from_links(source, target, value, labels?)` builds `SankeyData` from the parallel
index arrays produced by tools like Plotly/pymatviz (e.g. matbench-discovery's DFT-vs-ML
spacegroup correspondence diagrams). `source`/`target` are zero-based node indices.

```svelte example
<script lang="ts">
  import { Sankey, sankey_from_links } from 'matterviz'

  // DFT spacegroup (left) -> ML-relaxed spacegroup (right)
  const data = sankey_from_links(
    [0, 1, 2, 0, 1, 2],
    [3, 3, 4, 4, 5, 5],
    [1750, 820, 610, 290, 130, 70],
    [`P1`, `P2₁/c`, `Fm-3m`, `Pnma`, `R-3m`, `C2/m`],
  )
</script>

<Sankey {data} node_align="left" value_format="," style="height: 360px" />
```

## Custom tooltip

The `tooltip` snippet receives the hovered node or link (`SankeyHandlerProps`, discriminated by `type`).

```svelte example
<script lang="ts">
  import { Sankey, type SankeyData } from 'matterviz'

  const data: SankeyData = {
    nodes: [{ label: `Input` }, { label: `Loss` }, { label: `Output` }],
    links: [
      { source: `Input`, target: `Loss`, value: 18 },
      { source: `Input`, target: `Output`, value: 82 },
    ],
  }
</script>

<Sankey {data} style="height: 300px">
  {#snippet tooltip(info)}
    {#if info.type === `node`}
      <strong>{info.label}</strong>: {info.value} units
    {:else}
      {info.source_label} &rarr; {info.target_label}: <strong>{info.value}</strong>
    {/if}
  {/snippet}
</Sankey>
```
