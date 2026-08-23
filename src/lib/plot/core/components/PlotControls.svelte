<script lang="ts">
  // NOTE: Axis config objects (x_axis, x2_axis, y_axis, y2_axis) must be reassigned (not mutated)
  // to trigger $bindable reactivity propagation to parent components.
  // Pattern: `x_axis = { ...x_axis, prop: value }` instead of `x_axis.prop = value`
  import { SettingsSection } from '$lib/layout'
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
    display_children,
    display_extra_values = {},
    on_display_extra_reset,
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
    controls_title = `plot`,
    controls_name = `plot`,
    toggle_props = {},
    pane_props = {},
  }: PlotControlsProps = $props()

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
  // secondary axes have no zero line / x2 grid defaults in the schema
  const zero_line_default = (axis: AxisKey): boolean =>
    (axis === `x` || axis === `y`) && DEFAULTS.plot.display[`${axis}_zero_line`]
  const grid_default = (axis: AxisKey): boolean =>
    axis !== `x2` && DEFAULTS.plot.display[`${axis}_grid`]
  const display_values = (): Record<string, boolean> =>
    Object.fromEntries(
      all_axes.flatMap((axis) => [
        [`${axis}_zero_line`, display[`${axis}_zero_line`] ?? zero_line_default(axis)],
        [`${axis}_grid`, display[`${axis}_grid`] ?? grid_default(axis)],
      ]),
    )
  const display_reset_values = untrack(display_values)
  const axis_labels = { x: `X`, x2: `X2`, y: `Y`, y2: `Y2` } as const
  const axis_config = (axis: AxisKey): AxisConfig =>
    axis === `x` ? x_axis : axis === `x2` ? x2_axis : axis === `y` ? y_axis : y2_axis
  // Each axis-field section (range, ticks, format) keys its values by axis; SettingsSection
  // snapshots them at mount and hands the changed ones back on Reset, so the pane keeps no
  // mount-time copies of the axis configs itself. Ticks is the exception: its section diffs
  // the numeric projection (`tick_count`), which cannot carry a mount-time tick list/interval,
  // so Reset restores the full mount-time `ticks` value kept here instead
  const is_axis_key = (key: string): key is AxisKey =>
    (all_axes as readonly string[]).includes(key)
  const mount_ticks = untrack(() => axis_record((axis) => axis_config(axis).ticks))
  const reset_axis_field =
    <Field extends keyof AxisConfig>(field: Field) =>
    (key: string, value: unknown) => {
      if (!is_axis_key(key)) return
      if (field === `ticks`) update_axis(key, { ticks: mount_ticks[key] })
      else update_axis(key, { [field]: value as AxisConfig[Field] })
    }
  // The Ticks inputs only edit numeric tick counts; an explicit tick list/map/interval set on
  // the axis is left alone (and shown as `custom`), and an empty input hands back to auto
  const tick_count = (axis: AxisKey): number | undefined => {
    const { ticks } = axis_config(axis)
    return typeof ticks === `number` ? ticks : undefined
  }
  const MAX_TICK_COUNT = 100
  const update_tick_count = (axis: AxisKey, value: string) => {
    if (value === ``) return update_axis(axis, { ticks: undefined })
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_TICK_COUNT) return
    update_axis(axis, { ticks: parsed })
  }
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
  const format_placeholders: Record<AxisKey, string> = {
    x: `.2~s / .0% / %Y-%m-%d`,
    x2: `.2~s / .0% / %Y-%m-%d`,
    y: `d / .1e / .0%`,
    y2: `.2f / .1e / .0%`,
  }

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

  // Range inputs mirror the axis configs; a partial or inverted entry stays local (and
  // flagged invalid) until it resolves or the config changes from outside.
  type RangeInput = [number | null, number | null]
  let range_inputs = $derived(
    axis_record((axis): RangeInput => {
      const { range } = axis_config(axis)
      return [range?.[0] ?? null, range?.[1] ?? null]
    }),
  )
  const range_invalid = ([min, max]: RangeInput): boolean =>
    min !== null && max !== null && min >= max
  const update_range = (axis: AxisKey, bound: 0 | 1, value: string) => {
    const parsed = value === `` ? null : Number(value)
    const next: RangeInput = [...range_inputs[axis]]
    next[bound] = Number.isFinite(parsed) ? parsed : null
    range_inputs = { ...range_inputs, [axis]: next }
    if (range_invalid(next)) return
    const [min, max] = next
    const auto = auto_ranges[axis]
    // Without an auto range, only a complete min/max pair can be applied
    if (!auto && (min === null || max === null)) return
    const next_range =
      min === null && max === null
        ? undefined
        : ([min ?? auto?.[0] ?? 0, max ?? auto?.[1] ?? 1] as Vec2)
    update_axis(axis, { range: next_range })
  }

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
    {controls_name}
    toggle_title={controls_title}
    pane_class="compact-settings"
    {toggle_props}
    {pane_props}
  >
    {@render children?.(ctrl_state)}

    <SettingsSection
      title="Display"
      class="ctrl-line"
      current_values={{ ...display_values(), ...display_extra_values }}
      on_reset={() => {
        display = { ...display, ...display_reset_values }
        on_display_extra_reset?.()
      }}
      layout="flow"
    >
      {@render display_children?.()}
      {@render axis_checks(
        `Zero line`,
        `zero_line`,
        zero_line_default,
        (axis) => includes_zero[axis],
      )}
      {@render axis_checks(`Grid`, `grid`, grid_default)}
    </SettingsSection>

    <SettingsSection
      title="Axis range"
      class="ctrl-line axis-fields"
      current_values={axis_record((axis) => axis_config(axis).range)}
      on_reset_key={reset_axis_field(`range`)}
      layout="flow"
    >
      {#each visible_axes as [axis, label] (axis)}
        {@const invalid = range_invalid(range_inputs[axis])}
        <label>
          <span>{label}</span>
          <span class="range-pair">
            {#each [0, 1] as const as bound (bound)}
              {#if bound === 1}<span>to</span>{/if}
              <input
                type="number"
                value={range_inputs[axis][bound] ?? ``}
                placeholder="auto"
                class={[`range-input`, { invalid }]}
                oninput={(evt) => update_range(axis, bound, evt.currentTarget.value)}
                onkeydown={(evt) => evt.key === `Enter` && evt.currentTarget.blur()}
              />
            {/each}
          </span>
        </label>
      {/each}
    </SettingsSection>

    <SettingsSection
      title="Scale type"
      class="ctrl-line axis-fields"
      current_values={axis_values(`scale`, (axis) =>
        get_scale_type_name(axis_config(axis).scale_type),
      )}
      on_reset={() => {
        for (const axis of all_axes) update_axis(axis, { scale_type: `linear` })
      }}
      data-testid="scale-type-section"
      layout="flow"
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

    {#if has_y2_points}
      {@const current_sync = normalize_y2_sync(y2_axis.sync)}
      {@const y2_sync_tip = `Controls Y2 axis range:
• Independent: Y2 has its own range based on its data
• Synced: Y2 has exact same range as Y1
• Align: Y2 expands to show all data, with a shared anchor point (default 0)`}
      <SettingsSection
        title="Y2 sync"
        class="ctrl-line"
        current_values={{
          y2_sync: current_sync.mode,
          align_value: current_sync.align_value,
        }}
        on_reset={() => {
          y2_axis = { ...y2_axis, sync: undefined }
        }}
        layout="flow"
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

    <SettingsSection
      title="Ticks"
      data-testid="ticks-section"
      class="ctrl-line axis-fields"
      current_values={axis_record(tick_count)}
      on_reset_key={reset_axis_field(`ticks`)}
      layout="flow"
    >
      {#each visible_axes as [axis, label] (axis)}
        {@const count = tick_count(axis)}
        {@const custom = count === undefined && axis_config(axis).ticks !== undefined}
        <label>
          <span>{label}</span>
          <input
            type="number"
            min="1"
            max={MAX_TICK_COUNT}
            step="1"
            value={count ?? ``}
            placeholder={custom ? `custom` : `auto`}
            disabled={custom}
            aria-label="{label} axis tick count"
            oninput={(evt) => update_tick_count(axis, evt.currentTarget.value)}
            onkeydown={(evt) => evt.key === `Enter` && evt.currentTarget.blur()}
          />
        </label>
      {/each}
    </SettingsSection>

    <SettingsSection
      title="Tick format"
      data-testid="tick-format-section"
      class="ctrl-line formats tick-format-section"
      current_values={axis_record((axis) => axis_config(axis).format)}
      on_reset_key={reset_axis_field(`format`)}
      layout="flow"
    >
      {#each visible_axes as [axis, label] (axis)}
        <label>
          <span>{label}-axis</span>
          <input
            type="text"
            value={axis_config(axis).format ?? ``}
            placeholder={format_placeholders[axis]}
            oninput={format_input_handler(axis)}
          />
        </label>
      {/each}
    </SettingsSection>

    {@render post_children?.(ctrl_state)}
  </ControlPane>
{/if}

<style>
  :is(.control-options, .range-pair) {
    display: flex;
    align-items: center;
    gap: 3pt;
    min-width: 0;
  }
  .control-options {
    flex-wrap: wrap;
  }
  .range-pair {
    flex-wrap: nowrap;
  }
  .control-options label {
    display: flex;
    align-items: center;
    gap: 3pt;
  }
  .range-pair input {
    width: auto;
    min-width: 3.2em;
    flex: 1;
  }
  :global(.tick-format-section input) {
    width: 100%;
  }
</style>
