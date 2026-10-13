<script lang="ts">
  import type { LegendItem } from '#lib/plot/index.js'
  import { PlotLegend } from '#lib/plot/index.js'

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

  let last_toggled_idx = $state<number | null>(null)
  let last_isolated_idx = $state<number | null>(null)

  function handle_toggle(toggled_idx: number) {
    last_toggled_idx = toggled_idx
    last_isolated_idx = null // Reset isolation tracker
    series_data = series_data.map((item) =>
      item.series_idx === toggled_idx ? { ...item, visible: !item.visible } : item,
    )
  }

  function handle_double_click(double_clicked_idx: number) {
    last_toggled_idx = null // Reset toggle tracker
    last_isolated_idx = double_clicked_idx
    series_data = series_data.map((item) => ({
      ...item,
      visible: item.series_idx === double_clicked_idx,
    }))
  }
</script>

<h1 id="plotlegend-integration-test-page">PlotLegend Integration Test Page</h1>

<h2 id="legend-component">Legend Component</h2>
<PlotLegend
  id="main-legend"
  {series_data}
  on_toggle={handle_toggle}
  on_double_click={handle_double_click}
/>

<h2 id="state-trackers">State Trackers</h2>
<p data-testid="last-toggled">
  Last Toggled Index: {last_toggled_idx ?? `null`}
</p>
<p data-testid="last-isolated">
  Last Isolated Index: {last_isolated_idx ?? `null`}
</p>
