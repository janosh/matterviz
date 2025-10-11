<script lang="ts">
  import { SettingsSection } from '$lib'
  import type { BarMode, Orientation, PlotControlsProps } from '$lib/plot'
  import { PlotControls } from '$lib/plot'

  interface Props extends Omit<PlotControlsProps, `children` | `post_children`> {
    orientation?: Orientation
    mode?: BarMode
  }
  let {
    orientation = $bindable(`vertical` as Orientation),
    mode = $bindable(`overlay` as BarMode),
    ...rest
  }: Props = $props()
</script>

<PlotControls {...rest}>
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
