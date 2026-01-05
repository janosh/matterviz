<script lang="ts">
  import { format_num } from '$lib/labels'
  import DraggablePane from '$lib/overlays/DraggablePane.svelte'
  import type { ComponentProps } from 'svelte'
  import type { TempUnit, TernaryPhaseDiagramData } from './types'

  type Props = Omit<ComponentProps<typeof DraggablePane>, `children`> & {
    data: TernaryPhaseDiagramData
    // Bindable state
    controls_open?: boolean
    // Display options
    show_labels?: boolean
    show_special_points?: boolean
    show_grid?: boolean
    region_opacity?: number
    render_mode?: `transparent` | `solid`
    // Slice options
    slice_temperature?: number
    slice_ratio?: number
    show_isothermal_panel?: boolean
    show_vertical_panel?: boolean
    // Callbacks
    on_slice_temperature_change?: (temperature: number) => void
    on_slice_ratio_change?: (ratio: number) => void
    // Pane customization
    pane_props?: ComponentProps<typeof DraggablePane>[`pane_props`]
    toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
  }

  let {
    data,
    controls_open = $bindable(false),
    show_labels = $bindable(true),
    show_special_points = $bindable(true),
    show_grid = $bindable(true),
    region_opacity = $bindable(0.6),
    render_mode = $bindable(`transparent`),
    slice_temperature = $bindable(),
    slice_ratio = $bindable(0.5),
    show_isothermal_panel = $bindable(true),
    show_vertical_panel = $bindable(false),
    on_slice_temperature_change,
    on_slice_ratio_change,
    pane_props = {},
    toggle_props = {},
    ...rest
  }: Props = $props()

  // Temperature range
  const t_range = $derived(data.temperature_range)
  const t_min = $derived(t_range[0])
  const t_max = $derived(t_range[1])
  const temp_unit = $derived<TempUnit>((data.temperature_unit ?? `K`) as TempUnit)

  // Initialize slice temperature
  $effect(() => {
    if (slice_temperature === undefined) {
      slice_temperature = (t_min + t_max) / 2
    }
  })

  // Component names for display
  const comp_a = $derived(data.components[0])
  const comp_b = $derived(data.components[1])
</script>

<DraggablePane
  bind:show={controls_open}
  pane_props={{
    ...pane_props,
    class: `ternary-phase-diagram-controls-pane ${pane_props?.class ?? ``}`,
    style: `--pane-padding: 12px; --pane-gap: 6px; ${pane_props?.style ?? ``}`,
  }}
  toggle_props={{
    title: controls_open ? `` : `Ternary phase diagram controls`,
    class: `ternary-phase-diagram-controls-toggle`,
    ...toggle_props,
  }}
  closed_icon="Settings"
  open_icon="Cross"
  {...rest}
>
  <h4 class="pane-title">{data.components.join(`-`)} Controls</h4>

  <section class="settings-section">
    <h5>Display Options</h5>

    <fieldset>
      <legend>Render Mode</legend>
      <label>
        <input
          type="radio"
          name="render_mode"
          value="transparent"
          checked={render_mode === `transparent`}
          onchange={() => render_mode = `transparent`}
        />
        Transparent
      </label>
      <label>
        <input
          type="radio"
          name="render_mode"
          value="solid"
          checked={render_mode === `solid`}
          onchange={() => render_mode = `solid`}
        />
        Solid
      </label>
    </fieldset>

    {#if render_mode === `transparent`}
      <label class="slider-row">
        <span>Opacity:</span>
        <input
          type="range"
          min="0.1"
          max="1"
          step="0.05"
          bind:value={region_opacity}
        />
        <span class="value">{format_num(region_opacity, `.2f`)}</span>
      </label>
    {/if}

    <fieldset>
      <legend>Visibility</legend>
      <label>
        <input type="checkbox" bind:checked={show_labels} />
        Labels
      </label>
      <label>
        <input type="checkbox" bind:checked={show_special_points} />
        Special Points
      </label>
      <label>
        <input type="checkbox" bind:checked={show_grid} />
        Grid / Axes
      </label>
    </fieldset>
  </section>

  <section class="settings-section">
    <h5>Slice Controls</h5>

    <fieldset>
      <legend>Isothermal Section</legend>
      <label>
        <input type="checkbox" bind:checked={show_isothermal_panel} />
        Show Panel
      </label>
      <label class="slider-row">
        <span>T:</span>
        <input
          type="range"
          min={t_min}
          max={t_max}
          step={(t_max - t_min) / 100}
          value={slice_temperature ?? (t_min + t_max) / 2}
          oninput={(event) => {
            const new_temp = parseFloat(
              (event.target as HTMLInputElement).value,
            )
            slice_temperature = new_temp
            on_slice_temperature_change?.(new_temp)
          }}
        />
        <span class="value">{format_num(slice_temperature ?? 0, `.0f`)} {temp_unit}</span>
      </label>
    </fieldset>

    <fieldset>
      <legend>Vertical Section</legend>
      <label>
        <input type="checkbox" bind:checked={show_vertical_panel} />
        Show Panel
      </label>
      <label class="slider-row">
        <span>{comp_a}:{comp_b}</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          bind:value={slice_ratio}
          oninput={() => on_slice_ratio_change?.(slice_ratio)}
        />
        <span class="value">{format_num(slice_ratio * 100, `.0f`)}:{
            format_num((1 - slice_ratio) * 100, `.0f`)
          }</span>
      </label>
    </fieldset>
  </section>
</DraggablePane>

<style>
  .pane-title {
    margin: 0 0 12px;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-color, #333);
    border-bottom: 1px solid var(--border-color, #ddd);
    padding-bottom: 6px;
  }
  .settings-section {
    margin-bottom: 16px;
  }
  .settings-section h5 {
    margin: 0 0 8px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-color-secondary, #666);
  }
  fieldset {
    border: 1px solid var(--border-color, #ddd);
    border-radius: 4px;
    padding: 8px 12px;
    margin: 0 0 12px;
  }
  legend {
    font-size: 12px;
    font-weight: 500;
    padding: 0 4px;
    color: var(--text-color-secondary, #666);
  }
  label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    margin: 6px 0;
    cursor: pointer;
  }
  label input[type='checkbox'],
  label input[type='radio'] {
    margin: 0;
  }
  .slider-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .slider-row span:first-child {
    min-width: 50px;
    font-size: 12px;
  }
  .slider-row input[type='range'] {
    flex: 1;
    min-width: 80px;
  }
  .slider-row .value {
    min-width: 60px;
    text-align: right;
    font-size: 12px;
    font-family: monospace;
  }
</style>
