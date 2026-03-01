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

  // Y2 axis test series
  const y2_axis_series: BarSeries[] = [
    {
      x: [1, 2, 3, 4],
      y: [10, 20, 15, 25],
      label: `Y1 Series`,
      color: `#4e79a7`,
      bar_width: 0.6,
      visible: true,
    },
    {
      x: [1, 2, 3, 4],
      y: [100, 200, 150, 250],
      label: `Y2 Series`,
      color: `#e15759`,
      bar_width: 0.6,
      visible: true,
      y_axis: `y2`,
    },
  ]

  const y2_different_scale_series: BarSeries[] = [
    {
      x: [1, 2, 3, 4],
      y: [5, 10, 8, 12],
      label: `Small Scale`,
      color: `#59a14f`,
      bar_width: 0.6,
      visible: true,
    },
    {
      x: [1, 2, 3, 4],
      y: [500, 1000, 800, 1200],
      label: `Large Scale`,
      color: `#f28e2b`,
      bar_width: 0.6,
      visible: true,
      y_axis: `y2`,
    },
  ]

  const y2_stacked_series: BarSeries[] = [
    {
      x: [1, 2, 3],
      y: [3, 5, 4],
      label: `Y1-A`,
      color: `#edc948`,
      bar_width: 0.8,
      visible: true,
    },
    {
      x: [1, 2, 3],
      y: [2, 3, 3],
      label: `Y1-B`,
      color: `#b07aa1`,
      bar_width: 0.8,
      visible: true,
    },
    {
      x: [1, 2, 3],
      y: [30, 50, 40],
      label: `Y2-A`,
      color: `#76b7b2`,
      bar_width: 0.8,
      visible: true,
      y_axis: `y2`,
    },
    {
      x: [1, 2, 3],
      y: [20, 30, 30],
      label: `Y2-B`,
      color: `#ff9da7`,
      bar_width: 0.8,
      visible: true,
      y_axis: `y2`,
    },
  ]

  const y2_line_series: BarSeries[] = [
    {
      x: [1, 2, 3, 4],
      y: [10, 20, 15, 25],
      label: `Bar Series`,
      color: `#4e79a7`,
      bar_width: 0.6,
      visible: true,
    },
    {
      x: [1, 2, 3, 4],
      y: [100, 200, 150, 250],
      label: `Line Series`,
      color: `#e15759`,
      visible: true,
      y_axis: `y2`,
      render_mode: `line`,
    },
  ]

  // X2 axis demo — two series with different x scales (e.g. Celsius vs Fahrenheit)
  const x2_axis_series: BarSeries[] = [
    {
      x: [10, 20, 30, 40],
      y: [5, 12, 8, 15],
      label: `Celsius`,
      color: `#2563eb`,
      bar_width: 3,
      visible: true,
    },
    {
      x: [50, 68, 86, 104],
      y: [3, 9, 6, 11],
      label: `Fahrenheit`,
      color: `#dc2626`,
      bar_width: 5,
      x_axis: `x2`,
      visible: true,
    },
  ]
</script>

<svelte:head>
  <title>BarPlot Test Page</title>
</svelte:head>

<h1>BarPlot Component Playwright Tests</h1>

<section id="basic-bar">
  <h2>Basic</h2>
  <BarPlot
    series={basic_series}
    x_axis={{ label: `X` }}
    y_axis={{ label: `Y`, range: [0, 50] }}
    controls_open={false}
    controls_toggle_props={{ class: `bar-controls-toggle` }}
    style="height: 360px"
  />
</section>

<section id="legend-bar">
  <h2>Legend and Overlay</h2>
  <BarPlot
    series={legend_series}
    x_axis={{ label: `Category` }}
    y_axis={{ label: `Value` }}
    controls_toggle_props={{ class: `bar-controls-toggle` }}
    style="height: 360px"
  />
</section>

