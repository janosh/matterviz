<script lang="ts">
  import { SettingsSection } from '$lib'
  import type { BarMode, PlotConfig } from '$lib/plot'
  import { PlotControls } from '$lib/plot'
  import type { Orientation, PlotControlsProps } from '$lib/plot/types'
  import type { Snippet } from 'svelte'

  let {
    orientation = $bindable(`vertical`),
    mode = $bindable(`overlay`),
    x_axis = {},
    y_axis = {},
    y2_axis = {},
    display = $bindable({}),
    show_controls = $bindable(false),
    controls_open = $bindable(false),
    children,
    ...rest
  }: Omit<PlotControlsProps, `children` | `post_children`> & PlotConfig & {
    orientation?: Orientation
    mode?: BarMode
    show_controls?: boolean
    controls_open?: boolean
    children?: Snippet<
      [{ orientation: Orientation; mode: BarMode } & Required<PlotConfig>]
    >
  } = $props()
</script>

<PlotControls
  bind:show_controls
  bind:controls_open
  {x_axis}
  {y_axis}
  {y2_axis}
  bind:display
  {...rest}
>
  {@render children?.({ orientation, mode, x_axis, y_axis, y2_axis, display })}
  <SettingsSection
    title="Layout"
    current_values={{ orientation, mode }}
    style="display: flex; gap: 2ex"
  >
    <label style="flex: 1">
      Orientation:
      <select bind:value={orientation} id="orientation-select">
        <option value="vertical">Vertical</option>
        <option value="horizontal">Horizontal</option>
      </select>
    </label>
    <label style="flex: 1">
      Mode:
      <select bind:value={mode} id="mode-select">
        <option value="overlay">Overlay</option>
        <option value="stacked">Stacked</option>
        <option value="grouped">Grouped (Side-by-Side)</option>
      </select>
    </label>
  </SettingsSection>
</PlotControls>
