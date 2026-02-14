<script lang="ts">
  import type { ChemicalElement, ElementSymbol } from '$lib/element'
  import {
    type AxisItem,
    type CellContext,
    type ElementAxisOrderingKey,
    elements_to_axis,
    HeatmapMatrix,
    HeatmapMatrixControls,
  } from '$lib/heatmap-matrix'
  import { format_num } from '$lib/labels'

  // === Demo 1: Full element matrix with ordering controls, tooltip, and click ===
  let ordering = $state<ElementAxisOrderingKey>(`atomic_number`)
  let hide_mode = $state<false | `compact` | `gaps`>(`compact`)
  let axis_items = $derived(elements_to_axis(undefined, ordering))
  let clicked_cell: CellContext | null = $state(null)
  let dblclick_info: string | null = $state(null)

  // Compute pairwise |ΔEN| for a set of axis items
  function en_diff_matrix(items: AxisItem<ChemicalElement>[]): (number | null)[][] {
    return items.map((y_item) => {
      const y_en = y_item.data?.electronegativity_pauling ?? null
      return items.map((x_item) => {
        const x_en = x_item.data?.electronegativity_pauling ?? null
        return x_en !== null && y_en !== null ? Math.abs(x_en - y_en) : null
      })
    })
  }

  let en_diff_values = $derived(en_diff_matrix(axis_items))

  // === Demo 2: Small subset with custom tooltip, symmetric mode, and color scale ===
  const demo_symbols: ElementSymbol[] = [
    `Li`,
    `Na`,
    `K`,
    `Mg`,
    `Ca`,
    `Al`,
    `Fe`,
    `Cu`,
    `Zn`,
    `Ag`,
    `Au`,
    `Pt`,
    `Ti`,
    `Ni`,
    `Co`,
    `Mn`,
    `Cr`,
    `V`,
    `Si`,
    `Ge`,
  ]
  let small_axis = $derived(elements_to_axis(demo_symbols, ordering))
  let small_values = $derived(en_diff_matrix(small_axis))

  // === Demo 3: Non-element axis items (property ranges) ===
  const property_bins: AxisItem[] = [
    { label: `0-1`, key: `bin_0`, category: `low` },
    { label: `1-2`, key: `bin_1`, category: `low` },
    { label: `2-3`, key: `bin_2`, category: `medium` },
    { label: `3-4`, key: `bin_3`, category: `medium` },
    { label: `4-5`, key: `bin_4`, category: `high` },
    { label: `5-6`, key: `bin_5`, category: `high` },
    { label: `6-7`, key: `bin_6`, category: `high` },
    { label: `7+`, key: `bin_7`, category: `extreme` },
  ]
  // Count element pairs falling into each EN-diff x density-ratio bin
  const bin_values: number[][] = property_bins.map((_, y_idx) =>
    property_bins.map((_, x_idx) => {
      // Generate a synthetic heatmap: Gaussian-ish distribution centered near (3,3)
      const dist = Math.sqrt((x_idx - 3) ** 2 + (y_idx - 3) ** 2)
      return Math.round(100 * Math.exp(-dist * 0.4))
    })
  )
</script>

<h1>Heatmap Matrix</h1>
<p>
  Interactive square heatmap for visualizing pairwise relationships. Inspired by the
  <a href="https://viz.whsunresearch.group/gliquid/interactive-matrix.html">
    Binary Phase Diagram Map
  </a> from the Sun Research Group.
</p>

<!-- Demo 1: Full 118x118 element matrix -->
<h2>Element Pair Electronegativity Difference</h2>
<p>
  Full 118-element matrix colored by |&Delta;EN|. Elements without electronegativity data
  (noble gases, some superheavy) are auto-hidden with <code>hide_empty="compact"</code>.
  Hover for tooltips, click cells for details.
</p>

