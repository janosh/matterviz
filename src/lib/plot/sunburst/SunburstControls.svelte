<script lang="ts">
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
  import ControlPane from '$lib/plot/core/components/ControlPane.svelte'

  let {
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    shape = $bindable(DEFAULTS.sunburst.shape),
    value_mode = $bindable(DEFAULTS.sunburst.value_mode),
    max_depth = $bindable(DEFAULTS.sunburst.max_depth),
    inner_radius = $bindable(DEFAULTS.sunburst.inner_radius),
    pad_angle = $bindable(DEFAULTS.sunburst.pad_angle),
    min_fraction = $bindable(DEFAULTS.sunburst.min_fraction),
    show_labels = $bindable(DEFAULTS.sunburst.show_labels),
    label_rotation = $bindable(DEFAULTS.sunburst.label_rotation),
    label_text = $bindable(DEFAULTS.sunburst.label_text),
    zoom_on_click = $bindable(DEFAULTS.sunburst.zoom_on_click),
    show_breadcrumbs = $bindable(DEFAULTS.sunburst.show_breadcrumbs),
    export_buttons = true,
    on_export,
    toggle_props = {},
    pane_props = {},
    children,
  }: {
    show_controls?: boolean
    controls_open?: boolean
    shape?: SunburstShape
    value_mode?: SunburstValueMode
    max_depth?: number
    inner_radius?: number
    pad_angle?: number
    min_fraction?: number
    show_labels?: boolean
    label_rotation?: SunburstLabelRotation
    label_text?: SunburstLabelText
    zoom_on_click?: boolean
    show_breadcrumbs?: boolean
    export_buttons?: boolean // show SVG/PNG download buttons in the pane
    on_export?: (format: `svg` | `png`) => void
    toggle_props?: HTMLAttributes<HTMLButtonElement>
    pane_props?: HTMLAttributes<HTMLDivElement>
    children?: Snippet
  } = $props()
</script>

{#if show_controls}
  <!-- snippets live at the template top level (not inside the components below) so
  they're locally renderable rather than treated as ControlPane/SettingsSection props -->
  {#snippet options(enum_map: Record<string, string>)}
    {#each Object.entries(enum_map) as [value, label] (value)}
      <option {value}>{label}</option>
    {/each}
  {/snippet}
  <ControlPane bind:controls_open controls_class="sunburst" {toggle_props} {pane_props}>
    {@render children?.()}
    <SettingsSection
      title="Sunburst"
      current_values={{
        shape,
        value_mode,
        max_depth,
        inner_radius,
        pad_angle,
        min_fraction,
        show_labels,
        label_rotation,
        label_text,
        zoom_on_click,
        show_breadcrumbs,
      }}
      on_reset={() => {
        ;({
          shape,
          value_mode,
          max_depth,
          inner_radius,
          pad_angle,
          min_fraction,
          show_labels,
          label_rotation,
          label_text,
          zoom_on_click,
          show_breadcrumbs,
        } = DEFAULTS.sunburst)
      }}
      style="display: flex; flex-wrap: wrap; gap: 2ex"
    >
      <!-- select options come from the settings schema so labels/values have a
      single source of truth -->
      <label style="flex: 1">
        Shape:
        <select bind:value={shape}>
          {@render options(SETTINGS_CONFIG.sunburst.shape.enum ?? {})}
        </select>
      </label>
      <label style="flex: 1">
        Value mode:
        <select bind:value={value_mode}>
          {@render options(SETTINGS_CONFIG.sunburst.value_mode.enum ?? {})}
        </select>
      </label>
      {#if shape === `sunburst`}
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
          {@render options(SETTINGS_CONFIG.sunburst.label_text.enum ?? {})}
        </select>
      </label>
      <NumberRangeInput min={0} max={10} step={1} bind:value={max_depth} style="flex: 1 1 100%"
        >Max depth (0 = all):</NumberRangeInput
      >
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
      <NumberRangeInput
        min={0}
        max={0.2}
        step={0.005}
        bind:value={min_fraction}
        style="flex: 1 1 100%">Group slices below (fraction of total):</NumberRangeInput
      >
      <label style="flex: 1 1 100%">
        <input type="checkbox" bind:checked={show_labels} />
        Show arc labels
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
      <div class="export-row">
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
    background: var(--sunburst-btn-bg, rgba(128, 128, 128, 0.15));
    color: inherit;
    border: none;
    border-radius: 3pt;
    padding: 1px 6px;
    cursor: pointer;
  }
  .export-btn:hover {
    background: var(--sunburst-btn-hover-bg, rgba(128, 128, 128, 0.35));
  }
</style>
