<script lang="ts">
  import { DraggablePane, SettingsSection } from '$lib'
  import { DEFAULTS } from '$lib/settings'
  import { format } from 'd3-format'
  import { timeFormat } from 'd3-time-format'
  import type { PlotControlsProps } from './index'

  let {
    show_controls = $bindable(false),
    controls_open = $bindable(false),
    children,
    post_children,
    plot_controls,
    show_x_zero_line = $bindable(false),
    show_y_zero_line = $bindable(false),
    x_grid = $bindable(DEFAULTS.plot.x_grid),
    y_grid = $bindable(DEFAULTS.plot.y_grid),
    y2_grid = $bindable(DEFAULTS.plot.y2_grid),
    has_y2_points = false,
    x_range = $bindable(undefined),
    y_range = $bindable(undefined),
    y2_range = $bindable(undefined),
    auto_x_range = [0, 1],
    auto_y_range = [0, 1],
    auto_y2_range = [0, 1],
    show_ticks = false,
    x_ticks = $bindable(DEFAULTS.plot.x_ticks),
    y_ticks = $bindable(DEFAULTS.plot.y_ticks),
    x_format = $bindable(DEFAULTS.plot.x_format),
    y_format = $bindable(DEFAULTS.plot.y_format),
    y2_format = $bindable(DEFAULTS.plot.y2_format),
    controls_title = `plot`,
    controls_class = ``,
    toggle_props = {},
    pane_props = {},
  }: PlotControlsProps = $props()

  // Local format state
  let x_format_input = $state(x_format)
  let y_format_input = $state(y_format)
  let y2_format_input = $state(y2_format)

  // Derived state
  let x_includes_zero = $derived(
    ((x_range?.[0] ?? auto_x_range[0]) <= 0) &&
      ((x_range?.[1] ?? auto_x_range[1]) >= 0),
  )
  let y_includes_zero = $derived(
    ((y_range?.[0] ?? auto_y_range[0]) <= 0) &&
      ((y_range?.[1] ?? auto_y_range[1]) >= 0),
  )

  // Validation function for format specifiers
  function is_valid_format(format_string: string): boolean {
    if (!format_string) return true

    try {
      if (format_string.startsWith(`%`)) {
        timeFormat(format_string)(new Date())
        return true
      } else {
        format(format_string)(123.456)
        return true
      }
    } catch {
      return false
    }
  }

  // Handle format input changes
  const format_input_handler = (format_type: `x` | `y` | `y2`) => (event: Event) => {
    const input = event.target as HTMLInputElement

    if (format_type === `x`) x_format_input = input.value
    else if (format_type === `y`) y_format_input = input.value
    else y2_format_input = input.value

    if (is_valid_format(input.value)) {
      input.classList.remove(`invalid`)
      if (format_type === `x`) x_format = input.value
      else if (format_type === `y`) y_format = input.value
      else y2_format = input.value
    } else {
      input.classList.add(`invalid`)
    }
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
      x: (r: typeof x_range) => (x_range = r),
      y: (r: typeof y_range) => (y_range = r),
      y2: (r: typeof y2_range) => (y2_range = r),
    }
    ranges[axis](
      min === null && max === null ? undefined : [min ?? auto[0], max ?? auto[1]],
    )
  }

  const input_props = (
    axis: `x` | `y` | `y2`,
    bound: `min` | `max`,
    range?: [number | null, number | null],
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
    y2_format_input = y2_format
  })

  // Update range inputs when ranges change
  $effect(() =>
    [
      [x_range, `x`],
      [y_range, `y`],
      [y2_range, `y2`],
    ].forEach(([range, axis]) => {
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
      title: `${controls_open ? `Close` : `Open`} ${controls_title} controls`,
      ...toggle_props,
      class: `${controls_class}-controls-toggle ${toggle_props?.class ?? ``}`,
      style: `${toggle_style} ${toggle_props?.style ?? ``}`,
    }}
    pane_props={{
      ...pane_props,
      class: `${controls_class}-controls-pane ${pane_props?.class ?? ``}`,
      style: `--pane-padding: 4px; --pane-gap: 4px; ${pane_props?.style ?? ``}`,
    }}
  >
    {#if plot_controls}
      {@render plot_controls()}
    {:else}
      <!-- Custom controls before base controls -->
      {@render children?.()}

      <!-- Base Display controls -->
      <SettingsSection
        title="Display"
        current_values={{ show_x_zero_line, show_y_zero_line, x_grid, y_grid, y2_grid }}
        on_reset={() => {
          show_x_zero_line = false
          show_y_zero_line = false
          x_grid = DEFAULTS.plot.x_grid
          y_grid = DEFAULTS.plot.y_grid
          y2_grid = DEFAULTS.plot.y2_grid
        }}
        style="display: flex; flex-wrap: wrap; gap: 1ex"
      >
        {#if x_includes_zero}
          <label>
            <input type="checkbox" bind:checked={show_x_zero_line} /> X zero line
          </label>
        {/if}
        {#if y_includes_zero}
          <label>
            <input type="checkbox" bind:checked={show_y_zero_line} /> Y zero line
          </label>
        {/if}
        <label>
          <input type="checkbox" bind:checked={x_grid as boolean} /> X-axis grid
        </label>
        <label>
          <input type="checkbox" bind:checked={y_grid as boolean} /> Y-axis grid
        </label>
        {#if has_y2_points}
          <label>
            <input type="checkbox" bind:checked={y2_grid as boolean} /> Y2-axis grid
          </label>
        {/if}
      </SettingsSection>

      <!-- Base Axis Range controls -->
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

      <!-- Optional Ticks controls -->
      {#if show_ticks}
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
      {/if}

      <!-- Base Tick Format controls -->
      <SettingsSection
        title="Tick Format"
        current_values={{ x_format, y_format, y2_format }}
        on_reset={() => {
          x_format = DEFAULTS.plot.x_format
          y_format = DEFAULTS.plot.y_format
          y2_format = DEFAULTS.plot.y2_format
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

      <!-- Custom controls after base controls -->
      {@render post_children?.()}
    {/if}
  </DraggablePane>
{/if}

<style>
  label {
    display: inline-flex !important;
    margin: 0 0 0 5pt;
  }
</style>
