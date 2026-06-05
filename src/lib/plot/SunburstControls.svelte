<script lang="ts">
  import { SettingsSection } from '$lib/layout'
  import type {
    SunburstLabelRotation,
    SunburstLabelText,
    SunburstShape,
    SunburstValueMode,
  } from '$lib/plot'
  import { unique_id } from '$lib/plot/utils'
  import { DEFAULTS, SETTINGS_CONFIG } from '$lib/settings'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import ControlPane from './ControlPane.svelte'

  // Unique id prefix to avoid label/input collisions with other instances
  const uid = unique_id(`sunburst`)

  let {
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    shape = $bindable(`sunburst`),
    value_mode = $bindable(`leaf-sum`),
    max_depth = $bindable(DEFAULTS.sunburst.max_depth),
    inner_radius = $bindable(DEFAULTS.sunburst.inner_radius),
    pad_angle = $bindable(DEFAULTS.sunburst.pad_angle),
    min_fraction = $bindable(DEFAULTS.sunburst.min_fraction),
    show_labels = $bindable(true),
    label_rotation = $bindable(`auto`),
    label_text = $bindable(`label`),
    zoom_on_click = $bindable(true),
    show_breadcrumbs = $bindable(true),
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
  {#snippet num_row(
    text: string,
    [min, max, step]: [number, number, number],
    get: () => number,
    set: (val: number) => void,
  )}
    <label style="flex: 1 1 100%">
      {text}
      <input type="range" {min} {max} {step} bind:value={get, set} />
      <input type="number" {min} {max} {step} bind:value={get, set} />
    </label>
  {/snippet}
  {#snippet check_row(text: string, get: () => boolean, set: (val: boolean) => void)}
    <label style="flex: 1 1 100%">
      <input type="checkbox" bind:checked={get, set} />
      {text}
    </label>
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
        shape = DEFAULTS.sunburst.shape as SunburstShape
        value_mode = DEFAULTS.sunburst.value_mode as SunburstValueMode
        max_depth = DEFAULTS.sunburst.max_depth
        inner_radius = DEFAULTS.sunburst.inner_radius
        pad_angle = DEFAULTS.sunburst.pad_angle
        min_fraction = DEFAULTS.sunburst.min_fraction
        show_labels = DEFAULTS.sunburst.show_labels
        label_rotation = DEFAULTS.sunburst.label_rotation as SunburstLabelRotation
        label_text = DEFAULTS.sunburst.label_text as SunburstLabelText
        zoom_on_click = DEFAULTS.sunburst.zoom_on_click
        show_breadcrumbs = DEFAULTS.sunburst.show_breadcrumbs
      }}
      style="display: flex; flex-wrap: wrap; gap: 2ex"
    >
      <!-- select options come from the settings schema so labels/values have a
      single source of truth -->
      <label style="flex: 1">
        Shape:
        <select bind:value={shape} id="{uid}-shape">
          {@render options(SETTINGS_CONFIG.sunburst.shape.enum ?? {})}
        </select>
      </label>
      <label style="flex: 1">
        Value mode:
        <select bind:value={value_mode} id="{uid}-value-mode">
          {@render options(SETTINGS_CONFIG.sunburst.value_mode.enum ?? {})}
        </select>
      </label>
      {#if shape === `sunburst`}
        <!-- icicle labels are always horizontal; inner radius/pad angle are polar-only -->
        <label style="flex: 1">
          Labels:
          <select bind:value={label_rotation} id="{uid}-label-rotation">
            {@render options(SETTINGS_CONFIG.sunburst.label_rotation.enum ?? {})}
          </select>
        </label>
      {/if}
      <label style="flex: 1">
        Label text:
        <select bind:value={label_text} id="{uid}-label-text">
          {@render options(SETTINGS_CONFIG.sunburst.label_text.enum ?? {})}
        </select>
      </label>
      {@render num_row(`Max depth (0 = all):`, [0, 10, 1], () => max_depth, (val) =>
        max_depth = val)}
      {#if shape === `sunburst`}
        {@render num_row(`Inner radius:`, [0, 0.8, 0.05], () => inner_radius, (val) =>
          inner_radius = val)}
        {@render num_row(`Pad angle (°):`, [0, 4, 0.1], () => pad_angle, (val) =>
          pad_angle = val)}
      {/if}
      {@render num_row(
        `Group slices below (fraction of total):`,
        [0, 0.2, 0.005],
        () => min_fraction,
        (val) => min_fraction = val,
      )}
      {@render check_row(`Show arc labels`, () => show_labels, (val) =>
        show_labels = val)}
      {@render check_row(`Zoom on click`, () => zoom_on_click, (val) =>
        zoom_on_click = val)}
      {@render check_row(`Show breadcrumbs when zoomed`, () => show_breadcrumbs, (val) =>
        show_breadcrumbs = val)}
    </SettingsSection>
  </ControlPane>
{/if}
