<script lang="ts">
  import { goto } from '$app/navigation'
  import type { ChemicalElement } from '$lib'
  import { element_data, ElementStats, PeriodicTable, PropertySelect } from '$lib'
  import type { D3InterpolateName } from '$lib/colors'
  import { ELEM_PROPERTY_LABELS } from '$lib/labels'
  import type { ScaleContext } from '$lib/periodic-table'
  import { PeriodicTableControls, TableInset } from '$lib/periodic-table'
  import { ColorScaleSelect, ElementScatter } from '$lib/plot'
  import { selected } from '$lib/state.svelte'
  import { slide } from 'svelte/transition'

  let window_width: number = $state(0)
  let color_scale: D3InterpolateName = $state(`interpolateViridis`)
  let heatmap_key: keyof ChemicalElement | null = $state(null)

  // Appearance control state
  let tile_gap: string = $state(`0.3cqw`)
  let symbol_font_size: number = $state(40)
  let number_font_size: number = $state(22)
  let name_font_size: number = $state(12)
  let value_font_size: number = $state(18)
  let tooltip_font_size: number = $state(14)
  let tooltip_bg_color: string = $state(`rgba(0, 0, 0, 0.8)`)
  let tile_border_radius: number = $state(1)
  let inner_transition_offset: number = $state(0.5)
  let tile_font_color: string = $state(`#ffffff`)
  let controls_open = $state(false)

  let heatmap_values = $derived(
    heatmap_key
      ? element_data.map((el) => {
          if (!heatmap_key || !(heatmap_key in el)) return 0
          const value = el[heatmap_key]
          return typeof value === `number` ? value : 0
        })
      : [],
  )

  let [y_label = ``, y_unit = ``] = $derived(
    heatmap_key ? ELEM_PROPERTY_LABELS[heatmap_key] : [],
  )

  const onenter = (element: ChemicalElement) => {
    if (!element?.name) return
    goto(`/${element.name.toLowerCase()}`)
  }
</script>

<svelte:window bind:innerWidth={window_width} />

{#snippet custom_tooltip({
  element,
  value,
  active,
  bg_color: _bg_color,
  scale_context,
}: {
  element: ChemicalElement
  value: string | number | (number | string)[] | null
  active: boolean
  bg_color: string | null
  scale_context: ScaleContext
})}
  <div class:active>
    <strong>{element.name}</strong>
    {#if active}<span class="active-indicator">★</span>{/if}
    <br />
    <small>{element.symbol} • {element.number}</small>
    <br />
    <em>{heatmap_key}: {Array.isArray(value) ? value.join(`, `) : (value ?? `N/A`)}</em>
    <br />
    <small class="position">Position: {element.column},{element.row}</small>
    {#if heatmap_key && value != null}
      <br />
      <small class="scale-info">
        Range: {scale_context.min.toFixed(1)} - {scale_context.max.toFixed(1)}
      </small>
    {/if}
  </div>
{/snippet}

<form style="display: flex; place-content: center; gap: 1em; margin-block: 0 2em">
  <PropertySelect empty id="heatmap-select" bind:key={heatmap_key} />
  {#if heatmap_key}
    <ColorScaleSelect
      bind:value={color_scale}
      minSelect={1}
      selected={[color_scale]}
      style="flex: 1"
    />
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
  {onenter}
>
  {#snippet inset()}
    <TableInset>
      {#if heatmap_key}
        <ElementScatter
          y_axis={{ range: [0, null], label: y_label }}
          y={heatmap_values}
          {y_unit}
          on_point_click={({ point }) => {
            const el = element_data.find((el) => el.number === point.x)
            if (el) selected.element = el
          }}
          color_scale={{ scheme: color_scale }}
          style="min-height: initial"
        />
      {:else}
        <ElementStats element={selected.element} />
      {/if}
    </TableInset>
  {/snippet}
</PeriodicTable>

<div style="margin: 2em auto">
  <button
    class="controls-toggle"
    aria-expanded={controls_open}
    onclick={() => (controls_open = !controls_open)}
  >
    {controls_open ? `▾` : `▸`} Controls
  </button>
  {#if controls_open}
    <div transition:slide>
      <PeriodicTableControls
        bind:tile_gap
        bind:symbol_font_size
        bind:number_font_size
        bind:name_font_size
        bind:value_font_size
        bind:tooltip_font_size
        bind:tooltip_bg_color
        bind:tile_border_radius
        bind:inner_transition_offset
        bind:tile_font_color
        style="--ptable-ctrl-margin: 1em auto 0"
      />
    </div>
  {/if}
</div>

<style>
  .controls-toggle {
    display: block;
    max-width: max-content;
    margin: 0 auto;
    padding: 2pt 8pt;
    border-radius: 4pt;
    background: var(--surface-bg);
    border: none;
    color: inherit;
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    user-select: none;
  }
</style>
