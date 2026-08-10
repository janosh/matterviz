<script lang="ts">
  // NOTE: Axis config objects (x_axis, x2_axis, y_axis, y2_axis) must be reassigned (not mutated)
  // to trigger $bindable reactivity propagation to parent components.
  // Pattern: `x_axis = { ...x_axis, prop: value }` instead of `x_axis.prop = value`
  import { SettingsGroup, SettingsSection } from '$lib/layout'
  import { ControlPane } from '$lib/overlays'
  import { DEFAULTS } from '$lib/settings'
  import { format } from 'd3-format'
  import { timeFormat } from 'd3-time-format'
  import { tooltip } from 'svelte-widgets/attachments'
  import type { Vec2 } from '$lib/math'
  import type { AxisConfig, AxisKey, PlotControlsProps } from '$lib/plot/core/types'
  import { normalize_y2_sync } from '$lib/plot/core/interactions'
  import { untrack } from 'svelte'
  import {
    get_scale_type_name,
    is_scale_type_name,
    is_y2_sync_mode,
  } from '$lib/plot/core/types'

  let {
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    children,
    post_children,
    x_axis = $bindable({}),
    x2_axis = $bindable({}),
    y_axis = $bindable({}),
    y2_axis = $bindable({}),
    display = $bindable({}),
    auto_x_range = [0, 1],
    auto_x2_range = undefined,
    auto_y_range = [0, 1],
    auto_y2_range = undefined,
    has_x2_points = false,
    has_y2_points = false,
    show_ticks = false,
    controls_title = `plot`,
    controls_class = `plot`,
    toggle_props = {},
    pane_props = {},
  }: PlotControlsProps = $props()

  // Range input state
  let range_inputs: Record<AxisKey, [number | null, number | null]> = $state({
    x: [null, null],
    x2: [null, null],
    y: [null, null],
    y2: [null, null],
  })
  let range_els = $state<Record<string, HTMLInputElement>>({})

  // Check if an axis range spans zero (handles inverted ranges like [3.5, 1.4])
  const range_spans_zero = (lo: number, hi: number): boolean =>
    Math.min(lo, hi) <= 0 && Math.max(lo, hi) >= 0

  const all_axes = [`x`, `x2`, `y`, `y2`] as const
  const axis_record = <Value>(get_value: (axis: AxisKey) => Value): Record<AxisKey, Value> =>
    Object.fromEntries(all_axes.map((axis) => [axis, get_value(axis)])) as Record<
      AxisKey,
      Value
    >
  const axis_values = <Value>(suffix: string, get_value: (axis: AxisKey) => Value) =>
    Object.fromEntries(all_axes.map((axis) => [`${axis}_${suffix}`, get_value(axis)]))
  const zero_line_default = (axis: AxisKey): boolean =>
    (axis === `x` && DEFAULTS.plot.show_x_zero_line) ||
    (axis === `y` && DEFAULTS.plot.show_y_zero_line)
  const grid_default = (axis: AxisKey): boolean =>
    axis !== `x2` && DEFAULTS.scatter.display[`${axis}_grid`]
  const display_values = (): Record<string, boolean> =>
    Object.fromEntries(
      all_axes.flatMap((axis) => [
        [`${axis}_zero_line`, display[`${axis}_zero_line`] ?? zero_line_default(axis)],
        [`${axis}_grid`, display[`${axis}_grid`] ?? grid_default(axis)],
      ]),
    )
  const display_reset_values = untrack(display_values)
  const tick_axes = [
    { axis: `x`, label: `X-axis`, fallback: DEFAULTS.plot.x_ticks },
    { axis: `y`, label: `Y-axis`, fallback: DEFAULTS.plot.y_ticks },
  ] as const
  const axis_labels = { x: `X`, x2: `X2`, y: `Y`, y2: `Y2` } as const
  const axis_config = (axis: AxisKey): AxisConfig =>
    axis === `x` ? x_axis : axis === `x2` ? x2_axis : axis === `y` ? y_axis : y2_axis
  const initial_ranges = untrack(() => axis_record((axis) => axis_config(axis).range))
  const initial_ticks = untrack(() => ({
    x: x_axis.ticks ?? DEFAULTS.plot.x_ticks,
    y: y_axis.ticks ?? DEFAULTS.plot.y_ticks,
  }))
  const update_axis = (axis: AxisKey, updates: Partial<AxisConfig>): void => {
    if (axis === `x`) x_axis = { ...x_axis, ...updates }
    else if (axis === `x2`) x2_axis = { ...x2_axis, ...updates }
    else if (axis === `y`) y_axis = { ...y_axis, ...updates }
    else y2_axis = { ...y2_axis, ...updates }
  }
  let auto_ranges = $derived({
    x: auto_x_range,
    x2: auto_x2_range,
    y: auto_y_range,
    y2: auto_y2_range,
  } satisfies Record<AxisKey, Vec2 | undefined>)
  // secondary axes only exist once their series do; primary axes always have an auto range
  let axis_present = $derived({ x: true, x2: has_x2_points, y: true, y2: has_y2_points })
  let visible_axes = $derived(
    all_axes
      .filter((axis) => axis_present[axis])
      .map((axis) => [axis, axis_labels[axis]] as const),
  )
  // whether each axis range spans zero, gating the zero-line toggles
  let includes_zero = $derived(
    axis_record((axis) => {
      const auto = auto_ranges[axis]
      const { range } = axis_config(axis)
      return (
        axis_present[axis] &&
        auto != null &&
        range_spans_zero(range?.[0] ?? auto[0], range?.[1] ?? auto[1])
      )
    }),
  )
  const axis_format = {
    x: { fallback: DEFAULTS.plot.x_format, placeholder: `.2~s / .0% / %Y-%m-%d` },
    x2: { fallback: DEFAULTS.plot.x2_format, placeholder: `.2~s / .0% / %Y-%m-%d` },
    y: { fallback: DEFAULTS.plot.y_format, placeholder: `d / .1e / .0%` },
    y2: { fallback: DEFAULTS.plot.y2_format, placeholder: `.2f / .1e / .0%` },
  } satisfies Record<AxisKey, { fallback: string | undefined; placeholder: string }>

  // Validation function for format specifiers
  function is_valid_format(format_string: string): boolean {
    if (!format_string) return true
    try {
      if (format_string.startsWith(`%`)) {
        timeFormat(format_string)(new Date())
        return true
      }
      format(format_string)(123.456)
      return true
    } catch {
      return false
    }
  }

  // Handle format input changes
  const format_input_handler = (format_type: AxisKey) => (event: Event) => {
    const input = event.target
    if (!(input instanceof HTMLInputElement)) return
    if (!is_valid_format(input.value)) {
      input.classList.add(`invalid`)
      return
    }
    input.classList.remove(`invalid`)
    update_axis(format_type, { format: input.value })
  }

  // Handle range input changes
  const update_range = (axis: AxisKey, bound: 0 | 1, value: string) => {
    const parsed = value === `` ? null : Number(value)
    range_inputs[axis][bound] = Number.isFinite(parsed) ? parsed : null
    const [min, max] = range_inputs[axis]
    const auto = auto_ranges[axis]
    const invalid = min !== null && max !== null && min >= max
    range_els[`${axis}-min`]?.classList.toggle(`invalid`, invalid)
    range_els[`${axis}-max`]?.classList.toggle(`invalid`, invalid)
    if (invalid) return
    const next_range =
      min === null && max === null
        ? undefined
        : ([min ?? auto?.[0] ?? 0, max ?? auto?.[1] ?? 1] as Vec2)
    // If auto range is undefined, only set if both min and max are provided
    if (!auto && (min === null || max === null)) return
    update_axis(axis, { range: next_range })
  }

  // Sync range inputs from props
  $effect(() => {
    for (const axis of all_axes) {
      const { range } = axis_config(axis)
      range_inputs[axis] = [range?.[0] ?? null, range?.[1] ?? null]
    }
  })

  let ctrl_state = $derived({
    show_controls,
    controls_open,
    x_axis,
    x2_axis,
    y_axis,
    y2_axis,
    display,
    range_inputs,
  })