<div class="heatmap-controls-anchor">
  <div class="scroll-container">
    <HeatmapMatrix
      x_items={axis_items}
      y_items={axis_items}
      values={en_diff_values}
      color_scale="interpolateViridis"
      hide_empty={hide_mode}
      tooltip
      onclick={(cell: CellContext) => (clicked_cell = cell)}
    />
  </div>
  <HeatmapMatrixControls bind:ordering>
    <label>
      Hide empty
      <select bind:value={hide_mode}>
        <option value="compact">compact</option>
        <option value="gaps">gaps</option>
        <option value={false}>off</option>
      </select>
    </label>
  </HeatmapMatrixControls>
</div>
{#if clicked_cell}
  <div class="click-info">
    Clicked: <strong>{clicked_cell.x_item.label}</strong> &ndash;
    <strong>{clicked_cell.y_item.label}</strong>
    {#if clicked_cell.value != null}
      = {
        typeof clicked_cell.value === `number`
        ? format_num(clicked_cell.value)
        : clicked_cell.value
      }
    {/if}
  </div>
{/if}

<!-- Demo 2: Subset with symmetric mode, custom tooltip, dblclick, and different color scale -->
<h2>Symmetric Subset with Custom Tooltip</h2>
<p>
  20 metals in symmetric (lower-triangle) mode with <code>interpolatePlasma</code> color
  scale. Custom tooltip shows element names and electronegativity values. Double-click
  updates the status text below.
</p>

<div class="heatmap-controls-anchor">
  <HeatmapMatrix
    x_items={small_axis}
    y_items={small_axis}
    values={small_values}
    color_scale="interpolatePlasma"
    symmetric
    tile_size="20px"
    gap="1px"
    ondblclick={(cell: CellContext) =>
    dblclick_info = `${cell.x_item.label}-${cell.y_item.label}: ${
      typeof cell.value === `number` ? format_num(cell.value) : cell.value
    }`}
    style="margin: 1em auto"
  >
    {#snippet tooltip(ctx)}
      {@const x_el = ctx.x_item.data as ChemicalElement}
      {@const y_el = ctx.y_item.data as ChemicalElement}
      <strong>{x_el.name}</strong> &ndash; <strong>{y_el.name}</strong><br />
      EN: {x_el.electronegativity_pauling ?? `?`} vs {
        y_el.electronegativity_pauling ?? `?`
      }<br />
      |&Delta;EN| = {typeof ctx.value === `number` ? format_num(ctx.value) : `N/A`}
    {/snippet}
  </HeatmapMatrix>
  <HeatmapMatrixControls bind:ordering />
</div>
{#if dblclick_info}
  <p class="dblclick-info">Last double-click: {dblclick_info}</p>
{/if}

<!-- Demo 3: Arbitrary non-element axes -->
<h2>Arbitrary Axis Items</h2>
<p>
  Axes don't have to be elements. This demo uses property-range bins as both axes, showing
  that <code>HeatmapMatrix</code> works with any <code>AxisItem[]</code>. Uses <code
  >interpolateYlOrRd</code> color scale and a custom cell snippet that renders the value
  inside each tile.
</p>

<HeatmapMatrix
  x_items={property_bins}
  y_items={property_bins}
  values={bin_values}
  color_scale="interpolateYlOrRd"
  tile_size="50px"
  gap="2px"
  label_style="font-size: 0.85em;"
  tooltip
  style="margin: 1em auto"
>
  {#snippet cell(ctx)}
    {#if typeof ctx.value === `number` && ctx.value > 0}
      <span style="font-size: 0.7em">{ctx.value}</span>
    {/if}
  {/snippet}
</HeatmapMatrix>

<style>
  h1 {
    text-align: center;
  }
  h2 {
    margin: 2em 0 0.5em;
  }
  p {
    color: var(--text-color-muted);
    max-width: 700px;
    margin: 0 auto 1em;
    text-align: center;
  }
  .click-info {
    margin: 0.5em auto 0;
    width: fit-content;
    padding: 0.3em 0.8em;
    border-radius: var(--border-radius, 3pt);
    background: light-dark(#f0f0f0, #333);
    font-size: 0.85em;
  }
  .heatmap-controls-anchor {
    position: relative;
  }
  .scroll-container {
    overflow: auto;
    max-width: 100%;
    margin: 1em 0;
  }
  .dblclick-info {
    margin-top: 0.5em;
    font-size: 0.9em;
  }
</style>
