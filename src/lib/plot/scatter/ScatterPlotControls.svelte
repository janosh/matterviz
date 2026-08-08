<script lang="ts">
  import { NumberRangeInput, SettingsSection } from '$lib/layout'
  import { PlotControls } from '$lib/plot'
  import type {
    DataSeries,
    PlotConfig,
    PlotControlsProps,
    StyleOverrides,
  } from '$lib/plot/core/types'
  import { DEFAULTS } from '$lib/settings'
  import type { Snippet } from 'svelte'
  import { tooltip } from 'svelte-widgets/attachments'

  let {
    series = [],
    x_axis = $bindable({}),
    x2_axis = $bindable({}),
    y_axis = $bindable({}),
    y2_axis = $bindable({}),
    display = $bindable({}),
    styles = $bindable({}),
    selected_series_idx = $bindable(0),
    // Declared explicitly (rather than left to ...rest) so the host can bind them and
    // observe the pane being shown/opened, matching BarPlotControls
    show_controls = $bindable(true),
    controls_open = $bindable(false),
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
  let visible_series = $derived(non_null_series.filter((srs) => srs.visible ?? true))
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

  $effect(() => {
    // Initialize show_points/show_lines from defaults
    styles.show_points ??= DEFAULTS.scatter.show_points
    styles.show_lines ??= DEFAULTS.scatter.show_lines
  })

  const touch = ({ target }: Event) => {
    if (!(target instanceof Element)) return
    const key = target.closest(`[data-key]`)?.getAttribute(`data-key`)
    if (key) on_touch?.(key)
  }

  const reset_style = (kind: `point` | `line`) => () => {
    styles[kind] = { ...DEFAULTS.scatter[kind] }
    for (const key of Object.keys(DEFAULTS.scatter[kind])) on_touch?.(`${kind}.${key}`)
  }
</script>

<PlotControls
  bind:x_axis
  bind:x2_axis
  bind:y_axis
  bind:y2_axis
  bind:display
  bind:show_controls
  bind:controls_open
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
      layout="grid"
    >
      {#if has_any_points}
        <label
          {@attach tooltip({
            content: `Toggle visibility of data points in the scatter plot`,
          })}
        >
          <span>Show points</span>
          <input type="checkbox" bind:checked={styles.show_points} />
        </label>
      {/if}
      {#if has_any_lines}
        <label
          {@attach tooltip({
            content: `Toggle visibility of connecting lines between data points`,
          })}
        >
          <span>Show lines</span>
          <input type="checkbox" bind:checked={styles.show_lines} />
        </label>
      {/if}
    </SettingsSection>
  {/if}

  {#snippet post_children()}
    <!-- Series Selection (for multi-series style controls) -->
    {#if has_multiple_series}
      <SettingsSection title="Series" layout="grid">
        <label>
          <span>Series</span>
          <select bind:value={selected_series_idx}>
            {#each series as srs, idx (idx)}
              {#if srs}
                <option value={idx}>
                  {srs.label ?? `Series ${idx + 1}`}
                </option>
              {/if}
            {/each}
          </select>
        </label>
      </SettingsSection>
    {/if}

    <!-- Point Style Controls: only when points exist and are visible -->
    {#if has_any_points && styles.show_points}
      <SettingsSection
        title="Point style"
        current_values={styles.point ?? {}}
        on_reset={reset_style(`point`)}
        oninput={touch}
        layout="grid"
      >
        {#if styles.point}
          {#if !has_size_data}
            <NumberRangeInput
              data-key="point.size"
              min={1}
              max={20}
              step={0.5}
              bind:value={styles.point.size}>Size</NumberRangeInput
            >
          {/if}
          {#if !has_color_data}
            <label data-key="point.color">
              <span>Color</span>
              <input type="color" bind:value={styles.point.color} />
            </label>
          {/if}
          <NumberRangeInput
            data-key="point.opacity"
            min={0}
            max={1}
            step={0.05}
            bind:value={styles.point.opacity}>Opacity</NumberRangeInput
          >
          <NumberRangeInput
            data-key="point.stroke_width"
            min={0}
            max={5}
            step={0.1}
            bind:value={styles.point.stroke_width}>Stroke width</NumberRangeInput
          >
          <label data-key="point.stroke_color">
            <span>Stroke color</span>
            <input type="color" bind:value={styles.point.stroke_color} />
          </label>
          <NumberRangeInput
            data-key="point.stroke_opacity"
            min={0}
            max={1}
            step={0.05}
            bind:value={styles.point.stroke_opacity}>Stroke opacity</NumberRangeInput
          >
        {/if}
      </SettingsSection>
    {/if}

    <!-- Line Style Controls: only when lines exist and are visible -->
    {#if has_any_lines && styles.show_lines}
      <SettingsSection
        title="Line style"
        current_values={styles.line ?? {}}
        on_reset={reset_style(`line`)}
        oninput={touch}
        layout="grid"
      >
        {#if styles.line}
          <NumberRangeInput
            data-key="line.width"
            min={0.5}
            max={10}
            step={0.5}
            bind:value={styles.line.width}>Width</NumberRangeInput
          >
          {#if !has_color_data}
            <label data-key="line.color">
              <span>Color</span>
              <input type="color" bind:value={styles.line.color} />
            </label>
          {/if}
          <NumberRangeInput
            data-key="line.opacity"
            min={0}
            max={1}
            step={0.05}
            bind:value={styles.line.opacity}>Opacity</NumberRangeInput
          >
          <label data-key="line.dash">
            <span>Style</span>
            <select bind:value={styles.line.dash}>
              <option value="solid">Solid</option>
              <option value="4,4">Dashed</option>
              <option value="2,2">Dotted</option>
              <option value="8,4,2,4">Dash-dot</option>
            </select>
          </label>
        {/if}
      </SettingsSection>
    {/if}
  {/snippet}
</PlotControls>
