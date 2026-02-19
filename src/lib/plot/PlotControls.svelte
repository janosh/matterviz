<script lang="ts">
  // NOTE: Axis config objects (x_axis, y_axis, y2_axis) must be reassigned (not mutated)
  // to trigger $bindable reactivity propagation to parent components.
  // Pattern: `x_axis = { ...x_axis, prop: value }` instead of `x_axis.prop = value`
  import SettingsSection from '$lib/layout/SettingsSection.svelte'
  import DraggablePane from '$lib/overlays/DraggablePane.svelte'
  import { DEFAULTS } from '$lib/settings'
  import { format } from 'd3-format'
  import { timeFormat } from 'd3-time-format'
  import { tooltip } from 'svelte-multiselect/attachments'
  import type { Vec2 } from '../math'
  import type { AxisKey, PlotControlsProps } from './index'
  import { normalize_y2_sync } from './interactions'
  import { get_scale_type_name, is_scale_type_name, is_y2_sync_mode } from './types'

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
    auto_y2_range = undefined,
    has_y2_points = false,
    show_ticks = false,
    controls_title = `plot`,
    controls_class = ``,
    toggle_props = {},
    pane_props = {},
  }: PlotControlsProps = $props()

  // Range input state
  let range_inputs: Record<AxisKey, [number | null, number | null]> = $state(
    { x: [null, null], y: [null, null], y2: [null, null] },
  )
  let range_els = $state<Record<string, HTMLInputElement>>({})

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
  const format_input_handler = (format_type: AxisKey) => (event: Event) => {
    const input = event.target
    if (!(input instanceof HTMLInputElement)) return
    const axes = { x: x_axis, y: y_axis, y2: y2_axis }
    const axis = axes[format_type]

    if (is_valid_format(input.value)) {
      input.classList.remove(`invalid`)
      axis.format = input.value
    } else input.classList.add(`invalid`)
  }

  // Handle range input changes
  const update_range = (axis: AxisKey, bound: 0 | 1, value: string) => {
    const parsed = value === `` ? null : Number(value)
    range_inputs[axis][bound] = Number.isFinite(parsed) ? parsed : null
    const [min, max] = range_inputs[axis]
    const auto = { x: auto_x_range, y: auto_y_range, y2: auto_y2_range }[axis]
    const invalid = min !== null && max !== null && min >= max
    range_els[`${axis}-min`]?.classList.toggle(`invalid`, invalid)
    range_els[`${axis}-max`]?.classList.toggle(`invalid`, invalid)
    if (invalid) return
    const axis_config = { x: x_axis, y: y_axis, y2: y2_axis }[axis]
    // If auto range is undefined, only set if both min and max are provided
    if (!auto && (min === null || max === null)) return
    axis_config.range = min === null && max === null
      ? undefined
      : [min ?? auto?.[0] ?? 0, max ?? auto?.[1] ?? 1] as Vec2
  }

  // Sync range inputs from props
  $effect(() => {
    range_inputs.x = [x_axis.range?.[0] ?? null, x_axis.range?.[1] ?? null]
    range_inputs.y = [y_axis.range?.[0] ?? null, y_axis.range?.[1] ?? null]
    range_inputs.y2 = [y2_axis.range?.[0] ?? null, y2_axis.range?.[1] ?? null]
  })

  let ctrl_state = $derived({
    show_controls,
    controls_open,
    x_axis,
    y_axis,
    y2_axis,
    display,
    range_inputs,
  })
</script>

