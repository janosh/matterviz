<script lang="ts">
  import { SettingsSection } from '$lib'
  import type { DataSeries, PlotControlsProps } from '$lib/plot'
  import { PlotControls } from '$lib/plot'
  import { DEFAULTS } from '$lib/settings'

  interface Props extends Omit<PlotControlsProps, `children` | `post_children`> {
    // Series data for multi-series controls
    series?: readonly DataSeries[]
    // Histogram-specific controls
    bins?: number
    mode?: `single` | `overlay`
    bar_opacity?: number
    bar_stroke_width?: number
    bar_stroke_color?: string
    bar_stroke_opacity?: number
    bar_color?: string
    show_legend?: boolean
    // Scale type controls
    x_scale_type?: `linear` | `log`
    y_scale_type?: `linear` | `log`
    // Selected property for single mode
    selected_property?: string
  }
  let {
    series = [],
    bins = $bindable(DEFAULTS.histogram.bin_count),
    mode = $bindable(DEFAULTS.histogram.mode),
    bar_opacity = $bindable(DEFAULTS.histogram.bar_opacity),
    bar_stroke_width = $bindable(DEFAULTS.histogram.bar_stroke_width),
    bar_stroke_color = $bindable(DEFAULTS.histogram.bar_stroke_color),
    bar_stroke_opacity = $bindable(DEFAULTS.histogram.bar_stroke_opacity),
    bar_color = $bindable(DEFAULTS.histogram.bar_color),
    show_legend = $bindable(DEFAULTS.histogram.show_legend),
    x_scale_type = $bindable(DEFAULTS.plot.x_scale_type as `linear` | `log`),
    y_scale_type = $bindable(DEFAULTS.plot.y_scale_type as `linear` | `log`),
    selected_property = $bindable(``),
    ...rest
  }: Props = $props()

  // Derived state
  let has_multiple_series = $derived(series.filter(Boolean).length > 1)
  let visible_series = $derived(series.filter((s) => s && (s.visible ?? true)))
  let series_options = $derived(visible_series.map((s) => s.label || `Series`))
</script>

<PlotControls {...rest}>
  <SettingsSection
    title="Histogram"
    current_values={{ bins, mode, show_legend }}
    on_reset={() => {
      bins = DEFAULTS.histogram.bin_count
      ;({ mode, show_legend } = DEFAULTS.histogram)
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
    current_values={{
      bar_opacity,
      bar_stroke_width,
      bar_stroke_color,
      bar_stroke_opacity,
      bar_color,
    }}
    on_reset={() => {
      ;({
        bar_opacity,
        bar_stroke_width,
        bar_stroke_color,
        bar_stroke_opacity,
        bar_color,
      } = DEFAULTS.histogram)
    }}
    class="pane-grid"
  >
    {#if visible_series.length === 1}
      <label>Fill: <input type="color" bind:value={bar_color} /></label>
    {/if}
    <label>Opacity:
      <input type="range" min="0" max="1" step="0.05" bind:value={bar_opacity} />
      <input type="number" min="0" max="1" step="0.05" bind:value={bar_opacity} />
    </label>
    <label>Stroke Width:
      <input type="range" min="0" max="5" step="0.1" bind:value={bar_stroke_width} />
      <input type="number" min="0" max="5" step="0.1" bind:value={bar_stroke_width} />
    </label>
    <label>Stroke Color:
      <input type="color" bind:value={bar_stroke_color} />
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        bind:value={bar_stroke_opacity}
        title="Opacity"
      />
      <input type="number" min="0" max="1" step="0.05" bind:value={bar_stroke_opacity} />
    </label>
  </SettingsSection>

  <SettingsSection
    title="Scale Type"
    current_values={{ x_scale_type, y_scale_type }}
    on_reset={() => {
      x_scale_type = DEFAULTS.plot.x_scale_type as `linear` | `log`
      y_scale_type = DEFAULTS.plot.y_scale_type as `linear` | `log`
    }}
    class="pane-grid"
    style="grid-template-columns: 1fr 1fr"
  >
    <label>X: <select bind:value={x_scale_type}>
        <option value="linear">Linear</option>
        <option value="log">Log</option>
      </select></label>
    <label>Y: <select bind:value={y_scale_type}>
        <option value="linear">Linear</option>
        <option value="log">Log</option>
      </select></label>
  </SettingsSection>
</PlotControls>
