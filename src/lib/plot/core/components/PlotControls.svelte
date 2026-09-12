<script lang="ts">
  import { INITIAL_SETTINGS_LABELS, track_settings } from '$lib/controls'
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
    auto_ranges = {},
    controls_title = `plot`,
    controls_name = `plot`,
    toggle_props = {},
    pane_props = {},
    on_export,
    export_formats = [`png`, `svg`, `csv`],
  }: PlotControlsProps = $props()

  // Check if an axis range spans zero (handles inverted ranges like [3.5, 1.4])
  const range_spans_zero = (lower: number, upper: number): boolean =>
    Math.min(lower, upper) <= 0 && Math.max(lower, upper) >= 0

  const all_axes = [`x`, `x2`, `y`, `y2`] as const
  const auto_range = (axis: AxisKey): Vec2 | undefined =>
    auto_ranges[axis] ?? (axis === `x` || axis === `y` ? [0, 1] : undefined)
  const axis_record = <Value>(get_value: (axis: AxisKey) => Value): Record<AxisKey, Value> =>
    Object.fromEntries(all_axes.map((axis) => [axis, get_value(axis)])) as Record<
      AxisKey,
      Value
    >
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
  const axis_config = (axis: AxisKey): AxisConfig =>
    axis === `x` ? x_axis : axis === `x2` ? x2_axis : axis === `y` ? y_axis : y2_axis
  const is_axis_key = (key: string): key is AxisKey =>
    (all_axes as readonly string[]).includes(key)
  // The Ticks inputs only edit numeric tick counts; an explicit tick list/map/interval set on
  // the axis is left alone (and shown as `custom`), and an empty input hands back to auto
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
  let visible_axes = $derived(
    all_axes
      .filter((axis) => axis === `x` || axis === `y` || auto_ranges[axis] !== undefined)
      .map((axis) => [axis, axis.toUpperCase()] as const),
  )
  // whether each axis range spans zero, gating the zero-line toggles
  let includes_zero = $derived(
    axis_record((axis) => {
      const auto = auto_range(axis)
      const { range } = axis_config(axis)
      return auto != null && range_spans_zero(range?.[0] ?? auto[0], range?.[1] ?? auto[1])
    }),
  )
  const format_placeholders: Record<AxisKey, string> = {
    x: `.2~s / .0% / %Y-%m-%d`,
    x2: `.2~s / .0% / %Y-%m-%d`,
    y: `d / .1e / .0%`,
    y2: `.2f / .1e / .0%`,
  }

  const update_format = (axis: AxisKey, input: HTMLInputElement): void => {
    const { value } = input
    try {
      if (value.startsWith(`%`)) timeFormat(value)(new Date())
      else if (value) format(value)(123.456)
    } catch {
      input.classList.add(`invalid`)
      return
    }
    input.classList.remove(`invalid`)
    update_axis(axis, { format: value })
  }

  // Empty endpoints stay automatic in caller state. Invalid pairs stay local until corrected.
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
    update_axis(axis, { range: next })
  }

  const display_settings = track_settings(
    () => ({
      ...display_values(),
      ...display_extra_values,
    }),
    `initial`,
  )
  // Each field owns both its complete baseline and the callback that restores it.
  const track_axis_field = (field: `range` | `ticks` | `format`) => {
    const settings = track_settings(
      () => axis_record((axis) => axis_config(axis)[field]),
      `initial`,
    )
    return {
      labels: INITIAL_SETTINGS_LABELS,
      get changed_keys() {
        return settings.changed_keys
      },
      on_reset_key: (key: string) => {
        if (is_axis_key(key)) update_axis(key, { [field]: settings.snapshot([key])[key] })
      },
    }
  }
  const axis_range_settings = track_axis_field(`range`)
  const scale_type_settings = track_settings(
    () => axis_record((axis) => get_scale_type_name(axis_config(axis).scale_type)),
    axis_record(() => `linear`),
  )
  const current_sync = $derived(normalize_y2_sync(y2_axis.sync))
  const y2_sync_settings = track_settings(
    () => ({ y2_sync: current_sync.mode, align_value: current_sync.align_value }),
    { y2_sync: `none`, align_value: undefined },
  )
  // Track the full configuration: custom lists, labels and intervals must also reset.
  const ticks_settings = track_axis_field(`ticks`)
  const tick_format_settings = track_axis_field(`format`)
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

<ControlPane
  {show_controls}
  bind:controls_open
  {controls_name}
  toggle_title={controls_title}
  pane_class="compact-settings"
  {toggle_props}
  {pane_props}
>
  {@render children?.()}

  <SettingsSection
    title="Display"
    class="ctrl-line"
    changed_keys={display_settings.changed_keys}
    labels={INITIAL_SETTINGS_LABELS}
    on_reset={() => {
      const reference = display_settings.snapshot()
      display = {
        ...display,
        ...Object.fromEntries(
          Object.keys(display_values()).map((key) => [key, reference[key]]),
        ),
      }
      on_display_extra_reset?.(reference)
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
    {...axis_range_settings}
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
    changed_keys={scale_type_settings.changed_keys}
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

  {#if auto_ranges.y2}
    {@const y2_sync_tip = `Controls Y2 axis range:
• Independent: Y2 has its own range based on its data
• Synced: Y2 has exact same range as Y1
• Align: Y2 expands to show all data, with a shared anchor point (default 0)`}
    <SettingsSection
      title="Y2 sync"
      class="ctrl-line"
      changed_keys={y2_sync_settings.changed_keys}
      on_reset={() => update_axis(`y2`, { sync: undefined })}
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
            update_axis(`y2`, {
              sync:
                mode === `none`
                  ? undefined
                  : mode === `align`
                    ? { mode, align_value: current_sync.align_value ?? 0 }
                    : mode,
            })
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
              update_axis(`y2`, {
                sync: {
                  mode: `align`,
                  align_value: Number.isFinite(val) ? val : 0,
                },
              })
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
    {...ticks_settings}
    layout="flow"
  >
    {#each visible_axes as [axis, label] (axis)}
      {@const ticks = axis_config(axis).ticks}
      {@const custom = ticks !== undefined && typeof ticks !== `number`}
      <label>
        <span>{label}</span>
        <input
          type="number"
          min="1"
          max={MAX_TICK_COUNT}
          step="1"
          value={typeof ticks === `number` ? ticks : ``}
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
    {...tick_format_settings}
    layout="flow"
  >
    {#each visible_axes as [axis, label] (axis)}
      <label>
        <span>{label}-axis</span>
        <input
          type="text"
          value={axis_config(axis).format ?? ``}
          placeholder={format_placeholders[axis]}
          oninput={(event) => update_format(axis, event.currentTarget)}
        />
      </label>
    {/each}
  </SettingsSection>

  {@render post_children?.()}

  {#if on_export}
    <SettingsSection title="Export" layout="flow">
      {#each export_formats as format (format)}
        <button type="button" class="export-btn" onclick={() => on_export?.(format)}>
          {format.toUpperCase()}
        </button>
      {/each}
    </SettingsSection>
  {/if}
</ControlPane>

<style>
  .export-btn {
    padding: 2pt 8pt;
    cursor: pointer;
  }
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
