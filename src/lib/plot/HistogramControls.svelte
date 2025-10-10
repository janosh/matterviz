<script lang="ts">
  import { SettingsSection } from '$lib'
  import type { DataSeries, PlotControlsProps } from '$lib/plot'
  import { DEFAULTS } from '$lib/settings'
  import PlotControls from './PlotControls.svelte'

  interface Props extends Omit<PlotControlsProps, `children` | `post_children`> {
    // Series data for multi-series controls
    series?: readonly DataSeries[]
    // Histogram-specific controls
    bins?: number
    mode?: `single` | `overlay`
    bar_opacity?: number
    bar_stroke_width?: number
    bar_color?: string
    show_legend?: boolean
    // Scale type controls
    x_scale_type?: `linear` | `log`
    y_scale_type?: `linear` | `log`
    // Selected property for single mode
    selected_property?: string
  }
  let {
    show_controls = $bindable(false),
    controls_open = $bindable(false),
    plot_controls,
    series = [],
    bins = $bindable(DEFAULTS.trajectory.histogram_bin_count),
    mode = $bindable(DEFAULTS.trajectory.histogram_mode),
    bar_opacity = $bindable(DEFAULTS.trajectory.histogram_bar_opacity),
    bar_stroke_width = $bindable(DEFAULTS.trajectory.histogram_bar_stroke_width),
    bar_color = $bindable(`#4682b4`),
    show_legend = $bindable(DEFAULTS.trajectory.histogram_show_legend),
    // Display controls
    show_x_zero_line = $bindable(false),
    show_y_zero_line = $bindable(false),
    x_grid = $bindable(DEFAULTS.plot.x_grid),
    y_grid = $bindable(DEFAULTS.plot.y_grid),
    // Scale type controls
    x_scale_type = $bindable(DEFAULTS.plot.x_scale_type as `linear` | `log`),
    y_scale_type = $bindable(DEFAULTS.plot.y_scale_type as `linear` | `log`),
    // Range controls
    x_range = $bindable(undefined),
    y_range = $bindable(undefined),
    auto_x_range = [0, 1],
    auto_y_range = [0, 1],
    // Tick controls
    x_ticks = $bindable(DEFAULTS.plot.x_ticks),
    y_ticks = $bindable(DEFAULTS.plot.y_ticks),
    // Format controls
    x_format = $bindable(DEFAULTS.plot.x_format),
    y_format = $bindable(DEFAULTS.plot.y_format),
    selected_property = $bindable(``),
    toggle_props = {},
    pane_props = {},
  }: Props = $props()

  // Derived state
  let has_multiple_series = $derived(series.filter(Boolean).length > 1)
  let visible_series = $derived(series.filter((s) => s && (s.visible ?? true)))
  let series_options = $derived(visible_series.map((s) => s.label || `Series`))
</script>

<PlotControls
  bind:show_controls
  bind:controls_open
  bind:show_x_zero_line
  bind:show_y_zero_line
  bind:x_grid
  bind:y_grid
  bind:x_range
  bind:y_range
  bind:x_ticks
  bind:y_ticks
  bind:x_format
  bind:y_format
  {auto_x_range}
  {auto_y_range}
  {plot_controls}
  show_ticks={true}
  controls_title="histogram"
  controls_class="histogram"
  {toggle_props}
  {pane_props}
>
  <SettingsSection
    title="Histogram"
    current_values={{ bins, mode, show_legend }}
    on_reset={() => {
      bins = DEFAULTS.trajectory.histogram_bin_count
      mode = DEFAULTS.trajectory.histogram_mode
      show_legend = DEFAULTS.trajectory.histogram_show_legend
    }}
  >
    <div class="pane-row">
      <label for="bins-input">Bins:</label>
      <input
        id="bins-input"
        type="range"
        min="5"
        max="100"
        step="5"
        bind:value={bins}
      />
      <input type="number" min="5" max="100" step="5" bind:value={bins} />
    </div>
    {#if has_multiple_series}
      <div class="pane-row">
        <label for="mode-select">Mode:</label>
        <select bind:value={mode} id="mode-select">
          <option value="single">Single</option>
          <option value="overlay">Overlay</option>
        </select>
      </div>
      {#if mode === `single`}
        <div class="pane-row">
          <label for="property-select">Property:</label>
          <select bind:value={selected_property} id="property-select">
            <option value="">All</option>
            {#each series_options as option (option)}
              <option value={option}>{option}</option>
            {/each}
          </select>
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
    current_values={{ bar_opacity, bar_stroke_width, bar_color }}
    on_reset={() => {
      bar_opacity = DEFAULTS.trajectory.histogram_bar_opacity
      bar_stroke_width = DEFAULTS.trajectory.histogram_bar_stroke_width
      bar_color = `#4682b4`
    }}
    class="pane-grid"
    style="grid-template-columns: auto 1fr auto"
  >
    <label for="bar-opacity-range">Opacity:</label>
    <input
      id="bar-opacity-range"
      type="range"
      min="0"
      max="1"
      step="0.05"
      bind:value={bar_opacity}
    />
    <input type="number" min="0" max="1" step="0.05" bind:value={bar_opacity} />
    <label for="bar-stroke-width-range">Stroke Width:</label>
    <input
      id="bar-stroke-width-range"
      type="range"
      min="0"
      max="5"
      step="0.1"
      bind:value={bar_stroke_width}
    />
    <input
      type="number"
      min="0"
      max="5"
      step="0.1"
      bind:value={bar_stroke_width}
    />
    {#if visible_series.length === 1}
      <label for="bar-color-input">Color:</label>
      <input
        id="bar-color-input"
        type="color"
        bind:value={bar_color}
        style="grid-column: 2 / 4"
      />
    {/if}
  </SettingsSection>

  <SettingsSection
    title="Scale Type"
    current_values={{ x_scale_type, y_scale_type }}
    on_reset={() => {
      x_scale_type = DEFAULTS.plot.x_scale_type as `linear` | `log`
      y_scale_type = DEFAULTS.plot.y_scale_type as `linear` | `log`
    }}
    class="pane-grid"
    style="grid-template-columns: auto 1fr"
  >
    <label for="x-scale-select">X-axis:</label>
    <select bind:value={x_scale_type} id="x-scale-select">
      <option value="linear">Linear</option>
      <option value="log">Log</option>
    </select>
    <label for="y-scale-select">Y-axis:</label>
    <select bind:value={y_scale_type} id="y-scale-select">
      <option value="linear">Linear</option>
      <option value="log">Log</option>
    </select>
  </SettingsSection>
</PlotControls>
