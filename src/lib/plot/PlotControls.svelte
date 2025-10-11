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
    show_x_zero_line = $bindable(false),
    show_y_zero_line = $bindable(false),
    show_x_grid = $bindable(DEFAULTS.plot.show_x_grid),
    show_y_grid = $bindable(DEFAULTS.plot.show_y_grid),
    show_y2_grid = $bindable(DEFAULTS.plot.show_y2_grid),
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

  // Range input state
  let range_inputs = $state(
    { x: [null, null], y: [null, null], y2: [null, null] } as Record<
      `x` | `y` | `y2`,
      [number | null, number | null]
    >,
  )
  let range_els: Record<string, HTMLInputElement> = {}

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
    } else input.classList.add(`invalid`)
  }

  // Handle range input changes
  const update_range = (axis: `x` | `y` | `y2`, bound: 0 | 1, value: string) => {
    range_inputs[axis][bound] = value === `` ? null : +value
    const [min, max] = range_inputs[axis]
    const auto = { x: auto_x_range, y: auto_y_range, y2: auto_y2_range }[axis]

    // Validate and update range
    const invalid = min !== null && max !== null && min >= max
    range_els[`${axis}-min`]?.classList.toggle(`invalid`, invalid)
    range_els[`${axis}-max`]?.classList.toggle(`invalid`, invalid)
    if (invalid) return

    const new_range = min === null && max === null
      ? undefined
      : [min ?? auto[0], max ?? auto[1]] as [number, number]
    if (axis === `x`) x_range = new_range
    else if (axis === `y`) y_range = new_range
    else y2_range = new_range
  }

  // Sync format inputs
  $effect(() => {
    x_format_input = x_format
    y_format_input = y_format
    y2_format_input = y2_format
  })

  // Sync range inputs from props
  $effect(() => {
    range_inputs.x = [x_range?.[0] ?? null, x_range?.[1] ?? null]
    range_inputs.y = [y_range?.[0] ?? null, y_range?.[1] ?? null]
    range_inputs.y2 = [y2_range?.[0] ?? null, y2_range?.[1] ?? null]
  })
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
      style: `--pane-padding: 12px; --pane-gap: 4px; ${pane_props?.style ?? ``}`,
    }}
  >
    <!-- Custom controls before base controls -->
    {@render children?.()}

    <!-- Base Display controls -->
    <SettingsSection
      title="Display"
      current_values={{ show_x_zero_line, show_y_zero_line, show_x_grid, show_y_grid, show_y2_grid }}
      on_reset={() => {
        show_x_zero_line = false
        show_y_zero_line = false
        show_x_grid = DEFAULTS.plot.show_x_grid
        show_y_grid = DEFAULTS.plot.show_y_grid
        show_y2_grid = DEFAULTS.plot.show_y2_grid
      }}
      style="display: flex; flex-wrap: wrap; gap: 1ex"
    >
      {#if x_includes_zero}<label><input
            type="checkbox"
            bind:checked={show_x_zero_line}
          /> X zero line</label>{/if}
      {#if y_includes_zero}<label><input
            type="checkbox"
            bind:checked={show_y_zero_line}
          /> Y zero line</label>{/if}
      <label><input type="checkbox" bind:checked={show_x_grid} /> X-axis grid</label>
      <label><input type="checkbox" bind:checked={show_y_grid} /> Y-axis grid</label>
      {#if has_y2_points}<label><input
            type="checkbox"
            bind:checked={show_y2_grid}
          /> Y2-axis grid</label>{/if}
    </SettingsSection>

    <!-- Base Axis Range controls -->
    {#snippet range_row(axis: `x` | `y` | `y2`, label: string)}
      <label>{label}:
        <input
          type="number"
          value={range_inputs[axis][0] ?? ``}
          bind:this={range_els[`${axis}-min`]}
          placeholder="auto"
          class="range-input"
          oninput={(e) => update_range(axis, 0, e.currentTarget.value)}
          onkeydown={(e) => e.key === `Enter` && e.currentTarget.blur()}
        />
        &nbsp;to
        <input
          type="number"
          value={range_inputs[axis][1] ?? ``}
          bind:this={range_els[`${axis}-max`]}
          placeholder="auto"
          class="range-input"
          oninput={(e) => update_range(axis, 1, e.currentTarget.value)}
          onkeydown={(e) => e.key === `Enter` && e.currentTarget.blur()}
        />
      </label>
    {/snippet}
    <SettingsSection
      title="Axis Range"
      current_values={{ x_range, y_range, y2_range }}
      on_reset={() => {
        x_range = undefined
        y_range = undefined
        y2_range = undefined
      }}
      class="pane-grid"
    >
      {@render range_row(`x`, `X-axis`)}
      {@render range_row(`y`, `Y-axis`)}
      {#if has_y2_points}{@render range_row(`y2`, `Y2-axis`)}{/if}
    </SettingsSection>

    <!-- Optional Ticks controls -->
    {#if show_ticks}
      {@const [min_ticks, max_ticks] = [2, 20]}
      <SettingsSection
        title="Ticks"
        current_values={{ x_ticks, y_ticks }}
        on_reset={() => {
          x_ticks = DEFAULTS.plot.x_ticks
          y_ticks = DEFAULTS.plot.y_ticks
        }}
        style="display: flex; flex-wrap: wrap; gap: 1ex"
      >
        <label>X-axis:
          <input
            type="number"
            min={min_ticks}
            max={max_ticks}
            step="1"
            value={typeof x_ticks === `number` ? x_ticks : 8}
            oninput={(e) => {
              const v = parseInt(e.currentTarget.value, 10)
              if (isNaN(v)) return
              x_ticks = Math.max(min_ticks, Math.min(max_ticks, v))
            }}
          />
        </label>
        <label>Y-axis:
          <input
            type="number"
            min={min_ticks}
            max={max_ticks}
            step="1"
            value={typeof y_ticks === `number` ? y_ticks : 6}
            oninput={(e) => {
              const v = parseInt(e.currentTarget.value, 10)
              if (isNaN(v)) return
              y_ticks = Math.max(min_ticks, Math.min(max_ticks, v))
            }}
          />
        </label>
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
      style="grid-template-columns: 1fr 1fr"
    >
      <label style="white-space: nowrap">X-axis:
        <input
          type="text"
          bind:value={x_format_input}
          placeholder=".2~s / .0% / %Y-%m-%d"
          oninput={format_input_handler(`x`)}
        />
      </label>
      <label style="white-space: nowrap">Y-axis:
        <input
          type="text"
          bind:value={y_format_input}
          placeholder="d / .1e / .0%"
          oninput={format_input_handler(`y`)}
          style="width: 100%"
        />
      </label>
      {#if has_y2_points}
        <label style="white-space: nowrap">Y2-axis:
          <input
            type="text"
            bind:value={y2_format_input}
            placeholder=".2f / .1e / .0%"
            oninput={format_input_handler(`y2`)}
            style="width: 100%"
          />
        </label>
      {/if}
    </SettingsSection>

    <!-- Custom controls after base controls -->
    {@render post_children?.()}
  </DraggablePane>
{/if}
