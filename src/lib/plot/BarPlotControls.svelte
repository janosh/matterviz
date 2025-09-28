<script lang="ts">
  import { DraggablePane, SettingsSection } from '$lib'
  import type { BarMode, Orientation } from '$lib/plot'
  import type { TicksOption } from '$lib/plot/scales'
  import { DEFAULTS } from '$lib/settings'
  import type { ComponentProps, Snippet } from 'svelte'

  interface Props {
    show_controls?: boolean
    controls_open?: boolean
    orientation?: Orientation
    mode?: BarMode
    x_grid?: boolean | Record<string, unknown>
    y_grid?: boolean | Record<string, unknown>
    x_ticks?: TicksOption
    y_ticks?: TicksOption
    x_format?: string
    y_format?: string
    x_range?: [number | null, number | null] | undefined
    y_range?: [number | null, number | null] | undefined
    auto_x_range?: [number, number]
    auto_y_range?: [number, number]
    plot_controls?: Snippet<[]> | undefined
    toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
    pane_props?: ComponentProps<typeof DraggablePane>[`pane_props`]
  }
  let {
    show_controls = $bindable(false),
    controls_open = $bindable(false),
    orientation = $bindable(`vertical` as Orientation),
    mode = $bindable(`overlay` as BarMode),
    x_grid = $bindable(true),
    y_grid = $bindable(true),
    x_ticks = $bindable(8),
    y_ticks = $bindable(6),
    x_format = $bindable(``),
    y_format = $bindable(``),
    x_range = $bindable<[number | null, number | null] | undefined>(undefined),
    y_range = $bindable<[number | null, number | null] | undefined>(undefined),
    auto_x_range = [0, 1] as [number, number],
    auto_y_range = [0, 1] as [number, number],
    plot_controls,
    toggle_props,
    pane_props,
  }: Props = $props()

  function set_auto_ranges() {
    x_range = [...auto_x_range]
    y_range = [...auto_y_range]
  }

  // Handlers similar to Histogram/Scatter controls
  const ticks_input_handler = (axis: `x` | `y`) => (event: Event) => {
    const input = event.target as HTMLInputElement
    const value = parseInt(input.value, 10)
    if (!Number.isNaN(value) && value > 0) {
      if (axis === `x`) x_ticks = value
      else y_ticks = value
    }
  }

  // Element refs for per-instance range inputs
  const range_inputs = {
    x: { min: null as HTMLInputElement | null, max: null as HTMLInputElement | null },
    y: { min: null as HTMLInputElement | null, max: null as HTMLInputElement | null },
  }

  // Applies the min/max inputs for the given axis after blur/Enter.
  // - Validates the pair (min < max)
  // - When both inputs are empty, clears the bound range to fall back to auto
  // - If one side is empty, substitutes the corresponding auto bound
  const range_complete = (axis: `x` | `y`) => {
    const min_el = range_inputs[axis].min
    const max_el = range_inputs[axis].max
    if (!min_el || !max_el) return
    ;[min_el, max_el].forEach((el) => el.classList.remove(`invalid`))

    const parse = (
      el: HTMLInputElement,
    ) => (el.value === `` ? null : Number(el.value))
    const min_val = parse(min_el)
    const max_val = parse(max_el)

    if (min_val !== null && max_val !== null && min_val >= max_val) {
      min_el.classList.add(`invalid`)
      max_el.classList.add(`invalid`)
      return
    }

    const auto = axis === `x` ? auto_x_range : auto_y_range
    const final_range = (min_val === null && max_val === null)
      ? undefined
      : [min_val ?? auto[0], max_val ?? auto[1]] as [number, number]

    if (axis === `x`) x_range = final_range
    else y_range = final_range
  }

  const input_props = (
    axis: `x` | `y`,
    bound: `min` | `max`,
    range?: [number | null, number | null],
  ) => ({
    type: `number`,
    value: range?.[bound === `min` ? 0 : 1] ?? ``,
    placeholder: `auto`,
    class: `range-input`,
    onblur: () => range_complete(axis),
    onkeydown: (e: KeyboardEvent) =>
      e.key === `Enter` && (e.target as HTMLElement).blur(),
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
      title: `${controls_open ? `Close` : `Open`} bar plot controls`,
      ...toggle_props,
      class: `bar-controls-toggle ${toggle_props?.class ?? ``}`,
      style: `${toggle_style} ${toggle_props?.style ?? ``}`,
    }}
    pane_props={{
      ...pane_props,
      class: `bar-controls-pane ${pane_props?.class ?? ``}`,
      style: `--pane-padding: 4px; --pane-gap: 4px; ${pane_props?.style ?? ``}`,
    }}
  >
    {#if plot_controls}
      {@render plot_controls()}
    {:else}
      <SettingsSection
        title="Display"
        current_values={{ x_grid, y_grid }}
        on_reset={() => {
          x_grid = DEFAULTS.plot.x_grid
          y_grid = DEFAULTS.plot.y_grid
        }}
      >
        <label>
          <input type="checkbox" bind:checked={x_grid as boolean} /> X-axis grid
        </label>
        <label>
          <input type="checkbox" bind:checked={y_grid as boolean} /> Y-axis grid
        </label>
      </SettingsSection>

      <SettingsSection
        title="Layout"
        current_values={{ orientation, mode }}
      >
        <label>Orientation:
          <select bind:value={orientation} id="orientation-select">
            <option value="vertical">Vertical</option>
            <option value="horizontal">Horizontal</option>
          </select>
        </label>
        <label>Mode:
          <select bind:value={mode} id="mode-select">
            <option value="overlay">Overlay</option>
            <option value="stacked">Stacked</option>
          </select>
        </label>
      </SettingsSection>

      <SettingsSection
        title="Axis Range"
        current_values={{ x_range, y_range }}
        on_reset={() => {
          x_range = undefined
          y_range = undefined
        }}
      >
        <label>X-axis:
          <input
            {...input_props(`x`, `min`, x_range)}
            bind:this={range_inputs.x.min}
          />
          &nbsp;to
          <input
            {...input_props(`x`, `max`, x_range)}
            bind:this={range_inputs.x.max}
          />
        </label>
        <label>Y-axis:
          <input
            {...input_props(`y`, `min`, y_range)}
            bind:this={range_inputs.y.min}
          />
          &nbsp;to
          <input
            {...input_props(`y`, `max`, y_range)}
            bind:this={range_inputs.y.max}
          />
        </label>
        <button onclick={set_auto_ranges} style="margin-left: 8px">auto</button>
      </SettingsSection>

      <SettingsSection
        title="Ticks"
        current_values={{ x_ticks, y_ticks }}
        on_reset={() => {
          x_ticks = DEFAULTS.plot.x_ticks
          y_ticks = DEFAULTS.plot.y_ticks
        }}
      >
        <label>X-axis:
          <input
            type="number"
            min="2"
            max="20"
            step="1"
            value={typeof x_ticks === `number` ? x_ticks : 8}
            oninput={ticks_input_handler(`x`)}
          />
        </label>
        <label>Y-axis:
          <input
            type="number"
            min="2"
            max="20"
            step="1"
            value={typeof y_ticks === `number` ? y_ticks : 6}
            oninput={ticks_input_handler(`y`)}
          />
        </label>
      </SettingsSection>

      <SettingsSection
        title="Tick Format"
        current_values={{ x_format, y_format }}
        on_reset={() => {
          x_format = DEFAULTS.plot.x_format
          y_format = DEFAULTS.plot.y_format
        }}
      >
        <label>X-axis:
          <input type="text" bind:value={x_format} placeholder=".2~s / .0%" />
        </label>
        <label>Y-axis:
          <input type="text" bind:value={y_format} placeholder="d / .1e" />
        </label>
      </SettingsSection>
    {/if}
  </DraggablePane>
{/if}

<style>
  label {
    display: inline-flex !important;
    margin: 0 0 0 5pt;
  }
</style>
