<script lang="ts">
  import { SettingsSection } from '$lib'
  import type { AxisConfig, BarStyle, DataSeries } from '$lib/plot'
  import { PlotControls } from '$lib/plot'
  import type { DisplayConfig, PlotControlsProps } from '$lib/plot/types'
  import { DEFAULTS } from '$lib/settings'

  let {
    series = [],
    bins = $bindable(DEFAULTS.histogram.bin_count),
    mode = $bindable(DEFAULTS.histogram.mode),
    bar = $bindable({}),
    show_legend = $bindable(DEFAULTS.histogram.show_legend),
    selected_property = $bindable(``),
    x_axis = $bindable({}),
    y_axis = $bindable({}),
    y2_axis = $bindable({}),
    display = $bindable({}),
    show_controls = $bindable(false),
    controls_open = $bindable(false),
    auto_y2_range = undefined,
    ...rest
  }: Omit<PlotControlsProps, `children` | `post_children`> & {
    // Series data for multi-series controls
    series?: readonly DataSeries[]
    // Histogram-specific controls
    bins?: number
    mode?: `single` | `overlay`
    bar?: BarStyle
    show_legend?: boolean
    selected_property?: string
    // Grouped configs
    x_axis?: AxisConfig
    y_axis?: AxisConfig
    y2_axis?: AxisConfig
    display?: DisplayConfig
    show_controls?: boolean
    controls_open?: boolean
    auto_y2_range?: [number, number]
  } = $props()

  // Initialize bar styles with defaults (runs once)
  bar = { ...DEFAULTS.histogram.bar, ...bar }

  // Derived state
  let has_multiple_series = $derived(series.filter(Boolean).length > 1)
  let visible_series = $derived(series.filter((s) => s && (s.visible ?? true)))
  let series_options = $derived(visible_series.map((s) => s.label || `Series`))
</script>

<PlotControls
  bind:show_controls
  bind:controls_open
  bind:x_axis
  bind:y_axis
  bind:y2_axis
  bind:display
  {auto_y2_range}
  {...rest}
>
  <SettingsSection
    title="Histogram"
    current_values={{ bins, mode, show_legend }}
    on_reset={() => {
      ;({ bin_count: bins, mode, show_legend } = DEFAULTS.histogram)
    }}
  >
    <div class="pane-row">
      <label>Bins:
        <input
          type="range"
          min="5"
          max="100"
          step="5"
          bind:value={bins}
        />
      </label>
      <input type="number" min="5" max="100" step="5" bind:value={bins} />
    </div>
    {#if has_multiple_series}
      <div class="pane-row">
        <label>Mode:
          <select bind:value={mode}>
            <option value="single">Single</option>
            <option value="overlay">Overlay</option>
          </select>
        </label>
      </div>
      {#if mode === `single`}
        <div class="pane-row">
          <label>Property:
            <select bind:value={selected_property}>
              <option value="">All</option>
              {#each series_options as option (option)}
                <option value={option}>{option}</option>
              {/each}
            </select>
          </label>
        </div>
      {/if}
    {/if}
    <label>
      <input type="checkbox" bind:checked={show_legend} />
      Show legend
    </label>
  </SettingsSection>

  <SettingsSection
    title="Bar Style"
    current_values={bar}
    on_reset={() => {
      bar = { ...DEFAULTS.histogram.bar }
    }}
    class="pane-grid"
  >
    {#if bar}
      {#if visible_series.length === 1}
        <label>Fill: <input type="color" bind:value={bar.color} /></label>
      {/if}
      <label>Opacity:
        <input type="range" min="0" max="1" step="0.05" bind:value={bar.opacity} />
        <input type="number" min="0" max="1" step="0.05" bind:value={bar.opacity} />
      </label>
      <label>Stroke Width:
        <input type="range" min="0" max="5" step="0.1" bind:value={bar.stroke_width} />
        <input type="number" min="0" max="5" step="0.1" bind:value={bar.stroke_width} />
      </label>
      <label>Stroke Color:
        <input type="color" bind:value={bar.stroke_color} />
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          bind:value={bar.stroke_opacity}
          title="Opacity"
        />
        <input
          type="number"
          min="0"
          max="1"
          step="0.05"
          bind:value={bar.stroke_opacity}
        />
      </label>
    {/if}
  </SettingsSection>

  <SettingsSection
    title="Scale Type"
    current_values={{
      x_scale_type: x_axis.scale_type,
      y_scale_type: y_axis.scale_type,
      y2_scale_type: y2_axis.scale_type,
    }}
    on_reset={() => {
      x_axis.scale_type = DEFAULTS.plot.x_scale_type as `linear` | `log`
      y_axis.scale_type = DEFAULTS.plot.y_scale_type as `linear` | `log`
      y2_axis.scale_type = DEFAULTS.plot.y_scale_type as `linear` | `log`
    }}
    class="pane-grid"
    style="grid-template-columns: 1fr 1fr"
  >
    <label>X: <select bind:value={x_axis.scale_type}>
        <option value="linear">Linear</option>
        <option value="log">Log</option>
      </select></label>
    <label>Y: <select bind:value={y_axis.scale_type}>
        <option value="linear">Linear</option>
        <option value="log">Log</option>
      </select></label>
    <label>Y2: <select bind:value={y2_axis.scale_type}>
        <option value="linear">Linear</option>
        <option value="log">Log</option>
      </select></label>
  </SettingsSection>
</PlotControls>
