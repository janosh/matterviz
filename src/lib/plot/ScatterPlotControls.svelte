<script lang="ts">
  import { ControlPanel } from '$lib'
  import type { DataSeries } from '$lib/plot'
  import { format } from 'd3-format'
  import { timeFormat } from 'd3-time-format'
  import type { Snippet } from 'svelte'

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
  }: Props = $props()

  // Local variables for format inputs to prevent invalid values from reaching props
  let x_format_input = $state(x_format)
  let y_format_input = $state(y_format)
  let y2_format_input = $state(y2_format)

  // Derived state
  let has_multiple_series = $derived(series.filter(Boolean).length > 1)

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
  function handle_format_input(event: Event, format_type: `x` | `y` | `y2`) {
    const input = event.target as HTMLInputElement

    // Update local variable
    if (format_type === `x`) x_format_input = input.value
    else if (format_type === `y`) y_format_input = input.value
    else if (format_type === `y2`) y2_format_input = input.value

    // Only update prop if valid
    if (is_valid_format(input.value)) {
      input.classList.remove(`invalid`)
      if (format_type === `x`) x_format = input.value
      else if (format_type === `y`) y_format = input.value
      else if (format_type === `y2`) y2_format = input.value
    } else input.classList.add(`invalid`)
  }

  // Handle click outside control panel to close it
  function handle_click_outside_controls(event: MouseEvent) {
    if (!controls_open) return

    const target = event.target as Element
    const control_panel = target.closest(`.plot-controls`)

    // Don't close if clicking inside the control panel
    if (!control_panel) controls_open = false
  }

  // Sync control states with props
  $effect(() => {
    // Sync with markers prop
    show_points = markers?.includes(`points`) ?? false
    show_lines = markers?.includes(`line`) ?? false

    // Sync with selected series style properties
    if (
      series.length > 0 &&
      selected_series_idx >= 0 &&
      selected_series_idx < series.length &&
      series[selected_series_idx]
    ) {
      const selected_series = series[selected_series_idx]

      // Point style
      const selected_point_style = Array.isArray(selected_series.point_style)
        ? selected_series.point_style[0]
        : selected_series.point_style

      if (selected_point_style) {
        point_size = selected_point_style.radius ?? 4
        point_color = selected_point_style.fill ?? `#4682b4`
        point_stroke_width = selected_point_style.stroke_width ?? 1
        point_stroke_color = selected_point_style.stroke ?? `#000000`
        point_opacity = selected_point_style.fill_opacity ?? 1
      }

      // Line style
      if (selected_series.line_style) {
        line_width = selected_series.line_style.stroke_width ?? 2
        line_color = selected_series.line_style.stroke ?? `#4682b4`
        line_dash = selected_series.line_style.line_dash
      }
    }
  })

  // Apply control states back to props
  $effect(() => {
    // Update markers
    const new_markers = show_points && show_lines
      ? `line+points`
      : show_points
      ? `points`
      : show_lines
      ? `line`
      : `points`

    if (new_markers !== markers) markers = new_markers
  })
</script>

<svelte:document onclick={handle_click_outside_controls} />

