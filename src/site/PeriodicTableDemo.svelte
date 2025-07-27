<script lang="ts">
  import { goto } from '$app/navigation'
  import type { Category, ChemicalElement } from '$lib'
  import { element_data, ElementStats, PeriodicTable, PropertySelect } from '$lib'
  import type { D3InterpolateName } from '$lib/colors'
  import { property_labels } from '$lib/labels'
  import { type ScaleContext, TableInset } from '$lib/periodic-table'
  import { ColorBar, ColorScaleSelect, ElementScatter } from '$lib/plot'
  import { selected } from '$lib/state.svelte'
  import { PeriodicTableControls } from '$site'

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

  let heatmap_values = $derived(
    heatmap_key ? element_data.map(get_element_value) : [],
  )

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

  // Multi-value property ranges for color bars
  let two_fold_data = $derived(
    element_data.map((el) => [el.atomic_mass, el.density || 0]),
  )

  let four_fold_data = $derived(
    element_data.map((el) => [
      el.atomic_radius || 0,
      (el.electronegativity || 0) * 100,
      el.covalent_radius || 0,
      Math.abs(el.electron_affinity || 0),
    ]),
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

  let atomic_radius_range = $derived([
    Math.min(...element_data.map((el) => el.atomic_radius || 0).filter((r) => r > 0)),
    Math.max(...element_data.map((el) => el.atomic_radius || 0)),
  ] as [number, number])

  let electronegativity_range = $derived([
    Math.min(
      ...element_data.map((el) => (el.electronegativity || 0) * 100).filter((
        elec_neg,
      ) => elec_neg > 0),
    ),
    Math.max(...element_data.map((el) => (el.electronegativity || 0) * 100)),
  ] as [number, number])

  let covalent_radius_range = $derived([
    Math.min(
      ...element_data.map((el) => el.covalent_radius || 0).filter((r) => r > 0),
    ),
    Math.max(...element_data.map((el) => el.covalent_radius || 0)),
  ] as [number, number])

  let electron_affinity_range = $derived([
    Math.min(
      ...element_data
        .map((el) => Math.abs(el.electron_affinity || 0))
        .filter((elec_aff) => elec_aff > 0),
    ),
    Math.max(...element_data.map((el) => Math.abs(el.electron_affinity || 0))),
  ] as [number, number])

  const onenter = (element: ChemicalElement) => {
    goto(`/${element.name.toLowerCase()}`)
  }
</script>

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
    <em>{heatmap_key}: {Array.isArray(value) ? value.join(`, `) : value || `N/A`}</em>
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

<div style="max-width: var(--max-text-width); margin: 1em auto">
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
            onchange={(
              event: CustomEvent,
            ) => (selected.element = element_data[event.detail.x - 1])}
            x_label_yshift={42}
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
    bind:tooltip_text_color
    bind:tile_border_radius
    bind:inner_transition_offset
    bind:tile_font_color
  />
  <h2>Multi-value Heatmap Examples</h2>
  <p>
    The periodic table now supports multiple values per element with different visual
    layouts:
  </p>

  <h3>2-fold Split (Diagonal)</h3>
  <p>
    Each element shows two values as diagonal triangles: <strong>top-left = atomic
      mass</strong>, <strong>bottom-right = density</strong>.
  </p>
  <PeriodicTable
    tile_props={{ show_name: false, show_number: false }}
    heatmap_values={two_fold_data}
    color_scale="interpolateRdYlBu"
    tooltip
    {onenter}
  >
    {#snippet inset()}
      <TableInset>
        <div class="color-bars-container">
          <div class="color-bar-item">
            <ColorBar
              title="Atomic Mass (u)"
              color_scale="interpolateRdYlBu"
              range={atomic_mass_range}
              orientation="horizontal"
              style="width: 180px; height: 12px"
              tick_labels={3}
              title_side="top"
            />
          </div>
          <div class="color-bar-item">
            <ColorBar
              title="Density (g/cm³)"
              color_scale="interpolateRdYlBu"
              range={density_range}
              orientation="horizontal"
              style="width: 180px; height: 12px"
              tick_labels={3}
              title_side="top"
            />
          </div>
        </div>
      </TableInset>
    {/snippet}
  </PeriodicTable>

  <h3>4-fold Split</h3>
  <p>
    Each element shows four values as quadrants: <strong>top-left = atomic
      radius</strong>,
    <strong>top-right = electronegativity * 100</strong>,
    <strong>bottom-left = covalent radius</strong>,
    <strong>bottom-right = |electron affinity|</strong>.
  </p>
  <PeriodicTable
    tile_props={{ show_name: false, show_number: false }}
    heatmap_values={four_fold_data}
    color_scale="interpolateViridis"
    split_layout="quadrant"
    tooltip
    {onenter}
  >
    {#snippet inset()}
      <TableInset>
        <div class="color-bars-container">
          <div class="color-bar-item">
            <ColorBar
              title="Atomic Radius (pm)"
              color_scale="interpolateViridis"
              range={atomic_radius_range}
              orientation="horizontal"
              style="width: 135px; height: 12px"
              tick_labels={3}
              title_side="top"
            />
          </div>
          <div class="color-bar-item">
            <ColorBar
              title="Electronegativity × 100"
              color_scale="interpolateViridis"
              range={electronegativity_range}
              orientation="horizontal"
              style="width: 135px; height: 12px"
              tick_labels={3}
              title_side="top"
            />
          </div>
          <div class="color-bar-item">
            <ColorBar
              title="Covalent Radius (pm)"
              color_scale="interpolateViridis"
              range={covalent_radius_range}
              orientation="horizontal"
              style="width: 135px; height: 12px"
              tick_labels={3}
              title_side="top"
            />
          </div>
          <div class="color-bar-item">
            <ColorBar
              title="|Electron Affinity| (kJ/mol)"
              color_scale="interpolateViridis"
              range={electron_affinity_range}
              orientation="horizontal"
              style="width: 135px; height: 12px"
              tick_labels={3}
              title_side="top"
            />
          </div>
        </div>
      </TableInset>
    {/snippet}
  </PeriodicTable>

  <h2>Missing Color Demo</h2>
  <p>
    The <code>missing_color</code> prop is used to control how missing values in heatmap
    data are displayed.
  </p>

  <PeriodicTable
    tile_props={{ show_name: window_width > 800, text_color: tile_font_color }}
    heatmap_values={missing_heatmap_values}
    missing_color={missing_computed_color}
    bind:color_scale
    bind:active_element={missing_active_element}
    bind:active_category={missing_active_category}
    links="name"
    tooltip
    gap={tile_gap}
    style="margin: 1em auto; max-width: 1000px"
    {onenter}
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
</div>

<style>
  form {
    display: flex;
    place-content: center;
    gap: 1em;
  }
  p {
    max-width: var(--max-width);
    margin: 1em auto;
    text-align: center;
  }
  h2,
  h3 {
    text-align: center;
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

  .color-bars-container {
    display: flex;
    gap: 0 2em;
    justify-content: center;
    align-items: center;
    flex-wrap: wrap;
    padding: 0.5em;
  }

  .color-bar-item {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
</style>
