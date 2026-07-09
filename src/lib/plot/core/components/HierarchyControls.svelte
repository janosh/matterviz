<script lang="ts">
  // Shared controls pane for the hierarchical part-of-whole charts. Exported as
  // SunburstControls/TreemapControls from the chart barrels; `chart` picks the
  // chart-specific controls (shape/rotation/radius vs cell paddings) and labels.
  import { NumberRangeInput, SettingsSection } from '$lib/layout'
  import type {
    SunburstLabelRotation,
    SunburstLabelText,
    SunburstShape,
    SunburstValueMode,
  } from '$lib/plot'
  import { DEFAULTS, SETTINGS_CONFIG } from '$lib/settings'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import ControlPane from './ControlPane.svelte'

  let {
    chart,
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    // shared-option defaults come from the bound chart's own settings (chart is
    // destructured first so later prop defaults can reference it)
    value_mode = $bindable(DEFAULTS[chart].value_mode),
    max_depth = $bindable(DEFAULTS[chart].max_depth),
    min_fraction = $bindable(DEFAULTS[chart].min_fraction),
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
    export_buttons = true,
    on_export,
    toggle_props = {},
    pane_props = {},
    children,
  }: {
    chart: `sunburst` | `treemap`
    show_controls?: boolean
    controls_open?: boolean
    value_mode?: SunburstValueMode
    max_depth?: number
    min_fraction?: number
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
    export_buttons?: boolean // show SVG/PNG download buttons in the pane
    on_export?: (format: `svg` | `png`) => void
    toggle_props?: HTMLAttributes<HTMLButtonElement>
    pane_props?: HTMLAttributes<HTMLDivElement>
    children?: Snippet
  } = $props()

  let current_values = $derived({
    value_mode,
    max_depth,
    min_fraction,
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
      show_labels,
      label_text,
      zoom_on_click,
      show_breadcrumbs,
    } = DEFAULTS[chart])
    if (chart === `sunburst`) {
      ;({ shape, inner_radius, pad_angle, label_rotation } = DEFAULTS.sunburst)
    } else ({ padding_inner, padding_top, padding_outer } = DEFAULTS.treemap)
  }
</script>

{#if show_controls}
  <!-- snippets live at the template top level (not inside the components below) so
  they're locally renderable rather than treated as ControlPane/SettingsSection props -->
  {#snippet options(enum_map: Record<string, string>)}
    {#each Object.entries(enum_map) as [value, label] (value)}
      <option {value}>{label}</option>
    {/each}
  {/snippet}
  <ControlPane bind:controls_open controls_class={chart} {toggle_props} {pane_props}>
    {@render children?.()}
    <SettingsSection
      title={chart === `sunburst` ? `Sunburst` : `Treemap`}
      {current_values}
      on_reset={reset_to_defaults}
      style="display: flex; flex-wrap: wrap; gap: 2ex"
    >
      <!-- select options come from the settings schema so labels/values have a
      single source of truth -->
      {#if chart === `sunburst`}
        <label style="flex: 1">
          Shape:
          <select bind:value={shape}>
            {@render options(SETTINGS_CONFIG.sunburst.shape.enum ?? {})}
          </select>
        </label>
      {/if}
      <label style="flex: 1">
        Value mode:
        <select bind:value={value_mode}>
          {@render options(SETTINGS_CONFIG[chart].value_mode.enum ?? {})}
        </select>
      </label>
      {#if chart === `sunburst` && shape === `sunburst`}
        <!-- icicle labels are always horizontal; inner radius/pad angle are polar-only -->
        <label style="flex: 1">
          Labels:
          <select bind:value={label_rotation}>
            {@render options(SETTINGS_CONFIG.sunburst.label_rotation.enum ?? {})}
          </select>
        </label>
      {/if}
      <label style="flex: 1">
        Label text:
        <select bind:value={label_text}>
          {@render options(SETTINGS_CONFIG[chart].label_text.enum ?? {})}
        </select>
      </label>
      <NumberRangeInput min={0} max={10} step={1} bind:value={max_depth} style="flex: 1 1 100%"
        >Max depth (0 = all):</NumberRangeInput
      >
      {#if chart === `sunburst`}
        {#if shape === `sunburst`}
          <NumberRangeInput
            min={0}
            max={0.8}
            step={0.05}
            bind:value={inner_radius}
            style="flex: 1 1 100%">Inner radius:</NumberRangeInput
          >
          <NumberRangeInput
            min={0}
            max={4}
            step={0.1}
            bind:value={pad_angle}
            style="flex: 1 1 100%">Pad angle (°):</NumberRangeInput
          >
        {/if}
      {:else}
        <NumberRangeInput
          min={0}
          max={10}
          step={0.5}
          bind:value={padding_inner}
          style="flex: 1 1 100%">Cell gap (px):</NumberRangeInput
        >
        <NumberRangeInput
          min={0}
          max={40}
          step={1}
          bind:value={padding_top}
          style="flex: 1 1 100%">Header height (px, 0 = none):</NumberRangeInput
        >
        <NumberRangeInput
          min={0}
          max={10}
          step={0.5}
          bind:value={padding_outer}
          style="flex: 1 1 100%">Child inset (px):</NumberRangeInput
        >
      {/if}
      <NumberRangeInput
        min={0}
        max={0.2}
        step={0.005}
        bind:value={min_fraction}
        style="flex: 1 1 100%"
        >Group {chart === `sunburst` ? `slices` : `cells`} below (fraction of total):</NumberRangeInput
      >
      <label style="flex: 1 1 100%">
        <input type="checkbox" bind:checked={show_labels} />
        Show {chart === `sunburst` ? `arc` : `cell`} labels
      </label>
      <label style="flex: 1 1 100%">
        <input type="checkbox" bind:checked={zoom_on_click} />
        Zoom on click
      </label>
      <label style="flex: 1 1 100%">
        <input type="checkbox" bind:checked={show_breadcrumbs} />
        Show breadcrumbs when zoomed
      </label>
    </SettingsSection>
    {#if export_buttons && on_export}
      <!-- --hier-btn-*: forward the chart's own theming vars (--sunburst-btn-bg /
      --treemap-btn-bg); when unset, the outer var() falls back to the gray default -->
      <div
        class="export-row"
        style="--hier-btn-bg: var(--{chart}-btn-bg); --hier-btn-hover-bg: var(--{chart}-btn-hover-bg)"
      >
        Export:
        {#each [`svg`, `png`] as const as fmt (fmt)}
          <button
            type="button"
            class="export-btn"
            aria-label="Download {fmt.toUpperCase()}"
            onclick={() => on_export?.(fmt)}>{fmt.toUpperCase()}</button
          >
        {/each}
      </div>
    {/if}
  </ControlPane>
{/if}

<style>
  .export-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    font-size: 0.85em;
  }
  .export-btn {
    background: var(--hier-btn-bg, rgba(128, 128, 128, 0.15));
    color: inherit;
    border: none;
    border-radius: 3pt;
    padding: 1px 6px;
    cursor: pointer;
  }
  .export-btn:hover {
    background: var(--hier-btn-hover-bg, rgba(128, 128, 128, 0.35));
  }
</style>
