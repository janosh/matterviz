<script lang="ts">
  import type { HistogramSeries, ScaleType } from '#lib/plot/index.js'
  import { Histogram } from '#lib/plot/index.js'
  import {
    generate_exponential,
    generate_log_normal,
    generate_normal,
    generate_power_law,
    generate_uniform,
  } from '#site/histogram-data.js'

  let bin_count = $state(20)
  let sample_size = $state(1000)
  let x_scale: ScaleType = $state(`linear`)
  let y_scale: ScaleType = $state(`linear`)

  const series = (
    values: number[],
    label: string,
    color: string,
    extra: Partial<HistogramSeries> = {},
  ): HistogramSeries => ({ values, label, color, visible: true, ...extra })

  let basic_data = $derived([
    series(generate_normal(sample_size, 5, 2), `Normal Distribution`, `#2563eb`),
  ])

  const multiple_series_data = [
    series(generate_normal(500, 5, 2), `Normal (μ=5, σ=2)`, `#2563eb`),
    series(generate_exponential(500, 0.3), `Exponential (λ=0.3)`, `#dc2626`),
    series(generate_uniform(500, 0, 15), `Uniform (0-15)`, `#16a34a`),
  ]

  const log_data = [
    series(generate_log_normal(1000, 2, 0.6), `Log-normal`, `#2563eb`),
    series(generate_power_law(1000, 1.5), `Power law`, `#dc2626`),
  ]

  const y2_axis_data = [
    series(generate_normal(500, 5, 1), `Y1 Series`, `#2563eb`),
    series(generate_normal(500, 50, 10), `Y2 Series`, `#dc2626`, { y_axis: `y2` }),
  ]

  const y2_different_scale_data = [
    series(generate_normal(500, 10, 2), `Small Scale (Y1)`, `#059669`),
    series(generate_normal(500, 1000, 200), `Large Scale (Y2)`, `#f59e0b`, { y_axis: `y2` }),
  ]
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

<Histogram
  id="multiple-series-overlay"
  series={multiple_series_data}
  bins={30}
  mode="overlay"
  show_legend
  bar={{ opacity: 0.7, stroke_width: 1.5 }}
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

<section id="y2-axis-histogram">
  <h2 id="y2-axis-histogram-1">Y2 Axis Histogram</h2>
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
  <h2 id="y2-different-scale-histogram">Y2 Different Scale Histogram</h2>
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
