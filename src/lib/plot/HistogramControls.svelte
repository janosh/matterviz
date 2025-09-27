<script lang="ts">
  import { DraggablePane, SettingsSection } from '$lib'
  import type { DataSeries } from '$lib/plot'
  import { DEFAULTS } from '$lib/settings'
  import { format } from 'd3-format'
  import { timeFormat } from 'd3-time-format'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { TicksOption } from './scales'

  interface Props {
    // Control pane visibility
    show_controls?: boolean
    controls_open?: boolean
    // Custom content for the control pane
    plot_controls?: Snippet<[]>
    // Series data for multi-series controls
    series?: readonly DataSeries[]
    // Histogram-specific controls
    bins?: number
    mode?: `single` | `overlay`
    bar_opacity?: number
    bar_stroke_width?: number
    show_legend?: boolean
    // Display controls
    show_zero_lines?: boolean
    x_grid?: boolean | Record<string, unknown>
    y_grid?: boolean | Record<string, unknown>
    // Scale type controls
    x_scale_type?: `linear` | `log`
    y_scale_type?: `linear` | `log`
    // Range controls
    x_range?: [number, number]
    y_range?: [number, number]
    auto_x_range?: [number, number]
    auto_y_range?: [number, number]
    // Tick controls
    x_ticks?: TicksOption
    y_ticks?: TicksOption
    // Format controls
    x_format?: string
    y_format?: string
    // Selected property for single mode
    selected_property?: string
    toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
    pane_props?: ComponentProps<typeof DraggablePane>[`pane_props`]
  }
  let {
    show_controls = $bindable(false),
    controls_open = $bindable(false),
    plot_controls,
    series = [],
    bins = $bindable(DEFAULTS.trajectory.histogram_bin_count),
    mode = $bindable(DEFAULTS.trajectory.histogram_mode),
    bar_opacity = $bindable(DEFAULTS.trajectory.histogram_bar_opacity),
    bar_stroke_width = $bindable(DEFAULTS.trajectory.histogram_bar_stroke_width),
    show_legend = $bindable(DEFAULTS.trajectory.histogram_show_legend),
    // Display controls
    show_zero_lines = $bindable(DEFAULTS.plot.show_zero_lines),
    x_grid = $bindable(DEFAULTS.plot.x_grid),
    y_grid = $bindable(DEFAULTS.plot.y_grid),
    // Scale type controls
    x_scale_type = $bindable(
      DEFAULTS.plot.x_scale_type as `linear` | `log`,
    ),
    y_scale_type = $bindable(
      DEFAULTS.plot.y_scale_type as `linear` | `log`,
    ),
    // Range controls
    x_range = $bindable(undefined),
    y_range = $bindable(undefined),
    auto_x_range = [0, 1],
    auto_y_range = [0, 1],
    // Tick controls
    x_ticks = $bindable(DEFAULTS.plot.x_ticks),
    y_ticks = $bindable(DEFAULTS.plot.y_ticks),
    // Format controls
    x_format = $bindable(DEFAULTS.plot.x_format),
    y_format = $bindable(DEFAULTS.plot.y_format),
    selected_property = $bindable(``),
    toggle_props,
    pane_props,
  }: Props = $props()

  // Local variables for format inputs to prevent invalid values from reaching props
  let x_format_input = $state(x_format)
  let y_format_input = $state(y_format)

  // Derived state
  let has_multiple_series = $derived(series.filter(Boolean).length > 1)
  let visible_series = $derived(series.filter((s) => s && (s.visible ?? true)))
  let series_options = $derived(visible_series.map((s) => s.label || `Series`))

  // Validation function for format specifiers
  function is_valid_format(format_string: string): boolean {
    if (!format_string) return true // Empty string is valid (uses default formatting)

    try {
      if (format_string.startsWith(`%`)) { // Time format validation
        timeFormat(format_string)(new Date())
        return true
      } else { // Number format validation
        format(format_string)(123.456)
        return true
      }
    } catch {
      return false
    }
  }

  // Handle format input changes - only update prop if valid
  const format_input_handler = (format_type: `x` | `y`) => (event: Event) => {
    const input = event.target as HTMLInputElement

    // Update local variable
    if (format_type === `x`) x_format_input = input.value
    else if (format_type === `y`) y_format_input = input.value

    // Only update prop if valid
    if (is_valid_format(input.value)) {
      input.classList.remove(`invalid`)
      if (format_type === `x`) x_format = input.value
      else if (format_type === `y`) y_format = input.value
    } else input.classList.add(`invalid`)
  }

  // Handle ticks input changes
  const ticks_input_handler = (axis: `x` | `y`) => (event: Event) => {
    const input = event.target as HTMLInputElement
    const value = parseInt(input.value, 10)

    if (!isNaN(value) && value > 0) {
      if (axis === `x`) x_ticks = value
      else if (axis === `y`) y_ticks = value
    }
  }

  // Range control helpers
  const range_complete = (axis: `x` | `y`) => {
    const [min_el, max_el] = [`min`, `max`].map((b) =>
      document.getElementById(`${axis}-range-${b}`) as HTMLInputElement
    )
    if (!min_el || !max_el) return

    const [min, max] = [min_el, max_el].map(
      (el) => (el.classList.remove(`invalid`), el.value === `` ? null : +el.value),
    )
    const auto = { x: auto_x_range, y: auto_y_range }[axis]

    if (min !== null && max !== null && min >= max) {
      ;[min_el, max_el].forEach((el) => el.classList.add(`invalid`))
      return
    }

    const ranges = {
      x: (r: typeof x_range) => x_range = r,
      y: (r: typeof y_range) => y_range = r,
    }
    ranges[axis](
      min === null && max === null ? undefined : [min ?? auto[0], max ?? auto[1]],
    )
  }

  const input_props = (
    axis: `x` | `y`,
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

  // Sync local format inputs with props
  $effect(() => {
    x_format_input = x_format
    y_format_input = y_format
  })

  // Update range inputs when ranges change
  $effect(() =>
    [[x_range, `x`], [y_range, `y`]].forEach(([range, axis]) => {
      if (!range) {
        ;[`min`, `max`].forEach((b) => {
          const el = document.getElementById(`${axis}-range-${b}`) as HTMLInputElement
          if (el) el.value = ``
        })
      }
    })
  )
</script>

{#if show_controls}
  {@const toggle_style =
    `position: absolute; top: var(--ctrl-btn-top, 1ex); right: var(--ctrl-btn-right, 1ex); background-color: transparent;`}
  <DraggablePane
    bind:show={controls_open}
    closed_icon="Settings"
    open_icon="Cross"
    toggle_props={{
      title: `${controls_open ? `Close` : `Open`} histogram controls`,
      ...toggle_props,
      class: `histogram-controls-toggle ${toggle_props?.class ?? ``}`,
      style: `${toggle_style} ${toggle_props?.style ?? ``}`,
    }}
    pane_props={{
      ...pane_props,
      class: `histogram-controls-pane ${pane_props?.class ?? ``}`,
    }}
  >
    {#if plot_controls}
      {@render plot_controls()}
    {:else}
      <SettingsSection
        title="Display"
        current_values={{ show_zero_lines, x_grid, y_grid }}
        on_reset={() => {
          show_zero_lines = DEFAULTS.plot.show_zero_lines
          x_grid = DEFAULTS.plot.x_grid
          y_grid = DEFAULTS.plot.y_grid
        }}
        style="display: flex; flex-wrap: wrap; gap: 1ex"
      >
        <label>
          <input type="checkbox" bind:checked={show_zero_lines} />
          Show zero lines
        </label>
        <label>
          <input type="checkbox" bind:checked={x_grid as boolean} />
          X-axis grid
        </label>
        <label>
          <input type="checkbox" bind:checked={y_grid as boolean} />
          Y-axis grid
        </label>
      </SettingsSection>

      <hr />
      <SettingsSection
        title="Axis Range"
        current_values={{ x_range, y_range }}
        on_reset={() => {
          x_range = undefined
          y_range = undefined
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
      </SettingsSection>

      <hr />
      <SettingsSection
        title="Histogram"
        current_values={{ bins, mode, show_legend }}
        on_reset={() => {
          bins = DEFAULTS.trajectory.histogram_bin_count
          mode = DEFAULTS.trajectory.histogram_mode
          show_legend = DEFAULTS.trajectory.histogram_show_legend
        }}
      >
        <div class="pane-row">
          <label for="bins-input">Bins:</label>
          <input
            id="bins-input"
            type="range"
            min="5"
            max="100"
            step="5"
            bind:value={bins}
          />
          <input
            type="number"
            min="5"
            max="100"
            step="5"
            bind:value={bins}
          />
        </div>
        {#if has_multiple_series}
          <div class="pane-row">
            <label for="mode-select">Mode:</label>
            <select bind:value={mode} id="mode-select">
              <option value="single">Single</option>
              <option value="overlay">Overlay</option>
            </select>
          </div>
          {#if mode === `single`}
            <div class="pane-row">
              <label for="property-select">Property:</label>
              <select bind:value={selected_property} id="property-select">
                <option value="">All</option>
                {#each series_options as option (option)}
                  <option value={option}>{option}</option>
                {/each}
              </select>
            </div>
          {/if}
        {/if}
        <label>
          <input type="checkbox" bind:checked={show_legend} />
          Show legend
        </label>
      </SettingsSection>

      <hr />
      <SettingsSection
        title="Bar Style"
        current_values={{ bar_opacity, bar_stroke_width }}
        on_reset={() => {
          bar_opacity = DEFAULTS.trajectory.histogram_bar_opacity
          bar_stroke_width = DEFAULTS.trajectory.histogram_bar_stroke_width
        }}
        class="pane-grid"
        style="grid-template-columns: auto 1fr auto"
      >
        <label for="bar-opacity-range">Opacity:</label>
        <input
          id="bar-opacity-range"
          type="range"
          min="0"
          max="1"
          step="0.05"
          bind:value={bar_opacity}
        />
        <input
          type="number"
          min="0"
          max="1"
          step="0.05"
          bind:value={bar_opacity}
        />
        <label for="bar-stroke-width-range">Stroke Width:</label>
        <input
          id="bar-stroke-width-range"
          type="range"
          min="0"
          max="5"
          step="0.1"
          bind:value={bar_stroke_width}
        />
        <input
          type="number"
          min="0"
          max="5"
          step="0.1"
          bind:value={bar_stroke_width}
        />
      </SettingsSection>

      <hr />
      <SettingsSection
        title="Scale Type"
        current_values={{ x_scale_type, y_scale_type }}
        on_reset={() => {
          x_scale_type = DEFAULTS.plot.x_scale_type as `linear` | `log`
          y_scale_type = DEFAULTS.plot.y_scale_type as `linear` | `log`
        }}
        class="pane-grid"
        style="grid-template-columns: auto 1fr"
      >
        <label for="x-scale-select">X-axis:</label>
        <select bind:value={x_scale_type} id="x-scale-select">
          <option value="linear">Linear</option>
          <option value="log">Log</option>
        </select>
        <label for="y-scale-select">Y-axis:</label>
        <select bind:value={y_scale_type} id="y-scale-select">
          <option value="linear">Linear</option>
          <option value="log">Log</option>
        </select>
      </SettingsSection>

      <hr />
      <SettingsSection
        title="Ticks"
        current_values={{ x_ticks, y_ticks }}
        on_reset={() => {
          x_ticks = DEFAULTS.plot.x_ticks
          y_ticks = DEFAULTS.plot.y_ticks
        }}
        class="pane-grid"
        style="grid-template-columns: auto 1fr"
      >
        <label for="x-ticks-input">X-axis:</label>
        <input
          id="x-ticks-input"
          type="number"
          min="2"
          max="20"
          step="1"
          value={typeof x_ticks === `number` ? x_ticks : 8}
          oninput={ticks_input_handler(`x`)}
        />
        <label for="y-ticks-input">Y-axis:</label>
        <input
          id="y-ticks-input"
          type="number"
          min="2"
          max="20"
          step="1"
          value={typeof y_ticks === `number` ? y_ticks : 6}
          oninput={ticks_input_handler(`y`)}
        />
      </SettingsSection>

      <hr />
      <SettingsSection
        title="Tick Format"
        current_values={{ x_format, y_format }}
        on_reset={() => {
          x_format = DEFAULTS.plot.x_format
          y_format = DEFAULTS.plot.y_format
        }}
        class="pane-grid"
        style="grid-template-columns: auto 1fr"
      >
        <label for="x-format">X-axis:</label>
        <input
          id="x-format"
          type="text"
          bind:value={x_format_input}
          placeholder=".2~s / .0% / %Y-%m-%d"
          oninput={format_input_handler(`x`)}
        />
        <label for="y-format">Y-axis:</label>
        <input
          id="y-format"
          type="text"
          bind:value={y_format_input}
          placeholder="d / .1e / .0%"
          oninput={format_input_handler(`y`)}
        />
      </SettingsSection>
    {/if}
  </DraggablePane>
{/if}
