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
    x_axis = $bindable({}),
    y_axis = $bindable({}),
    y2_axis = $bindable({}),
    display = $bindable({}),
    auto_x_range = [0, 1],
    auto_y_range = [0, 1],
    auto_y2_range = [0, 1],
    has_y2_points = false,
    show_ticks = false,
    controls_title = `plot`,
    controls_class = ``,
    toggle_props = {},
    pane_props = {},
  }: PlotControlsProps = $props()

  // Local format state
  let x_format_input = $state(x_axis.format ?? DEFAULTS.plot.x_format)
  let y_format_input = $state(y_axis.format ?? DEFAULTS.plot.y_format)
  let y2_format_input = $state(y2_axis.format ?? DEFAULTS.plot.y2_format)

  // Range input state
  let range_inputs = $state(
    { x: [null, null], y: [null, null], y2: [null, null] } as Record<
      `x` | `y` | `y2`,
      [number | null, number | null]
    >,
  )
  let range_els = $state<Record<string, HTMLInputElement>>({})

  // Derived state
  let x_includes_zero = $derived(
    ((x_axis.range?.[0] ?? auto_x_range[0]) <= 0) &&
      ((x_axis.range?.[1] ?? auto_x_range[1]) >= 0),
  )
  let y_includes_zero = $derived(
    ((y_axis.range?.[0] ?? auto_y_range[0]) <= 0) &&
      ((y_axis.range?.[1] ?? auto_y_range[1]) >= 0),
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
    const inputs = {
      x: () => (x_format_input = input.value),
      y: () => (y_format_input = input.value),
      y2: () => (y2_format_input = input.value),
    }
    const axes = { x: x_axis, y: y_axis, y2: y2_axis }
    inputs[format_type]()

    if (is_valid_format(input.value)) {
      input.classList.remove(`invalid`)
      axes[format_type].format = input.value
    } else input.classList.add(`invalid`)
  }

  // Handle range input changes
  const update_range = (axis: `x` | `y` | `y2`, bound: 0 | 1, value: string) => {
    const parsed = value === `` ? null : Number(value)
    range_inputs[axis][bound] = Number.isFinite(parsed) ? parsed : null
    const [min, max] = range_inputs[axis]
    const auto = { x: auto_x_range, y: auto_y_range, y2: auto_y2_range }[axis]
    const invalid = min !== null && max !== null && min >= max
    range_els[`${axis}-min`]?.classList.toggle(`invalid`, invalid)
    range_els[`${axis}-max`]?.classList.toggle(`invalid`, invalid)
    if (invalid) return
    const axis_config = { x: x_axis, y: y_axis, y2: y2_axis }[axis]
    axis_config.range = min === null && max === null
      ? undefined
      : [min ?? auto[0], max ?? auto[1]] as [number, number]
  }

  // Sync format inputs
  $effect(() => {
    x_format_input = x_axis.format ?? DEFAULTS.plot.x_format
    y_format_input = y_axis.format ?? DEFAULTS.plot.y_format
    y2_format_input = y2_axis.format ?? DEFAULTS.plot.y2_format
  })

  // Sync range inputs from props
  $effect(() => {
    range_inputs.x = [x_axis.range?.[0] ?? null, x_axis.range?.[1] ?? null]
    range_inputs.y = [y_axis.range?.[0] ?? null, y_axis.range?.[1] ?? null]
    range_inputs.y2 = [y2_axis.range?.[0] ?? null, y2_axis.range?.[1] ?? null]
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
      current_values={{
        x_zero_line: display.x_zero_line,
        y_zero_line: display.y_zero_line,
        x_grid: display.x_grid,
        y_grid: display.y_grid,
        y2_grid: display.y2_grid,
      }}
      on_reset={() => {
        display.x_zero_line = false
        display.y_zero_line = false
        display.x_grid = DEFAULTS.plot.show_x_grid
        display.y_grid = DEFAULTS.plot.show_y_grid
        display.y2_grid = DEFAULTS.plot.show_y2_grid
      }}
      style="display: flex; flex-wrap: wrap; gap: 1ex"
    >
      {#if x_includes_zero}<label><input
            type="checkbox"
            bind:checked={display.x_zero_line}
          /> X zero line</label>{/if}
      {#if y_includes_zero}<label><input
            type="checkbox"
            bind:checked={display.y_zero_line}
          /> Y zero line</label>{/if}
      <label><input type="checkbox" bind:checked={display.x_grid} /> X-axis grid</label>
      <label><input type="checkbox" bind:checked={display.y_grid} /> Y-axis grid</label>
      {#if has_y2_points}<label><input
            type="checkbox"
            bind:checked={display.y2_grid}
          /> Y2-axis grid</label>{/if}
    </SettingsSection>

    <!-- Base Axis Range controls -->
    <SettingsSection
      title="Axis Range"
      current_values={{ x_range: x_axis.range, y_range: y_axis.range, y2_range: y2_axis.range }}
      on_reset={() => {
        x_axis.range = undefined
        y_axis.range = undefined
        y2_axis.range = undefined
        Object.values(range_els).forEach((el) => el.classList.remove(`invalid`))
      }}
      class="pane-grid"
    >
      {#each [
        [`x`, `X-axis`],
        [`y`, `Y-axis`],
        ...(has_y2_points ? [[`y2`, `Y2-axis`]] : []),
      ] as
        [axis_key, label]
        (axis_key)
      }
        {@const axis = axis_key as `x` | `y` | `y2`}
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
      {/each}
    </SettingsSection>

    <!-- Optional Ticks controls -->
    {#if show_ticks}
      {@const [min_ticks, max_ticks] = [2, 20]}
      <SettingsSection
        title="Ticks"
        current_values={{ x_ticks: x_axis.ticks, y_ticks: y_axis.ticks }}
        on_reset={() => {
          x_axis.ticks = DEFAULTS.plot.x_ticks
          y_axis.ticks = DEFAULTS.plot.y_ticks
        }}
        style="display: flex; flex-wrap: wrap; gap: 1ex"
      >
        <label>X-axis:
          <input
            type="number"
            min={min_ticks}
            max={max_ticks}
            step="1"
            value={typeof x_axis.ticks === `number` ? x_axis.ticks : 8}
            oninput={(e) => {
              const v = parseInt(e.currentTarget.value, 10)
              if (isNaN(v)) return
              x_axis.ticks = Math.max(min_ticks, Math.min(max_ticks, v))
            }}
          />
        </label>
        <label>Y-axis:
          <input
            type="number"
            min={min_ticks}
            max={max_ticks}
            step="1"
            value={typeof y_axis.ticks === `number` ? y_axis.ticks : 6}
            oninput={(e) => {
              const v = parseInt(e.currentTarget.value, 10)
              if (isNaN(v)) return
              y_axis.ticks = Math.max(min_ticks, Math.min(max_ticks, v))
            }}
          />
        </label>
      </SettingsSection>
    {/if}

    <!-- Base Tick Format controls -->
    <SettingsSection
      title="Tick Format"
      current_values={{
        x_format: x_axis.format,
        y_format: y_axis.format,
        y2_format: y2_axis.format,
      }}
      on_reset={() => {
        x_axis.format = DEFAULTS.plot.x_format
        y_axis.format = DEFAULTS.plot.y_format
        y2_axis.format = DEFAULTS.plot.y2_format
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
