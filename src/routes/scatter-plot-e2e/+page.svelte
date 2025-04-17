<script lang="ts">
  import { ScatterPlot } from '$lib'

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
    x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    y: [5, 15, 45, 135, 405, 1215, 3645, 10935, 32805, 98415],
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

  // Create color gradient data with exponential values
  const color_scale_data = {
    x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    y: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    // Create values with exponential distribution (1, 2, 4, 8, 16, 32, 64, 128, 256, 512)
    color_values: Array.from({ length: 10 }, (_, idx) => Math.pow(2, idx)),
    point_style: {
      radius: 10,
      stroke: `black`,
      stroke_width: 1,
    },
  }
</script>

<div class="demo-container">
  <h1>ScatterPlot Component Examples</h1>

  <section class="demo-section" id="basic-example">
    <h2>Basic Example</h2>
    <div class="demo-plot">
      <ScatterPlot
        series={[basic_data]}
        x_label="X Axis"
        y_label="Y Axis"
        x_format=".0f"
        y_format=".0f"
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
          x_format=".0f"
          y_format=".0f"
          markers="points"
        />
      </div>
      <div class="demo-plot" id="line-only">
        <h3>Line Only</h3>
        <ScatterPlot
          series={[line_data]}
          x_label="X Axis"
          y_label="Y Axis (Line)"
          x_format=".0f"
          y_format=".0f"
          markers="line"
        />
      </div>
      <div class="demo-plot" id="line-points">
        <h3>Line + Points</h3>
        <ScatterPlot
          series={[line_points_data]}
          x_label="X Axis"
          y_label="Y Axis (Line+Points)"
          x_format=".0f"
          y_format=".0f"
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
          x_format=".0f"
          y_format=".0f"
          markers="line+points"
        />
      </div>
      <div class="demo-plot" id="small-range">
        <h3>Very Small Range</h3>
        <ScatterPlot
          series={[small_range_data]}
          x_label="X Axis"
          y_label="Y Axis"
          x_format=".0f"
          y_format=".0f"
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
          x_format=".0f"
          y_format=".0f"
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
          x_format=".0f"
          y_format=".0f"
          markers="points"
        />
      </div>
      <div class="demo-plot" id="multi-series">
        <h3>Multiple Series</h3>
        <ScatterPlot
          series={[multi_series_data1, multi_series_data2]}
          x_label="X Axis"
          y_label="Y Axis"
          x_format=".0f"
          y_format=".0f"
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
        {#key color_scale_type}
          <ScatterPlot
            series={[color_scale_data]}
            x_label="X Axis"
            y_label="Y Axis"
            x_format=".0f"
            y_format=".0f"
            markers="points"
            color_scheme="viridis"
            color_scale_type={color_scale_type as `linear` | `log`}
          />
        {/key}
      </div>
    </div>
  </section>
</div>

<style>
  .demo-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 20px;
  }

  .demo-section {
    margin-bottom: 60px;
  }

  .demo-row {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    justify-content: center;
  }

  .demo-plot {
    flex: 1;
    min-width: 350px;
    height: 300px;
    border: 1px solid #ccc;
    box-sizing: border-box;
    border-radius: 8px;
    margin-bottom: 20px;
  }

  :is(h1, h2, h3) {
    text-align: center;
    margin-top: 0;
  }
</style>
