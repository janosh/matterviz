<script lang="ts">
  import { SettingsSection } from '$lib'
  import type { DataSeries, Markers, PlotControlsProps } from '$lib/plot'
  import { PlotControls } from '$lib/plot'
  import { DEFAULTS } from '$lib/settings'
  import { tooltip } from 'svelte-multiselect/attachments'

  interface Props extends Omit<PlotControlsProps, `children` | `post_children`> {
    series?: readonly DataSeries[]
    markers?: Markers // Display options
    // Style controls
    point_size?: number
    point_color?: string
    point_opacity?: number
    point_stroke_width?: number
    point_stroke_color?: string
    point_stroke_opacity?: number
    line_width?: number
    line_color?: string
    line_opacity?: number
    line_dash?: string
    show_points?: boolean
    show_lines?: boolean
    selected_series_idx?: number
  }
  let {
    series = [],
    markers = $bindable(DEFAULTS.scatter.markers),
    // Style controls
    point_size = $bindable(DEFAULTS.scatter.point_size),
    point_color = $bindable(DEFAULTS.scatter.point_color),
    point_opacity = $bindable(DEFAULTS.scatter.point_opacity),
    point_stroke_width = $bindable(DEFAULTS.scatter.point_stroke_width),
    point_stroke_color = $bindable(DEFAULTS.scatter.point_stroke_color),
    point_stroke_opacity = $bindable(DEFAULTS.scatter.point_stroke_opacity),
    line_width = $bindable(DEFAULTS.scatter.line_width),
    line_color = $bindable(DEFAULTS.scatter.line_color),
    line_opacity = $bindable(DEFAULTS.scatter.line_opacity),
    line_dash = $bindable(DEFAULTS.scatter.line_dash),
    show_points = $bindable(DEFAULTS.scatter.show_points),
    show_lines = $bindable(DEFAULTS.scatter.show_lines),
    selected_series_idx = $bindable(0),
    ...rest
  }: Props = $props()

  // Derived state
  let has_multiple_series = $derived(series.filter(Boolean).length > 1)

  $effect(() => {
    show_points = markers?.includes(`points`) ?? false
    show_lines = markers?.includes(`line`) ?? false

    if (has_multiple_series && series[selected_series_idx]) {
      const series_item = series[selected_series_idx]
      const ps = Array.isArray(series_item.point_style)
        ? series_item.point_style[0]
        : series_item.point_style
      if (ps) {
        point_size = ps.radius ?? 4
        point_color = ps.fill ?? `#4A9EFF`
        point_stroke_width = ps.stroke_width ?? 1
        point_stroke_color = ps.stroke ?? `#000`
        point_opacity = ps.fill_opacity ?? 1
        if (ps.stroke_opacity != null) point_stroke_opacity = ps.stroke_opacity
      }
      if (series_item.line_style) {
        line_width = series_item.line_style.stroke_width ?? 2
        line_color = series_item.line_style.stroke ?? `#4A9EFF`
        line_dash = series_item.line_style.line_dash ?? DEFAULTS.scatter.line_dash
      }
    }
  })

  $effect(() => {
    markers = show_points && show_lines
      ? `line+points`
      : show_points
      ? `points`
      : `line`
  })
</script>

<PlotControls {...rest}>
  <!-- Add show_points and show_lines checkboxes to Display section by extending it -->
  <!-- This is done via the Display section in PlotControls, but we need custom controls -->
  <!-- For now, we'll add a separate section for markers -->
  <SettingsSection
    title="Markers"
    current_values={{ show_points, show_lines }}
    on_reset={() => {
      show_points = DEFAULTS.scatter.show_points
      show_lines = DEFAULTS.scatter.show_lines
    }}
    style="display: flex; flex-wrap: wrap; gap: 1ex"
  >
    <label
      {@attach tooltip({ content: `Toggle visibility of data points in the scatter plot` })}
    >
      <input type="checkbox" bind:checked={show_points} /> Show points
    </label>
    <label
      {@attach tooltip({
        content: `Toggle visibility of connecting lines between data points`,
      })}
    >
      <input type="checkbox" bind:checked={show_lines} /> Show lines
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
    {#if show_points}
      <SettingsSection
        title="Point Style"
        current_values={{
          point_size,
          point_color,
          point_opacity,
          point_stroke_width,
          point_stroke_color,
          point_stroke_opacity,
        }}
        on_reset={() => {
          point_size = DEFAULTS.scatter.point_size
          point_color = DEFAULTS.scatter.point_color
          point_opacity = DEFAULTS.scatter.point_opacity
          point_stroke_width = DEFAULTS.scatter.point_stroke_width
          point_stroke_color = DEFAULTS.scatter.point_stroke_color
          point_stroke_opacity = DEFAULTS.scatter.point_stroke_opacity
        }}
      >
        <div class="pane-row">
          <label for="point-size-range">Size:</label>
          <input
            id="point-size-range"
            type="range"
            min="1"
            max="20"
            step="0.5"
            bind:value={point_size}
          />
          <input type="number" min="1" max="20" step="0.5" bind:value={point_size} />
        </div>
        <div class="pane-row">
          <label for="point-color">Color:</label>
          <input id="point-color" type="color" bind:value={point_color} />
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            bind:value={point_opacity}
            title="Color opacity"
          />
          <input type="number" min="0" max="1" step="0.05" bind:value={point_opacity} />
        </div>
        <div class="pane-row">
          <label for="point-stroke-width-range">Stroke Width:</label>
          <input
            id="point-stroke-width-range"
            type="range"
            min="0"
            max="5"
            step="0.1"
            bind:value={point_stroke_width}
          />
          <input
            type="number"
            min="0"
            max="5"
            step="0.1"
            bind:value={point_stroke_width}
          />
        </div>
        <div class="pane-row">
          <label for="point-stroke-color">Stroke Color:</label>
          <input id="point-stroke-color" type="color" bind:value={point_stroke_color} />
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            bind:value={point_stroke_opacity}
            title="Stroke opacity"
          />
          <input
            type="number"
            min="0"
            max="1"
            step="0.05"
            bind:value={point_stroke_opacity}
          />
        </div>
      </SettingsSection>
    {/if}

    <!-- Line Style Controls -->
    {#if show_lines}
      <SettingsSection
        title="Line Style"
        current_values={{ line_width, line_color, line_opacity, line_dash }}
        on_reset={() => {
          line_width = DEFAULTS.scatter.line_width
          line_color = DEFAULTS.scatter.line_color
          line_opacity = DEFAULTS.scatter.line_opacity
          line_dash = DEFAULTS.scatter.line_dash
        }}
      >
        <div class="pane-row">
          <label for="line-width-range">Line Width:</label>
          <input
            id="line-width-range"
            type="range"
            min="0.5"
            max="10"
            step="0.5"
            bind:value={line_width}
          />
          <input type="number" min="0.5" max="10" step="0.5" bind:value={line_width} />
        </div>
        <div class="pane-row">
          <label for="line-color">Line Color:</label>
          <input id="line-color" type="color" bind:value={line_color} />
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            bind:value={line_opacity}
            title="Line opacity"
          />
          <input type="number" min="0" max="1" step="0.05" bind:value={line_opacity} />
        </div>
        <div class="pane-row">
          <label for="line-style-select">Line Style:</label>
          <select id="line-style-select" bind:value={line_dash}>
            <option value="solid">Solid</option>
            <option value="4,4">Dashed</option>
            <option value="2,2">Dotted</option>
            <option value="8,4,2,4">Dash-dot</option>
          </select>
        </div>
      </SettingsSection>
    {/if}
  {/snippet}
</PlotControls>
