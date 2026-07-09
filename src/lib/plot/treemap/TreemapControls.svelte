<script lang="ts">
  import { NumberRangeInput, SettingsSection } from '$lib/layout'
  import type { SunburstLabelText, SunburstValueMode } from '$lib/plot'
  import { DEFAULTS, SETTINGS_CONFIG } from '$lib/settings'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import ControlPane from '$lib/plot/core/components/ControlPane.svelte'

  let {
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    value_mode = $bindable(DEFAULTS.treemap.value_mode),
    max_depth = $bindable(DEFAULTS.treemap.max_depth),
    padding_inner = $bindable(DEFAULTS.treemap.padding_inner),
    padding_top = $bindable(DEFAULTS.treemap.padding_top),
    padding_outer = $bindable(DEFAULTS.treemap.padding_outer),
    min_fraction = $bindable(DEFAULTS.treemap.min_fraction),
    show_labels = $bindable(DEFAULTS.treemap.show_labels),
    label_text = $bindable(DEFAULTS.treemap.label_text),
    zoom_on_click = $bindable(DEFAULTS.treemap.zoom_on_click),
    show_breadcrumbs = $bindable(DEFAULTS.treemap.show_breadcrumbs),
    export_buttons = true,
    on_export,
    toggle_props = {},
    pane_props = {},
    children,
  }: {
    show_controls?: boolean
    controls_open?: boolean
    value_mode?: SunburstValueMode
    max_depth?: number
    padding_inner?: number
    padding_top?: number
    padding_outer?: number
    min_fraction?: number
    show_labels?: boolean
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
  <ControlPane bind:controls_open controls_class="treemap" {toggle_props} {pane_props}>
    {@render children?.()}
    <SettingsSection
      title="Treemap"
      current_values={{
        value_mode,
        max_depth,
        padding_inner,
        padding_top,
        padding_outer,
        min_fraction,
        show_labels,
        label_text,
        zoom_on_click,
        show_breadcrumbs,
      }}
      on_reset={() => {
        ;({
          value_mode,
          max_depth,
          padding_inner,
          padding_top,
          padding_outer,
          min_fraction,
          show_labels,
          label_text,
          zoom_on_click,
          show_breadcrumbs,
        } = DEFAULTS.treemap)
      }}
      style="display: flex; flex-wrap: wrap; gap: 2ex"
    >
      <!-- select options come from the settings schema so labels/values have a
      single source of truth -->
      <label style="flex: 1">
        Value mode:
        <select bind:value={value_mode}>
          {@render options(SETTINGS_CONFIG.treemap.value_mode.enum ?? {})}
        </select>
      </label>
      <label style="flex: 1">
        Label text:
        <select bind:value={label_text}>
          {@render options(SETTINGS_CONFIG.treemap.label_text.enum ?? {})}
        </select>
      </label>
      <NumberRangeInput min={0} max={10} step={1} bind:value={max_depth} style="flex: 1 1 100%"
        >Max depth (0 = all):</NumberRangeInput
      >
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
      <NumberRangeInput
        min={0}
        max={0.2}
        step={0.005}
        bind:value={min_fraction}
        style="flex: 1 1 100%">Group cells below (fraction of total):</NumberRangeInput
      >
      <label style="flex: 1 1 100%">
        <input type="checkbox" bind:checked={show_labels} />
        Show cell labels
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
    background: var(--treemap-btn-bg, rgba(128, 128, 128, 0.15));
    color: inherit;
    border: none;
    border-radius: 3pt;
    padding: 1px 6px;
    cursor: pointer;
  }
  .export-btn:hover {
    background: var(--treemap-btn-hover-bg, rgba(128, 128, 128, 0.35));
  }
</style>
