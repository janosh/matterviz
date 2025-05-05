<script lang="ts">
  import { ScatterPlot } from '$lib'
  import type { DataSeries, LabelStyle, PointStyle, ScaleType } from '$lib/plot'
  import { LOG_MIN_EPS, symbol_names } from '$lib/plot'

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
  let color_scale = $state({ type: `linear` as const })

  const color_scale_data = {
    x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    y: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    color_values: Array(10)
      .fill(0)
      .map((_, idx) => Math.pow(2, idx)),
    point_style: { radius: 10, stroke: `black`, stroke_width: 1 },
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
      { text: `Sparse-TL`, auto_placement: true, font_size: `10px`, offset: { x: 10 } },
      { text: `Sparse-TR`, auto_placement: true, font_size: `10px`, offset: { x: -40 } },
      { text: `Sparse-BL`, auto_placement: true, font_size: `10px`, offset: { y: -15 } },
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
      ).map(
        (lbl): LabelStyle => ({
          ...(typeof lbl === `object` && lbl !== null ? lbl : {}),
          auto_placement: enable_auto_placement,
        }),
      ),
    }))
  })

  // === Automatic Color Bar Placement Data ===
  let auto_placement_density = $state({
    top_left: 10,
    top_right: 50,
    bottom_left: 10,
    bottom_right: 10,
  })

  // Function to generate points within a specific quadrant for the demo
  const make_quadrant_points = (
    count: number,
    x_range: [number, number],
    y_range: [number, number],
  ) => {
    const points = []
    for (let idx = 0; idx < count; idx++) {
      const x_val = x_range[0] + Math.random() * (x_range[1] - x_range[0])
      const y_val = y_range[0] + Math.random() * (y_range[1] - y_range[0])
      // Assign a color value (e.g., based on distance from origin)
      const center_x = x_range[0] + (x_range[1] - x_range[0]) / 2
      const center_y = y_range[0] + (y_range[1] - y_range[0]) / 2
      const color_val = Math.sqrt(center_x ** 2 + center_y ** 2) * Math.random() * 2 // Add some variation

      points.push({ x: x_val, y: y_val, color_value: color_val })
    }
    return points
  }

  // Reactive generation of plot data based on densities for the demo
  let auto_placement_plot_series = $derived.by(() => {
    const plot_width = 100
    const plot_height = 100
    const center_x = plot_width / 2
    const center_y = plot_height / 2

    // Note: The demo markdown had reversed y-axis quadrants mapping (e.g. density.bottom_left -> [0, center_y])
    // Correcting here for standard Cartesian mapping
    const tl_points = make_quadrant_points(
      auto_placement_density.top_left,
      [0, center_x],
      [center_y, plot_height],
    )
    const tr_points = make_quadrant_points(
      auto_placement_density.top_right,
      [center_x, plot_width],
      [center_y, plot_height],
    )
    const bl_points = make_quadrant_points(
      auto_placement_density.bottom_left,
      [0, center_x],
      [0, center_y],
    )
    const br_points = make_quadrant_points(
      auto_placement_density.bottom_right,
      [center_x, plot_width],
      [0, center_y],
    )

    const all_points = [...tl_points, ...tr_points, ...bl_points, ...br_points]

    return [
      {
        x: all_points.map((p) => p.x),
        y: all_points.map((p) => p.y),
        color_values: all_points.map((p) => p.color_value),
        // point_label: all_points.map(p => ({ text: p.label, offset: { x: 0, y: -10 }, font_size: '14px' })),
        point_style: { radius: 5, stroke: `white`, stroke_width: 0.5 },
      },
    ]
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
    point_style: { fill: `darkcyan`, radius: 5, stroke: `white`, stroke_width: 1 },
  }

  // === Point Sizing Data ===
  let size_scale = $state({
    radius_range: [2, 15] as [number, number],
    type: `linear` as ScaleType,
  })

  // Create a dataset with points arranged in a spiral pattern
  const point_count = 40

  // Reactive generation of spiral data based on controls
  let spiral_data = $derived.by(() => {
    const data = {
      x: [] as number[],
      y: [] as number[],
      size_values: [] as number[], // Array for size scaling
      point_style: [] as PointStyle[], // Explicitly type as PointStyle[]
      metadata: [] as Record<string, unknown>[], // Explicitly type as Record<string, unknown>[]
    }

    // Generate points in a spiral pattern
    for (let idx = 0; idx < point_count; idx++) {
      // Calculate angle and radius for spiral
      const angle = idx * 0.5
      const radius = 1 + idx * 0.3

      // Convert to cartesian coordinates
      const x = Math.cos(angle) * radius
      const y = Math.sin(angle) * radius

      data.x.push(x)
      data.y.push(y)
      data.size_values.push(radius) // Use spiral radius for sizing

      // Store angle in metadata
      data.metadata.push({ angle, radius } as Record<string, unknown>) // Cast pushed object
      // Change color gradually along the spiral
      const hue = (idx / point_count) * 360
      // Change marker type based on index
      const symbol_type = symbol_names[idx % symbol_names.length]

      // Create the point style (radius is now controlled by size_values)
      data.point_style.push({
        fill: `hsl(${hue}, 80%, 50%)`,
        stroke: `white`,
        stroke_width: 1 + idx / 20, // Gradually thicker stroke
        symbol_type,
      } as PointStyle) // Cast pushed object
    }
    return data as DataSeries // Cast return value to satisfy the derived type
  })

  // === Line Style Data ===
  const solid_line_data_1 = {
    x: [1, 2, 3, 4, 5],
    y: [2, 4, 3, 5, 4],
    point_style: { fill: `steelblue` }, // Needed for line color fallback
    label: `Solid Line 1`, // Add unique label for key
  }
  const solid_line_data_2 = {
    x: [1, 2, 3, 4, 5],
    y: [6, 8, 7, 9, 8],
    line_style: { stroke: `steelblue`, stroke_width: 2 }, // Explicit style
    label: `Solid Line 2`, // Add unique label for key
  }
  const dashed_line_data = {
    x: [1, 2, 3, 4, 5],
    y: [10, 12, 11, 13, 12],
    line_style: { stroke: `crimson`, stroke_width: 3, line_dash: `5 2` },
    label: `Dashed Line`, // Add unique label for key
  }
  const custom_dash_data = {
    x: [1, 2, 3, 4, 5],
    y: [14, 16, 15, 17, 16],
    line_style: { stroke: `forestgreen`, stroke_width: 1, line_dash: `10 5 2 5` },
    label: `Custom Dash Line`, // Add unique label for key
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
              <input type="radio" value={scale_type} bind:group={color_scale.type} />
              {scale_type}
            </label>
          {/each}
        </div>
        <ScatterPlot
          series={[color_scale_data]}
          x_label="X Axis"
          y_label="Y Axis"
          markers="points"
          {color_scale}
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
          Point Info: <strong>{props.metadata?.info}</strong><br />
          Coords: ({props.x_formatted}, {props.y_formatted})
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

  <section class="demo-section" id="auto-colorbar-placement">
    <h2>Automatic Color Bar Placement</h2>
    <p>
      This example demonstrates how the color bar automatically positions itself based on
      point density.
    </p>
    <div
      style="display: grid; grid-template-columns: repeat(2, max-content); gap: 1.5em; place-items: center; place-content: center; margin-bottom: 1em;"
    >
      {#each [[`top_left`, `Top Left`], [`top_right`, `Top Right`], [`bottom_left`, `Bottom Left`], [`bottom_right`, `Bottom Right`]] as const as [quadrant, label] (label)}
        <label>
          {label}: {auto_placement_density[quadrant]}
          <input
            type="range"
            min="0"
            max="100"
            bind:value={auto_placement_density[quadrant]}
            style="width: 100px; margin-left: 0.5em;"
          />
        </label>
      {/each}
    </div>

    <div class="demo-plot" style="height: 450px;">
      <ScatterPlot
        series={auto_placement_plot_series}
        x_label="X Position"
        y_label="Y Position"
        x_lim={[0, 100]}
        y_lim={[0, 100]}
        markers="points"
        color_scale={{ scheme: `Turbo` }}
        color_bar={{ title: `Color Bar Title` }}
      >
        {#snippet tooltip({ x, y, color_value })}
          Point ({x.toFixed(1)}, {y.toFixed(1)})<br />
          Color value: {color_value?.toFixed(2)}
        {/snippet}
      </ScatterPlot>
    </div>
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
        y_lim={lin_log_y_scale_type === `log` ? [LOG_MIN_EPS, null] : [null, null]}
      />
    </div>
  </section>

  <!-- Added Point Sizing Example -->
  <h2>Point Sizing Test with Spiral Data</h2>
  <div id="point-sizing">
    <div style="display: flex; gap: 2em; margin-bottom: 1em; align-items: center;">
      <label>
        Min Size (px):
        <input
          type="number"
          bind:value={size_scale.radius_range[0]}
          min="0.5"
          max="10"
          step="0.5"
          style="width: 50px;"
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
          style="width: 50px;"
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
    </div>

    <ScatterPlot
      series={[spiral_data]}
      x_label="X Axis"
      y_label="Y Axis"
      x_lim={[-15, 15]}
      y_lim={[-15, 15]}
      markers="points"
      {size_scale}
      style="height: 500px; width: 100%;"
    >
      {#snippet tooltip({ x, y, metadata })}
        <strong>Spiral Point</strong><br />
        Position: ({x.toFixed(2)}, {y.toFixed(2)})<br />
        {#if metadata}
          Angle: {(metadata.angle as number).toFixed(2)} rad<br />
          Value (Radius): {(metadata.radius as number).toFixed(2)}
        {/if}
      {/snippet}
    </ScatterPlot>
  </div>

  <section>
    <h2>Line Styling Test</h2>
    <div id="line-styling-test">
      <section id="solid-line-plot">
        <h3>Solid Lines</h3>
        <ScatterPlot
          series={[solid_line_data_1, solid_line_data_2]}
          x_label="X Axis"
          y_label="Y Axis"
          markers="line"
        />
      </section>
      <section id="dashed-line-plot">
        <h3>Dashed Line</h3>
        <ScatterPlot
          series={[dashed_line_data]}
          x_label="X Axis"
          y_label="Y Axis"
          markers="line"
        />
      </section>
      <section id="custom-dash-plot">
        <h3>Custom Dashed Line</h3>
        <ScatterPlot
          series={[custom_dash_data]}
          x_label="X Axis"
          y_label="Y Axis"
          markers="line"
        />
      </section>
    </div>
  </section>

  <!-- Added Tooltip Precedence Test -->
  <section id="tooltip-precedence-test">
    <h2>Tooltip Background Color Precedence Test</h2>
    <div class="plot-grid">
      <div id="fill-plot" class="plot-container">
        <h3>Fill Color Precedence (Purple)</h3>
        <ScatterPlot
          series={[{ x: [1], y: [1], point_style: { fill: `purple`, radius: 8 } }]}
          hover_config={{ threshold_px: 100 }}
        />
      </div>
      <div id="stroke-plot" class="plot-container">
        <h3>Stroke Color Precedence (Orange)</h3>
        <ScatterPlot
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
        />
      </div>
      <div id="line-plot" class="plot-container">
        <h3>Line Color Precedence (Green)</h3>
        <ScatterPlot
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
        />
      </div>
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

  label {
    margin-right: 1em;
  }
</style>
