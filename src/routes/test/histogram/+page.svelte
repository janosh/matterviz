<script lang="ts">
  import type { HistogramSeries, ScaleType } from '$lib/plot'
  import { Histogram } from '$lib/plot'
  import { generate_normal } from '$site/histogram-data'

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

  let basic_data = $derived.by(() => {
    const values = generate_normal(sample_size, 5, 2)
    return [
      {
        values,
        label: `Normal Distribution`,
        visible: true,
        color: `#2563eb`,
      },
    ] as HistogramSeries[]
  })

  let multiple_series_data = $derived.by(() => {
    const normal_data = generate_normal(500, 5, 2)
    const exponential_data = Array.from({ length: 500 }, () => -Math.log(Math.random()) / 0.3)
    const uniform_data = Array.from({ length: 500 }, () => Math.random() * 15)

    return [
      {
        values: normal_data,
        label: `Normal (μ=5, σ=2)`,
        visible: normal_visible,
        color: `#2563eb`,
      },
      {
        values: exponential_data,
        label: `Exponential (λ=0.3)`,
        visible: exponential_visible,
        color: `#dc2626`,
      },
      {
        values: uniform_data,
        label: `Uniform (0-15)`,
        visible: uniform_visible,
        color: `#16a34a`,
      },
    ] as HistogramSeries[]
  })

  let log_data = $derived.by(() => {
    const log_normal = Array.from({ length: 1000 }, () => Math.exp(Math.random() * 2 + 1))
    const power_law = Array.from({ length: 1000 }, () => Math.random() ** -2)

    return [
      {
        values: log_normal,
        label: `Log-normal`,
        visible: true,
        color: `#2563eb`,
      },
      {
        values: power_law,
        label: `Power law`,
        visible: true,
        color: `#dc2626`,
      },
    ] as HistogramSeries[]
  })

  let real_world_data = $derived.by(() => {
    let values: number[] = []
    if (distribution_type === `bimodal`) {
      values = [...generate_normal(300, 20, 3), ...generate_normal(300, 50, 4)]
    } else if (distribution_type === `skewed`) {
      values = Array.from({ length: 500 }, () => Math.random() ** 3 * 100)
    } else if (distribution_type === `discrete`) {
      values = Array.from({ length: 200 }, () => Math.floor(Math.random() * 6) + 1)
    } else if (distribution_type === `age`) {
      values = [
        ...generate_normal(100, 25, 5),
        ...generate_normal(150, 45, 8),
        ...generate_normal(100, 65, 6),
      ]
    }

    return [
      {
        values,
        label: distribution_type.charAt(0).toUpperCase() + distribution_type.slice(1),
        visible: true,
        color: `#2563eb`,
      },
    ] as HistogramSeries[]
  })

  let bin_comparison_data = $derived.by(() => {
    const values = generate_normal(1000, 0, 1)
    const base_series = {
      values,
      visible: true,
      color: `#2563eb`,
    }

    if (show_overlay) {
      return [
        { ...base_series, label: `${bin_count_10} bins` },
        { ...base_series, label: `${bin_count_30} bins` },
        { ...base_series, label: `${bin_count_100} bins` },
      ] as HistogramSeries[]
    }
    return [{ ...base_series, label: `${single_bin_count} bins` }] as HistogramSeries[]
  })

  let tick_test_data = $derived.by(() => {
    const values = generate_normal(800, 0, 1)
    return [
      {
        values,
        label: `Tick Configuration Test`,
        visible: true,
        color: `#2563eb`,
      },
    ] as HistogramSeries[]
  })

  // Y2 axis test series
  let y2_axis_data = $derived.by(() => {
    const y1_values = generate_normal(500, 5, 1)
    const y2_values = generate_normal(500, 50, 10)
    return [
      {
        values: y1_values,
        label: `Y1 Series`,
        visible: true,
        color: `#2563eb`,
      },
      {
        values: y2_values,
        label: `Y2 Series`,
        visible: true,
        color: `#dc2626`,
        y_axis: `y2`,
      },
    ] as HistogramSeries[]
  })

  let y2_different_scale_data = $derived.by(() => {
    const small_values = generate_normal(500, 10, 2)
    const large_values = generate_normal(500, 1000, 200)
    return [
      {
        values: small_values,
        label: `Small Scale (Y1)`,
        visible: true,
        color: `#059669`,
      },
      {
        values: large_values,
        label: `Large Scale (Y2)`,
        visible: true,
        color: `#f59e0b`,
        y_axis: `y2`,
      },
    ] as HistogramSeries[]
  })
</script>

