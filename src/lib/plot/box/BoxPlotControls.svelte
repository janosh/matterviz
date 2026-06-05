<script lang="ts">
  import { SettingsSection } from '$lib/layout'
  import type { Orientation, PlotConfig, ViolinKind, ViolinSide, WhiskerMode } from '$lib/plot'
  import { PlotControls } from '$lib/plot'
  import type { PlotControlsProps } from '$lib/plot/core/types'
  import { unique_id } from '$lib/plot/core/utils'
  import { DEFAULTS } from '$lib/settings'
  import type { Snippet } from 'svelte'

  // Unique ID prefix to avoid conflicts when multiple instances on same page
  const uid = unique_id(`box-ctrl`)

  let {
    orientation = $bindable(`vertical`),
    whisker_mode = $bindable(`tukey`),
    show_outliers = $bindable(true),
    show_mean = $bindable(false),
    kind = $bindable(`box`),
    side = $bindable(`both`),
    x_axis = $bindable({}),
    x2_axis = $bindable({}),
    y_axis = $bindable({}),
    y2_axis = $bindable({}),
    display = $bindable({}),
    show_controls = $bindable(false),
    controls_open = $bindable(false),
    children,
    ...rest
  }: Omit<PlotControlsProps, `children` | `post_children`> & {
    orientation?: Orientation
    whisker_mode?: WhiskerMode
    show_outliers?: boolean
    show_mean?: boolean
    kind?: ViolinKind
    side?: ViolinSide
    show_controls?: boolean
    controls_open?: boolean
    children?: Snippet<[{ orientation: Orientation } & Required<PlotConfig>]>
  } = $props()
</script>

<PlotControls
  bind:show_controls
  bind:controls_open
  bind:x_axis
  bind:x2_axis
  bind:y_axis
  bind:y2_axis
  bind:display
  {...rest}
>
  {@render children?.({ orientation, x_axis, x2_axis, y_axis, y2_axis, display })}
  <SettingsSection
    title="Box / Violin"
    current_values={{ orientation, kind, side, whisker_mode, show_outliers, show_mean }}
    on_reset={() => {
      orientation = `vertical`
      kind = DEFAULTS.box.kind
      side = DEFAULTS.box.side
      whisker_mode = DEFAULTS.box.whisker_mode
      show_outliers = DEFAULTS.box.show_outliers
      show_mean = DEFAULTS.box.show_mean
    }}
    style="display: flex; flex-wrap: wrap; gap: 2ex"
  >
    <label style="flex: 1">
      Orientation:
      <select bind:value={orientation} id="{uid}-orientation">
        <option value="vertical">Vertical</option>
        <option value="horizontal">Horizontal</option>
      </select>
    </label>
    <label style="flex: 1">
      Glyph:
      <select bind:value={kind} id="{uid}-kind">
        <option value="box">Box</option>
        <option value="violin">Violin</option>
        <option value="violin+box">Violin + Box</option>
      </select>
    </label>
    {#if kind !== `box`}
      <label style="flex: 1">
        Violin side:
        <select bind:value={side} id="{uid}-side">
          <option value="both">Both</option>
          <option value="positive">Positive</option>
          <option value="negative">Negative</option>
        </select>
      </label>
    {/if}
    <label style="flex: 1">
      Whiskers:
      <select bind:value={whisker_mode} id="{uid}-whisker-mode">
        <option value="tukey">Tukey (1.5·IQR)</option>
        <option value="minmax">Min/Max</option>
        <option value="percentile">Percentile</option>
        <option value="std">Std Dev</option>
      </select>
    </label>
    <label style="flex: 1 1 100%">
      <input type="checkbox" bind:checked={show_outliers} />
      Show outliers
    </label>
    <label style="flex: 1 1 100%">
      <input type="checkbox" bind:checked={show_mean} />
      Show mean
    </label>
  </SettingsSection>
</PlotControls>
