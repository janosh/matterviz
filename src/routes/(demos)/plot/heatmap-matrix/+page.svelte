<script lang="ts">
  import type { ChemicalElement, ElementSymbol } from '$lib/element'
  import type { AxisItem, CellContext, ElementAxisOrderingKey } from '$lib/heatmap-matrix'
  import {
    ELEMENT_ORDERINGS,
    ORDERING_LABELS,
    elements_to_axis,
    HeatmapMatrix,
  } from '$lib/heatmap-matrix'
  import { format_num } from '$lib/labels'
  import { download } from '$lib/io/fetch'

  // === Demo 1: Full element matrix with ordering controls, tooltip, and click ===
  let ordering = $state<ElementAxisOrderingKey>(`atomic_number`)
  let hide_mode = $state<false | `compact` | `gaps`>(`compact`)
  let axis_items = $derived(elements_to_axis(undefined, ordering))
  let clicked_cell = $state<CellContext | null>(null)
  let dblclick_info: string | null = $state(null)
  let selected_cells = $state<{ x_idx: number; y_idx: number }[]>([])
  let pinned_cell = $state<{ x_idx: number; y_idx: number } | null>(null)
  let last_export_status = $state<string | null>(null)
  let brush_info = $state<string | null>(null)

  function format_cell_value(value: number | string | null | undefined): string {
    if (value === null || value === undefined) return `N/A`
    return typeof value === `number` ? format_num(value) : value
  }

  // Compute pairwise |ΔEN| for a set of axis items
  const en_diff_matrix = (items: AxisItem<ChemicalElement>[]): (number | null)[][] =>
    items.map((y_item) => {
      const y_en = y_item.data?.electronegativity_pauling ?? null
      return items.map((x_item) => {
        const x_en = x_item.data?.electronegativity_pauling ?? null
        return x_en !== null && y_en !== null ? Math.abs(x_en - y_en) : null
      })
    })

  let en_diff_values = $derived(en_diff_matrix(axis_items))

  // === Demo 2: Small subset with custom tooltip, symmetric mode, and color scale ===
  let subset_ordering = $state<ElementAxisOrderingKey>(`atomic_number`)
  const demo_symbols = `Li,Na,K,Mg,Ca,Al,Fe,Cu,Zn,Ag,Au,Pt,Ti,Ni,Co,Mn,Cr,V,Si,Ge`.split(
    `,`,
  ) as ElementSymbol[]
  let small_axis = $derived(elements_to_axis(demo_symbols, subset_ordering))
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
  const bin_values: number[][] = property_bins.map((_y_bin, y_idx) =>
    property_bins.map((_x_bin, x_idx) => {
      // Generate a synthetic heatmap: Gaussian-ish distribution centered near (3,3)
      const dist = Math.hypot(x_idx - 3, y_idx - 3)
      return Math.round(100 * Math.exp(-dist * 0.4))
    }),
  )
</script>

