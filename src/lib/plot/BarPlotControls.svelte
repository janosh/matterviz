<script lang="ts">
  import { SettingsSection } from '$lib'
  import type { BarMode, Orientation, PlotControlsProps } from '$lib/plot'
  import { PlotControls } from '$lib/plot'

  interface Props extends Omit<PlotControlsProps, `children` | `post_children`> {
    orientation?: Orientation
    mode?: BarMode
  }
  let {
    show_controls = $bindable(false),
    controls_open = $bindable(false),
    orientation = $bindable(`vertical` as Orientation),
    mode = $bindable(`overlay` as BarMode),
    show_x_zero_line = $bindable(false),
    show_y_zero_line = $bindable(false),
    show_x_grid = $bindable(true),
    show_y_grid = $bindable(true),
    x_ticks = $bindable(8),
    y_ticks = $bindable(6),
    x_format = $bindable(``),
    y_format = $bindable(``),
    x_range = $bindable<[number | null, number | null] | undefined>(undefined),
    y_range = $bindable<[number | null, number | null] | undefined>(undefined),
    auto_x_range = [0, 1] as [number, number],
    auto_y_range = [0, 1] as [number, number],
    toggle_props = {},
    pane_props = {},
  }: Props = $props()
</script>

<PlotControls
  bind:show_controls
  bind:controls_open
  bind:show_x_zero_line
  bind:show_y_zero_line
  bind:show_x_grid
  bind:show_y_grid
  bind:x_range
  bind:y_range
  bind:x_ticks
  bind:y_ticks
  bind:x_format
  bind:y_format
  {auto_x_range}
  {auto_y_range}
  show_ticks={true}
  controls_title="bar plot"
  controls_class="bar"
  {toggle_props}
  {pane_props}
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
