<script lang="ts">
  import { SettingsSection } from '$lib/layout'
  import type { BarMode, PlotConfig } from '$lib/plot'
  import { PlotControls } from '$lib/plot'
  import type { Orientation, PlotControlsProps } from '$lib/plot/core/types'
  import { type Snippet, untrack } from 'svelte'

  let {
    orientation = $bindable(`vertical`),
    mode = $bindable(`overlay`),
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
    mode?: BarMode
    show_controls?: boolean
    controls_open?: boolean
    children?: Snippet<[{ orientation: Orientation; mode: BarMode } & Required<PlotConfig>]>
  } = $props()

  const initial_layout = untrack(() => ({ orientation, mode }))
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
  {@render children?.({ orientation, mode, x_axis, x2_axis, y_axis, y2_axis, display })}
  <SettingsSection
    title="Layout"
    current_values={{ orientation, mode }}
    on_reset={() => {
      orientation = initial_layout.orientation
      mode = initial_layout.mode
    }}
    layout="grid"
  >
    <label>
      <span>Orientation</span>
      <select bind:value={orientation}>
        <option value="vertical">Vertical</option>
        <option value="horizontal">Horizontal</option>
      </select>
    </label>
    <label>
      <span>Mode</span>
      <select bind:value={mode}>
        <option value="overlay">Overlay</option>
        <option value="stacked">Stacked</option>
        <option value="grouped">Grouped (side-by-side)</option>
      </select>
    </label>
  </SettingsSection>
</PlotControls>
