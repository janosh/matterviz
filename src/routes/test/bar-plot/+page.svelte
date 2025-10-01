<script lang="ts">
  import type { BarSeries } from '$lib/plot'
  import { BarPlot } from '$lib/plot'

  const basic_series: BarSeries[] = [
    {
      x: [1, 2, 3, 4],
      y: [10, 30, 20, 40],
      label: `Series 1`,
      color: `steelblue`,
      bar_width: 0.6,
      visible: true,
    },
  ]

  const legend_series: BarSeries[] = [
    {
      x: [1, 2, 3, 4],
      y: [10, 30, 20, 40],
      label: `Alpha`,
      color: `#4e79a7`,
      bar_width: 0.6,
      visible: true,
    },
    {
      x: [1, 2, 3, 4],
      y: [20, 10, 35, 25],
      label: `Beta`,
      color: `#e15759`,
      bar_width: 0.6,
      visible: true,
    },
  ]

  const modes_series_overlay: BarSeries[] = [
    {
      x: [1, 2, 3],
      y: [5, 10, 7],
      label: `A`,
      color: `#59a14f`,
      bar_width: 0.8,
      visible: true,
    },
    {
      x: [1, 2, 3],
      y: [4, 6, 8],
      label: `B`,
      color: `#f28e2b`,
      bar_width: 0.8,
      visible: true,
    },
  ]

  const modes_series_stacked: BarSeries[] = [
    {
      x: [1, 2, 3],
      y: [2, 3, 4],
      label: `S1`,
      color: `#edc948`,
      bar_width: 0.8,
      visible: true,
    },
    {
      x: [1, 2, 3],
      y: [3, 4, 5],
      label: `S2`,
      color: `#b07aa1`,
      bar_width: 0.8,
      visible: true,
    },
  ]

  // Mixed positive/negative values for stacked-mode testing
  const stacked_mixed_series: BarSeries[] = [
    {
      x: [1, 2, 3],
      y: [2, -3, 4],
      label: `Sposneg`,
      color: `#8cd17d`,
      bar_width: 0.8,
      visible: true,
    },
    {
      x: [1, 2, 3],
      y: [3, -2, -1],
      label: `Snegpos`,
      color: `#76b7b2`,
      bar_width: 0.8,
      visible: true,
    },
  ]

  const zero_value_series: BarSeries[] = [
    {
      x: [1, 2, 3, 4],
      y: [0, 5, 0, 10],
      label: `Zeros`,
      color: `#9c755f`,
      bar_width: 0.6,
      visible: true,
    },
  ]

  const width_array_series: BarSeries[] = [
    {
      x: [1, 2, 3, 4],
      y: [4, 6, 5, 3],
      label: `VarWidth`,
      color: `#ff9da7`,
      bar_width: [0.3, 0.6, 1.0, 0.4],
      visible: true,
    },
  ]

  const handlers_series: BarSeries[] = [
    {
      x: [1, 2, 3, 4],
      y: [12, 25, 18, 32],
      label: `With Handlers`,
      color: `#9467bd`,
      bar_width: 0.6,
      visible: true,
    },
  ]

  let hover_msg = $state(`Hover over a bar`)
  let click_msg = $state(`Click on a bar`)
</script>

<svelte:head>
  <title>BarPlot Test Page</title>
</svelte:head>

<h1>BarPlot Component Playwright Tests</h1>

<section id="basic-bar">
  <h2>Basic</h2>
  <BarPlot
    series={basic_series}
    x_label="X"
    y_label="Y"
    y_range={[0, 50]}
    show_controls
    controls_open={false}
    controls_toggle_props={{ class: `bar-controls-toggle` }}
    style="height: 360px"
  />
</section>

<section id="legend-bar">
  <h2>Legend and Overlay</h2>
  <BarPlot
    series={legend_series}
    x_label="Category"
    y_label="Value"
    show_controls
    controls_toggle_props={{ class: `bar-controls-toggle` }}
    style="height: 360px"
  />
</section>

<section id="modes-bar">
  <h2>Modes and Orientation</h2>
  <div id="overlay">
    <BarPlot
      series={modes_series_overlay}
      x_label="X"
      y_label="Y"
      mode="overlay"
      show_controls
      controls_toggle_props={{ class: `bar-controls-toggle` }}
      style="height: 300px"
    />
  </div>
  <div id="stacked">
    <BarPlot
      series={modes_series_stacked}
      x_label="X"
      y_label="Y"
      mode="stacked"
      show_controls
      controls_toggle_props={{ class: `bar-controls-toggle` }}
      style="height: 300px"
    />
  </div>
  <div id="stacked-mixed">
    <BarPlot
      series={stacked_mixed_series}
      x_label="X"
      y_label="Y"
      mode="stacked"
      show_controls
      controls_toggle_props={{ class: `bar-controls-toggle` }}
      style="height: 300px"
    />
  </div>
  <div id="zero-values">
    <BarPlot
      series={zero_value_series}
      x_label="X"
      y_label="Y"
      show_controls
      controls_toggle_props={{ class: `bar-controls-toggle` }}
      style="height: 300px"
    />
  </div>
  <div id="width-array">
    <BarPlot
      series={width_array_series}
      x_label="X"
      y_label="Y"
      show_controls
      controls_toggle_props={{ class: `bar-controls-toggle` }}
      style="height: 300px"
    />
  </div>
  <div id="stacked-mixed-horizontal">
    <BarPlot
      series={stacked_mixed_series}
      x_label="Y"
      y_label="X"
      mode="stacked"
      orientation="horizontal"
      show_controls
      controls_toggle_props={{ class: `bar-controls-toggle` }}
      style="height: 300px"
    />
  </div>
  <div id="horizontal">
    <BarPlot
      series={modes_series_overlay}
      x_label="Y"
      y_label="X"
      orientation="horizontal"
      show_controls
      controls_toggle_props={{ class: `bar-controls-toggle` }}
      style="height: 300px"
    />
  </div>
</section>

<section id="handlers-bar">
  <h2>With Handlers</h2>
  <BarPlot
    series={handlers_series}
    x_label="X"
    y_label="Y"
    on_bar_hover={(data) => {
      if (data) {
        hover_msg = `Hovering: bar ${data.bar_idx + 1} (x=${data.x}, y=${data.y})`
      } else {
        hover_msg = `Hover over a bar`
      }
    }}
    on_bar_click={(data) => {
      click_msg = `Clicked: bar ${data.bar_idx + 1} (x=${data.x}, y=${data.y})`
    }}
    show_controls
    controls_toggle_props={{ class: `bar-controls-toggle` }}
    style="height: 360px"
  />
  <div class="handler-info">
    <p>{hover_msg}</p>
    <p>{click_msg}</p>
  </div>
</section>
