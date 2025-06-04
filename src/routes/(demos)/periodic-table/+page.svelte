<script lang="ts">
  import type { ChemicalElement } from '$lib'
  import {
    BohrAtom,
    ColorCustomizer,
    ColorScaleSelect,
    ElementScatter,
    ElementStats,
    PeriodicTable,
    PropertySelect,
    TableInset,
    element_data,
  } from '$lib'
  import type { D3InterpolateName } from '$lib/colors'
  import { property_labels } from '$lib/labels'
  import type { ScaleContext } from '$lib/periodic-table/PeriodicTable.svelte'
  import { selected } from '$lib/state.svelte'
  import type { Snapshot } from './$types'

  let window_width: number = $state(0)
  let color_scale: D3InterpolateName = $state(`interpolateViridis`)
  let heatmap_key: string | null = $state(null)

  // Extract shared logic for mapping element values
  let get_element_value = $derived((el: ChemicalElement) => {
    if (!heatmap_key) return 0
    const value = el[heatmap_key as keyof typeof el]
    return typeof value === `number` ? value : 0
  })

  let heatmap_values = $derived(heatmap_key ? element_data.map(get_element_value) : [])

  let [y_label, y_unit] = $derived(
    heatmap_key
      ? (property_labels[heatmap_key as keyof typeof property_labels] ?? [])
      : [],
  )

  export const snapshot: Snapshot = {
    capture: () => ({ color_scale }),
    restore: (values) => ({ color_scale } = values),
  }
</script>

{#snippet custom_tooltip({
  element,
  value,
  active,
  scale_context,
}: {
  element: ChemicalElement
  value: number
  active: boolean
  scale_context: ScaleContext
})}
  <div class:active>
    <strong>{element.name}</strong>
    {#if active}<span class="active-indicator">★</span>{/if}
    <br />
    <small>{element.symbol} • {element.number}</small>
    <br />
    <em>{heatmap_key}: {value || `N/A`}</em>
    <br />
    <small class="position">Position: {element.column},{element.row}</small>
    {#if heatmap_key && value}
      <br />
      <small class="scale-info">
        Range: {scale_context.min.toFixed(1)} - {scale_context.max.toFixed(1)}
      </small>
    {/if}
  </div>
{/snippet}

<svelte:window bind:innerWidth={window_width} />

<div class="full-bleed">
  <form>
    <PropertySelect empty id="heatmap-select" bind:key={heatmap_key} />
    {#if heatmap_key}
      <ColorScaleSelect bind:value={color_scale} minSelect={1} selected={[color_scale]} />
    {/if}
  </form>

  <PeriodicTable
    tile_props={{ show_name: window_width > 1000 }}
    {heatmap_values}
    style="margin-block: 2em;"
    bind:color_scale
    bind:active_element={selected.element}
    bind:active_category={selected.category}
    links="name"
    tooltip={heatmap_key ? custom_tooltip : true}
  >
    {#if selected.element && window_width > 1100}
      {@const { shells, name, symbol } = selected.element}
      <a href="bohr-atoms" style="position: absolute; top: -240px; transform: scale(0.8)">
        <BohrAtom {shells} name="Bohr Model of {name}" {symbol} style="width: 250px" />
      </a>
    {/if}
    {#snippet inset()}
      <TableInset>
        {#if heatmap_key}
          <ElementScatter
            y_lim={[0, null]}
            y={heatmap_values}
            {y_label}
            {y_unit}
            onchange={(event: CustomEvent) =>
              (selected.element = element_data[event.detail.x - 1])}
            x_label_yshift={42}
            color_scale={{ scheme: color_scale }}
            style="max-height: calc(100cqw / 10 * 3);"
          />
        {:else}
          <ElementStats element={selected.element} />
        {/if}
      </TableInset>
    {/snippet}
  </PeriodicTable>

  {#if !heatmap_key}
    <ColorCustomizer collapsible={false} />
  {/if}
</div>

<style>
  form {
    display: flex;
    place-content: center;
    gap: 1em;
  }

  /* Enhanced tooltip styles */
  :global(.tooltip .active-indicator) {
    color: gold;
    margin-left: 0.25em;
  }

  :global(.tooltip .position) {
    opacity: 0.7;
    font-style: italic;
  }

  :global(.tooltip .scale-info) {
    opacity: 0.8;
    color: #ccc;
  }

  :global(.tooltip div.active) {
    border-left: 3px solid gold;
    padding-left: 0.5em;
  }
</style>
