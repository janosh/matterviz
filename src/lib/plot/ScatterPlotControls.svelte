<script lang="ts">
  import { DraggablePane, SettingsSection } from '$lib'
  import type { DataSeries } from '$lib/plot'
  import { DEFAULTS, SETTINGS_CONFIG } from '$lib/settings'
  import { format } from 'd3-format'
  import { timeFormat } from 'd3-time-format'
  import type { ComponentProps, Snippet } from 'svelte'
  import { tooltip } from 'svelte-multiselect/attachments'

  interface Props {
    show_controls?: boolean
    controls_open?: boolean
    // Custom content for the control pane
    plot_controls?: Snippet<[]>
    // Series data for multi-series controls
    series?: readonly DataSeries[]
    // Display options
    markers?: `line` | `points` | `line+points`
    show_zero_lines?: boolean
    x_grid?: boolean | Record<string, unknown>
    y_grid?: boolean | Record<string, unknown>
    y2_grid?: boolean | Record<string, unknown>
    // Whether there are y2 points to show y2 grid control
    has_y2_points?: boolean
    // Range controls
    x_range?: [number, number]
    y_range?: [number, number]
    y2_range?: [number, number]
    // Auto-detected ranges for fallback when only one value is set
    auto_x_range?: [number, number]
    auto_y_range?: [number, number]
    auto_y2_range?: [number, number]
    // Format controls
    x_format?: string
    y_format?: string
    y2_format?: string
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
    toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
    pane_props?: ComponentProps<typeof DraggablePane>[`pane_props`]
  }
  let {
    show_controls = $bindable(false),
    controls_open = $bindable(false),
    plot_controls,
    series = [],
    markers = $bindable(
      DEFAULTS.trajectory.scatter_markers as `line` | `points` | `line+points`,
    ),
    show_zero_lines = $bindable(DEFAULTS.trajectory.plot_show_zero_lines),
    x_grid = $bindable(DEFAULTS.trajectory.plot_x_grid),
    y_grid = $bindable(DEFAULTS.trajectory.plot_y_grid),
    y2_grid = $bindable(DEFAULTS.trajectory.plot_y2_grid),
    has_y2_points = false,
    // Range controls
    x_range = $bindable(undefined),
    y_range = $bindable(undefined),
    y2_range = $bindable(undefined),
    // Auto-detected ranges for fallback when only one value is set
    auto_x_range = [0, 1],
    auto_y_range = [0, 1],
    auto_y2_range = [0, 1],
    // Format controls
    x_format = $bindable(DEFAULTS.trajectory.plot_x_format),
    y_format = $bindable(DEFAULTS.trajectory.plot_y_format),
    y2_format = $bindable(DEFAULTS.trajectory.plot_y2_format),
    // Style controls
    point_size = $bindable(DEFAULTS.trajectory.scatter_point_size),
    point_color = $bindable(DEFAULTS.trajectory.scatter_point_color),
    point_opacity = $bindable(DEFAULTS.trajectory.scatter_point_opacity),
    point_stroke_width = $bindable(DEFAULTS.trajectory.scatter_point_stroke_width),
    point_stroke_color = $bindable(DEFAULTS.trajectory.scatter_point_stroke_color),
    point_stroke_opacity = $bindable(
      DEFAULTS.trajectory.scatter_point_stroke_opacity,
    ),
    line_width = $bindable(DEFAULTS.trajectory.scatter_line_width),
    line_color = $bindable(DEFAULTS.trajectory.scatter_line_color),
    line_opacity = $bindable(DEFAULTS.trajectory.scatter_line_opacity),
    line_dash = $bindable(DEFAULTS.trajectory.scatter_line_dash),
    show_points = $bindable(DEFAULTS.trajectory.scatter_show_points),
    show_lines = $bindable(DEFAULTS.trajectory.scatter_show_lines),
    selected_series_idx = $bindable(0),
    toggle_props = {},
    pane_props = {},
  }: Props = $props()

  // Derived state
  let has_multiple_series = $derived(series.filter(Boolean).length > 1)

  // Generic helpers to eliminate ALL repetition
  const validate_format = (str: string) => {
    if (!str) return true
    try {
      return str.startsWith(`%`)
        ? timeFormat(str)(new Date()) || true
        : format(str)(123.456) || true
    } catch {
      return false
    }
  }

  const format_input_handler = (type: `x` | `y` | `y2`) => (event: Event) => {
    const input = event.target as HTMLInputElement

    // Update local state
    if (type === `x`) x_format_input = input.value
    else if (type === `y`) y_format_input = input.value
    else y2_format_input = input.value

    // Validate and update prop
    const is_valid = validate_format(input.value)
    input.classList.toggle(`invalid`, !is_valid)
    if (is_valid) {
      if (type === `x`) x_format = input.value
      else if (type === `y`) y_format = input.value
      else y2_format = input.value
    }
  }

  const range_complete = (axis: `x` | `y` | `y2`) => {
    const [min_el, max_el] = [`min`, `max`].map((b) =>
      document.getElementById(`${axis}-range-${b}`) as HTMLInputElement
    )
    if (!min_el || !max_el) return

    const [min, max] = [min_el, max_el].map(
      (el) => (el.classList.remove(`invalid`), el.value === `` ? null : +el.value),
    )
    const auto = { x: auto_x_range, y: auto_y_range, y2: auto_y2_range }[axis]

    if (min !== null && max !== null && min >= max) {
      ;[min_el, max_el].forEach((el) => el.classList.add(`invalid`))
      return
    }

    const ranges = {
      x: (r: typeof x_range) => x_range = r,
      y: (r: typeof y_range) => y_range = r,
      y2: (r: typeof y2_range) => y2_range = r,
    }
    ranges[axis](
      min === null && max === null ? undefined : [min ?? auto[0], max ?? auto[1]],
    )
  }

  const input_props = (
    axis: `x` | `y` | `y2`,
    bound: `min` | `max`,
    range?: [number, number],
  ) => ({
    id: `${axis}-range-${bound}`,
    type: `number`,
    value: range?.[bound === `min` ? 0 : 1] ?? ``,
    placeholder: `auto`,
    class: `range-input`,
    onblur: () => range_complete(axis),
    onkeydown: (e: KeyboardEvent) =>
      e.key === `Enter` && (e.target as HTMLElement).blur(),
  })

  // Ultra-minimal effects
  $effect(() =>
    [[x_range, `x`], [y_range, `y`], [y2_range, `y2`]].forEach(([range, axis]) => {
      if (!range) {
        ;[`min`, `max`].forEach((b) => {
          const el = document.getElementById(`${axis}-range-${b}`) as HTMLInputElement
          if (el) el.value = ``
        })
      }
    })
  )

  $effect(() => {
    show_points = markers?.includes(`points`) ?? false
    show_lines = markers?.includes(`line`) ?? false

    if (has_multiple_series && series[selected_series_idx]) {
      const s = series[selected_series_idx]
      const ps = Array.isArray(s.point_style) ? s.point_style[0] : s.point_style
      if (ps) {
        point_size = ps.radius ?? 4
        point_color = ps.fill ?? `#4682b4`
        point_stroke_width = ps.stroke_width ?? 1
        point_stroke_color = ps.stroke ?? `#000`
        point_opacity = ps.fill_opacity ?? 1
      }
      if (s.line_style) {
        line_width = s.line_style.stroke_width ?? 2
        line_color = s.line_style.stroke ?? `#4682b4`
        line_dash = s.line_style.line_dash
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

  // Local format state
  let x_format_input = $state(x_format)
  let y_format_input = $state(y_format)
  let y2_format_input = $state(y2_format)
</script>

{#if show_controls}
  <DraggablePane
    bind:show={controls_open}
    closed_icon="Settings"
    open_icon="Cross"
    toggle_props={{
      ...toggle_props,
      class: `scatter-controls-toggle ${toggle_props?.class ?? ``}`,
      title: `${controls_open ? `Close` : `Open`} scatter plot controls`,
      style:
        `position: absolute; top: var(--ctrl-btn-top, 1ex); right: var(--ctrl-btn-right, 1ex); background-color: transparent; ${
          toggle_props?.style ?? ``
        }`,
    }}
    pane_props={{
      ...pane_props,
      class: `scatter-controls-pane ${pane_props?.class ?? ``}`,
    }}
  >
    {#if plot_controls}
      {@render plot_controls()}
    {:else}
      <SettingsSection
        title="Display"
        current_values={{ show_zero_lines, show_points, show_lines, x_grid, y_grid, y2_grid }}
        on_reset={() => {
          show_zero_lines = DEFAULTS.trajectory.plot_show_zero_lines
          show_points = DEFAULTS.trajectory.scatter_show_points
          show_lines = DEFAULTS.trajectory.scatter_show_lines
          x_grid = DEFAULTS.trajectory.plot_x_grid
          y_grid = DEFAULTS.trajectory.plot_y_grid
          y2_grid = DEFAULTS.trajectory.plot_y2_grid
        }}
        style="display: flex; flex-wrap: wrap; gap: 1ex"
      >
        <label>
          <input type="checkbox" bind:checked={show_zero_lines} /> Show zero lines
        </label>
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
        <label
          {@attach tooltip({ content: SETTINGS_CONFIG.trajectory.plot_grid_lines.description })}
        >
          <input type="checkbox" bind:checked={x_grid as boolean} /> X-axis grid
        </label>
        <label
          {@attach tooltip({ content: SETTINGS_CONFIG.trajectory.plot_grid_lines.description })}
        >
          <input type="checkbox" bind:checked={y_grid as boolean} /> Y-axis grid
        </label>
        {#if has_y2_points}
          <label>
            <input type="checkbox" bind:checked={y2_grid as boolean} /> Y2-axis grid
          </label>
        {/if}
      </SettingsSection>

      <hr />
      <SettingsSection
        title="Axis Range"
        current_values={{ x_range, y_range, y2_range }}
        on_reset={() => {
          x_range = undefined
          y_range = undefined
          y2_range = undefined
        }}
        class="pane-grid"
        style="grid-template-columns: repeat(4, max-content)"
      >
        <label for="x-range-min">X-axis:</label>
        <input {...input_props(`x`, `min`, x_range)} />
        &nbsp;to
        <input {...input_props(`x`, `max`, x_range)} />
        <label for="y-range-min">Y-axis:</label>
        <input {...input_props(`y`, `min`, y_range)} />
        &nbsp;to
        <input {...input_props(`y`, `max`, y_range)} />
        {#if has_y2_points}
          <label for="y2-range-min">Y2-axis:</label>
          <input {...input_props(`y2`, `min`, y2_range)} />
          &nbsp;to
          <input {...input_props(`y2`, `max`, y2_range)} />
        {/if}
      </SettingsSection>

      <hr />
      <SettingsSection
        title="Tick Format"
        current_values={{ x_format, y_format, y2_format }}
        on_reset={() => {
          x_format = DEFAULTS.trajectory.plot_x_format
          y_format = DEFAULTS.trajectory.plot_y_format
          y2_format = DEFAULTS.trajectory.plot_y2_format
        }}
        class="pane-grid"
        style="grid-template-columns: auto 1fr"
      >
        <label for="x-format">X-axis:</label>
        <input
          id="x-format"
          type="text"
          bind:value={x_format_input}
          placeholder=".2f / .0% / %Y-%m-%d"
          oninput={format_input_handler(`x`)}
        />
        <label for="y-format">Y-axis:</label>
        <input
          id="y-format"
          type="text"
          bind:value={y_format_input}
          placeholder=".2f / .1e / .0%"
          oninput={format_input_handler(`y`)}
        />
        {#if has_y2_points}
          <label for="y2-format">Y2-axis:</label>
          <input
            id="y2-format"
            type="text"
            bind:value={y2_format_input}
            placeholder=".2f / .1e / .0%"
            oninput={format_input_handler(`y2`)}
          />
        {/if}
      </SettingsSection>

      <!-- Series Selection (for multi-series style controls) -->
      {#if has_multiple_series}
        <div class="pane-row">
          <label for="series-select">Series</label>
          <select bind:value={selected_series_idx} id="series-select">
            {#each series.filter(Boolean) as series_data, idx (series_data.label ?? idx)}
              <option value={idx}>
                {series_data.label ?? `Series ${idx + 1}`}
              </option>
            {/each}
          </select>
        </div>
      {/if}

      <!-- Point Style Controls -->
      {#if show_points}
        <hr />
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
            point_size = DEFAULTS.trajectory.scatter_point_size
            point_color = DEFAULTS.trajectory.scatter_point_color
            point_opacity = DEFAULTS.trajectory.scatter_point_opacity
            point_stroke_width = DEFAULTS.trajectory.scatter_point_stroke_width
            point_stroke_color = DEFAULTS.trajectory.scatter_point_stroke_color
            point_stroke_opacity = DEFAULTS.trajectory.scatter_point_stroke_opacity
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
        <hr />
        <SettingsSection
          title="Line Style"
          current_values={{ line_width, line_color, line_opacity, line_dash }}
          on_reset={() => {
            line_width = DEFAULTS.trajectory.scatter_line_width
            line_color = DEFAULTS.trajectory.scatter_line_color
            line_opacity = DEFAULTS.trajectory.scatter_line_opacity
            line_dash = undefined
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
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              bind:value={line_opacity}
            />
          </div>
          <div class="pane-row">
            <label for="line-style-select">Line Style:</label>
            <select
              id="line-style-select"
              value={line_dash ?? `solid`}
              onchange={(event) => {
                const target = event.currentTarget as HTMLSelectElement
                line_dash = target.value === `solid` ? undefined : target.value
              }}
            >
              <option value="solid">Solid</option>
              <option value="4,4">Dashed</option>
              <option value="2,2">Dotted</option>
              <option value="8,4,2,4">Dash-dot</option>
            </select>
          </div>
        </SettingsSection>
      {/if}
    {/if}
  </DraggablePane>
{/if}
