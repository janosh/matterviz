<script lang="ts">
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
  import { selected } from '$lib/state.svelte'
  import type { Snapshot } from './$types'

  let window_width: number = $state(0)
  let color_scale: D3InterpolateName = $state(`interpolateViridis`)
  let heatmap_key: string | null = $state(null)
  let heatmap_values = $derived(
    heatmap_key ? element_data.map((el) => el[heatmap_key]) : [],
  )

  let [y_label, y_unit] = $derived(property_labels[heatmap_key] ?? [])

  export const snapshot: Snapshot = {
    capture: () => ({ color_scale }),
    restore: (values) => ({ color_scale } = values),
  }
</script>

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
  >
    {#if selected.element && window_width > 1100}
      {@const { shells, name, symbol } = selected.element}
      <a href="bohr-atoms" style="position: absolute; top: -240px; transform: scale(0.8)">
        <BohrAtom {shells} name="Bohr Model of {name}" {symbol} style="width: 250px" />
      </a>
    {/if}
    <!-- set max-height to ensure ScatterPlot is never taller than 3 PeriodicTable
    rows so it doesn't stretch the table. assumes PeriodicTable has 18 rows -->
    {#snippet inset()}
      <TableInset>
        {#if heatmap_key}
          <ElementScatter
            y_lim={[0, null]}
            y={element_data.map((el) => el[heatmap_key])}
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
</style>
