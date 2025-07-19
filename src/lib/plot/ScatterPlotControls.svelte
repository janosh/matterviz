<script lang="ts">
  import { DraggablePanel } from '$lib'
  import type { DataSeries } from '$lib/plot'
  import { format } from 'd3-format'
  import { timeFormat } from 'd3-time-format'
  import type { ComponentProps, Snippet } from 'svelte'

  interface Props {
    // Control panel visibility
    show_controls?: boolean
    controls_open?: boolean
    // Custom content for the control panel
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
    line_dash?: string | undefined
    show_points?: boolean
    show_lines?: boolean
    selected_series_idx?: number
    controls_toggle_props?: ComponentProps<typeof DraggablePanel>[`toggle_props`]
    controls_panel_props?: ComponentProps<typeof DraggablePanel>[`panel_props`]
  }
  let {
    show_controls = $bindable(false),
    controls_open = $bindable(false),
    plot_controls,
    series = [],
    markers = $bindable(`line+points`),
    show_zero_lines = $bindable(true),
    x_grid = $bindable(true),
    y_grid = $bindable(true),
    y2_grid = $bindable(true),
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
    x_format = $bindable(``),
    y_format = $bindable(``),
    y2_format = $bindable(``),
    // Style controls
    point_size = $bindable(4),
    point_color = $bindable(`#4682b4`),
    point_opacity = $bindable(1),
    point_stroke_width = $bindable(1),
    point_stroke_color = $bindable(`#000000`),
    point_stroke_opacity = $bindable(1),
    line_width = $bindable(2),
    line_color = $bindable(`#4682b4`),
    line_opacity = $bindable(1),
    line_dash = $bindable(undefined),
    show_points = $bindable(true),
    show_lines = $bindable(true),
    selected_series_idx = $bindable(0),
    controls_toggle_props = {},
    controls_panel_props = {},
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
  <DraggablePanel
    bind:show={controls_open}
    closed_icon="Settings"
    open_icon="Cross"
    icon_style="transform: scale(1.2);"
    toggle_props={{
      class: `scatter-controls-toggle`,
      title: `${controls_open ? `Close` : `Open`} scatter plot controls`,
      ...controls_toggle_props,
    }}
    panel_props={{
      class: `scatter-controls-panel`,
      style:
        `--panel-width: 16em; max-height: 450px; overflow-y: auto; padding-right: 4px;`,
      ...controls_panel_props,
    }}
  >
    {#if plot_controls}
      {@render plot_controls()}
    {:else}
      <h4 style="margin-top: 0">Scatter Plot Controls</h4>
      <div class="controls-group">
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={show_zero_lines} /> Show zero lines
        </label>
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={show_points} /> Show points
        </label>
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={show_lines} /> Show lines
        </label>
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={x_grid as boolean} /> X-axis grid
        </label>
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={y_grid as boolean} /> Y-axis grid
        </label>
        {#if has_y2_points}
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={y2_grid as boolean} /> Y2-axis grid
          </label>
        {/if}
      </div>

      <!-- Range Controls -->
      <h4>Axis Range</h4>
      <div class="controls-group">
        <div class="range-row">
          <label for="x-range-min">X-axis:</label>
          <input {...input_props(`x`, `min`, x_range)} />
          <span class="range-separator">to</span>
          <input {...input_props(`x`, `max`, x_range)} />
        </div>
        <div class="range-row">
          <label for="y-range-min">Y-axis:</label>
          <input {...input_props(`y`, `min`, y_range)} />
          <span class="range-separator">to</span>
          <input {...input_props(`y`, `max`, y_range)} />
        </div>
        {#if has_y2_points}
          <div class="range-row">
            <label for="y2-range-min">Y2-axis:</label>
            <input {...input_props(`y2`, `min`, y2_range)} />
            <span class="range-separator">to</span>
            <input {...input_props(`y2`, `max`, y2_range)} />
          </div>
        {/if}
      </div>

      <!-- Format Controls -->
      <h4>Tick Format</h4>
      <div class="controls-group">
        <div class="panel-row">
          <label for="x-format">X-axis:</label>
          <input
            id="x-format"
            type="text"
            bind:value={x_format_input}
            placeholder=".2f / .0% / %Y-%m-%d"
            class="format-input"
            oninput={format_input_handler(`x`)}
          />
        </div>
        <div class="panel-row">
          <label for="y-format">Y-axis:</label>
          <input
            id="y-format"
            type="text"
            bind:value={y_format_input}
            placeholder=".2f / .1e / .0%"
            class="format-input"
            oninput={format_input_handler(`y`)}
          />
        </div>
        {#if has_y2_points}
          <div class="panel-row">
            <label for="y2-format">Y2-axis:</label>
            <input
              id="y2-format"
              type="text"
              bind:value={y2_format_input}
              placeholder=".2f / .1e / .0%"
              class="format-input"
              oninput={format_input_handler(`y2`)}
            />
          </div>
        {/if}
      </div>

      <!-- Series Selection (for multi-series style controls) -->
      {#if has_multiple_series}
        <div class="controls-group">
          <div class="panel-row">
            <label for="series-select">Series</label>
            <select bind:value={selected_series_idx} id="series-select">
              {#each series.filter(Boolean) as
                series_data,
                idx
                (series_data.label ?? idx)
              }
                <option value={idx}>
                  {series_data.label ?? `Series ${idx + 1}`}
                </option>
              {/each}
            </select>
          </div>
        </div>
      {/if}

      <!-- Point Style Controls -->
      {#if show_points}
        <h4>Point Style</h4>
        <div class="controls-group">
          <div class="panel-row">
            <label for="point-size-range">Size:</label>
            <input
              id="point-size-range"
              type="range"
              min="1"
              max="20"
              step="0.5"
              bind:value={point_size}
            />
            <input
              type="number"
              min="1"
              max="20"
              step="0.5"
              bind:value={point_size}
              class="number-input"
            />
          </div>
          <div class="panel-row">
            <label for="point-color">Color:</label>
            <input
              id="point-color"
              type="color"
              bind:value={point_color}
              class="color-input"
            />
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              bind:value={point_opacity}
              class="opacity-slider"
              title="Color opacity"
            />
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              bind:value={point_opacity}
              class="number-input opacity-number"
            />
          </div>
          <div class="panel-row">
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
              class="number-input"
            />
          </div>
          <div class="panel-row">
            <label for="point-stroke-color">Stroke Color:</label>
            <input
              id="point-stroke-color"
              type="color"
              bind:value={point_stroke_color}
            />
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              bind:value={point_stroke_opacity}
              class="opacity-slider"
              title="Stroke opacity"
            />
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              bind:value={point_stroke_opacity}
              class="number-input opacity-number"
            />
          </div>
        </div>
      {/if}

      <!-- Line Style Controls -->
      {#if show_lines}
        <h4>Line Style</h4>
        <div class="controls-group">
          <div class="panel-row">
            <label for="line-width-range">Line Width:</label>
            <input
              id="line-width-range"
              type="range"
              min="0.5"
              max="10"
              step="0.5"
              bind:value={line_width}
            />
            <input
              type="number"
              min="0.5"
              max="10"
              step="0.5"
              bind:value={line_width}
              class="number-input"
            />
          </div>
          <div class="panel-row">
            <label for="line-color">Line Color:</label>
            <input
              id="line-color"
              type="color"
              bind:value={line_color}
            />
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              bind:value={line_opacity}
              class="opacity-slider"
              title="Line opacity"
            />
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              bind:value={line_opacity}
              class="number-input opacity-number"
            />
          </div>
          <div class="panel-row">
            <label for="line-style-select">Line Style:</label>
            <select
              id="line-style-select"
              value={line_dash ?? `solid`}
              onchange={(event) => {
                line_dash = event.currentTarget.value === `solid`
                  ? undefined
                  : event.currentTarget.value
              }}
            >
              <option value="solid">Solid</option>
              <option value="4,4">Dashed</option>
              <option value="2,2">Dotted</option>
              <option value="8,4,2,4">Dash-dot</option>
            </select>
          </div>
        </div>
      {/if}
    {/if}
  </DraggablePanel>
{/if}

<style>
  h4 {
    margin: 8pt 0 2pt;
    font-size: 0.9em;
  }
  .controls-group {
    display: flex;
    flex-direction: column;
  }
  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.85em;
  }
  .panel-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.85em;
  }
  .panel-row label {
    min-width: 80px;
    font-size: 0.85em;
  }
  .panel-row input[type='range'] {
    flex: 1;
    min-width: 60px;
  }
  .number-input {
    width: 50px;
    text-align: center;
    border-radius: 3px;
    padding: 2px 4px;
    font-size: 0.8em;
    box-sizing: border-box;
  }
  .panel-row input[type='color'] {
    width: 40px;
    height: 24px;
    box-sizing: border-box;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
  }
  .panel-row select {
    flex: 1;
    border-radius: 3px;
    padding: 2px 4px;
    font-size: 0.8em;
  }
  .opacity-slider {
    flex: 1;
    min-width: 50px;
    margin-left: 4px;
  }
  .opacity-number {
    width: 40px;
    margin-left: 4px;
  }
  .format-input {
    flex: 1;
    border-radius: 3px;
    padding: 4px 6px;
    font-size: 0.8em;
    font-family: monospace;
  }
  .format-input::placeholder {
    color: rgba(255, 255, 255, 0.5);
    font-style: italic;
  }
  .format-input.invalid {
    border-color: var(--error-color, #ff6b6b);
    background: rgba(255, 107, 107, 0.1);
  }
  .format-input.invalid:focus {
    outline-color: var(--error-color, #ff6b6b);
    box-shadow: 0 0 0 2px rgba(255, 107, 107, 0.2);
  }
  .range-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.85em;
  }
  .range-row label {
    min-width: 80px;
    font-size: 0.85em;
  }
  .range-row .range-separator {
    margin: 0 4px;
    font-size: 0.85em;
  }
  .range-input {
    flex: 1;
    border-radius: 3px;
    padding: 4px 6px;
    font-size: 0.8em;
    font-family: monospace;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-color, #fff);
    transition: border-color 0.2s ease-in-out;
  }
  .range-input:focus {
    outline: none;
    border-color: var(--primary-color, #4f46e5);
    box-shadow: 0 0 0 2px rgba(79, 70, 229, 0.2);
  }
  .range-input.invalid {
    border-color: var(--error-color, #ff6b6b);
    background: rgba(255, 107, 107, 0.1);
  }
  .range-input.invalid:focus {
    outline-color: var(--error-color, #ff6b6b);
    box-shadow: 0 0 0 2px rgba(255, 107, 107, 0.2);
  }
</style>