{#snippet ordering_options()}
  {#each ELEMENT_ORDERINGS as ordering_key (ordering_key)}
    <option value={ordering_key}>{ORDERING_LABELS[ordering_key]}</option>
  {/each}
{/snippet}

{#snippet full_controls()}
  <label>
    <span>Ordering</span>
    <select bind:value={ordering}>{@render ordering_options()}</select>
  </label>
  <label>
    <span>Hide empty</span>
    <select bind:value={hide_mode}>
      <option value="compact">compact</option>
      <option value="gaps">gaps</option>
      <option value={false}>off</option>
    </select>
  </label>
{/snippet}

{#snippet subset_controls()}
  <label>
    <span>Ordering</span>
    <select bind:value={subset_ordering}>{@render ordering_options()}</select>
  </label>
{/snippet}

<h1 id="heatmap-matrix">Heatmap Matrix</h1>
<p class="demo-intro">
  This demo is based on the
  <a href="https://viz.whsunresearch.group/gliquid/interactive-matrix.html">
    Binary Phase Diagram Map
  </a> from the Sun Research Group.
</p>

<!-- Demo 1: Full 118x118 element matrix -->
<h2 id="element-pair-electronegativity-difference">
  Element Pair Electronegativity Difference
</h2>
<p>
  Full 118-element matrix colored by |&Delta;EN|. Elements without electronegativity data
  (noble gases, some superheavy) are auto-hidden with <code>hide_empty="compact"</code>. Hover
  for tooltips, click cells for details. <code>virtualize</code> is on, but at the default 6px tile
  the whole ~103&times;103 grid fits on screen at most window sizes, so all ~10k cells are mounted.
</p>

<div class="heatmap-controls-anchor bleed-1400" role="group">
  <div class="scroll-container">
    <HeatmapMatrix
      x_items={axis_items}
      y_items={axis_items}
      values={en_diff_values}
      color_scale="interpolateViridis"
      show_color_bar
      show_controls="hover"
      controls_props={{ children: full_controls }}
      hide_empty={hide_mode}
      virtualize
      selection_mode="multi"
      bind:selected_cells
      bind:pinned_cell
      tooltip_mode="both"
      enable_brush
      on_brush={(payload) =>
        (brush_info = `${payload.cells.length} cells (${payload.x_range[0]}-${
          payload.x_range[1]
        }, ${payload.y_range[0]}-${payload.y_range[1]})`)}
      on_export={(format_name, payload) => {
        download(
          typeof payload === `string` ? payload : JSON.stringify(payload, null, 2),
          `electronegativity-difference.${format_name}`,
          format_name === `csv` ? `text/csv;charset=utf-8` : `application/json`,
        )
        last_export_status = `Exported ${format_name.toUpperCase()}`
      }}
      tooltip
      on_click={(cell: CellContext) => (clicked_cell = cell)}
    />
  </div>
</div>
{#if clicked_cell}
  <div class="click-info">
    Clicked: <strong>{clicked_cell.x_item.label}</strong> &ndash;
    <strong>{clicked_cell.y_item.label}</strong>
    {#if clicked_cell.value != null}
      = {format_cell_value(clicked_cell.value)}
    {/if}
  </div>
{/if}
{#if selected_cells.length}
  <div class="click-info">
    Selected cells: <strong>{selected_cells.length}</strong>
    {#if pinned_cell}
      | Pinned: <strong>{pinned_cell.x_idx},{pinned_cell.y_idx}</strong>
    {/if}
  </div>
{/if}
{#if brush_info}
  <div class="click-info">{brush_info}</div>
{/if}
{#if last_export_status}
  <div class="click-info">{last_export_status}</div>
{/if}

<!-- Demo 2: Subset with symmetric mode, custom tooltip, dblclick, and different color scale -->
<h2 id="symmetric-subset-with-custom-tooltip">Symmetric Subset with Custom Tooltip</h2>
<p>
  Demonstrates switchable <code>symmetric</code> modes and a custom <code>tooltip</code> snippet.
</p>

<div class="heatmap-controls-anchor" role="group">
  <HeatmapMatrix
    x_items={small_axis}
    y_items={small_axis}
    values={small_values}
    color_scale="interpolatePlasma"
    symmetric="lower"
    show_controls="hover"
    controls_props={{ children: subset_controls }}
    tile_size="20px"
    gap="1px"
    on_double_click={(cell: CellContext) =>
      (dblclick_info = `${cell.x_item.label}-${cell.y_item.label}: ${format_cell_value(
        cell.value,
      )}`)}
    style="margin: 1em auto"
  >
    {#snippet tooltip(ctx)}
      {@const x_el = ctx.x_item.data as ChemicalElement}
      {@const y_el = ctx.y_item.data as ChemicalElement}
      <strong>{x_el.name}</strong> &ndash; <strong>{y_el.name}</strong><br />
      EN: {x_el.electronegativity_pauling ?? `?`} vs {y_el.electronegativity_pauling ?? `?`}<br
      />
      |&Delta;EN| = {format_cell_value(ctx.value)}
    {/snippet}
  </HeatmapMatrix>
</div>
{#if dblclick_info}
  <p style="margin-top: 0.5em; font-size: 0.9em">Last double-click: {dblclick_info}</p>
{/if}

<!-- Demo 3: Arbitrary non-element axes -->
<h2 id="arbitrary-axis-items">Arbitrary Axis Items</h2>
<p>
  Axes don't have to be elements. This demo uses property-range bins as both axes, showing that <code
    >HeatmapMatrix</code
  >
  works with any <code>AxisItem[]</code>. Uses <code>interpolateYlOrRd</code> color scale and a custom
  cell snippet that renders the value inside each tile.
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
    display: inline-block;
    padding: 0.3em 0.8em;
    border-radius: var(--border-radius, 3pt);
    background: light-dark(#f0f0f0, #333);
    font-size: 0.85em;
  }
  .scroll-container {
    overflow-x: auto;
    overflow-y: hidden;
    max-width: 100%;
    margin: 1em 0;
  }
</style>
