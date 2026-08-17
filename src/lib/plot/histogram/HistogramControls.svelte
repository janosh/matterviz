<script lang="ts">
  // NOTE: Axis config objects must be reassigned (not mutated) to trigger $bindable reactivity.
  import { NumberRangeInput, SettingsSection } from '$lib/layout'
  import type { Vec2 } from '$lib/math'
  import type { BarStyle, DataSeries, PlotConfig } from '$lib/plot'
  import { PlotControls } from '$lib/plot'
  import type { PlotControlsProps } from '$lib/plot/core/types'
  import { legend_mode_to_prop } from '$lib/plot/core/utils/series-visibility'
  import { DEFAULTS } from '$lib/settings'
  import type { Snippet } from 'svelte'

  let {
    series = [],
    bins = $bindable(DEFAULTS.histogram.bin_count),
    mode = $bindable(DEFAULTS.histogram.mode),
    bar = $bindable({}),
    // explicit type arg keeps `undefined` (auto) in the prop type
    show_legend = $bindable<boolean | undefined>(),
    resolved_show_legend = false,
    selected_property = $bindable(``),
    x_axis = $bindable({}),
    x2_axis = $bindable({}),
    y_axis = $bindable({}),
    y2_axis = $bindable({}),
    display = $bindable({}),
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    auto_x2_range = undefined,
    auto_y2_range = undefined,
    has_x2_points = false,
    has_y2_points = false,
    children,
    ...rest
  }: Omit<PlotControlsProps, `children` | `post_children`> & {
    // Series data for multi-series controls
    series?: readonly DataSeries[]
    // Histogram-specific controls
    bins?: number
    mode?: `single` | `overlay`
    bar?: BarStyle
    // undefined = auto (same contract as Histogram / resolve_legend_visibility)
    show_legend?: boolean | undefined
    resolved_show_legend?: boolean
    selected_property?: string
    show_controls?: boolean
    controls_open?: boolean
    auto_x2_range?: Vec2
    auto_y2_range?: Vec2
    has_x2_points?: boolean
    has_y2_points?: boolean
    children?: Snippet<[Required<PlotConfig>]>
  } = $props()

  let has_multiple_series = $derived(series.filter(Boolean).length > 1)
  let visible_series = $derived(series.filter((srs) => srs && (srs.visible ?? true)))
  let series_options = $derived(visible_series.map((srs) => srs.label || `Series`))
  const resolved_bar = $derived({ ...DEFAULTS.histogram.bar, ...bar })
  const set_bar = (key: keyof typeof DEFAULTS.histogram.bar) => (value: string | number) =>
    (bar = { ...bar, [key]: value })
</script>

<PlotControls
  bind:show_controls
  bind:controls_open
  bind:display
  bind:x_axis
  bind:x2_axis
  bind:y_axis
  bind:y2_axis
  {auto_x2_range}
  {auto_y2_range}
  {has_x2_points}
  {has_y2_points}
  {...rest}
>
  {@render children?.({ x_axis, x2_axis, y_axis, y2_axis, display })}
  <SettingsSection
    title="Histogram"
    current_values={{ bins, mode, show_legend }}
    on_reset={() => {
      ;({ bin_count: bins, mode } = DEFAULTS.histogram)
      // Resets to the configured mode, `auto` (undefined) by default, so a one-series
      // plot does not suddenly grow a legend
      show_legend = legend_mode_to_prop(DEFAULTS.histogram.show_legend)
    }}
    layout="grid"
  >
    <NumberRangeInput min={5} max={100} step={5} bind:value={bins}>Bins</NumberRangeInput>
    {#if has_multiple_series}
      <label>
        <span>Mode</span>
        <select bind:value={mode}>
          <option value="single">Single</option>
          <option value="overlay">Overlay</option>
        </select>
      </label>
      {#if mode === `single`}
        <label>
          <span>Property</span>
          <select bind:value={selected_property}>
            <option value="">All</option>
            {#each series_options as option, option_idx (option_idx)}
              <option value={option}>{option}</option>
            {/each}
          </select>
        </label>
      {/if}
    {/if}
    <label>
      <span>Show legend</span>
      <input
        type="checkbox"
        checked={show_legend ?? resolved_show_legend}
        onchange={(event) => (show_legend = event.currentTarget.checked)}
      />
    </label>
  </SettingsSection>

  <SettingsSection
    title="Bar style"
    current_values={bar}
    on_reset={() => {
      bar = { ...DEFAULTS.histogram.bar }
    }}
    layout="grid"
  >
    {#if visible_series.length === 1}
      <label>
        <span>Fill</span>
        <input type="color" bind:value={() => resolved_bar.color, set_bar(`color`)} />
      </label>
    {/if}
    <NumberRangeInput
      min={0}
      max={1}
      step={0.05}
      bind:value={() => resolved_bar.opacity, set_bar(`opacity`)}>Opacity</NumberRangeInput
    >
    <NumberRangeInput
      min={0}
      max={5}
      step={0.1}
      bind:value={() => resolved_bar.stroke_width, set_bar(`stroke_width`)}
      >Stroke width</NumberRangeInput
    >
    <label>
      <span>Stroke color</span>
      <span class="stroke-value">
        <input
          type="color"
          bind:value={() => resolved_bar.stroke_color, set_bar(`stroke_color`)}
        />
        <input
          type="number"
          min="0"
          max="1"
          step="0.05"
          bind:value={() => resolved_bar.stroke_opacity, set_bar(`stroke_opacity`)}
        />
      </span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        bind:value={() => resolved_bar.stroke_opacity, set_bar(`stroke_opacity`)}
        title="Opacity"
      />
    </label>
  </SettingsSection>
</PlotControls>

<style>
  .stroke-value {
    display: flex;
    align-items: center;
    gap: 4pt;
  }
</style>
