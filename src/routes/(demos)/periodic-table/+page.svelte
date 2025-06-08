<script lang="ts">
  import type { Category, ChemicalElement } from '$lib'
  import {
    BohrAtom,
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
  import type { ScaleContext } from '$lib/periodic-table'
  import { selected } from '$lib/state.svelte'
  import { PeriodicTableControls } from '$site'
  import type { Snapshot } from './$types'

  let window_width: number = $state(0)
  let color_scale: D3InterpolateName = $state(`interpolateViridis`)
  let heatmap_key: string | null = $state(null)

  // Appearance control state
  let tile_gap: string = $state(`0.3cqw`)
  let symbol_font_size: number = $state(40)
  let number_font_size: number = $state(22)
  let name_font_size: number = $state(12)
  let value_font_size: number = $state(18)
  let tooltip_font_size: number = $state(14)
  let tooltip_bg_color: string = $state(`rgba(0, 0, 0, 0.8)`)
  let tooltip_text_color: string = $state(`white`)
  let tile_border_radius: number = $state(1)
  let inner_transition_offset: number = $state(0.5)
  let tile_font_color: string = $state(`#ffffff`)

  // Missing color demo periodic table
  let missing_heatmap_key: string | null = $state(`atomic_mass`)
  let missing_color: string = $state(`#666666`)
  let missing_use_category: boolean = $state(false)
  let missing_active_element: ChemicalElement | null = $state(null)
  let missing_active_category: Category | null = $state(null)

  // Extract shared logic for mapping element values
  let get_element_value = $derived((el: ChemicalElement) => {
    if (!heatmap_key) return 0
    const value = el[heatmap_key as keyof typeof el]
    return typeof value === `number` ? value : 0
  })

  let heatmap_values = $derived(heatmap_key ? element_data.map(get_element_value) : [])

  // Missing color demo derived values
  let missing_get_element_value = $derived((el: ChemicalElement) => {
    if (!missing_heatmap_key) return 0
    const value = el[missing_heatmap_key as keyof typeof el]
    return typeof value === `number` ? value : 0
  })

  let missing_heatmap_values = $derived.by(() => {
    if (!missing_heatmap_key) return []

    const full_values = element_data.map(missing_get_element_value)

    // Always show partial data for demo (every 3rd element)
    return full_values.map((value, idx) => (idx % 3 === 0 ? value : 0))
  })

  let missing_computed_color = $derived(
    missing_use_category ? `element-category` : missing_color,
  )

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
    tile_props={{ show_name: window_width > 1000, text_color: tile_font_color }}
    {heatmap_values}
    bind:color_scale
    bind:active_element={selected.element}
    bind:active_category={selected.category}
    links="name"
    tooltip={heatmap_key ? custom_tooltip : true}
    gap={tile_gap}
    inner_transition_metal_offset={inner_transition_offset}
    show_photo
    style="margin: 2em auto; max-width: 1200px;"
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

  <PeriodicTableControls
    bind:tile_gap
    bind:symbol_font_size
    bind:number_font_size
    bind:name_font_size
    bind:value_font_size
    bind:tooltip_font_size
    bind:tooltip_bg_color
    bind:tooltip_text_color
    bind:tile_border_radius
    bind:inner_transition_offset
    bind:tile_font_color
  />
</div>

<!-- Second Periodic Table - Missing Color Demo -->
<h2>Missing Color Demo</h2>
<p>
  The <code>missing_color</code> prop is used to control how missing values in heatmap data
  are displayed.
</p>

<PeriodicTable
  tile_props={{ show_name: window_width > 800, text_color: tile_font_color }}
  heatmap_values={missing_heatmap_values}
  missing_color={missing_computed_color}
  bind:color_scale
  bind:active_element={missing_active_element}
  bind:active_category={missing_active_category}
  links="name"
  tooltip={true}
  gap={tile_gap}
  style="margin: 1em auto; max-width: 1000px;"
>
  {#snippet inset()}
    <TableInset>
      <div class="missing-color-controls-inline">
        <label>
          <input
            type="checkbox"
            bind:checked={missing_use_category}
            disabled={!missing_heatmap_values?.length}
          />
          Use element category colors
        </label>

        <label>
          Missing color:
          <input
            type="color"
            bind:value={missing_color}
            disabled={missing_use_category || !missing_heatmap_values?.length}
          />
        </label>
      </div>
    </TableInset>
  {/snippet}
</PeriodicTable>

<style>
  form {
    display: flex;
    place-content: center;
    gap: 1em;
  }
  .missing-color-controls-inline {
    display: flex;
    align-items: center;
    gap: 1em;
    justify-content: center;
    flex-wrap: wrap;
  }
  .missing-color-controls-inline label {
    display: flex;
    align-items: center;
    gap: 0.5em;
    font-size: 0.9em;
    white-space: nowrap;
  }
  .missing-color-controls-inline input[type='checkbox'] {
    margin: 0;
  }
  .missing-color-controls-inline input[type='color'] {
    width: 2.5em;
    height: 1.8em;
  }
</style>
