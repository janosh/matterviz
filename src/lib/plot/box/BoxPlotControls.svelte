<script lang="ts">
  import { SettingsSection } from '$lib/layout'
  import type { Orientation, PlotConfig, ViolinKind, ViolinSide, WhiskerMode } from '$lib/plot'
  import { PlotControls } from '$lib/plot'
  import type { PlotControlsProps } from '$lib/plot/core/types'
  import { DEFAULTS } from '$lib/settings'
  import type { Snippet } from 'svelte'

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
    show_controls = $bindable(true),
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
    title="Box / violin"
    current_values={{ orientation, kind, side, whisker_mode, show_outliers, show_mean }}
    on_reset={() => {
      orientation = `vertical`
      ;({ kind, side, whisker_mode, show_outliers, show_mean } = DEFAULTS.box)
    }}
    layout="flow"
  >
    <div class="ctrl-line">
      <label>
        <span>Orientation</span>
        <select bind:value={orientation}>
          <option value="vertical">Vertical</option>
          <option value="horizontal">Horizontal</option>
        </select>
      </label>
      <label>
        <span>Glyph</span>
        <select bind:value={kind}>
          <option value="box">Box</option>
          <option value="violin">Violin</option>
          <option value="violin+box">Violin + box</option>
        </select>
      </label>
      {#if kind !== `box`}
        <label>
          <span>Side</span>
          <select bind:value={side}>
            <option value="both">Both</option>
            <option value="positive">Positive</option>
            <option value="negative">Negative</option>
          </select>
        </label>
      {/if}
      <label>
        <span>Whiskers</span>
        <select bind:value={whisker_mode}>
          <option value="tukey">Tukey (1.5·IQR)</option>
          <option value="minmax">Min/max</option>
          <option value="percentile">Percentile</option>
          <option value="std">Std dev</option>
        </select>
      </label>
    </div>
    <div class="ctrl-line">
      <label>
        <input type="checkbox" bind:checked={show_outliers} />
        Show outliers
      </label>
      <label>
        <input type="checkbox" bind:checked={show_mean} />
        Show mean
      </label>
    </div>
  </SettingsSection>
</PlotControls>
