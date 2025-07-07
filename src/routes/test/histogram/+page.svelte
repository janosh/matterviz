<script lang="ts">
  import type { DataSeries, ScaleType } from '$lib/plot'
  import { Histogram } from '$lib/plot'
  import { generate_normal } from '$site/plot-utils'

  // Basic single series data
  let bin_count = $state(20)
  let sample_size = $state(1000)

  // Generate data for basic test
  let basic_data = $derived.by(() => {
    const values = generate_normal(sample_size, 5, 2)
    return [{
      x: values.map((_, idx) => idx),
      y: values,
      label: `Normal Distribution`,
      visible: true,
      line_style: { stroke: `#2563eb` },
      point_style: { fill: `#2563eb` },
    }] as DataSeries[]
  })

  // Multiple series overlay data
  let normal_visible = $state(true)
  let exponential_visible = $state(true)
  let uniform_visible = $state(true)
  let overlay_opacity = $state(0.7)
  let stroke_width = $state(1.5)

  let multiple_series_data = $derived.by(() => {
    const normal_data = generate_normal(500, 5, 2)
    const exponential_data = Array.from(
      { length: 500 },
      () => -Math.log(Math.random()) / 0.3,
    )
    const uniform_data = Array.from({ length: 500 }, () => Math.random() * 15)

    return [
      {
        x: normal_data.map((_, idx) => idx),
        y: normal_data,
        label: `Normal (μ=5, σ=2)`,
        visible: normal_visible,
        line_style: {
          stroke: `#2563eb`,
          stroke_width: stroke_width,
        },
        point_style: { fill: `#2563eb` },
      },
      {
        x: exponential_data.map((_, idx) => idx),
        y: exponential_data,
        label: `Exponential (λ=0.3)`,
        visible: exponential_visible,
        line_style: {
          stroke: `#dc2626`,
          stroke_width: stroke_width,
        },
        point_style: { fill: `#dc2626` },
      },
      {
        x: uniform_data.map((_, idx) => idx),
        y: uniform_data,
        label: `Uniform (0-15)`,
        visible: uniform_visible,
        line_style: {
          stroke: `#16a34a`,
          stroke_width: stroke_width,
        },
        point_style: { fill: `#16a34a` },
      },
    ] as DataSeries[]
  })

  // Logarithmic scales
  let x_scale: ScaleType = $state(`linear`)
  let y_scale: ScaleType = $state(`linear`)

  let log_data = $derived.by(() => {
    // Log-normal and power law data
    const log_normal = Array.from(
      { length: 1000 },
      () => Math.exp(Math.random() * 2 + 1),
    )
    const power_law = Array.from({ length: 1000 }, () => Math.pow(Math.random(), -2))

    return [
      {
        x: log_normal.map((_, idx) => idx),
        y: log_normal,
        label: `Log-normal`,
        visible: true,
        line_style: { stroke: `#2563eb` },
        point_style: { fill: `#2563eb` },
      },
      {
        x: power_law.map((_, idx) => idx),
        y: power_law,
        label: `Power law`,
        visible: true,
        line_style: { stroke: `#dc2626` },
        point_style: { fill: `#dc2626` },
      },
    ] as DataSeries[]
  })

  // Real-world distributions
  let distribution_type = $state(`bimodal`)
  let distribution_description = $derived(() => {
    if (distribution_type === `bimodal`) {
      return `Two distinct peaks representing different populations`
    } else if (distribution_type === `skewed`) {
      return `Long tail extending to the right, common in income data`
    } else if (distribution_type === `discrete`) {
      return `Discrete values only (integers), like survey responses`
    } else if (distribution_type === `age`) {
      return `Multi-modal age groups in a population`
    } else return `Unknown distribution`
  })

  let real_world_data = $derived.by(() => {
    let values: number[] = []

    if (distribution_type === `bimodal`) {
      values = [
        ...generate_normal(300, 20, 3),
        ...generate_normal(300, 50, 4),
      ]
    } else if (distribution_type === `skewed`) {
      values = Array.from({ length: 500 }, () => Math.pow(Math.random(), 3) * 100)
    } else if (distribution_type === `discrete`) {
      values = Array.from({ length: 200 }, () => Math.floor(Math.random() * 6) + 1)
    } else if (distribution_type === `age`) {
      values = [
        ...generate_normal(100, 25, 5),
        ...generate_normal(150, 45, 8),
        ...generate_normal(100, 65, 6),
      ]
    }

    return [{
      x: values.map((_, idx) => idx),
      y: values,
      label: distribution_type.charAt(0).toUpperCase() + distribution_type.slice(1),
      visible: true,
      line_style: { stroke: `#2563eb` },
      point_style: { fill: `#2563eb` },
    }] as DataSeries[]
  })

  // Bin size comparison
  let show_overlay = $state(false)
  let single_bin_count = $state(20)
  let bin_count_10 = $state(10)
  let bin_count_30 = $state(30)
  let bin_count_100 = $state(100)

  let bin_comparison_data = $derived.by(() => {
    const values = generate_normal(1000, 0, 1)
    const base_series = {
      x: values.map((_, idx) => idx),
      y: values,
      visible: true,
      line_style: { stroke: `#2563eb` },
      point_style: { fill: `#2563eb` },
    }

    if (show_overlay) {
      return [
        { ...base_series, label: `${bin_count_10} bins` },
        { ...base_series, label: `${bin_count_30} bins` },
        { ...base_series, label: `${bin_count_100} bins` },
      ] as DataSeries[]
    } else {
      return [{ ...base_series, label: `${single_bin_count} bins` }] as DataSeries[]
    }
  })

  // Custom styling
  let color_scheme = $state(`default`)
  let x_format = $state(`number`)
  let y_format = $state(`count`)
  let padding_top = $state(60)
  let padding_bottom = $state(60)
  let padding_left = $state(80)
  let padding_right = $state(40)

  // Tick configuration test
  let x_tick_count = $state(10)
  let y_tick_count = $state(8)
  let tick_test_data = $derived.by(() => {
    const values = generate_normal(800, 0, 1)
    return [{
      x: values.map((_, idx) => idx),
      y: values,
      label: `Tick Configuration Test`,
      visible: true,
      line_style: { stroke: `#2563eb` },
      point_style: { fill: `#2563eb` },
    }] as DataSeries[]
  })

  let styled_data = $derived.by(() => {
    const values = generate_normal(500, 0, 1)
    return [{
      x: values.map((_, idx) => idx),
      y: values,
      label: `Styled Data`,
      visible: true,
      line_style: { stroke: `#2563eb` },
      point_style: { fill: `#2563eb` },
    }] as DataSeries[]
  })
