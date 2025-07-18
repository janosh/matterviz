<script lang="ts">
  import { DraggablePanel } from '$lib'
  import type { DataSeries } from '$lib/plot'
  import { format } from 'd3-format'
  import { timeFormat } from 'd3-time-format'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { TicksOption } from './scales'

  interface Props {
    // Control panel visibility
    show_controls?: boolean
    controls_open?: boolean
    // Custom content for the control panel
    plot_controls?: Snippet<[]>
    // Series data for multi-series controls
    series?: readonly DataSeries[]
    // Histogram-specific controls
    bins?: number
    mode?: `single` | `overlay`
    bar_opacity?: number
    bar_stroke_width?: number
    show_legend?: boolean
    // Grid controls
    x_grid?: boolean | Record<string, unknown>
    y_grid?: boolean | Record<string, unknown>
    // Scale type controls
    x_scale_type?: `linear` | `log`
    y_scale_type?: `linear` | `log`
    // Tick controls
    x_ticks?: TicksOption
    y_ticks?: TicksOption
    // Format controls
    x_format?: string
    y_format?: string
    // Selected property for single mode
    selected_property?: string
    toggle_props?: ComponentProps<typeof DraggablePanel>[`toggle_props`]
    panel_props?: ComponentProps<typeof DraggablePanel>[`panel_props`]
  }
  let {
    show_controls = $bindable(false),
    controls_open = $bindable(false),
    plot_controls,
    series = [],
    bins = $bindable(20),
    mode = $bindable(`single`),
    bar_opacity = $bindable(0.7),
    bar_stroke_width = $bindable(1),
    show_legend = $bindable(true),
    x_grid = $bindable(true),
    y_grid = $bindable(true),
    x_scale_type = $bindable(`linear`),
    y_scale_type = $bindable(`linear`),
    x_ticks = $bindable(8),
    y_ticks = $bindable(6),
    x_format = $bindable(`.2~s`),
    y_format = $bindable(`d`),
    selected_property = $bindable(``),
    toggle_props,
    panel_props,
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
  function handle_format_input(event: Event, format_type: `x` | `y`) {
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
  function handle_ticks_input(event: Event, axis: `x` | `y`) {
    const input = event.target as HTMLInputElement
    const value = parseInt(input.value, 10)

    if (!isNaN(value) && value > 0) {
      if (axis === `x`) x_ticks = value
      else if (axis === `y`) y_ticks = value
    }
  }

  // Sync local format inputs with props
  $effect(() => {
    x_format_input = x_format
    y_format_input = y_format
  })
</script>

{#if show_controls}
  <DraggablePanel
    bind:show={controls_open}
    closed_icon="Settings"
    open_icon="Cross"
    icon_style="transform: scale(1.2);"
    offset={{ x: -35, y: 10 }}
    toggle_props={{
      class: `histogram-controls-toggle`,
      title: `${controls_open ? `Close` : `Open`} histogram controls`,
      style:
        `position: absolute; top: var(--ctrl-btn-top, 1ex); right: var(--ctrl-btn-right, 1ex); background-color: transparent; ${
          toggle_props?.style ?? ``
        }`,
      ...toggle_props,
    }}
    panel_props={{
      class: `histogram-controls-panel`,
      style:
        `--panel-width: 16em; max-height: 450px; overflow-y: auto; padding-right: 4px;`,
      ...panel_props,
    }}
  >
    {#if plot_controls}
      {@render plot_controls()}
    {:else}
      <h4 style="margin-top: 0">Histogram Controls</h4>
      <div class="controls-group">
        <div class="panel-row">
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
            class="number-input"
          />
        </div>
        {#if has_multiple_series}
          <div class="panel-row">
            <label for="mode-select">Mode:</label>
            <select bind:value={mode} id="mode-select">
              <option value="single">Single</option>
              <option value="overlay">Overlay</option>
            </select>
          </div>
          {#if mode === `single`}
            <div class="panel-row">
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
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={show_legend} />
          Show legend
        </label>
      </div>

      <!-- Bar Style Controls -->
      <h4>Bar Style</h4>
      <div class="controls-group">
        <div class="panel-row">
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
            class="number-input"
          />
        </div>
        <div class="panel-row">
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
            class="number-input"
          />
        </div>
      </div>

      <!-- Display Controls -->
      <h4>Display</h4>
      <div class="controls-group">
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={x_grid as boolean} />
          X-axis grid
        </label>
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={y_grid as boolean} />
          Y-axis grid
        </label>
      </div>

      <!-- Scale Type Controls -->
      <h4>Scale Type</h4>
      <div class="controls-group">
        <div class="panel-row">
          <label for="x-scale-select">X-axis:</label>
          <select bind:value={x_scale_type} id="x-scale-select">
            <option value="linear">Linear</option>
            <option value="log">Log</option>
          </select>
        </div>
        <div class="panel-row">
          <label for="y-scale-select">Y-axis:</label>
          <select bind:value={y_scale_type} id="y-scale-select">
            <option value="linear">Linear</option>
            <option value="log">Log</option>
          </select>
        </div>
      </div>

      <!-- Tick Controls -->
      <h4>Ticks</h4>
      <div class="controls-group">
        <div class="panel-row">
          <label for="x-ticks-input">X-axis:</label>
          <input
            id="x-ticks-input"
            type="number"
            min="2"
            max="20"
            step="1"
            value={typeof x_ticks === `number` ? x_ticks : 8}
            oninput={(event) => handle_ticks_input(event, `x`)}
            class="number-input"
          />
        </div>
        <div class="panel-row">
          <label for="y-ticks-input">Y-axis:</label>
          <input
            id="y-ticks-input"
            type="number"
            min="2"
            max="20"
            step="1"
            value={typeof y_ticks === `number` ? y_ticks : 6}
            oninput={(event) => handle_ticks_input(event, `y`)}
            class="number-input"
          />
        </div>
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
            placeholder=".2~s / .0% / %Y-%m-%d"
            class="format-input"
            oninput={(event) => handle_format_input(event, `x`)}
          />
        </div>
        <div class="panel-row">
          <label for="y-format">Y-axis:</label>
          <input
            id="y-format"
            type="text"
            bind:value={y_format_input}
            placeholder="d / .1e / .0%"
            class="format-input"
            oninput={(event) => handle_format_input(event, `y`)}
          />
        </div>
      </div>
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
    gap: 6pt;
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
  .panel-row select {
    flex: 1;
    border-radius: 3px;
    padding: 2px 4px;
    font-size: 0.8em;
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
  .format-input:global(.invalid) {
    border-color: var(--error-color, #ff6b6b);
    background: rgba(255, 107, 107, 0.1);
  }
  .format-input:global(.invalid):focus {
    outline-color: var(--error-color, #ff6b6b);
    box-shadow: 0 0 0 2px rgba(255, 107, 107, 0.2);
  }
</style>
