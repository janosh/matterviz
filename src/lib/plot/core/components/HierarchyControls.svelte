<script lang="ts">
  import { enum_options } from '#lib/plot/core/components/PlotControls.svelte'

  import { track_settings } from '#lib/controls.js'
  import type { ShowControlsProp } from '#lib/controls.js'
  // Shared controls pane for the hierarchical part-of-whole charts. Exported as
  // SunburstControls/TreemapControls from the chart barrels; `chart` picks the
  // chart-specific controls (shape/rotation/radius vs cell paddings) and labels.
  import { NumberRangeInput, SettingsSection } from '#lib/layout/index.js'
  import type {
    SunburstLabelRotation,
    SunburstLabelText,
    SunburstShape,
    SunburstValueMode,
  } from '#lib/plot/core/utils/hierarchy-layout.js'
  import { DEFAULTS, SETTINGS_CONFIG } from '#lib/settings.js'
  import { type Snippet, untrack } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { ControlPane } from '#lib/overlays/index.js'

  let {
    chart,
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    // shared-option defaults come from the bound chart's own settings (chart is
    // destructured first so later prop defaults can reference it)
    value_mode = $bindable(DEFAULTS[chart].value_mode),
    max_depth = $bindable(DEFAULTS[chart].max_depth),
    min_fraction = $bindable(DEFAULTS[chart].min_fraction),
    max_children = $bindable(DEFAULTS[chart].max_children),
    show_labels = $bindable(DEFAULTS[chart].show_labels),
    label_text = $bindable(DEFAULTS[chart].label_text),
    zoom_on_click = $bindable(DEFAULTS[chart].zoom_on_click),
    show_breadcrumbs = $bindable(DEFAULTS[chart].show_breadcrumbs),
    shape = $bindable(DEFAULTS.sunburst.shape),
    inner_radius = $bindable(DEFAULTS.sunburst.inner_radius),
    pad_angle = $bindable(DEFAULTS.sunburst.pad_angle),
    label_rotation = $bindable(DEFAULTS.sunburst.label_rotation),
    padding_inner = $bindable(DEFAULTS.treemap.padding_inner),
    padding_top = $bindable(DEFAULTS.treemap.padding_top),
    padding_outer = $bindable(DEFAULTS.treemap.padding_outer),
    toggle_props = {},
    pane_props = {},
    children,
  }: {
    chart: `sunburst` | `treemap`
    show_controls?: ShowControlsProp<`controls` | `fullscreen`>
    controls_open?: boolean
    value_mode?: SunburstValueMode
    max_depth?: number
    min_fraction?: number
    max_children?: number
    show_labels?: boolean
    label_text?: SunburstLabelText
    zoom_on_click?: boolean
    show_breadcrumbs?: boolean
    // sunburst-only (ignored for treemap)
    shape?: SunburstShape
    inner_radius?: number
    pad_angle?: number
    label_rotation?: SunburstLabelRotation
    // treemap-only (ignored for sunburst)
    padding_inner?: number
    padding_top?: number
    padding_outer?: number
    toggle_props?: HTMLAttributes<HTMLButtonElement>
    pane_props?: HTMLAttributes<HTMLDivElement>
    children?: Snippet
  } = $props()

  let current_values = $derived({
    value_mode,
    max_depth,
    min_fraction,
    max_children,
    show_labels,
    label_text,
    zoom_on_click,
    show_breadcrumbs,
    ...(chart === `sunburst`
      ? { shape, inner_radius, pad_angle, label_rotation }
      : { padding_inner, padding_top, padding_outer }),
  })

  function reset_to_defaults() {
    ;({
      value_mode,
      max_depth,
      min_fraction,
      max_children,
      show_labels,
      label_text,
      zoom_on_click,
      show_breadcrumbs,
    } = DEFAULTS[chart])
    if (chart === `sunburst`) {
      ;({ shape, inner_radius, pad_angle, label_rotation } = DEFAULTS.sunburst)
    } else ({ padding_inner, padding_top, padding_outer } = DEFAULTS.treemap)
  }

  const hierarchy_settings = track_settings(
    () => current_values,
    untrack(() => DEFAULTS[chart]),
  )
</script>

<ControlPane
  {show_controls}
  bind:controls_open
  controls_name={chart}
  {toggle_props}
  {pane_props}
>
  {@render children?.()}
  <SettingsSection
    title={chart === `sunburst` ? `Sunburst` : `Treemap`}
    changed_keys={hierarchy_settings.changed_keys}
    on_reset={reset_to_defaults}
    layout="grid"
  >
    <!-- select options come from the settings schema so labels/values have a
      single source of truth -->
    {#if chart === `sunburst`}
      <label>
        <span>Shape</span>
        <select bind:value={shape}>
          {@render enum_options(SETTINGS_CONFIG.sunburst.shape)}
        </select>
      </label>
    {/if}
    <label>
      <span>Value mode</span>
      <select bind:value={value_mode}>
        {@render enum_options(SETTINGS_CONFIG[chart].value_mode)}
      </select>
    </label>
    {#if chart === `sunburst` && shape === `sunburst`}
      <!-- icicle labels are always horizontal; inner radius/pad angle are polar-only -->
      <label>
        <span>Labels</span>
        <select bind:value={label_rotation}>
          {@render enum_options(SETTINGS_CONFIG.sunburst.label_rotation)}
        </select>
      </label>
    {/if}
    <label>
      <span>Label text</span>
      <select bind:value={label_text}>
        {@render enum_options(SETTINGS_CONFIG[chart].label_text)}
      </select>
    </label>
    <NumberRangeInput min={0} max={10} step={1} bind:value={max_depth}
      >Max depth (0 = all)</NumberRangeInput
    >
    {#if chart === `sunburst` && shape === `sunburst`}
      <NumberRangeInput min={0} max={0.8} step={0.05} bind:value={inner_radius}
        >Inner radius</NumberRangeInput
      >
      <NumberRangeInput min={0} max={4} step={0.1} bind:value={pad_angle}
        >Pad angle (°)</NumberRangeInput
      >
    {:else if chart === `treemap`}
      <NumberRangeInput min={0} max={10} step={0.5} bind:value={padding_inner}
        >Cell gap (px)</NumberRangeInput
      >
      <NumberRangeInput min={0} max={40} step={1} bind:value={padding_top}
        >Header height (px, 0 = none)</NumberRangeInput
      >
      <NumberRangeInput min={0} max={10} step={0.5} bind:value={padding_outer}
        >Child inset (px)</NumberRangeInput
      >
    {/if}
    <NumberRangeInput min={0} max={0.2} step={0.005} bind:value={min_fraction}
      >Group {chart === `sunburst` ? `slices` : `cells`} below (fraction)</NumberRangeInput
    >
    <NumberRangeInput min={0} max={20} step={1} bind:value={max_children}
      >Max children per parent (0 = all)</NumberRangeInput
    >
    <label>
      <span>Show {chart === `sunburst` ? `arc` : `cell`} labels</span>
      <input type="checkbox" bind:checked={show_labels} />
    </label>
    <label>
      <span>Zoom on click</span>
      <input type="checkbox" bind:checked={zoom_on_click} />
    </label>
    <label>
      <span>Show breadcrumbs when zoomed</span>
      <input type="checkbox" bind:checked={show_breadcrumbs} />
    </label>
  </SettingsSection>
</ControlPane>
