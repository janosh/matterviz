<script lang="ts">
  import { ScatterPlot } from '$lib'
  import type { DataSeries, LabelStyle } from '$lib/plot'

  // === Basic Example Data ===
  const basic_data = {
    x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    y: [10, 15, 13, 17, 20, 18, 22, 25, 23, 28],
    point_style: {
      fill: `steelblue`,
      radius: 5,
      stroke: `white`,
      stroke_width: 1,
    },
  }

  // === Marker Types Data ===
  const points_data = {
    x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    y: [10, 15, 13, 17, 20, 18, 22, 25, 23, 28],
    point_style: {
      fill: `steelblue`,
      radius: 5,
      stroke: `white`,
      stroke_width: 1,
    },
  }

  const line_data = {
    x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    y: [5, 8, 7, 9, 12, 10, 14, 16, 15, 19],
    point_style: {
      fill: `tomato`,
      radius: 5,
      stroke: `white`,
      stroke_width: 1,
    },
  }

  const line_points_data = {
    x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    y: [3, 5, 4, 6, 8, 7, 10, 12, 11, 14],
    point_style: {
      fill: `forestgreen`,
      radius: 5,
      stroke: `white`,
      stroke_width: 1,
    },
  }

  // === Range Test Data ===
  const wide_range_data = {
    x: [-1000, -100, -10, -1, 0, 1, 10, 100, 1000],
    y: [-500, -50, -5, -0.5, 0, 0.5, 5, 50, 500],
    point_style: {
      fill: `steelblue`,
      radius: 5,
      stroke: `white`,
      stroke_width: 1,
    },
  }

  const small_range_data = {
    x: [0.0001, 0.0002, 0.0003, 0.0004, 0.0005],
    y: [0.00001, 0.00002, 0.00003, 0.00004, 0.00005],
    point_style: {
      fill: `tomato`,
      radius: 5,
      stroke: `white`,
      stroke_width: 1,
    },
  }

  // === Log Scale Data ===
  const log_scale_data = {
    x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    y: [10, 20, 40, 80, 160, 320, 640, 1280, 2560, 5120],
    point_style: {
      fill: `steelblue`,
      radius: 5,
      stroke: `white`,
      stroke_width: 1,
    },
  }

  const log_scale_data2 = {
    x: [0.1, 0.5, 1, 5, 10, 50, 100, 500, 1000],
    y: [5, 15, 45, 135, 405, 1215, 3645, 10935, 32805],
    point_style: {
      fill: `tomato`,
      radius: 5,
      stroke: `white`,
      stroke_width: 1,
    },
  }

  // === Custom Style Data ===
  const rainbow_data = {
    x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    y: [10, 15, 13, 17, 20, 18, 22, 25, 23, 28],
    point_style: [
      { fill: `#ff0000`, radius: 8, stroke: `black`, stroke_width: 2 },
      { fill: `#ff7f00`, radius: 7, stroke: `black`, stroke_width: 2 },
      { fill: `#ffff00`, radius: 6, stroke: `black`, stroke_width: 2 },
      { fill: `#00ff00`, radius: 7, stroke: `black`, stroke_width: 2 },
      { fill: `#0000ff`, radius: 8, stroke: `black`, stroke_width: 2 },
      { fill: `#4b0082`, radius: 9, stroke: `black`, stroke_width: 2 },
      { fill: `#8f00ff`, radius: 8, stroke: `black`, stroke_width: 2 },
      { fill: `#ff00ff`, radius: 7, stroke: `black`, stroke_width: 2 },
      { fill: `#00ffff`, radius: 6, stroke: `black`, stroke_width: 2 },
      { fill: `#ff9999`, radius: 7, stroke: `black`, stroke_width: 2 },
    ],
  }

  const multi_series_data1 = {
    x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    y: [5, 8, 7, 9, 12, 10, 14, 16, 15, 19],
    point_style: {
      fill: `#ff5555`,
      radius: 6,
      stroke: `#882222`,
      stroke_width: 1.5,
    },
  }

  const multi_series_data2 = {
    x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    y: [3, 5, 4, 6, 8, 7, 10, 12, 11, 14],
    point_style: {
      fill: `#5555ff`,
      radius: 6,
      stroke: `#222288`,
      stroke_width: 1.5,
    },
  }

  // === Color Scale Data ===
  let color_scale_type = $state(`linear`)

  const color_scale_data = {
    x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    y: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    color_values: Array.from({ length: 10 }, (_, idx) => Math.pow(2, idx)),
    point_style: {
      radius: 10,
      stroke: `black`,
      stroke_width: 1,
    },
  }

  // === Custom Tooltip Data ===
  const custom_tooltip_data = {
    x: [1, 2, 3],
    y: [5, 8, 6],
    metadata: [{ info: `Point A` }, { info: `Point B` }, { info: `Point C` }],
    point_style: { fill: `purple`, radius: 6 },
  }

  // === Bind Hovered Data ===
  let is_plot_hovered = $state(false)
  const bind_hovered_data = {
    x: [10, 20, 30],
    y: [15, 25, 10],
    point_style: { fill: `orange`, radius: 5 },
  }

  // --- Data for Auto Placement Test ---
  const generate_cluster = (
    center_x: number,
    center_y: number,
    count: number,
    radius: number,
    label_prefix: string,
    auto_placement = true,
  ) => {
    const points = {
      x: [] as number[],
      y: [] as number[],
      point_style: [] as object[],
      point_label: [] as object[],
    }
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * 2 * Math.PI
      const dist = Math.random() * radius
      points.x.push(center_x + Math.cos(angle) * dist)
      points.y.push(center_y + Math.sin(angle) * dist)
      points.point_style.push({ fill: `purple`, radius: 5 })
      points.point_label.push({
        text: `${label_prefix}-${i + 1}`,
        auto_placement: auto_placement,
        font_size: `10px`,
      })
    }
    return points
  }

  // Dense cluster where labels *should* repel
  const dense_cluster = generate_cluster(30, 70, 8, 5, `Dense`)

  // Sparse points where labels should *not* repel significantly
  const sparse_points = {
    x: [10, 90, 10, 90],
    y: [10, 10, 90, 90],
    point_style: { fill: `green`, radius: 6 },
    point_label: [
      { text: `Sparse-TL`, auto_placement: true, font_size: `10px`, offset_x: 10 },
      { text: `Sparse-TR`, auto_placement: true, font_size: `10px`, offset_x: -40 },
      { text: `Sparse-BL`, auto_placement: true, font_size: `10px`, offset_y: -15 },
      { text: `Sparse-BR`, auto_placement: true, font_size: `10px` },
    ],
  }

  // Single point test
  const single_point = {
    x: [50],
    y: [50],
    point_style: { fill: `orange`, radius: 7 },
    point_label: [{ text: `Single`, auto_placement: true, font_size: `10px` }],
  }

  const auto_placement_series_data: DataSeries[] = [
    {
      x: [...dense_cluster.x, ...sparse_points.x, ...single_point.x],
      y: [...dense_cluster.y, ...sparse_points.y, ...single_point.y],
      point_style: [
        ...dense_cluster.point_style,
        ...(Array.isArray(sparse_points.point_style)
          ? sparse_points.point_style
          : [sparse_points.point_style]),
        ...(Array.isArray(single_point.point_style)
          ? single_point.point_style
          : [single_point.point_style]),
      ],
      point_label: [
        ...dense_cluster.point_label,
        ...(Array.isArray(sparse_points.point_label)
          ? sparse_points.point_label
          : [sparse_points.point_label]),
        ...(Array.isArray(single_point.point_label)
          ? single_point.point_label
          : [single_point.point_label]),
      ],
    },
  ]

  let enable_auto_placement = $state(true)

  let auto_placement_test_series = $derived.by(() => {
    return auto_placement_series_data.map((series) => ({
      ...series,
      point_label: (Array.isArray(series.point_label)
        ? series.point_label
        : series.point_label
          ? [series.point_label]
          : []
      ).map((lbl): LabelStyle => {
        return {
          ...(typeof lbl === `object` && lbl !== null ? lbl : {}),
          auto_placement: enable_auto_placement,
        }
      }),
    }))
  })

  // Legend test data
  const legend_single_series: DataSeries[] = [
    { x: [1, 2], y: [3, 4], metadata: { label: `Single Series` } },
  ]
  const legend_multi_series: DataSeries[] = [
    { x: [1, 2], y: [3, 4], metadata: { label: `Series A` } },
    { x: [1, 2], y: [1, 2], metadata: { label: `Series B` } },
  ]
  const legend_zero_series: DataSeries[] = []

  // === Linear-to-Log Transition Test Data ===
  let lin_log_y_scale_type = $state<`linear` | `log`>(`linear`)
  const lin_log_transition_data = {
    x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    y: [100, 50, 10, 1, 0.1, 0.01, 0.001, 1e-4, 1e-6, 1e-8], // Include values very close to zero
    point_style: {
      fill: `darkcyan`,
      radius: 5,
      stroke: `white`,
      stroke_width: 1,
    },
  }
