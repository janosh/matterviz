<script lang="ts">
  import { page } from '$app/state'
  import type { ChemicalElement } from '$lib'
  import { element_data, ElementStats, PeriodicTable, PropertySelect } from '$lib'
  import type { D3InterpolateName } from '$lib/colors'
  import { is_d3_interpolate_name } from '$lib/colors'
  import { ELEM_PROPERTY_LABELS } from '$lib/labels'
  import type { ScaleContext } from '$lib/periodic-table'
  import { PeriodicTableControls, TableInset } from '$lib/periodic-table'
  import { ColorScaleSelect, ElementScatter } from '$lib/plot'
  import { selected } from '$lib/state.svelte'
  import { replace_url } from '$site/state.svelte'
  import { Icon } from 'svelte-widgets'
  import { ChevronDown, ChevronRight } from 'svelte-widgets/icons'
  import { onMount } from 'svelte'
  import { slide } from 'svelte/transition'

  const DEFAULT_COLOR_SCALE: D3InterpolateName = `interpolateViridis`

  let window_width: number = $state(0)

  let color_scale: D3InterpolateName = $state(DEFAULT_COLOR_SCALE)
  let heatmap_key: keyof ChemicalElement | null = $state(null)

  // Both selections live in the URL so a reload (or a shared link) restores the view.
  // Read on mount rather than during init: prerendering forbids url.searchParams.
  let url_synced = $state(false)
  onMount(() => {
    const scale = page.url.searchParams.get(`color_scale`)
    if (scale && is_d3_interpolate_name(scale)) color_scale = scale
    const property = page.url.searchParams.get(`heatmap`)
    if (property && Object.hasOwn(ELEM_PROPERTY_LABELS, property)) {
      heatmap_key = property as keyof ChemicalElement
    }
    url_synced = true
  })

  // Deriving these from the URL instead looks tidier but loses the selection: PropertySelect
  // writes its own empty initial value back through `bind:` on mount, which would overwrite
  // a derived and then get mirrored into the URL, dropping ?heatmap= before it is ever read.
  $effect(() => {
    if (!url_synced) return // don't clobber the incoming URL before it has been read
    const params = new URLSearchParams(page.url.searchParams)
    // Only the non-default halves are written, so an untouched page keeps a clean URL
    if (heatmap_key) params.set(`heatmap`, heatmap_key)
    else params.delete(`heatmap`)
    if (color_scale === DEFAULT_COLOR_SCALE) params.delete(`color_scale`)
    else params.set(`color_scale`, color_scale)
    const query = params.size ? `?${params}` : ``
    const { pathname, search, hash } = page.url
    if (query !== search) void replace_url(`${pathname}${query}${hash}`)
  })

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
  let tile_font_color: string | null = $state(null)
  let controls_open = $state(false)

  let heatmap_values = $derived.by(() => {
    const key = heatmap_key
    if (!key) return []
    return element_data.map((element) => {
      const value = element[key]
      return typeof value === `number` ? value : 0
    })
  })

  let [y_label = ``, y_unit = ``] = $derived(
    heatmap_key ? ELEM_PROPERTY_LABELS[heatmap_key] : [],
  )
</script>

<svelte:window bind:innerWidth={window_width} />

{#snippet custom_tooltip({
  element,
  value,
  active,
  scale_context,
}: {
  element: ChemicalElement
  value: string | number | (number | string)[] | null
  active: boolean
  scale_context: ScaleContext
})}
  <div>
    <strong>{element.name}</strong>
    {#if active}<span>★</span>{/if}
    <br />
    <small>{element.symbol} • {element.number}</small>
    <br />
    <em>{heatmap_key}: {Array.isArray(value) ? value.join(`, `) : (value ?? `N/A`)}</em>
    <br />
    <small>Position: {element.column},{element.row}</small>
    {#if heatmap_key && value != null}
      <br />
      <small>
        Range: {scale_context.min.toFixed(1)} - {scale_context.max.toFixed(1)}
      </small>
    {/if}
  </div>
{/snippet}

<!-- flex-wrap: two 20em selects side by side overflow a phone -->
<form
  style="display: flex; flex-wrap: wrap; place-content: center; gap: 1em; margin-block: 0 2em"
>
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
  tile_props={{
    show_name: window_width > 1000,
    text_color: tile_font_color ?? undefined,
  }}
  {heatmap_values}
  bind:color_scale
  bind:active_element={selected.element}
  bind:active_category={selected.category}
  links="name"
  tooltip={heatmap_key ? custom_tooltip : true}
  gap={tile_gap}
  inner_transition_metal_offset={inner_transition_offset}
  show_photo
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
    <Icon
      icon={controls_open ? ChevronDown : ChevronRight}
      aria-hidden="true"
      style="--icon-size: 1.15em"
    />
    Periodic Table Controls
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
    display: flex;
    align-items: center;
    gap: 6pt;
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