{#if show_controls}
  <DraggablePane
    bind:show={controls_open}
    closed_icon="Settings"
    open_icon="Cross"
    toggle_props={{
      title: `${controls_open ? `Close` : `Open`} ${controls_title} controls`,
      ...toggle_props,
      class: `${controls_class}-controls-toggle ${toggle_props?.class ?? ``}`,
      style:
        `position: absolute; top: var(--ctrl-btn-top, 5pt); right: var(--ctrl-btn-right, 1ex);` +
        (toggle_props?.style ?? ``),
    }}
    pane_props={{
      ...pane_props,
      class: `${controls_class}-controls-pane ${pane_props?.class ?? ``}`,
      style: `--pane-padding: 12px; --pane-gap: 4px; ${pane_props?.style ?? ``}`,
    }}
  >
    {@render children?.(ctrl_state)}

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
      style="display: flex; flex-wrap: wrap; gap: 1ex; align-items: center"
    >
      {#if x_includes_zero || y_includes_zero}
        <span class="control-group" data-label="zero line">Zero line:
          {#if x_includes_zero}
            <label><input type="checkbox" bind:checked={display.x_zero_line} /> X</label>
          {/if}
          {#if y_includes_zero}
            <label><input type="checkbox" bind:checked={display.y_zero_line} /> Y</label>
          {/if}
        </span>
      {/if}
      <span class="control-group" data-label="grid">Grid:
        <label><input type="checkbox" bind:checked={display.x_grid} /> X</label>
        <label><input type="checkbox" bind:checked={display.y_grid} /> Y</label>
        {#if has_y2_points}
          <label><input type="checkbox" bind:checked={display.y2_grid} /> Y2</label>
        {/if}
      </span>
    </SettingsSection>

    <!-- Base Axis Range controls -->
    <SettingsSection
      title="Axis Range"
      current_values={{ x_range: x_axis.range, y_range: y_axis.range, y2_range: y2_axis.range }}
      on_reset={() => {
        x_axis = { ...x_axis, range: [null, null] }
        y_axis = { ...y_axis, range: [null, null] }
        y2_axis = { ...y2_axis, range: [null, null] }
        Object.values(range_els).forEach((el) => el.classList.remove(`invalid`))
      }}
      style="display: flex; flex-wrap: wrap; gap: 2pt"
    >
      {#each [
        [`x`, `X`],
        [`y`, `Y`],
        ...(has_y2_points ? [[`y2`, `Y2`]] : []),
      ] as
        [axis_key, label]
        (axis_key)
      }
        {@const axis = axis_key as AxisKey}
        <label>{label}:
          <input
            type="number"
            value={range_inputs[axis][0] ?? ``}
            bind:this={range_els[`${axis}-min`]}
            placeholder="auto"
            class="range-input"
            oninput={(e) => update_range(axis, 0, e.currentTarget.value)}
            onkeydown={(e) => e.key === `Enter` && e.currentTarget?.blur()}
          /> to <input
            type="number"
            value={range_inputs[axis][1] ?? ``}
            bind:this={range_els[`${axis}-max`]}
            placeholder="auto"
            class="range-input"
            oninput={(e) => update_range(axis, 1, e.currentTarget.value)}
            onkeydown={(e) => e.key === `Enter` && e.currentTarget?.blur()}
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
          x_axis = { ...x_axis, ticks: DEFAULTS.plot.x_ticks }
          y_axis = { ...y_axis, ticks: DEFAULTS.plot.y_ticks }
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
              x_axis = {
                ...x_axis,
                ticks: Math.max(min_ticks, Math.min(max_ticks, v)),
              }
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
              y_axis = {
                ...y_axis,
                ticks: Math.max(min_ticks, Math.min(max_ticks, v)),
              }
            }}
          />
        </label>
      </SettingsSection>
    {/if}

    <!-- Scale Type controls -->
    <SettingsSection
      title="Scale Type"
      current_values={{
        x_scale: get_scale_type_name(x_axis.scale_type),
        y_scale: get_scale_type_name(y_axis.scale_type),
        y2_scale: get_scale_type_name(y2_axis.scale_type),
      }}
      on_reset={() => {
        x_axis = { ...x_axis, scale_type: `linear` }
        y_axis = { ...y_axis, scale_type: `linear` }
        y2_axis = { ...y2_axis, scale_type: `linear` }
      }}
      style="display: flex; flex-wrap: wrap; gap: 1ex"
    >
      <label>X:
        <select
          value={get_scale_type_name(x_axis.scale_type)}
          onchange={(e) => {
            const val = e.currentTarget.value
            x_axis = {
              ...x_axis,
              scale_type: is_scale_type_name(val) ? val : `linear`,
            }
          }}
        >
          <option value="linear">Linear</option>
          <option value="log">Log</option>
          <option value="arcsinh">Arcsinh</option>
        </select>
      </label>
      <label>Y:
        <select
          value={get_scale_type_name(y_axis.scale_type)}
          onchange={(e) => {
            const val = e.currentTarget.value
            y_axis = {
              ...y_axis,
              scale_type: is_scale_type_name(val) ? val : `linear`,
            }
          }}
        >
          <option value="linear">Linear</option>
          <option value="log">Log</option>
          <option value="arcsinh">Arcsinh</option>
        </select>
      </label>
      {#if has_y2_points}
        <label>Y2:
          <select
            value={get_scale_type_name(y2_axis.scale_type)}
            onchange={(e) => {
              const val = e.currentTarget.value
              y2_axis = {
                ...y2_axis,
                scale_type: is_scale_type_name(val) ? val : `linear`,
              }
            }}
          >
            <option value="linear">Linear</option>
            <option value="log">Log</option>
            <option value="arcsinh">Arcsinh</option>
          </select>
        </label>
      {/if}
    </SettingsSection>

    <!-- Y2 Sync controls (only when y2 axis has points) -->
    {#if has_y2_points}
      {@const current_sync = normalize_y2_sync(y2_axis.sync)}
      {@const y2_sync_tip = `Controls Y2 axis range:
• Independent: Y2 has its own range based on its data
• Synced: Y2 has exact same range as Y1
• Align: Y2 expands to show all data, with a shared anchor point (default 0)`}
      <SettingsSection
        title="Y2 Sync"
        current_values={{ y2_sync: current_sync.mode, align_value: current_sync.align_value }}
        on_reset={() => {
          y2_axis = { ...y2_axis, sync: undefined }
        }}
        style="display: flex; gap: 1ex; align-items: center; flex-wrap: wrap"
      >
        <label {@attach tooltip({ content: y2_sync_tip })}>Mode:
          <select
            value={current_sync.mode}
            aria-label="Y2 axis synchronization mode"
            onchange={(e) => {
              const val = e.currentTarget.value
              const mode = is_y2_sync_mode(val) ? val : `none`
              if (mode === `none`) {
                y2_axis = { ...y2_axis, sync: undefined }
              } else if (mode === `align`) {
                y2_axis = {
                  ...y2_axis,
                  sync: { mode, align_value: current_sync.align_value ?? 0 },
                }
              } else {
                y2_axis = { ...y2_axis, sync: mode }
              }
            }}
          >
            <option value="none">Independent</option>
            <option value="synced">Synced</option>
            <option value="align">Align</option>
          </select>
        </label>
        {#if current_sync.mode === `align`}
          <label>Align at:
            <input
              type="number"
              value={current_sync.align_value ?? 0}
              aria-label="Value to align on both axes"
              style="width: 5em"
              onchange={(e) => {
                const val = parseFloat(e.currentTarget.value)
                y2_axis = {
                  ...y2_axis,
                  sync: {
                    mode: `align`,
                    align_value: Number.isFinite(val) ? val : 0,
                  },
                }
              }}
            />
          </label>
        {/if}
      </SettingsSection>
    {/if}

    <!-- Base Tick Format controls -->
    <SettingsSection
      title="Tick Format"
      data-testid="tick-format-section"
      current_values={{
        x_format: x_axis.format,
        y_format: y_axis.format,
        y2_format: y2_axis.format,
      }}
      on_reset={() => {
        x_axis = { ...x_axis, format: DEFAULTS.plot.x_format }
        y_axis = { ...y_axis, format: DEFAULTS.plot.y_format }
        y2_axis = { ...y2_axis, format: DEFAULTS.plot.y2_format }
      }}
      class="pane-grid"
      style="grid-template-columns: 1fr 1fr"
    >
      <label style="white-space: nowrap">X-axis:
        <input
          type="text"
          value={x_axis.format ?? DEFAULTS.plot.x_format}
          placeholder=".2~s / .0% / %Y-%m-%d"
          oninput={format_input_handler(`x`)}
        />
      </label>
      <label style="white-space: nowrap">Y-axis:
        <input
          type="text"
          value={y_axis.format ?? DEFAULTS.plot.y_format}
          placeholder="d / .1e / .0%"
          oninput={format_input_handler(`y`)}
          style="width: 100%"
        />
      </label>
      {#if has_y2_points}
        <label style="white-space: nowrap">Y2-axis:
          <input
            type="text"
            value={y2_axis.format ?? DEFAULTS.plot.y2_format}
            placeholder=".2f / .1e / .0%"
            oninput={format_input_handler(`y2`)}
            style="width: 100%"
          />
        </label>
      {/if}
    </SettingsSection>

    <!-- Custom controls after base controls -->
    {@render post_children?.(ctrl_state)}
  </DraggablePane>
{/if}