</script>

<div style="padding: 2rem; max-width: 1200px; margin: 0 auto">
  <h1>Histogram Component Tests</h1>

  <!-- Basic Single Series Test -->
  <section
    id="basic-single-series"
    style="margin: 2rem 0; padding: 1rem; border: 1px solid #ddd"
  >
    <h2>Basic Single Series</h2>
    <div style="margin: 1rem 0">
      <label>Bin Count: <input type="range" min="5" max="50" bind:value={bin_count} /> {
          bin_count
        }</label>
      <label style="margin-left: 1rem">Sample Size: <input
          type="range"
          min="100"
          max="5000"
          bind:value={sample_size}
        /> {sample_size}</label>
    </div>
    <Histogram
      series={basic_data}
      bins={bin_count}
      mode="single"
      x_label="Value"
      y_label="Frequency"
      style="height: 400px; border: 1px solid #ccc"
    />
  </section>

  <!-- Multiple Series Overlay Test -->
  <section
    id="multiple-series-overlay"
    style="margin: 2rem 0; padding: 1rem; border: 1px solid #ddd"
  >
    <h2>Multiple Series Overlay</h2>
    <div style="margin: 1rem 0">
      <label>Opacity: <input
          type="range"
          min="0.1"
          max="1"
          step="0.1"
          bind:value={overlay_opacity}
        /> {overlay_opacity}</label>
      <label style="margin-left: 1rem">Stroke Width: <input
          type="range"
          min="0.5"
          max="5"
          step="0.5"
          bind:value={stroke_width}
        /> {stroke_width}</label>
    </div>
    <div style="margin: 1rem 0">
      <label><input type="checkbox" bind:checked={normal_visible} /> Normal</label>
      <label style="margin-left: 1rem"><input
          type="checkbox"
          bind:checked={exponential_visible}
        /> Exponential</label>
      <label style="margin-left: 1rem"><input
          type="checkbox"
          bind:checked={uniform_visible}
        /> Uniform</label>
    </div>
    <Histogram
      series={multiple_series_data}
      bins={30}
      mode="overlay"
      show_legend
      style="height: 400px; border: 1px solid #ccc"
    />
  </section>

  <!-- Logarithmic Scales Test -->
  <section
    id="logarithmic-scales"
    style="margin: 2rem 0; padding: 1rem; border: 1px solid #ddd"
  >
    <h2>Logarithmic Scales</h2>
    <div style="margin: 1rem 0">
      <label>X-axis:
        <input type="radio" name="x-scale" value="linear" bind:group={x_scale} /> Linear
        <input type="radio" name="x-scale" value="log" bind:group={x_scale} /> Log
      </label>
      <label style="margin-left: 2rem">Y-axis:
        <input type="radio" name="y-scale" value="linear" bind:group={y_scale} /> Linear
        <input type="radio" name="y-scale" value="log" bind:group={y_scale} /> Log
      </label>
    </div>
    <Histogram
      series={log_data}
      bins={50}
      mode="overlay"
      x_scale_type={x_scale}
      y_scale_type={y_scale}
      style="height: 400px; border: 1px solid #ccc"
    />
  </section>

  <!-- Real-World Distributions Test -->
  <section
    id="real-world-distributions"
    style="margin: 2rem 0; padding: 1rem; border: 1px solid #ddd"
  >
    <h2>Real-World Data Distributions</h2>
    <div style="margin: 1rem 0">
      <label>Distribution Type:
        <select bind:value={distribution_type}>
          <option value="bimodal">Bimodal</option>
          <option value="skewed">Skewed</option>
          <option value="discrete">Discrete</option>
          <option value="age">Age Groups</option>
        </select>
      </label>
    </div>
    <p style="font-style: italic; margin: 0.5rem 0">{distribution_description}</p>
    <Histogram
      series={real_world_data}
      bins={distribution_type === `discrete` ? 6 : 25}
      mode="single"
      style="height: 400px; border: 1px solid #ccc"
    />
  </section>

  <!-- Bin Size Comparison Test -->
  <section
    id="bin-size-comparison"
    style="margin: 2rem 0; padding: 1rem; border: 1px solid #ddd"
  >
    <h2>Bin Size Comparison</h2>
    <div style="margin: 1rem 0">
      <label><input type="checkbox" bind:checked={show_overlay} /> Show Overlay</label>
    </div>
    {#if show_overlay}
      <div style="margin: 1rem 0">
        <label>10 bins: <input type="range" min="5" max="20" bind:value={bin_count_10} />
          {bin_count_10}</label>
        <label style="margin-left: 1rem">30 bins: <input
            type="range"
            min="20"
            max="50"
            bind:value={bin_count_30}
          /> {bin_count_30}</label>
        <label style="margin-left: 1rem">100 bins: <input
            type="range"
            min="50"
            max="150"
            bind:value={bin_count_100}
          /> {bin_count_100}</label>
      </div>
    {:else}
      <div style="margin: 1rem 0">
        <label>Bin Count: <input
            type="range"
            min="5"
            max="100"
            bind:value={single_bin_count}
          /> {single_bin_count}</label>
      </div>
    {/if}
    <div style="background: #f0f8ff; padding: 1rem; margin: 1rem 0; border-radius: 4px">
      <h4>Bin Size Effects</h4>
      <ul>
        <li><strong>Too few bins:</strong> Oversimplified, loses detail</li>
        <li><strong>Too many bins:</strong> Noisy, hard to see patterns</li>
        <li><strong>Just right:</strong> Clear patterns, appropriate detail</li>
      </ul>
    </div>
    <Histogram
      series={bin_comparison_data}
      bins={show_overlay ? bin_count_30 : single_bin_count}
      mode={show_overlay ? `overlay` : `single`}
      show_legend={show_overlay}
      style="height: 400px; border: 1px solid #ccc"
    />
  </section>

  <!-- Tick Configuration Test -->
  <section
    id="tick-configuration"
    style="margin: 2rem 0; padding: 1rem; border: 1px solid #ddd"
  >
    <h2>Tick Configuration Test</h2>
    <div style="margin: 1rem 0">
      <label>X-axis Ticks: <input
          type="range"
          min="3"
          max="15"
          bind:value={x_tick_count}
        /> {x_tick_count}</label>
      <label style="margin-left: 1rem">Y-axis Ticks: <input
          type="range"
          min="3"
          max="12"
          bind:value={y_tick_count}
        /> {y_tick_count}</label>
    </div>
    <div style="background: #f0f8ff; padding: 1rem; margin: 1rem 0; border-radius: 4px">
      <h4>Tick Configuration Benefits</h4>
      <ul>
        <li><strong>Performance:</strong> Configurable ticks prevent hardcoded values</li>
        <li>
          <strong>Flexibility:</strong> Adjust tick density based on data range and chart
          size
        </li>
        <li>
          <strong>User Experience:</strong> Better label readability with appropriate
          spacing
        </li>
      </ul>
    </div>
    <Histogram
      series={tick_test_data}
      bins={30}
      mode="single"
      x_ticks={x_tick_count}
      y_ticks={y_tick_count}
      x_label="Value (Custom X Ticks)"
      y_label="Count (Custom Y Ticks)"
      style="height: 400px; border: 1px solid #ccc"
    />
  </section>

  <!-- Custom Styling Test -->
  <section
    id="custom-styling"
    style="margin: 2rem 0; padding: 1rem; border: 1px solid #ddd; border-radius: 8px; background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)"
  >
    <h2>Custom Styling</h2>
    <div style="margin: 1rem 0">
      <label>Color Scheme:
        <select bind:value={color_scheme}>
          <option value="default">Default</option>
          <option value="warm">Warm</option>
          <option value="cool">Cool</option>
          <option value="monochrome">Monochrome</option>
        </select>
      </label>
      <label style="margin-left: 1rem">X Format:
        <select bind:value={x_format}>
          <option value="number">Number</option>
          <option value="scientific">Scientific</option>
          <option value="currency">Currency</option>
          <option value="percentage">Percentage</option>
        </select>
      </label>
      <label style="margin-left: 1rem">Y Format:
        <select bind:value={y_format}>
          <option value="count">Count</option>
          <option value="percentage">Percentage</option>
          <option value="thousands">Thousands</option>
        </select>
      </label>
    </div>
    <div style="margin: 1rem 0">
      <label>Padding Top: <input
          type="range"
          min="20"
          max="100"
          bind:value={padding_top}
        /> {padding_top}</label>
      <label style="margin-left: 1rem">Padding Bottom: <input
          type="range"
          min="20"
          max="100"
          bind:value={padding_bottom}
        /> {padding_bottom}</label>
      <label style="margin-left: 1rem">Padding Left: <input
          type="range"
          min="40"
          max="120"
          bind:value={padding_left}
        /> {padding_left}</label>
      <label style="margin-left: 1rem">Padding Right: <input
          type="range"
          min="20"
          max="80"
          bind:value={padding_right}
        /> {padding_right}</label>
    </div>
    <div
      class="histogram"
      style="height: 400px; border: 2px solid #333; border-radius: 8px; background: white"
    >
      <Histogram
        series={styled_data}
        bins={25}
        mode="single"
        {x_format}
        {y_format}
        padding={{
          t: padding_top,
          b: padding_bottom,
          l: padding_left,
          r: padding_right,
        }}
      />
    </div>
  </section>
</div>

<style>
  section {
    background: white;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  .histogram {
    position: relative;
  }

  label {
    display: inline-block;
    margin: 0.5rem 0;
    font-weight: 500;
  }

  input[type='range'] {
    margin: 0 0.5rem;
  }

  select {
    margin: 0 0.5rem;
    padding: 0.25rem;
  }
</style>