</script>

<div class="demo-container">
  <h1>ScatterPlot Component E2E Test Page</h1>

  <section class="demo-section" id="basic-example">
    <h2>Basic Example</h2>
    <div class="demo-plot">
      <ScatterPlot
        series={[basic_data]}
        x_label="X Axis"
        y_label="Y Axis"
        markers="line+points"
      />
    </div>
  </section>

  <section class="demo-section" id="marker-types">
    <h2>Marker Types</h2>
    <div class="demo-row">
      <div class="demo-plot" id="points-only">
        <h3>Points Only</h3>
        <ScatterPlot
          series={[points_data]}
          x_label="X Axis"
          y_label="Y Axis (Points)"
          markers="points"
        />
      </div>
      <div class="demo-plot" id="line-only">
        <h3>Line Only</h3>
        <ScatterPlot
          series={[line_data]}
          x_label="X Axis"
          y_label="Y Axis (Line)"
          markers="line"
        />
      </div>
      <div class="demo-plot" id="line-points">
        <h3>Line + Points</h3>
        <ScatterPlot
          series={[line_points_data]}
          x_label="X Axis"
          y_label="Y Axis (Line+Points)"
          markers="line+points"
        />
      </div>
    </div>
  </section>

  <section class="demo-section" id="range-test">
    <h2>Data Range Examples</h2>
    <div class="demo-row">
      <div class="demo-plot" id="wide-range">
        <h3>Wide Range (-1000 to 1000)</h3>
        <ScatterPlot
          series={[wide_range_data]}
          x_label="X Axis"
          y_label="Y Axis"
          x_lim={[-1100, 1100]}
          y_lim={[-550, 550]}
          markers="line+points"
        />
      </div>
      <div class="demo-plot" id="small-range">
        <h3>Very Small Range</h3>
        <ScatterPlot
          series={[small_range_data]}
          x_label="X Axis"
          y_label="Y Axis"
          x_lim={[0, 0.0006]}
          y_lim={[0, 0.00006]}
          markers="line+points"
        />
      </div>
    </div>
  </section>

  <section class="demo-section" id="log-scale">
    <h2>Logarithmic Scale Examples</h2>
    <div class="demo-row">
      <div class="demo-plot" id="log-y">
        <h3>Y-Axis Log Scale</h3>
        <ScatterPlot
          series={[log_scale_data]}
          x_label="X Axis (Linear)"
          y_label="Y Axis (Log)"
          x_lim={[-1100, 1100]}
          y_lim={[1, 6000]}
          markers="line+points"
          y_scale_type="log"
        />
      </div>
      <div class="demo-plot" id="log-x">
        <h3>X-Axis Log Scale</h3>
        <ScatterPlot
          series={[log_scale_data2]}
          x_label="X Axis (Log)"
          y_label="Y Axis (Linear)"
          y_format="~s"
          x_format="~s"
          x_lim={[0.01, 1100]}
          markers="line+points"
          x_scale_type="log"
        />
      </div>
    </div>
  </section>

  <section class="demo-section" id="custom-style">
    <h2>Custom Styling Examples</h2>
    <div class="demo-row">
      <div class="demo-plot" id="rainbow-points">
        <h3>Rainbow Points</h3>
        <ScatterPlot
          series={[rainbow_data]}
          x_label="X Axis"
          y_label="Y Axis"
          markers="points"
        />
      </div>
      <div class="demo-plot" id="multi-series">
        <h3>Multiple Series</h3>
        <ScatterPlot
          series={[multi_series_data1, multi_series_data2]}
          x_label="X Axis"
          y_label="Y Axis"
          markers="line+points"
        />
      </div>
    </div>
  </section>

  <section class="demo-section" id="color-scale">
    <h2>Color Scale Examples</h2>
    <div class="demo-row">
      <div class="demo-plot" id="color-scale-toggle">
        <h3>Color Scale with Toggle</h3>
        <div style="display: flex; justify-content: center; gap: 1em;">
          {#each [`linear`, `log`] as scale_type (scale_type)}
            <label>
              <input
                type="radio"
                name="color_scale_type"
                value={scale_type}
                bind:group={color_scale_type}
              />
              {scale_type}
            </label>
          {/each}
        </div>
        <ScatterPlot
          series={[color_scale_data]}
          x_label="X Axis"
          y_label="Y Axis"
          markers="points"
          color_scheme="viridis"
          color_scale_type={color_scale_type as `linear` | `log`}
          color_bar={{}}
        />
      </div>
    </div>
  </section>

  <section class="demo-section" id="custom-tooltip">
    <h2>Custom Tooltip Example</h2>
    <div class="demo-plot">
      <ScatterPlot series={[custom_tooltip_data]} markers="points">
        {#snippet tooltip(props)}
          <div class="custom-tooltip">
            Point Info: <strong>{props.metadata?.info}</strong><br />
            Coords: ({props.x_formatted}, {props.y_formatted})
          </div>
        {/snippet}
      </ScatterPlot>
    </div>
  </section>

  <section class="demo-section" id="bind-hovered">
    <h2>bind:hovered Example</h2>
    <p>Plot is currently hovered: <strong id="hover-status">{is_plot_hovered}</strong></p>
    <div class="demo-plot">
      <ScatterPlot
        series={[bind_hovered_data]}
        markers="points"
        bind:hovered={is_plot_hovered}
      />
    </div>
  </section>

  <section
    class="demo-section"
    id="label-auto-placement-test"
    style="height: 550px; width: 600px; border: 1px solid lightgray; margin-top: 20px; padding: 10px;"
  >
    <h2>Label Auto Placement Test</h2>
    <label>
      <input type="checkbox" bind:checked={enable_auto_placement} />
      Enable Auto Placement
    </label>
    {#key enable_auto_placement}
      <ScatterPlot
        series={auto_placement_test_series}
        x_label="X"
        y_label="Y"
        x_lim={[0, 100]}
        y_lim={[0, 100]}
        markers="points"
        style="height: 450px; width: 100%;"
      />
    {/key}
  </section>

  <section id="legend-tests">
    <h2>Legend Rendering Tests</h2>
    <div class="plot-grid">
      <div id="legend-single-default" class="plot-container">
        <h3>Single Series (Default Legend) - No Legend Expected</h3>
        <ScatterPlot series={legend_single_series} />
      </div>
      <div id="legend-single-null" class="plot-container">
        <h3>Single Series (legend=null) - No Legend Expected</h3>
        <ScatterPlot series={legend_single_series} legend={null} />
      </div>
      <div id="legend-single-config" class="plot-container">
        <h3>Single Series (Configured Legend) - Legend Expected</h3>
        <ScatterPlot series={legend_single_series} legend={{ layout: `horizontal` }} />
      </div>
      <div id="legend-multi-default" class="plot-container">
        <h3>Multi Series (Default Legend) - Legend Expected</h3>
        <ScatterPlot series={legend_multi_series} />
      </div>
      <div id="legend-zero" class="plot-container">
        <h3>Zero Series - No Legend Expected</h3>
        <ScatterPlot series={legend_zero_series} />
      </div>
    </div>
  </section>

  <section class="demo-section" id="lin-log-transition">
    <h2>Linear-to-Log Scale Transition Test</h2>
    <p>
      Test switching between linear and log scales. Values near zero previously caused NaN
      errors during the tweening animation.
    </p>
    <div style="display: flex; justify-content: center; gap: 1em; margin-bottom: 1em;">
      {#each [`linear`, `log`] as scale_type (scale_type)}
        <label>
          <input
            type="radio"
            name="lin_log_y_scale_type"
            value={scale_type}
            bind:group={lin_log_y_scale_type}
          />
          {scale_type} y-axis
        </label>
      {/each}
    </div>
    <div class="demo-plot" style="height: 400px;">
      <ScatterPlot
        series={[lin_log_transition_data]}
        x_label="X Axis (Linear)"
        y_label="Y Axis"
        markers="line+points"
        y_scale_type={lin_log_y_scale_type}
        y_lim={lin_log_y_scale_type === `log` ? [1e-9, null] : [null, null]}
      />
    </div>
  </section>
</div>

<style>
  .demo-container {
    max-width: 1200px;
    margin: 20px auto;
    padding: 20px;
    font-family: sans-serif;
  }

  .demo-section {
    margin-bottom: 40px;
    padding-bottom: 20px;
    border-bottom: 1px dashed #eee;
  }
  .demo-section:last-child {
    border-bottom: none;
  }

  .demo-row {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    justify-content: space-around;
  }

  .demo-plot {
    flex: 1 1 45%;
    min-width: 350px;
    height: 350px;
    border: 1px solid #ccc;
    box-sizing: border-box;
    border-radius: 8px;
    padding: 10px;
    margin-bottom: 20px;
    display: flex;
    flex-direction: column;
  }

  .demo-plot h3 {
    margin-top: 0;
    margin-bottom: 10px;
    text-align: center;
    font-size: 1em;
  }

  :global(.demo-plot .scatter) {
    flex-grow: 1;
  }

  :is(h1, h2) {
    text-align: center;
    margin-bottom: 1em;
  }

  .custom-tooltip {
    background: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 5px 8px;
    border-radius: 3px;
    font-size: 0.9em;
    white-space: nowrap;
  }

  label {
    margin-right: 1em;
  }
</style>
