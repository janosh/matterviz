<script lang="ts">
  import type { BoxPlotSeries } from '$lib/plot'
  import { BoxPlot } from '$lib/plot'

  // Deterministic pseudo-random distribution generator (seeded) for stable test renders
  const make_dist = (seed: number, n = 200, center = 0, spread = 1): number[] => {
    let state = seed
    const next = () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff
      return state / 0x7fffffff
    }
    return Array.from({ length: n }, () => {
      // Box-Muller for a rough normal distribution
      const u1 = Math.max(next(), 1e-9)
      const u2 = next()
      return center + spread * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    })
  }

  const basic_series: BoxPlotSeries[] = [
    { y: make_dist(1, 200, 0, 1), label: `Model A`, color: `#4e79a7` },
    { y: make_dist(2, 200, 0.5, 1.4), label: `Model B`, color: `#e15759` },
    { y: make_dist(3, 200, -0.3, 0.8), label: `Model C`, color: `#59a14f` },
  ]

  // Distribution with explicit outliers to test outlier rendering
  const outlier_series: BoxPlotSeries[] = [
    { y: [...make_dist(7, 120, 0, 1), 8, 9, -7, -8], label: `Has Outliers`, color: `#9c755f` },
  ]

  // Precomputed 5-percentile bridge: pass [p05, p25, p50, p75, p95] with minmax whiskers
  const percentile_series: BoxPlotSeries[] = [
    { y: [-0.04, -0.004, 0, 0.005, 0.02], label: `eSEN`, color: `#636EFA` },
    { y: [-0.023, -0.003, 0.001, 0.006, 0.042], label: `eqV2`, color: `#EF553B` },
    { y: [-0.046, -0.009, -0.001, 0.006, 0.029], label: `SevenNet`, color: `#00CC96` },
  ]

  const y2_series: BoxPlotSeries[] = [
    { y: make_dist(11, 150, 0, 1), label: `Primary`, color: `#4e79a7` },
    { y: make_dist(12, 150, 50, 20), label: `Secondary`, color: `#e15759`, y_axis: `y2` },
  ]

  let hover_msg = $state(`Hover over a box`)
  let click_msg = $state(`Click on a box`)
</script>

<svelte:head>
  <title>BoxPlot Test Page</title>
</svelte:head>

<h1>BoxPlot Component Playwright Tests</h1>

<section id="basic-box">
  <h2>Basic</h2>
  <BoxPlot
    series={basic_series}
    x_axis={{ label: `Model` }}
    y_axis={{ label: `Error` }}
    controls_toggle_props={{ class: `box-controls-toggle` }}
    style="height: 360px"
  />
</section>

<section id="horizontal-box">
  <h2>Horizontal</h2>
  <BoxPlot
    series={basic_series}
    orientation="horizontal"
    x_axis={{ label: `Error` }}
    y_axis={{ label: `Model` }}
    controls_toggle_props={{ class: `box-controls-toggle` }}
    style="height: 360px"
  />
</section>

<section id="whisker-minmax">
  <h2>Whisker Mode: Min/Max</h2>
  <BoxPlot
    series={basic_series}
    whisker_mode="minmax"
    x_axis={{ label: `Model` }}
    y_axis={{ label: `Error` }}
    controls_toggle_props={{ class: `box-controls-toggle` }}
    style="height: 360px"
  />
</section>

<section id="outliers-box">
  <h2>Outliers + Mean</h2>
  <BoxPlot
    series={outlier_series}
    show_mean
    x_axis={{ label: `Model` }}
    y_axis={{ label: `Error` }}
    controls_toggle_props={{ class: `box-controls-toggle` }}
    style="height: 360px"
  />
</section>

<section id="value-labels-box">
  <h2>Value Labels + Colored Tick Labels (matbench style)</h2>
  <BoxPlot
    series={percentile_series}
    whisker_mode="minmax"
    show_value_labels
    value_label_format=".2~g"
    x_axis={{ label: `Model` }}
    y_axis={{ label: `Error in E<sub>hull dist</sub> (eV/atom)`, format: `.3` }}
    controls_toggle_props={{ class: `box-controls-toggle` }}
    style="height: 400px"
  />
</section>

<section id="y2-box">
  <h2>Y2 Axis</h2>
  <BoxPlot
    series={y2_series}
    show_legend
    x_axis={{ label: `Model` }}
    y_axis={{ label: `Primary` }}
    y2_axis={{ label: `Secondary` }}
    controls_toggle_props={{ class: `box-controls-toggle` }}
    style="height: 360px"
  />
</section>

<section id="handlers-box">
  <h2>With Handlers</h2>
  <BoxPlot
    series={basic_series}
    x_axis={{ label: `Model` }}
    y_axis={{ label: `Error` }}
    on_box_hover={(data) => {
      hover_msg = data
        ? `Hovering: ${data.category_label} (median=${data.stats.median.toFixed(3)})`
        : `Hover over a box`
    }}
    on_box_click={(data) => {
      click_msg = `Clicked: ${data.category_label} (median=${data.stats.median.toFixed(3)})`
    }}
    controls_toggle_props={{ class: `box-controls-toggle` }}
    style="height: 360px"
  />
  <div class="handler-info">
    <p>{hover_msg}</p>
    <p>{click_msg}</p>
  </div>
</section>
