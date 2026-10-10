<script lang="ts">
  import { format_num, symbol_names } from '#lib/labels.js'
  import type { Vec2 } from '#lib/math.js'
  import * as math from '#lib/math.js'
  import type { DataSeries, InternalPoint, LabelStyle, ScaleType } from '#lib/plot/index.js'
  import { ScatterPlot } from '#lib/plot/index.js'

  const range = (length: number) => Array.from({ length }, (_, idx) => idx)
  const one_to_ten = range(10).map((idx) => idx + 1)

  // === Basic Example Data ===
  const basic_data = {
    x: one_to_ten,
    y: [10, 15, 13, 17, 20, 18, 22, 25, 23, 28],
    point_style: { fill: `steelblue`, radius: 5, stroke: `white`, stroke_width: 1 },
  }
  const canvas_auto_data = {
    x: range(10_001).map((idx) => idx % 101),
    y: range(10_001).map((idx) => Math.floor(idx / 101)),
    point_style: { fill: `#1971c2`, stroke: `none` },
  }

  const marginal_browser_series: DataSeries[] = [
    {
      x: [0.4, 0.8, 1.2, 1.7, 2.2, 2.9, 3.4, 4.2, 5.1, 6.3, 7.2, 8.4, 9.1],
      y: [8.8, 7.4, 8.1, 6.6, 6.9, 5.7, 6.1, 5.1, 4.5, 3.7, 2.9, 2.2, 1.4],
      label: `Browser marginal series`,
      markers: `points`,
      point_style: { fill: `#0ca678`, radius: 4, stroke: `white`, stroke_width: 1 },
    },
  ]

  let color_scale = $state({ type: `linear` as const })

  const color_scale_series: DataSeries = {
    x: one_to_ten,
    y: one_to_ten,
    color_values: range(10).map((idx) => 2 ** idx),
    point_style: { radius: 10, stroke: `black`, stroke_width: 1 },
    markers: `points`,
  }

  let is_plot_hovered = $state(false)
  const bind_hovered_series: DataSeries = {
    x: [10, 20, 30],
    y: [15, 25, 10],
    point_style: { fill: `orange`, radius: 5 },
    markers: `points`,
  }

  // === Label Auto Placement Test Data ===
  type LabeledPoint = { x: number; y: number; fill: string; radius: number; label: LabelStyle }
  // Dense cluster where labels *should* repel
  const dense_cluster: LabeledPoint[] = range(8).map((idx) => {
    const angle = Math.random() * 2 * Math.PI
    const dist = Math.random() * 5
    return {
      x: 30 + Math.cos(angle) * dist,
      y: 70 + Math.sin(angle) * dist,
      fill: `purple`,
      radius: 5,
      label: { text: `Dense-${idx + 1}` },
    }
  })
  const labeled_points: LabeledPoint[] = [
    ...dense_cluster,
    // Sparse points where labels should *not* repel significantly
    ...(
      [
        [10, 10, `Sparse-TL`, { x: 10, y: 0 }],
        [90, 10, `Sparse-TR`, { x: -40, y: 0 }],
        [10, 90, `Sparse-BL`, { x: 10, y: -15 }],
        [90, 90, `Sparse-BR`, undefined],
      ] as const
    ).map(([coord_x, coord_y, text, offset]) => ({
      x: coord_x,
      y: coord_y,
      fill: `green`,
      radius: 6,
      label: offset ? { text, offset } : { text },
    })),
    // Single point test
    { x: 50, y: 50, fill: `orange`, radius: 7, label: { text: `Single` } },
  ]

  let enable_auto_placement = $state(true)

  let auto_placement_test_series: DataSeries[] = $derived([
    {
      x: labeled_points.map((point) => point.x),
      y: labeled_points.map((point) => point.y),
      point_style: labeled_points.map(({ fill, radius }) => ({ fill, radius })),
      point_label: labeled_points.map(({ label }) => ({
        ...label,
        font_size: `10px`,
        auto_placement: enable_auto_placement,
      })),
      markers: `points`,
    },
  ])

  let auto_placement_density = $state({
    top_left: 10,
    top_right: 50,
    bottom_left: 10,
    bottom_right: 10,
  })

  // Random points within a quadrant of the 100x100 plot, color-valued with some variation
  const make_quadrant_points = (count: number, x_range: Vec2, y_range: Vec2) => {
    const center_dist = Math.hypot(
      (x_range[0] + x_range[1]) / 2,
      (y_range[0] + y_range[1]) / 2,
    )
    return range(count).map(() => ({
      x: x_range[0] + Math.random() * (x_range[1] - x_range[0]),
      y: y_range[0] + Math.random() * (y_range[1] - y_range[0]),
      color_value: center_dist * Math.random() * 2,
    }))
  }

  let auto_placement_plot_series: DataSeries[] = $derived.by(() => {
    const { top_left, top_right, bottom_left, bottom_right } = auto_placement_density
    const all_points = [
      ...make_quadrant_points(top_left, [0, 50], [50, 100]),
      ...make_quadrant_points(top_right, [50, 100], [50, 100]),
      ...make_quadrant_points(bottom_left, [0, 50], [0, 50]),
      ...make_quadrant_points(bottom_right, [50, 100], [0, 50]),
    ]
    return [
      {
        x: all_points.map((point) => point.x),
        y: all_points.map((point) => point.y),
        color_values: all_points.map((point) => point.color_value),
        point_style: { radius: 5, stroke: `white`, stroke_width: 0.5 },
        markers: `points`,
      },
    ]
  })

  const legend_multi_series: DataSeries[] = [
    {
      x: [1, 2],
      y: [3, 4],
      metadata: { label: `Series A` },
      point_style: { fill: `red`, radius: 5 },
      markers: `points`,
    },
    {
      x: [1, 2],
      y: [1, 2],
      metadata: { label: `Series B` },
      point_style: { fill: `blue`, radius: 5 },
      markers: `points`,
    },
  ]

  // === Linear-to-Log Transition Test Data ===
  let lin_log_y_scale_type = $state<`linear` | `log`>(`linear`)
  const lin_log_transition_data = {
    x: one_to_ten,
    y: [100, 50, 10, 1, 0.1, 0.01, 0.001, 1e-4, 1e-6, 1e-8], // Include values very close to zero
    point_style: { fill: `darkcyan`, radius: 5, stroke: `white`, stroke_width: 1 },
  }

  // === Point Sizing Data ===
  let size_scale = $state({
    radius_range: [2, 15] as Vec2,
    type: `linear` as ScaleType,
  })

  // 40 points on a spiral whose radius drives size_values, with hue and symbol varying by index
  const n_points = 40
  const spiral_points = range(n_points).map((idx) => ({
    idx,
    angle: idx * 0.5,
    radius: 1 + idx * 0.3,
  }))
  const spiral_series: DataSeries = {
    x: spiral_points.map(({ angle, radius }) => Math.cos(angle) * radius),
    y: spiral_points.map(({ angle, radius }) => Math.sin(angle) * radius),
    size_values: spiral_points.map(({ radius }) => radius),
    metadata: spiral_points.map(({ angle, radius }) => ({ angle, radius })),
    point_style: spiral_points.map(({ idx }) => ({
      fill: `hsl(${(idx / n_points) * 360}, 80%, 50%)`,
      stroke: `white`,
      stroke_width: 1 + idx / 20,
      symbol_type: symbol_names[idx % symbol_names.length],
    })),
    markers: `points`,
  }

  let last_clicked_point_id = $state<string | null>(null)
  let last_double_clicked_point_id = $state<string | null>(null)

  const describe_point = (point: InternalPoint) =>
    `series ${point.series_idx}, index ${point.point_idx} (x=${point.x}, y=${point.y})`

  const point_event_series: DataSeries = {
    x: [1, 2, 3],
    y: [2, 4, 1],
    point_style: { fill: `teal`, radius: 8 },
    markers: `points`,
  }

  // === Control Precedence Test Data ===
  // Tests that explicit styling wins on page load, but controls can override when touched
  const control_precedence_series: DataSeries[] = [
    {
      x: [1, 2, 3, 4, 5],
      y: [5, 5, 5, 5, 5],
      label: `Explicit Crimson r=12`,
      // Explicit styling that should NOT be overridden by control defaults on page load
      point_style: {
        fill: `crimson`,
        radius: 12, // Explicitly large - should not become default size (3)
        stroke: `darkred`,
        stroke_width: 3, // Explicitly thick stroke
      },
      markers: `points`,
    },
    {
      x: [1, 2, 3, 4, 5],
      y: [3, 3, 3, 3, 3],
      label: `Explicit Green r=8`,
      point_style: {
        fill: `forestgreen`,
        radius: 8, // Different explicit size
        stroke: `darkgreen`,
        stroke_width: 2,
      },
      markers: `line+points`,
      line_style: {
        stroke: `limegreen`,
        stroke_width: 4, // Explicitly thick line
      },
    },
  ]