<section data-testid="basic-single-series-section">
  <label
    >Bin Count: <input type="range" min="5" max="50" bind:value={bin_count} />
    {bin_count}</label
  >
  <label
    >Sample Size: <input type="range" min="100" max="5000" bind:value={sample_size} />
    {sample_size}</label
  >
  <Histogram
    id="basic-single-series"
    series={basic_data}
    bins={bin_count}
    mode="single"
    x_axis={{ label: `Value` }}
    y_axis={{ label: `Frequency` }}
  />
</section>

<label
  >Opacity: <input type="range" min="0.1" max="1" step="0.1" bind:value={overlay_opacity} />
  {overlay_opacity}</label
>
<label
  >Stroke Width: <input type="range" min="0.5" max="5" step="0.5" bind:value={stroke_width} />
  {stroke_width}</label
>
<label><input type="checkbox" bind:checked={normal_visible} /> Normal</label>
<label><input type="checkbox" bind:checked={exponential_visible} /> Exponential</label>
<label><input type="checkbox" bind:checked={uniform_visible} /> Uniform</label>
<Histogram
  id="multiple-series-overlay"
  series={multiple_series_data}
  bins={30}
  mode="overlay"
  show_legend
  bar={{ opacity: overlay_opacity, stroke_width }}
/>

<section data-testid="logarithmic-scales-section">
  <label
    >X-axis: <input type="radio" name="x-scale" value="linear" bind:group={x_scale} />
    Linear <input type="radio" name="x-scale" value="log" bind:group={x_scale} />
    Log</label
  >
  <label
    >Y-axis: <input type="radio" name="y-scale" value="linear" bind:group={y_scale} />
    Linear <input type="radio" name="y-scale" value="log" bind:group={y_scale} />
    Log</label
  >
  <Histogram
    id="logarithmic-scales"
    series={log_data}
    bins={50}
    mode="overlay"
    x_axis={{ scale_type: x_scale }}
    y_axis={{ scale_type: y_scale }}
  />
</section>

<label
  >Distribution Type: <select bind:value={distribution_type}>
    <option value="bimodal">Bimodal</option>
    <option value="skewed">Skewed</option>
    <option value="discrete">Discrete</option>
    <option value="age">Age Groups</option>
  </select></label
>
<Histogram
  id="real-world-distributions"
  series={real_world_data}
  bins={distribution_type === `discrete` ? 6 : 25}
  mode="single"
/>

<section data-testid="bin-size-comparison-section">
  <label><input type="checkbox" bind:checked={show_overlay} /> Show Overlay</label>
  {#if show_overlay}
    <label
      >10 bins: <input type="range" min="5" max="20" bind:value={bin_count_10} />
      {bin_count_10}</label
    >
    <label
      >30 bins: <input type="range" min="20" max="50" bind:value={bin_count_30} />
      {bin_count_30}</label
    >
    <label
      >100 bins: <input type="range" min="50" max="150" bind:value={bin_count_100} />
      {bin_count_100}</label
    >
  {:else}
    <label
      >Bin Count: <input type="range" min="5" max="100" bind:value={single_bin_count} />
      {single_bin_count}</label
    >
  {/if}
  <Histogram
    id="bin-size-comparison"
    series={bin_comparison_data}
    bins={show_overlay ? bin_count_30 : single_bin_count}
    mode={show_overlay ? `overlay` : `single`}
    show_legend={show_overlay}
  />
</section>

<section data-testid="tick-configuration-section">
  <label
    >X-axis Ticks: <input type="range" min="3" max="15" bind:value={x_tick_count} />
    {x_tick_count}</label
  >
  <label
    >Y-axis Ticks: <input type="range" min="3" max="12" bind:value={y_tick_count} />
    {y_tick_count}</label
  >
  <Histogram
    id="tick-configuration"
    series={tick_test_data}
    bins={30}
    mode="single"
    x_axis={{ ticks: x_tick_count, label: `Value (Custom X Ticks)` }}
    y_axis={{ ticks: y_tick_count, label: `Count (Custom Y Ticks)` }}
  />
</section>

<section id="y2-axis-histogram">
  <h2>Y2 Axis Histogram</h2>
  <Histogram
    series={y2_axis_data}
    bins={25}
    mode="overlay"
    show_legend
    x_axis={{ label: `Value` }}
    y_axis={{ label: `Y1 Count` }}
    y2_axis={{ label: `Y2 Count` }}
  />
</section>

<section id="y2-different-scale">
  <h2>Y2 Different Scale Histogram</h2>
  <Histogram
    series={y2_different_scale_data}
    bins={30}
    mode="overlay"
    show_legend
    x_axis={{ label: `Value` }}
    y_axis={{ label: `Small Count` }}
    y2_axis={{ label: `Large Count` }}
  />
</section>
