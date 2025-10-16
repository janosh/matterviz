<script lang="ts">
  import { SettingsSection } from '$lib'
  import type { AxisConfig, ControlsConfig } from '$lib/plot'
  import { PlotControls } from '$lib/plot'
  import type {
    DataSeries,
    DisplayConfig,
    PlotControlsProps,
    StyleOverrides,
  } from '$lib/plot/types'
  import { DEFAULTS } from '$lib/settings'
  import { tooltip } from 'svelte-multiselect/attachments'

  let {
    series = [],
    x_axis = $bindable({}),
    y_axis = $bindable({}),
    y2_axis = $bindable({}),
    display = $bindable({}),
    styles = $bindable({}),
    controls = $bindable({}),
    selected_series_idx = $bindable(0),
    ...rest
  }: Omit<PlotControlsProps, `children` | `post_children`> & {
    series?: readonly DataSeries[]
    x_axis?: AxisConfig
    y_axis?: AxisConfig
    y2_axis?: AxisConfig
    display?: DisplayConfig
    styles?: StyleOverrides
    controls?: ControlsConfig
    selected_series_idx?: number
  } = $props()

  // Derived state
  let has_multiple_series = $derived(series.filter(Boolean).length > 1)

  // Initialize show_points/show_lines from defaults
  $effect(() => {
    styles.show_points ??= DEFAULTS.scatter.show_points
    styles.show_lines ??= DEFAULTS.scatter.show_lines
  })
</script>

<PlotControls bind:x_axis bind:y_axis bind:y2_axis bind:display {...rest}>
  <!-- Add show_points and show_lines checkboxes to Display section by extending it -->
  <!-- This is done via the Display section in PlotControls, but we need custom controls -->
  <!-- For now, we'll add a separate section for markers -->
  <SettingsSection
    title="Markers"
    current_values={{ show_points: styles.show_points, show_lines: styles.show_lines }}
    on_reset={() => {
      styles.show_points = DEFAULTS.scatter.show_points
      styles.show_lines = DEFAULTS.scatter.show_lines
    }}
    style="display: flex; flex-wrap: wrap; gap: 1ex"
  >
    <label
      {@attach tooltip({ content: `Toggle visibility of data points in the scatter plot` })}
    >
      <input type="checkbox" bind:checked={styles.show_points} /> Show points
    </label>
    <label
      {@attach tooltip({
        content: `Toggle visibility of connecting lines between data points`,
      })}
    >
      <input type="checkbox" bind:checked={styles.show_lines} /> Show lines
    </label>
  </SettingsSection>

  {#snippet post_children()}
    <!-- Series Selection (for multi-series style controls) -->
    {#if has_multiple_series}
      <div class="pane-row">
        <label for="series-select">Series</label>
        <select bind:value={selected_series_idx} id="series-select">
          {#each series as srs, idx (idx)}
            {#if srs}
              <option value={idx}>
                {srs.label ?? `Series ${idx + 1}`}
              </option>
            {/if}
          {/each}
        </select>
      </div>
    {/if}

    <!-- Point Style Controls -->
    {#if styles.show_points}
      <SettingsSection
        title="Point Style"
        current_values={styles.point ?? {}}
        on_reset={() => {
          styles.point = { ...DEFAULTS.scatter.point }
        }}
      >
        {#if styles.point}
          <div class="pane-row">
            <label for="point-size-range">Size:</label>
            <input
              id="point-size-range"
              type="range"
              min="1"
              max="20"
              step="0.5"
              bind:value={styles.point.size}
            />
            <input
              type="number"
              min="1"
              max="20"
              step="0.5"
              bind:value={styles.point.size}
            />
          </div>
          <div class="pane-row">
            <label for="point-color">Color:</label>
            <input id="point-color" type="color" bind:value={styles.point.color} />
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              bind:value={styles.point.opacity}
              title="Color opacity"
            />
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              bind:value={styles.point.opacity}
            />
          </div>
          <div class="pane-row">
            <label for="point-stroke-width-range">Stroke Width:</label>
            <input
              id="point-stroke-width-range"
              type="range"
              min="0"
              max="5"
              step="0.1"
              bind:value={styles.point.stroke_width}
            />
            <input
              type="number"
              min="0"
              max="5"
              step="0.1"
              bind:value={styles.point.stroke_width}
            />
          </div>
          <div class="pane-row">
            <label for="point-stroke-color">Stroke Color:</label>
            <input
              id="point-stroke-color"
              type="color"
              bind:value={styles.point.stroke_color}
            />
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              bind:value={styles.point.stroke_opacity}
              title="Stroke opacity"
            />
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              bind:value={styles.point.stroke_opacity}
            />
          </div>
        {/if}
      </SettingsSection>
    {/if}

    <!-- Line Style Controls -->
    {#if styles.show_lines}
      <SettingsSection
        title="Line Style"
        current_values={styles.line ?? {}}
        on_reset={() => {
          styles.line = { ...DEFAULTS.scatter.line }
        }}
      >
        {#if styles.line}
          <div class="pane-row">
            <label for="line-width-range">Line Width:</label>
            <input
              id="line-width-range"
              type="range"
              min="0.5"
              max="10"
              step="0.5"
              bind:value={styles.line.width}
            />
            <input
              type="number"
              min="0.5"
              max="10"
              step="0.5"
              bind:value={styles.line.width}
            />
          </div>
          <div class="pane-row">
            <label for="line-color">Line Color:</label>
            <input id="line-color" type="color" bind:value={styles.line.color} />
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              bind:value={styles.line.opacity}
              title="Line opacity"
            />
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              bind:value={styles.line.opacity}
            />
          </div>
          <div class="pane-row">
            <label for="line-style-select">Line Style:</label>
            <select id="line-style-select" bind:value={styles.line.dash}>
              <option value="solid">Solid</option>
              <option value="4,4">Dashed</option>
              <option value="2,2">Dotted</option>
              <option value="8,4,2,4">Dash-dot</option>
            </select>
          </div>
        {/if}
      </SettingsSection>
    {/if}
  {/snippet}
</PlotControls>