</script>

{#snippet axis_checks(
  label: string,
  key: `zero_line` | `grid`,
  fallback: (axis: AxisKey) => boolean,
  visible: (axis: AxisKey) => boolean = () => true,
)}
  {@const axes = visible_axes.filter(([axis]) => visible(axis))}
  {#if axes.length}
    <div class="setting control-group" data-label={label.toLowerCase()}>
      <span>{label}</span>
      <span class="control-options">
        {#each axes as [axis, axis_label] (axis)}
          <label>
            <input
              type="checkbox"
              checked={display[`${axis}_${key}`] ?? fallback(axis)}
              onchange={(event) => (display[`${axis}_${key}`] = event.currentTarget.checked)}
            />
            {axis_label}
          </label>
        {/each}
      </span>
    </div>
  {/if}
{/snippet}

{#if show_controls}
  <ControlPane
    bind:controls_open
    {controls_class}
    toggle_title={controls_title}
    {toggle_props}
    {pane_props}
  >
    {@render children?.(ctrl_state)}

    <!-- Base Display controls -->
    <SettingsSection
      title="Display"
      current_values={display_values()}
      on_reset={() => (display = { ...display, ...display_reset_values })}
      layout="grid"
    >
      {@render axis_checks(
        `Zero line`,
        `zero_line`,
        zero_line_default,
        (axis) => includes_zero[axis],
      )}
      {@render axis_checks(`Grid`, `grid`, grid_default)}
    </SettingsSection>

    <SettingsGroup title="Axes" open>
      <!-- Base Axis Range controls -->
      <SettingsSection
        title="Axis range"
        current_values={axis_values(`range`, (axis) => axis_config(axis).range)}
        on_reset={() => {
          for (const axis of all_axes) update_axis(axis, { range: initial_ranges[axis] })
          Object.values(range_els).forEach((element) => element?.classList.remove(`invalid`))
        }}
        layout="grid"
      >
        {#each visible_axes as [axis, label] (axis)}
          <label>
            <span>{label}</span>
            <span class="range-pair">
              <input
                type="number"
                value={range_inputs[axis][0] ?? ``}
                bind:this={range_els[`${axis}-min`]}
                placeholder="auto"
                class="range-input"
                oninput={(evt) => update_range(axis, 0, evt.currentTarget.value)}
                onkeydown={(evt) => evt.key === `Enter` && evt.currentTarget?.blur()}
              />
              <span>to</span>
              <input
                type="number"
                value={range_inputs[axis][1] ?? ``}
                bind:this={range_els[`${axis}-max`]}
                placeholder="auto"
                class="range-input"
                oninput={(evt) => update_range(axis, 1, evt.currentTarget.value)}
                onkeydown={(evt) => evt.key === `Enter` && evt.currentTarget?.blur()}
              />
            </span>
          </label>
        {/each}
      </SettingsSection>

      <!-- Optional Ticks controls -->
      {#if show_ticks}
        {@const [min_ticks, max_ticks] = [2, 20]}
        <SettingsSection
          title="Ticks"
          current_values={{
            x_ticks: x_axis.ticks ?? DEFAULTS.plot.x_ticks,
            y_ticks: y_axis.ticks ?? DEFAULTS.plot.y_ticks,
          }}
          on_reset={() => {
            for (const { axis } of tick_axes) {
              update_axis(axis, { ticks: initial_ticks[axis] })
            }
          }}
          layout="grid"
        >
          {#each tick_axes as { axis, label, fallback } (axis)}
            {@const ticks = axis_config(axis).ticks}
            <label>
              <span>{label}</span>
              <input
                type="number"
                min={min_ticks}
                max={max_ticks}
                step="1"
                value={typeof ticks === `number` ? ticks : fallback}
                oninput={(evt) => {
                  const parsed = parseInt(evt.currentTarget.value, 10)
                  if (isNaN(parsed)) return
                  update_axis(axis, {
                    ticks: Math.max(min_ticks, Math.min(max_ticks, parsed)),
                  })
                }}
              />
            </label>
          {/each}
        </SettingsSection>
      {/if}

      <!-- Scale Type controls -->
      <SettingsSection
        title="Scale type"
        current_values={axis_values(`scale`, (axis) =>
          get_scale_type_name(axis_config(axis).scale_type),
        )}
        on_reset={() => {
          for (const axis of all_axes) update_axis(axis, { scale_type: `linear` })
        }}
        data-testid="scale-type-section"
        layout="grid"
      >
        {#each visible_axes as [axis, label] (axis)}
          <label>
            <span>{label}</span>
            <select
              value={get_scale_type_name(axis_config(axis).scale_type)}
              onchange={(evt) => {
                const scale_type = evt.currentTarget.value
                update_axis(axis, {
                  scale_type: is_scale_type_name(scale_type) ? scale_type : `linear`,
                })
              }}
            >
              <option value="linear">Linear</option>
              <option value="log">Log</option>
              <option value="arcsinh">Arcsinh</option>
            </select>
          </label>
        {/each}
      </SettingsSection>

      <!-- Y2 Sync controls (only when y2 axis has points) -->
      {#if has_y2_points}
        {@const current_sync = normalize_y2_sync(y2_axis.sync)}
        {@const y2_sync_tip = `Controls Y2 axis range:
• Independent: Y2 has its own range based on its data
• Synced: Y2 has exact same range as Y1
• Align: Y2 expands to show all data, with a shared anchor point (default 0)`}
        <SettingsSection
          title="Y2 sync"
          current_values={{
            y2_sync: current_sync.mode,
            align_value: current_sync.align_value,
          }}
          on_reset={() => {
            y2_axis = { ...y2_axis, sync: undefined }
          }}
          layout="grid"
        >
          <label {@attach tooltip({ content: y2_sync_tip })}>
            <span>Mode</span>
            <select
              value={current_sync.mode}
              aria-label="Y2 axis synchronization mode"
              onchange={(evt) => {
                const val = evt.currentTarget.value
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
            <label>
              <span>Align at</span>
              <input
                type="number"
                value={current_sync.align_value ?? 0}
                aria-label="Value to align on both axes"
                style="width: 5em"
                onchange={(evt) => {
                  const val = parseFloat(evt.currentTarget.value)
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
        title="Tick format"
        data-testid="tick-format-section"
        class="tick-format-section"
        current_values={axis_values(`format`, (axis) => axis_config(axis).format)}
        on_reset={() => {
          for (const axis of all_axes) {
            update_axis(axis, { format: axis_format[axis].fallback })
          }
        }}
        layout="grid"
      >
        {#each visible_axes as [axis, label] (axis)}
          <label>
            <span>{label}-axis</span>
            <input
              type="text"
              value={axis_config(axis).format ?? axis_format[axis].fallback}
              placeholder={axis_format[axis].placeholder}
              oninput={format_input_handler(axis)}
            />
          </label>
        {/each}
      </SettingsSection>
    </SettingsGroup>

    <!-- Custom controls after base controls -->
    {@render post_children?.(ctrl_state)}
  </ControlPane>
{/if}

<style>
  :is(.control-options, .range-pair) {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 3pt 7pt;
    min-width: 0;
  }
  .control-options label {
    display: flex;
    align-items: center;
    gap: 3pt;
  }
  .range-pair input {
    width: 6.5em;
    min-width: 0;
  }
  :global(.tick-format-section input) {
    width: 100%;
  }
</style>
