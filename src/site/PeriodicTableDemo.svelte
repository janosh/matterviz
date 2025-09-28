<script lang="ts">
  import { goto } from '$app/navigation'
  import type { ChemicalElement } from '$lib'
  import { element_data, ElementStats, PeriodicTable, PropertySelect } from '$lib'
  import type { D3InterpolateName } from '$lib/colors'
  import { property_labels } from '$lib/labels'
  import type { ScaleContext } from '$lib/periodic-table'
  import { PeriodicTableControls, TableInset } from '$lib/periodic-table'
  import { ColorBar, ColorScaleSelect, ElementScatter } from '$lib/plot'
  import { selected } from '$lib/state.svelte'

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
    heatmap_key ? property_labels[heatmap_key] : [],
  )

  // Multi-value property ranges for color bars
  let two_fold_data = $derived(
    element_data.map((el) => [el.atomic_mass, el.density || 0]),
  )

  // Calculate ranges for each property
  let atomic_mass_range = $derived([
    Math.min(...element_data.map((el) => el.atomic_mass)),
    Math.max(...element_data.map((el) => el.atomic_mass)),
  ] as [number, number])

  let density_range = $derived([
    Math.min(...element_data.map((el) => el.density || 0).filter((d) => d > 0)),
    Math.max(...element_data.map((el) => el.density || 0)),
  ] as [number, number])

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
  value: string | number | (number | string)[]
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
    <em>{heatmap_key}: {Array.isArray(value) ? value.join(`, `) : value ?? `N/A`}</em>
    <br />
    <small class="position">Position: {element.column},{element.row}</small>
    {#if heatmap_key && value !== null}
      <br />
      <small class="scale-info">
        Range: {scale_context.min.toFixed(1)} - {scale_context.max.toFixed(1)}
      </small>
    {/if}
  </div>
{/snippet}

<form style="display: flex; place-content: center; gap: 1em; margin-block: 1em 2em">
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
  {onenter}
>
  {#snippet inset()}
    <TableInset>
      {#if heatmap_key}
        <ElementScatter
          y_lim={[0, null]}
          y={heatmap_values}
          {y_label}
          {y_unit}
          onchange={(evt) => {
            const el = element_data.find((el) => el.number === evt.detail.x)
            if (el) selected.element = el
          }}
          color_scale={{ scheme: color_scale }}
          style="max-height: calc(100cqw / 10 * 3)"
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
  bind:tile_border_radius
  bind:inner_transition_offset
  bind:tile_font_color
/>
<h2>Multi-value Heatmap</h2>
The periodic table supports multiple values per element with different visual layouts:

<h3>2-fold Split (Diagonal)</h3>
<p>
  Each element shows two values as diagonal triangles:
  <strong>top-left = atomic mass</strong>,
  <strong>bottom-right = density</strong>.
</p>
<PeriodicTable
  tile_props={{ show_name: false, show_number: false }}
  heatmap_values={two_fold_data}
  color_scale="interpolateRdYlBu"
  tooltip
  {onenter}
>
  {#snippet inset()}
    <TableInset
      style="display: flex; gap: 0 2em; justify-content: center; align-items: center; flex-wrap: wrap; padding: 0.5em"
    >
      <ColorBar
        title="Atomic Mass (u)"
        color_scale="interpolateRdYlBu"
        range={atomic_mass_range}
        orientation="horizontal"
        bar_style="width: 180px; height: 12px"
        tick_labels={3}
        title_side="top"
      />
      <ColorBar
        title="Density (g/cm³)"
        color_scale="interpolateRdYlBu"
        range={density_range}
        orientation="horizontal"
        bar_style="width: 180px; height: 12px"
        tick_labels={3}
        title_side="top"
      />
    </TableInset>
  {/snippet}
</PeriodicTable>
