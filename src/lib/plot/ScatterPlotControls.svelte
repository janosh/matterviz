<script lang="ts">
  import { SettingsSection } from '$lib/layout'
  import { PlotControls } from '$lib/plot'
  import type {
    DataSeries,
    PlotConfig,
    PlotControlsProps,
    StyleOverrides,
  } from '$lib/plot/types'
  import { DEFAULTS } from '$lib/settings'
  import type { Snippet } from 'svelte'
  import { tooltip } from 'svelte-multiselect/attachments'

  // Unique ID prefix to avoid conflicts when multiple instances on same page
  const uid = crypto.randomUUID().slice(0, 8)

  let {
    series = [],
    x_axis = $bindable({}),
    x2_axis = $bindable({}),
    y_axis = $bindable({}),
    y2_axis = $bindable({}),
    display = $bindable({}),
    styles = $bindable({}),
    selected_series_idx = $bindable(0),
    on_touch,
    children,
    ...rest
  }: Omit<PlotControlsProps, `children` | `post_children`> & {
    series?: readonly DataSeries[]
    styles?: StyleOverrides
    selected_series_idx?: number
    on_touch?: (key: string) => void
    children?: Snippet<
      [{ styles: StyleOverrides; selected_series_idx: number } & Required<PlotConfig>]
    >
  } = $props()

  let non_null_series = $derived(series.filter((srs) => srs != null))
  let visible_series = $derived(
    non_null_series.filter((srs) => (srs.visible ?? true)),
  )
  let has_multiple_series = $derived(non_null_series.length > 1)

  // Derive what marker types are present, and whether color/size are data-driven
  const markers_include = (mode: string) =>
    visible_series.some((srs) => (srs?.markers ?? `line+points`).includes(mode))
  let has_any_lines = $derived(markers_include(`line`))
  let has_any_points = $derived(markers_include(`points`))
  let has_color_data = $derived(
    visible_series.some((srs) => srs?.color_values?.some((val) => val != null)),
  )
  let has_size_data = $derived(
    visible_series.some((srs) => srs?.size_values?.some((val) => val != null)),
  )

  $effect(() => { // Initialize show_points/show_lines from defaults
    styles.show_points ??= DEFAULTS.scatter.show_points
    styles.show_lines ??= DEFAULTS.scatter.show_lines
  })

  const touch = ({ target }: Event) => {
    const key = (target as Element)?.closest(`[data-key]`)?.getAttribute(`data-key`)
    if (key) on_touch?.(key)
  }
</script>

<PlotControls
  bind:x_axis
  bind:x2_axis
  bind:y_axis
  bind:y2_axis
  bind:display
  show_controls
  {...rest}
>
  {@render children?.({
      x_axis,
      x2_axis,
      y_axis,
      y2_axis,
      display,
      styles,
      selected_series_idx,
    })}
  {#if has_any_points || has_any_lines}
    <SettingsSection
      title="Markers"
      current_values={{ show_points: styles.show_points, show_lines: styles.show_lines }}
      on_reset={() => {
        styles.show_points = DEFAULTS.scatter.show_points
        styles.show_lines = DEFAULTS.scatter.show_lines
      }}
      style="display: flex; flex-wrap: wrap; gap: 1ex"
    >
      {#if has_any_points}
        <label
          {@attach tooltip({ content: `Toggle visibility of data points in the scatter plot` })}
        >
          <input type="checkbox" bind:checked={styles.show_points} /> Show points
        </label>
      {/if}
      {#if has_any_lines}
        <label
          {@attach tooltip({
            content: `Toggle visibility of connecting lines between data points`,
          })}
        >
          <input type="checkbox" bind:checked={styles.show_lines} /> Show lines
        </label>
      {/if}
    </SettingsSection>
  {/if}

  {#snippet post_children()}
    <!-- Series Selection (for multi-series style controls) -->
    {#if has_multiple_series}
      <div class="pane-row">
        <label for="{uid}-series">Series</label>
        <select bind:value={selected_series_idx} id="{uid}-series">
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

    <!-- Point Style Controls: only when points exist and are visible -->
    {#if has_any_points && styles.show_points}
      <SettingsSection
        title="Point Style"
        current_values={styles.point ?? {}}
        on_reset={() => {
          styles.point = { ...DEFAULTS.scatter.point }
          Object.keys(DEFAULTS.scatter.point).forEach((key) => on_touch?.(`point.${key}`))
        }}
        oninput={touch}
      >
        {#if styles.point}
          {#if !has_size_data}
            <div class="pane-row" data-key="point.size">
              <label for="{uid}-point-size">Size:</label>
              <input
                id="{uid}-point-size"
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
          {/if}
          {#if !has_color_data}
            <div class="pane-row" data-key="point.color">
              <label for="{uid}-point-color">Color:</label>
              <input
                id="{uid}-point-color"
                type="color"
                bind:value={styles.point.color}
              />
            </div>
          {/if}
          <div class="pane-row" data-key="point.opacity">
            <label for="{uid}-point-opacity">Opacity:</label>
            <input
              id="{uid}-point-opacity"
              type="range"
              min="0"
              max="1"
              step="0.05"
              bind:value={styles.point.opacity}
            />
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              bind:value={styles.point.opacity}
            />
          </div>
          <div class="pane-row" data-key="point.stroke_width">
            <label for="{uid}-point-stroke-width">Stroke Width:</label>
            <input
              id="{uid}-point-stroke-width"
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
          <div class="pane-row" data-key="point.stroke_color">
            <label for="{uid}-point-stroke-color">Stroke Color:</label>
            <input
              id="{uid}-point-stroke-color"
              type="color"
              bind:value={styles.point.stroke_color}
            />
          </div>
          <div class="pane-row" data-key="point.stroke_opacity">
            <label for="{uid}-point-stroke-opacity">Stroke Opacity:</label>
            <input
              id="{uid}-point-stroke-opacity"
              type="range"
              min="0"
              max="1"
              step="0.05"
              bind:value={styles.point.stroke_opacity}
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

    <!-- Line Style Controls: only when lines exist and are visible -->
    {#if has_any_lines && styles.show_lines}
      <SettingsSection
        title="Line Style"
        current_values={styles.line ?? {}}
        on_reset={() => {
          styles.line = { ...DEFAULTS.scatter.line }
          Object.keys(DEFAULTS.scatter.line).forEach((key) => on_touch?.(`line.${key}`))
        }}
        oninput={touch}
      >
        {#if styles.line}
          <div class="pane-row" data-key="line.width">
            <label for="{uid}-line-width">Width:</label>
            <input
              id="{uid}-line-width"
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
          {#if !has_color_data}
            <div class="pane-row" data-key="line.color">
              <label for="{uid}-line-color">Color:</label>
              <input id="{uid}-line-color" type="color" bind:value={styles.line.color} />
            </div>
          {/if}
          <div class="pane-row" data-key="line.opacity">
            <label for="{uid}-line-opacity">Opacity:</label>
            <input
              id="{uid}-line-opacity"
              type="range"
              min="0"
              max="1"
              step="0.05"
              bind:value={styles.line.opacity}
            />
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              bind:value={styles.line.opacity}
            />
          </div>
          <div class="pane-row" data-key="line.dash">
            <label for="{uid}-line-style">Style:</label>
            <select id="{uid}-line-style" bind:value={styles.line.dash}>
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