</script>

<h1 id="scatterplot-component-e2e-test-page">ScatterPlot Component E2E Test Page</h1>

<section id="basic-example">
  <h2 id="basic-example-1">Basic Example</h2>
  <ScatterPlot
    series={[basic_data]}
    x_axis={{ label: `X Axis` }}
    y_axis={{ label: `Y Axis` }}
    show_controls
  />
</section>

<section id="canvas-auto-renderer">
  <h2 id="canvas-auto-renderer-1">Canvas Auto Renderer</h2>
  <ScatterPlot
    series={[canvas_auto_data]}
    show_controls={false}
    style="height: 320px; width: 480px"
  />
</section>

<section id="marginals-browser-regression">
  <h2 id="marginals-browser-regression-1">Marginals Browser Regression</h2>
  <ScatterPlot
    series={marginal_browser_series}
    x_axis={{ label: `Energy`, range: [0, 10] }}
    y_axis={{ label: `Score`, range: [0, 10] }}
    marginals={{
      top: { type: `kde`, size: 76, label: `x density` },
      right: { type: `histogram`, size: 76, bins: 8, label: `y count` },
    }}
    style="height: 430px; width: 620px"
  />
</section>

<section id="color-scale">
  <h2 id="color-scale-examples">Color Scale Examples</h2>
  <div id="color-scale-toggle">
    <h3 id="color-scale-with-toggle">Color Scale with Toggle</h3>
    <div style="display: flex; justify-content: center; gap: 1em">
      {#each [`linear`, `log`] as scale_type (scale_type)}
        <label>
          <input type="radio" value={scale_type} bind:group={color_scale.type} />
          {scale_type}
        </label>
      {/each}
    </div>
    <ScatterPlot
      series={[color_scale_series]}
      x_axis={{ label: `X Axis` }}
      y_axis={{ label: `Y Axis` }}
      {color_scale}
      color_bar={{}}
    />
  </div>
</section>

<section id="bind-hovered">
  <h2 id="bind-hovered-example">bind:hovered Example</h2>
  <p>Plot is currently hovered: <strong id="hover-status">{is_plot_hovered}</strong></p>
  <ScatterPlot series={[bind_hovered_series]} bind:hovered={is_plot_hovered} />
</section>

<section
  id="label-auto-placement-test"
  style="height: 550px; width: 600px; border: 1px solid lightgray; margin-top: 20px; padding: 10px"
>
  <h2 id="label-auto-placement-test-1">Label Auto Placement Test</h2>
  <label>
    <input type="checkbox" bind:checked={enable_auto_placement} />
    Enable Auto Placement
  </label>
  {#key enable_auto_placement}
    <ScatterPlot
      series={auto_placement_test_series}
      x_axis={{ label: `X`, range: [0, 100] }}
      y_axis={{ label: `Y`, range: [0, 100] }}
      style="height: 450px; width: 100%"
    />
  {/key}
</section>

<section id="auto-colorbar-placement">
  <h2 id="automatic-color-bar-placement">Automatic Color Bar Placement</h2>
  This example demonstrates how the color bar automatically positions itself based on point density.
  <div>
    {#each [[`top_left`, `Top Left`], [`top_right`, `Top Right`], [`bottom_left`, `Bottom Left`], [`bottom_right`, `Bottom Right`]] as const as [quadrant, label] (label)}
      <label>
        {label}: {auto_placement_density[quadrant]}
        <input
          type="range"
          min="0"
          max="100"
          bind:value={auto_placement_density[quadrant]}
          style="width: 100px; margin-left: 0.5em"
        />
      </label>
    {/each}
  </div>

  <ScatterPlot
    series={auto_placement_plot_series}
    x_axis={{ label: `X Position`, range: [0, 100] }}
    y_axis={{ label: `Y Position`, range: [0, 100] }}
    color_scale={{ scheme: `interpolateTurbo` }}
    color_bar={{ title: `Color Bar Title`, responsive: true }}
  >
    {#snippet tooltip({ x: coord_x, y: coord_y, color_value })}
      Point ({coord_x.toFixed(1)}, {coord_y.toFixed(1)})<br />
      Color value: {color_value?.toFixed(2)}
    {/snippet}
  </ScatterPlot>
</section>

<section id="legend-tests">
  <h2 id="legend-rendering-tests">Legend Rendering Tests</h2>
  <h3 id="multi-series-default-legend-legend-expected">
    Multi Series (Default Legend) - Legend Expected
  </h3>
  <ScatterPlot
    series={legend_multi_series}
    legend={{ draggable: true, style: `padding: 8px;` }}
    id="legend-multi-default"
    show_controls
  />
</section>

<section id="lin-log-transition">
  <h2 id="linear-to-log-scale-transition-test">Linear-to-Log Scale Transition Test</h2>
  <p>
    Test switching between linear and log scales. Values near zero previously caused NaN errors
    during the tweening animation.
  </p>
  <div style="display: flex; justify-content: center; gap: 1em; margin-bottom: 1em">
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
  <ScatterPlot
    series={[lin_log_transition_data]}
    x_axis={{ label: `X Axis (Linear)` }}
    y_axis={{
      label: `Y Axis`,
      scale_type: lin_log_y_scale_type,
      range: lin_log_y_scale_type === `log` ? [math.LOG_EPS, null] : [null, null],
    }}
  />
</section>

<section id="point-sizing-spiral-test">
  <h2 id="point-sizing-test-with-spiral-data">Point Sizing Test with Spiral Data</h2>
  <label>
    Min Size (px):
    <input
      type="number"
      bind:value={size_scale.radius_range[0]}
      min="0.5"
      max="10"
      step="0.5"
      style="width: 50px"
      aria-label="Min Size (px)"
    />
  </label>
  <label>
    Max Size (px):
    <input
      type="number"
      bind:value={size_scale.radius_range[1]}
      min="5"
      max="30"
      step="1"
      style="width: 50px"
      aria-label="Max Size (px)"
    />
  </label>
  <label>
    Size Scale:
    <select bind:value={size_scale.type} aria-label="Size Scale">
      <option value="linear">Linear</option>
      <option value="log">Log</option>
    </select>
  </label>

  <ScatterPlot
    series={[spiral_series]}
    x_axis={{ label: `X Axis`, range: [-15, 15] }}
    y_axis={{ label: `Y Axis`, range: [-15, 15] }}
    {size_scale}
    style="height: 500px; width: 100%"
  >
    {#snippet tooltip({ x: coord_x, y: coord_y, metadata })}
      <strong>Spiral Point</strong><br />
      Position: ({format_num(coord_x, `.2~`)}, {format_num(coord_y, `.2~`)})<br />
      {#if metadata}
        Angle: {format_num(metadata.angle as number, `.2~`)} <small>rad</small><br />
        Value (Radius): {format_num(metadata.radius as number, `.2~`)}
      {/if}
    {/snippet}
  </ScatterPlot>
</section>

<section id="tooltip-precedence-test">
  <h2 id="tooltip-background-color-precedence-test">
    Tooltip Background Color Precedence Test
  </h2>
  <h3 id="fill-color-precedence-purple">Fill Color Precedence (Purple)</h3>
  <ScatterPlot
    id="fill-plot"
    series={[{ x: [1], y: [1], point_style: { fill: `purple`, radius: 8 } }]}
    hover_config={{ threshold_px: 100 }}
    style="height: 200px; width: 300px"
  />

  <h3 id="stroke-color-precedence-orange">Stroke Color Precedence (Orange)</h3>
  <ScatterPlot
    id="stroke-plot"
    series={[
      {
        x: [1],
        y: [1],
        point_style: {
          fill: `transparent`,
          stroke: `orange`,
          stroke_width: 2,
          radius: 8,
        },
      },
    ]}
    hover_config={{ threshold_px: 100 }}
    style="height: 200px; width: 300px"
  />

  <h3 id="line-color-precedence-green">Line Color Precedence (Green)</h3>
  <ScatterPlot
    id="line-plot"
    series={[
      {
        x: [1],
        y: [1],
        point_style: {
          fill: `transparent`,
          stroke: `transparent`,
          radius: 8,
        },
        line_style: { stroke: `green`, stroke_width: 3 },
        markers: `line+points`, // Need line+points for hover to work on the point
      },
    ]}
    hover_config={{ threshold_px: 100 }}
    style="height: 200px; width: 300px"
  />
</section>

<section id="point-event-test">
  <h2 id="point-event-test-1">Point Event Test</h2>
  <p>Clicking a point should update the text below.</p>
  <ScatterPlot
    series={[point_event_series]}
    x_axis={{ label: `X` }}
    y_axis={{ label: `Y` }}
    point_events={{
      onclick: ({ point }) => (last_clicked_point_id = `Point: ${describe_point(point)}`),
      ondblclick: ({ point }) =>
        (last_double_clicked_point_id = `DblClick: ${describe_point(point)}`),
    }}
  />
  <p data-testid="last-clicked-point">
    Last Clicked Point: {last_clicked_point_id ?? `none`}
  </p>
  <p data-testid="last-double-clicked-point">
    Last Double-Clicked Point: {last_double_clicked_point_id ?? `none`}
  </p>
</section>

<section id="color-mapped-line-legend-test">
  <h2 id="color-mapped-line-legend-test-1">Color-mapped Line Legend Test</h2>
  <p>Tests that legend line color reflects the color scale for series with color_values.</p>
  <ScatterPlot
    id="color-mapped-line-plot"
    series={[
      {
        x: [1, 2, 3, 4, 5],
        y: [2, 4, 3, 5, 4],
        color_values: [1, 2, 3, 4, 5],
        label: `Color Mapped Line`,
        point_style: { radius: 5 },
        markers: `line+points`,
        // Intentionally no line_style.stroke - should use color scale
      },
    ]}
    x_axis={{ label: `X` }}
    y_axis={{ label: `Y` }}
    color_scale={{ scheme: `interpolateViridis` }}
    color_bar={{ title: `Color Value` }}
    legend={{ draggable: true }}
    show_legend
  />
</section>

<!-- Control Precedence Test: explicit styling should win on page load -->
<section id="control-precedence-test">
  <h2 id="control-precedence-test-1">Control Precedence Test</h2>
  <p>
    Tests that explicit per-series styling (point_style, line_style) is preserved on page load.
    Control defaults should NOT override explicit props until user actually modifies a specific
    control.
  </p>
  <p>
    Expected on page load: Crimson points with radius=12 and stroke_width=3, Green points with
    radius=8 and stroke_width=2, limegreen line with width=4.
  </p>
  <ScatterPlot
    id="control-precedence-plot"
    series={control_precedence_series}
    x_axis={{ label: `X` }}
    y_axis={{ label: `Y`, range: [0, 8] }}
    show_controls
    legend={{ draggable: true }}
  />
</section>
