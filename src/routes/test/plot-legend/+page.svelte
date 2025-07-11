<script lang="ts">
  import type { LegendItem } from '$lib/plot'
  import { PlotLegend } from '$lib/plot'

  let series_data: LegendItem[] = $state([
    {
      label: `Alpha`,
      visible: true,
      series_idx: 0,
      display_style: {
        symbol_type: `Circle`,
        symbol_color: `crimson`,
        line_dash: `solid`,
        line_color: `crimson`,
      },
    },
    {
      label: `Beta`,
      visible: true,
      series_idx: 1,
      display_style: {
        symbol_type: `Square`,
        symbol_color: `steelblue`,
        line_dash: `dashed`,
        line_color: `steelblue`,
      },
    },
    {
      label: `Gamma`,
      visible: false, // Initially hidden
      series_idx: 2, // No line
      display_style: { symbol_type: `Triangle`, symbol_color: `darkorange` },
    },
    {
      label: `Delta`,
      visible: true,
      series_idx: 3, // No marker
      display_style: { line_dash: `Dotted`, line_color: `darkviolet` },
    },
    {
      label: `Epsilon`, // Added for testing line-only, no dash
      visible: true,
      series_idx: 4, // No marker
      display_style: { line_color: `purple` }, // Solid line by default with no dash specified
    },
  ])

  let legend_layout: `horizontal` | `vertical` = $state(`vertical`)
  let legend_n_items = $state(1)
  let legend_wrapper_style = $state(``)
  let legend_item_style = $state(``)

  let last_toggled_idx = $state<number | null>(null)
  let last_isolated_idx = $state<number | null>(null)
  let previous_visibility: boolean[] | null = $state(null) // State to store visibility before isolation

  function handle_toggle(toggled_idx: number) {
    last_toggled_idx = toggled_idx
    last_isolated_idx = null // Reset isolation tracker

    // Update the visibility of the toggled series
    series_data = series_data.map((item) => {
      if (item.series_idx === toggled_idx) return { ...item, visible: !item.visible }
      return item
    })
  }

  function handle_double_click(double_clicked_idx: number) {
    last_toggled_idx = null // Reset toggle tracker
    last_isolated_idx = double_clicked_idx

    const visible_count = series_data.filter((item) => item.visible).length
    const is_currently_isolated = visible_count === 1 &&
      series_data[double_clicked_idx]?.visible

    if (is_currently_isolated && previous_visibility) {
      // Restore previous visibility state
      series_data = series_data.map((item, idx) => ({
        ...item,
        visible: previous_visibility![idx],
      }))
      previous_visibility = null // Clear memory
    } else {
      // Isolate the double-clicked series
      // Only store previous state if we are actually isolating (more than one series visible)
      if (visible_count > 1) {
        previous_visibility = series_data.map((item) => item.visible) // Store current state
      }
      series_data = series_data.map((item) => ({
        ...item,
        visible: item.series_idx === double_clicked_idx,
      }))
    }
  }
</script>

<h1>PlotLegend Integration Test Page</h1>

<div>
  <div>
    <h2>Legend Component</h2>
    <PlotLegend
      {series_data}
      layout={legend_layout}
      layout_tracks={legend_n_items}
      wrapper_style={legend_wrapper_style}
      item_style={legend_item_style}
      on_toggle={handle_toggle}
      on_double_click={handle_double_click}
    />
  </div>

  <div>
    <h2>Controls</h2>
    <label for="layout">Layout:</label>
    <select bind:value={legend_layout} id="layout">
      <option value="vertical">Vertical</option>
      <option value="horizontal">Horizontal</option>
    </select>
    <br />

    <label for="n_items">n_items (columns if horizontal, rows if vertical):</label>
    <input type="number" bind:value={legend_n_items} min="1" id="n_items" />
    <br />

    <label for="wrapper_style">Wrapper Style:</label>
    <input type="text" bind:value={legend_wrapper_style} id="wrapper_style" />
    <br />

    <label for="item_style">Item Style:</label>
    <input type="text" bind:value={legend_item_style} id="item_style" />
    <br />
    <br />

    <h2>State Trackers</h2>
    <p data-testid="last-toggled">
      Last Toggled Index: {last_toggled_idx ?? `null`}
    </p>
    <p data-testid="last-isolated">
      Last Isolated Index: {last_isolated_idx ?? `null`}
    </p>
  </div>
</div>

<h2>Custom Style Test Case</h2>
<div id="custom-style-legend">
  <PlotLegend
    series_data={series_data.slice(0, 2)}
    layout="horizontal"
    layout_tracks={2}
    on_toggle={() => {}}
    on_double_click={() => {}}
  />
</div>
