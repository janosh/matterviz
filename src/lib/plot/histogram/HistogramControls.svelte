<script lang="ts">
  import { track_settings } from '$lib/controls'
  // NOTE: Axis config objects must be reassigned (not mutated) to trigger $bindable reactivity.
  import { NumberRangeInput, SettingsSection } from '$lib/layout'
  import type { BarStyle, HistogramSeries, PlotConfig } from '$lib/plot'
  import { PlotControls } from '$lib/plot'
  import type { PlotControlsProps } from '$lib/plot/core/types'
  import type { HistogramNormalize } from '$lib/plot/histogram/histogram'
  import { legend_mode_to_prop } from '$lib/plot/core/utils/series-visibility'
  import { DEFAULTS, enum_labels, SETTINGS_CONFIG } from '$lib/settings'
  import type { Snippet } from 'svelte'

  let {
    series = [],
    bins = $bindable(DEFAULTS.histogram.bin_count),
    normalize = $bindable(DEFAULTS.histogram.normalize),
    mode = $bindable(DEFAULTS.histogram.mode),
    bar = $bindable({}),
    // explicit type arg keeps `undefined` (auto) in the prop type
    show_legend = $bindable<boolean | undefined>(),
    resolved_show_legend = false,
    selected_series_idx = $bindable(0),
    x_axis = $bindable({}),
    x2_axis = $bindable({}),
    y_axis = $bindable({}),
    y2_axis = $bindable({}),
    display = $bindable({}),
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    children,
    ...rest
  }: Omit<PlotControlsProps, `children` | `post_children`> & {
    // Series data for multi-series controls
    series?: readonly HistogramSeries[]
    // Histogram-specific controls
    bins?: number
    normalize?: HistogramNormalize
    mode?: `single` | `overlay`
    bar?: BarStyle
    // undefined = auto (same contract as Histogram / resolve_legend_visibility)
    show_legend?: boolean | undefined
    resolved_show_legend?: boolean
    // Index in the original series array, independent of its label or visibility.
    selected_series_idx?: number
    children?: Snippet<[Required<PlotConfig>]>
  } = $props()

  let visible_series = $derived(series.filter((srs) => srs.visible ?? true))
  const resolved_bar = $derived({ ...DEFAULTS.histogram.bar, ...bar })
  const set_bar = (key: keyof typeof DEFAULTS.histogram.bar) => (value: string | number) =>
    (bar = { ...bar, [key]: value })

  const histogram_settings = track_settings(() => ({ bins, normalize, mode, show_legend }), {
    bins: DEFAULTS.histogram.bin_count,
    normalize: DEFAULTS.histogram.normalize,
    mode: DEFAULTS.histogram.mode,
    show_legend: legend_mode_to_prop(DEFAULTS.histogram.show_legend),
  })
  const bar_style_settings = track_settings(() => resolved_bar, DEFAULTS.histogram.bar)
</script>

<!-- select options come from the settings schema so labels/values have a single source of truth -->
{#snippet options(enum_map: Record<string, string>)}
  {#each Object.entries(enum_map) as [value, label] (value)}
    <option {value}>{label}</option>
  {/each}
{/snippet}

<PlotControls
  bind:show_controls
  bind:controls_open
  bind:display
  bind:x_axis
  bind:x2_axis
  bind:y_axis
  bind:y2_axis
  {...rest}
>
  {@render children?.({ x_axis, x2_axis, y_axis, y2_axis, display })}
  <SettingsSection
    title="Histogram"
    changed_keys={histogram_settings.changed_keys}
    on_reset={() => ({ bins, normalize, mode, show_legend } = histogram_settings.snapshot())}
    layout="flow"
  >
    <NumberRangeInput min={5} max={100} step={5} bind:value={bins}>Bins</NumberRangeInput>
    <div class="ctrl-line">
      <label>
        <span>Normalize</span>
        <select bind:value={normalize}>
          {@render options(enum_labels(SETTINGS_CONFIG.histogram.normalize))}
        </select>
      </label>
      {#if series.length > 1}
        <label>
          <span>Mode</span>
          <select bind:value={mode}>
            {@render options(enum_labels(SETTINGS_CONFIG.histogram.mode))}
          </select>
        </label>
        {#if mode === `single`}
          <label style="flex-basis: 100%">
            <span>Series</span>
            <select bind:value={selected_series_idx} disabled={!visible_series.length}>
              {#if !visible_series.length}<option value={-1}>No visible series</option>{/if}
              {#each series as { label, visible = true }, series_idx (series_idx)}
                {#if visible}
                  <option value={series_idx}>{label || `Series ${series_idx + 1}`}</option>
                {/if}
              {/each}
            </select>
          </label>
        {/if}
      {/if}
      <label>
        <input
          type="checkbox"
          checked={show_legend ?? resolved_show_legend}
          onchange={(event) => (show_legend = event.currentTarget.checked)}
        />
        Show legend
      </label>
    </div>
  </SettingsSection>

  <SettingsSection
    title="Bar style"
    changed_keys={bar_style_settings.changed_keys}
    on_reset={() => (bar = bar_style_settings.snapshot())}
    layout="flow"
  >
    <div class="style-row">
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
    </div>
    <NumberRangeInput
      min={0}
      max={5}
      step={0.1}
      bind:value={() => resolved_bar.stroke_width, set_bar(`stroke_width`)}
      >Stroke width</NumberRangeInput
    >
    <div class="style-row">
      <label>
        <span>Color</span>
        <input
          type="color"
          aria-label="Stroke color"
          bind:value={() => resolved_bar.stroke_color, set_bar(`stroke_color`)}
        />
      </label>
      <NumberRangeInput
        min={0}
        max={1}
        step={0.05}
        bind:value={() => resolved_bar.stroke_opacity, set_bar(`stroke_opacity`)}
        >Stroke opacity</NumberRangeInput
      >
    </div>
  </SettingsSection>
</PlotControls>
