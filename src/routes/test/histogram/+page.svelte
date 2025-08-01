<script lang="ts">
  import type { DataSeries, ScaleType } from '$lib/plot'
  import { Histogram } from '$lib/plot'
  import { generate_normal } from '$site/plot-utils'

  let bin_count = $state(20)
  let sample_size = $state(1000)
  let normal_visible = $state(true)
  let exponential_visible = $state(true)
  let uniform_visible = $state(true)
  let overlay_opacity = $state(0.7)
  let stroke_width = $state(1.5)
  let x_scale: ScaleType = $state(`linear`)
  let y_scale: ScaleType = $state(`linear`)
  let distribution_type = $state(`bimodal`)
  let show_overlay = $state(false)
  let single_bin_count = $state(20)
  let bin_count_10 = $state(10)
  let bin_count_30 = $state(30)
  let bin_count_100 = $state(100)
  let x_tick_count = $state(10)
  let y_tick_count = $state(8)
  let x_range = $state<[number, number] | undefined>(undefined)
  let y_range = $state<[number, number] | undefined>(undefined)
  let is_plot_hovered = $state(false)

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
        line_style: { stroke: `#2563eb`, stroke_width },
        point_style: { fill: `#2563eb` },
      },
      {
        x: exponential_data.map((_, idx) => idx),
        y: exponential_data,
        label: `Exponential (λ=0.3)`,
        visible: exponential_visible,
        line_style: { stroke: `#dc2626`, stroke_width },
        point_style: { fill: `#dc2626` },
      },
      {
        x: uniform_data.map((_, idx) => idx),
        y: uniform_data,
        label: `Uniform (0-15)`,
        visible: uniform_visible,
        line_style: { stroke: `#16a34a`, stroke_width },
        point_style: { fill: `#16a34a` },
      },
    ] as DataSeries[]
  })

  let log_data = $derived.by(() => {
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

  let real_world_data = $derived.by(() => {
    let values: number[] = []
    if (distribution_type === `bimodal`) {
      values = [...generate_normal(300, 20, 3), ...generate_normal(300, 50, 4)]
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

  let range_test_data = $derived.by(() => {
    const values = generate_normal(1000, 0, 1)
    return [{
      x: values.map((_, idx) => idx),
      y: values,
      label: `Range Control Test`,
      visible: true,
      line_style: { stroke: `#2563eb` },
      point_style: { fill: `#2563eb` },
    }] as DataSeries[]
  })

  let zero_lines_data = $derived.by(() => {
    const values = generate_normal(500, 2, 1)
    return [{
      x: values.map((_, idx) => idx),
      y: values,
      label: `Zero Lines Test`,
      visible: true,
      line_style: { stroke: `#2563eb` },
      point_style: { fill: `#2563eb` },
    }] as DataSeries[]
  })

  let custom_tooltip_data = $derived.by(() => {
    const values = generate_normal(300, 5, 1)
    return [{
      x: values.map((_, idx) => idx),
      y: values,
      label: `Custom Tooltip`,
      visible: true,
      line_style: { stroke: `#8b5cf6` },
      point_style: { fill: `#8b5cf6` },
    }] as DataSeries[]
  })

  let zoom_test_data = $derived.by(() => {
    const values = generate_normal(1000, 0, 1)
    return [{
      x: values.map((_, idx) => idx),
      y: values,
      label: `Zoom/Pan Test`,
      visible: true,
      line_style: { stroke: `#059669` },
      point_style: { fill: `#059669` },
    }] as DataSeries[]
  })

  let hovered_data = $derived.by(() => {
    const values = generate_normal(500, 0, 1)
    return [{
      x: values.map((_, idx) => idx),
      y: values,
      label: `Hover Test`,
      visible: true,
      line_style: { stroke: `#dc2626` },
      point_style: { fill: `#dc2626` },
    }] as DataSeries[]
  })

  let wide_range_data = $derived.by(() => {
    const values = [
      ...generate_normal(200, -1000, 100),
      ...generate_normal(200, 1000, 100),
    ]
    return [{
      x: values.map((_, idx) => idx),
      y: values,
      label: `Wide Range`,
      visible: true,
      line_style: { stroke: `#7c3aed` },
      point_style: { fill: `#7c3aed` },
    }] as DataSeries[]
  })

  let small_range_data = $derived.by(() => {
    const values = generate_normal(500, 0.0001, 0.00001)
    return [{
      x: values.map((_, idx) => idx),
      y: values,
      label: `Small Range`,
      visible: true,
      line_style: { stroke: `#ea580c` },
      point_style: { fill: `#ea580c` },
    }] as DataSeries[]
  })
</script>

<label>Bin Count: <input type="range" min="5" max="50" bind:value={bin_count} /> {
    bin_count
  }</label>
<label>Sample Size: <input type="range" min="100" max="5000" bind:value={sample_size} /> {
    sample_size
  }</label>
<Histogram
  id="basic-single-series"
  series={basic_data}
  bins={bin_count}
  mode="single"
  x_label="Value"
  y_label="Frequency"
  show_controls
/>

<label>Opacity: <input
    type="range"
    min="0.1"
    max="1"
    step="0.1"
    bind:value={overlay_opacity}
  /> {overlay_opacity}</label>
<label>Stroke Width: <input
    type="range"
    min="0.5"
    max="5"
    step="0.5"
    bind:value={stroke_width}
  /> {stroke_width}</label>
<label><input type="checkbox" bind:checked={normal_visible} /> Normal</label>
<label><input type="checkbox" bind:checked={exponential_visible} /> Exponential</label>
<label><input type="checkbox" bind:checked={uniform_visible} /> Uniform</label>
<Histogram
  id="multiple-series-overlay"
  series={multiple_series_data}
  bins={30}
  mode="overlay"
  show_legend
  show_controls
/>

<label>X-axis: <input type="radio" name="x-scale" value="linear" bind:group={x_scale} />
  Linear <input type="radio" name="x-scale" value="log" bind:group={x_scale} />
  Log</label>
<label>Y-axis: <input type="radio" name="y-scale" value="linear" bind:group={y_scale} />
  Linear <input type="radio" name="y-scale" value="log" bind:group={y_scale} />
  Log</label>
<Histogram
  id="logarithmic-scales"
  series={log_data}
  bins={50}
  mode="overlay"
  x_scale_type={x_scale}
  y_scale_type={y_scale}
  show_controls
/>

<label>Distribution Type: <select bind:value={distribution_type}>
    <option value="bimodal">Bimodal</option>
    <option value="skewed">Skewed</option>
    <option value="discrete">Discrete</option>
    <option value="age">Age Groups</option>
  </select></label>
<Histogram
  id="real-world-distributions"
  series={real_world_data}
  bins={distribution_type === `discrete` ? 6 : 25}
  mode="single"
/>

<label><input type="checkbox" bind:checked={show_overlay} /> Show Overlay</label>
{#if show_overlay}
  <label>10 bins: <input type="range" min="5" max="20" bind:value={bin_count_10} /> {
      bin_count_10
    }</label>
  <label>30 bins: <input type="range" min="20" max="50" bind:value={bin_count_30} /> {
      bin_count_30
    }</label>
  <label>100 bins: <input type="range" min="50" max="150" bind:value={bin_count_100} /> {
      bin_count_100
    }</label>
{:else}
  <label>Bin Count: <input type="range" min="5" max="100" bind:value={single_bin_count} />
    {single_bin_count}</label>
{/if}
<Histogram
  id="bin-size-comparison"
  series={bin_comparison_data}
  bins={show_overlay ? bin_count_30 : single_bin_count}
  mode={show_overlay ? `overlay` : `single`}
  show_legend={show_overlay}
/>

<label>X-axis Ticks: <input type="range" min="3" max="15" bind:value={x_tick_count} /> {
    x_tick_count
  }</label>
<label>Y-axis Ticks: <input type="range" min="3" max="12" bind:value={y_tick_count} /> {
    y_tick_count
  }</label>
<Histogram
  id="tick-configuration"
  series={tick_test_data}
  bins={30}
  mode="single"
  x_ticks={x_tick_count}
  y_ticks={y_tick_count}
  x_label="Value (Custom X Ticks)"
  y_label="Count (Custom Y Ticks)"
  show_controls
/>

<Histogram
  id="range-controls"
  series={range_test_data}
  bins={30}
  mode="single"
  x_label="Value (Custom Range)"
  y_label="Count (Custom Range)"
  {x_range}
  {y_range}
  show_controls
/>

<Histogram
  id="zero-lines"
  series={zero_lines_data}
  bins={25}
  mode="single"
  x_label="Value"
  y_label="Count"
  show_zero_lines
  show_controls
/>

<Histogram
  id="custom-tooltip"
  series={custom_tooltip_data}
  bins={20}
  mode="single"
  x_label="Value"
  y_label="Count"
  show_controls
>
  {#snippet tooltip(props)}
    <div style="background: #8b5cf6; color: white; padding: 8px; border-radius: 4px">
      <strong>Custom Tooltip</strong><br />
      Value: {props.value.toFixed(2)}<br />
      Count: {props.count}<br />
      Property: {props.property}
    </div>
  {/snippet}
</Histogram>

<Histogram
  id="zoom-pan"
  series={zoom_test_data}
  bins={40}
  mode="single"
  x_label="Value"
  y_label="Count"
  show_controls
/>

Plot is currently hovered: <strong>{is_plot_hovered}</strong>
<Histogram
  id="bind-hovered"
  series={hovered_data}
  bins={25}
  mode="single"
  x_label="Value"
  y_label="Count"
  bind:hovered={is_plot_hovered}
  show_controls
/>

<Histogram
  id="wide-range"
  series={wide_range_data}
  bins={50}
  mode="single"
  x_label="Value (Wide Range)"
  y_label="Count"
  show_controls
/>

<Histogram
  id="small-range"
  series={small_range_data}
  bins={30}
  mode="single"
  x_label="Value (Small Range)"
  y_label="Count"
  x_format=".6f"
  show_controls
/>
