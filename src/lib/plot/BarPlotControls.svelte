<script lang="ts">
  import { SettingsSection } from '$lib'
  import type { AxisConfig, BarMode, DisplayConfig } from '$lib/plot'
  import { PlotControls } from '$lib/plot'
  import type { Orientation, PlotControlsProps } from '$lib/plot/types'

  let {
    orientation = $bindable(`vertical`),
    mode = $bindable(`overlay`),
    x_axis = {},
    y_axis = {},
    y2_axis = {},
    display = {},
    show_controls = $bindable(false),
    controls_open = $bindable(false),
    ...rest
  }: Omit<PlotControlsProps, `children` | `post_children`> & {
    orientation?: Orientation
    mode?: BarMode
    x_axis?: AxisConfig
    y_axis?: AxisConfig
    y2_axis?: AxisConfig
    display?: DisplayConfig
    show_controls?: boolean
    controls_open?: boolean
  } = $props()
</script>

<PlotControls
  bind:show_controls
  bind:controls_open
  {x_axis}
  {y_axis}
  {y2_axis}
  {display}
  {...rest}
>
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