{#if show_controls}
  <div class="plot-controls">
    <ControlPanel
      bind:controls_open
      show_toggle_button
      panel_props={{ style: `top: 30px; right: 6px;` }}
      closed_icon="Settings"
      open_icon="Cross"
    >
      {#snippet controls_content()}
        {#if plot_controls}
          {@render plot_controls()}
        {:else}
          <div class="plot-controls-content">
            <!-- Display Controls -->
            <h4 class="section-heading">Display</h4>
            <div class="controls-group">
              <label class="checkbox-label">
                <input type="checkbox" bind:checked={show_zero_lines} />
                Show zero lines
              </label>
              <label class="checkbox-label">
                <input type="checkbox" bind:checked={show_points} />
                Show points
              </label>
              <label class="checkbox-label">
                <input type="checkbox" bind:checked={show_lines} />
                Show lines
              </label>
              <label class="checkbox-label">
                <input type="checkbox" bind:checked={x_grid as boolean} />
                X-axis grid
              </label>
              <label class="checkbox-label">
                <input type="checkbox" bind:checked={y_grid as boolean} />
                Y-axis grid
              </label>
              {#if has_y2_points}
                <label class="checkbox-label">
                  <input type="checkbox" bind:checked={y2_grid as boolean} />
                  Y2-axis grid
                </label>
              {/if}
            </div>

            <!-- Format Controls -->
            <h4 class="section-heading">Tick Format</h4>
            <div class="controls-group">
              <div class="control-row">
                <label for="x-format">X-axis:</label>
                <input
                  id="x-format"
                  type="text"
                  bind:value={x_format_input}
                  placeholder="e.g., .2f, .0%, %Y-%m-%d"
                  class="format-input"
                  oninput={(event) => handle_format_input(event, `x`)}
                />
              </div>
              <div class="control-row">
                <label for="y-format">Y-axis:</label>
                <input
                  id="y-format"
                  type="text"
                  bind:value={y_format_input}
                  placeholder="e.g., .2f, .1e, .0%"
                  class="format-input"
                  oninput={(event) => handle_format_input(event, `y`)}
                />
              </div>
              {#if has_y2_points}
                <div class="control-row">
                  <label for="y2-format">Y2-axis:</label>
                  <input
                    id="y2-format"
                    type="text"
                    bind:value={y2_format_input}
                    placeholder="e.g., .2f, .1e, .0%"
                    class="format-input"
                    oninput={(event) => handle_format_input(event, `y2`)}
                  />
                </div>
              {/if}
            </div>

            <!-- Series Selection (for multi-series style controls) -->
            {#if has_multiple_series}
              <div class="controls-group">
                <div class="control-row">
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
              <h4 class="section-heading">Point Style</h4>
              <div class="controls-group">
                <div class="control-row">
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
                <div class="control-row">
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
                <div class="control-row">
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
                <div class="control-row">
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
              <h4 class="section-heading">Line Style</h4>
              <div class="controls-group">
                <div class="control-row">
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
                <div class="control-row">
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
                <div class="control-row">
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
          </div>
        {/if}
      {/snippet}
    </ControlPanel>
  </div>
{/if}

<style>
  .plot-controls {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: var(--plot-controls-z-index);
  }
  .plot-controls :global(.controls-panel) {
    --control-panel-bg: rgba(0, 0, 0, 0.9);
    --control-panel-text-color: white;
    --control-panel-width: 16em;
  }
  .plot-controls :global(.section-heading) {
    margin: 0 0 8px 0;
    font-size: 0.9em;
    color: #ccc;
    font-weight: 600;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    padding-bottom: 4px;
  }
  .plot-controls :global(.plot-controls-content) {
    max-height: 400px;
    overflow-y: auto;
    padding-right: 4px;
  }
  .plot-controls :global(.controls-group) {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 16px;
  }
  .plot-controls :global(.checkbox-label) {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.85em;
  }
  .plot-controls :global(.control-row) {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.85em;
  }
  .plot-controls :global(.control-row label) {
    min-width: 80px;
    font-size: 0.85em;
  }
  .plot-controls :global(.control-row input[type='range']) {
    flex: 1;
    min-width: 60px;
  }
  .plot-controls :global(.number-input) {
    width: 50px;
    text-align: center;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 3px;
    color: white;
    padding: 2px 4px;
    font-size: 0.8em;
  }
  .plot-controls :global(.control-row input[type='color']) {
    width: 40px;
    height: 24px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    cursor: pointer;
  }
  .plot-controls :global(.control-row select) {
    flex: 1;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 3px;
    color: white;
    padding: 2px 4px;
    font-size: 0.8em;
  }
  .plot-controls :global(.opacity-slider) {
    flex: 1;
    min-width: 50px;
    margin-left: 4px;
  }
  .plot-controls :global(.opacity-number) {
    width: 40px;
    margin-left: 4px;
  }
  .plot-controls :global(.format-input) {
    flex: 1;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 3px;
    color: white;
    padding: 4px 6px;
    font-size: 0.8em;
    font-family: monospace;
  }
  .plot-controls :global(.format-input::placeholder) {
    color: rgba(255, 255, 255, 0.5);
    font-style: italic;
  }
  .plot-controls :global(.format-input.invalid) {
    border-color: #ff6b6b;
    background: rgba(255, 107, 107, 0.1);
  }
  .plot-controls :global(.format-input.invalid:focus) {
    outline-color: #ff6b6b;
    box-shadow: 0 0 0 2px rgba(255, 107, 107, 0.2);
  }
</style>