<section id="modes-bar">
  <h2>Modes and Orientation</h2>
  <BarPlot
    id="overlay"
    series={modes_series_overlay}
    x_axis={{ label: `X` }}
    y_axis={{ label: `Y` }}
    mode="overlay"
    controls_toggle_props={{ class: `bar-controls-toggle` }}
    style="height: 300px"
  />
  <BarPlot
    id="stacked"
    series={modes_series_stacked}
    x_axis={{ label: `X` }}
    y_axis={{ label: `Y` }}
    mode="stacked"
    controls_toggle_props={{ class: `bar-controls-toggle` }}
    style="height: 300px"
  />
  <BarPlot
    id="stacked-mixed"
    series={stacked_mixed_series}
    x_axis={{ label: `X` }}
    y_axis={{ label: `Y` }}
    mode="stacked"
    controls_toggle_props={{ class: `bar-controls-toggle` }}
    style="height: 300px"
  />
  <BarPlot
    id="zero-values"
    series={zero_value_series}
    x_axis={{ label: `X` }}
    y_axis={{ label: `Y` }}
    controls_toggle_props={{ class: `bar-controls-toggle` }}
    style="height: 300px"
  />
  <BarPlot
    id="width-array"
    series={width_array_series}
    x_axis={{ label: `X` }}
    y_axis={{ label: `Y` }}
    controls_toggle_props={{ class: `bar-controls-toggle` }}
    style="height: 300px"
  />
  <BarPlot
    id="stacked-mixed-horizontal"
    series={stacked_mixed_series}
    x_axis={{ label: `Y` }}
    y_axis={{ label: `X` }}
    mode="stacked"
    orientation="horizontal"
    controls_toggle_props={{ class: `bar-controls-toggle` }}
    style="height: 300px"
  />
  <BarPlot
    id="horizontal"
    series={modes_series_overlay}
    x_axis={{ label: `Y` }}
    y_axis={{ label: `X` }}
    orientation="horizontal"
    controls_toggle_props={{ class: `bar-controls-toggle` }}
    style="height: 300px"
  />
</section>

<section id="handlers-bar">
  <h2>With Handlers</h2>
  <BarPlot
    series={handlers_series}
    x_axis={{ label: `X` }}
    y_axis={{ label: `Y` }}
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
    controls_toggle_props={{ class: `bar-controls-toggle` }}
    style="height: 360px"
  />
  <div class="handler-info">
    <p>{hover_msg}</p>
    <p>{click_msg}</p>
  </div>
</section>

<section id="y2-axis-bar">
  <h2>Y2 Axis</h2>
  <BarPlot
    series={y2_axis_series}
    x_axis={{ label: `X` }}
    y_axis={{ label: `Y1` }}
    y2_axis={{ label: `Y2` }}
    controls_toggle_props={{ class: `bar-controls-toggle` }}
    style="height: 360px"
  />
</section>

<section id="y2-different-scale">
  <h2>Y2 Different Scale</h2>
  <BarPlot
    series={y2_different_scale_series}
    x_axis={{ label: `X` }}
    y_axis={{ label: `Small` }}
    y2_axis={{ label: `Large` }}
    controls_toggle_props={{ class: `bar-controls-toggle` }}
    style="height: 360px"
  />
</section>

<section id="y2-stacked">
  <h2>Y2 Stacked Mode</h2>
  <BarPlot
    series={y2_stacked_series}
    x_axis={{ label: `X` }}
    y_axis={{ label: `Y1` }}
    y2_axis={{ label: `Y2` }}
    mode="stacked"
    controls_toggle_props={{ class: `bar-controls-toggle` }}
    style="height: 360px"
  />
</section>

<section id="y2-line-series">
  <h2>Y2 Line Series</h2>
  <BarPlot
    series={y2_line_series}
    x_axis={{ label: `X` }}
    y_axis={{ label: `Bars` }}
    y2_axis={{ label: `Line` }}
    controls_toggle_props={{ class: `bar-controls-toggle` }}
    style="height: 360px"
  />
</section>

<section id="x2-axis-bar">
  <h2>X2 Axis (Dual X-Axes)</h2>
  <p>Bottom axis shows °C, top axis shows °F — each series mapped to its own x-scale.</p>
  <BarPlot
    series={x2_axis_series}
    x_axis={{ label: `Temperature (°C)` }}
    x2_axis={{ label: `Temperature (°F)` }}
    y_axis={{ label: `Count` }}
    show_legend
    controls_toggle_props={{ class: `bar-controls-toggle` }}
    style="height: 360px"
  />
</section>
