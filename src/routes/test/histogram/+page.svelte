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
  import TestControls from '../TestControls.svelte'
  import TestSection from '../TestSection.svelte'

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

  const y2_cases = [
    {
      id: `y2-axis-histogram`,
      title: `Y2 axis`,
      data: y2_axis_data,
      bins: 25,
      y_label: `Y1 Count`,
      y2_label: `Y2 Count`,
    },
    {
      id: `y2-different-scale`,
      title: `Y2 different scale`,
      data: y2_different_scale_data,
      bins: 30,
      y_label: `Small Count`,
      y2_label: `Large Count`,
    },
  ]
</script>

<h1>Histogram test page</h1>

<TestSection title="Basic single series" data-testid="basic-single-series-section">
  <TestControls>
    <label
      >Bin Count: <input type="range" min="5" max="50" bind:value={bin_count} />
      {bin_count}</label
    >
    <label
      >Sample Size: <input type="range" min="100" max="5000" bind:value={sample_size} />
      {sample_size}</label
    >
  </TestControls>
  <Histogram
    id="basic-single-series"
    series={basic_data}
    bins={bin_count}
    mode="single"
    x_axis={{ label: `Value` }}
    y_axis={{ label: `Frequency` }}
  />
</TestSection>

<TestSection title="Multiple series overlay">
  <Histogram
    id="multiple-series-overlay"
    series={multiple_series_data}
    bins={30}
    mode="overlay"
    show_legend
    bar={{ opacity: 0.7, stroke_width: 1.5 }}
  />
</TestSection>

<TestSection title="Logarithmic scales" data-testid="logarithmic-scales-section">
  <TestControls>
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
  </TestControls>
  <Histogram
    id="logarithmic-scales"
    series={log_data}
    bins={50}
    mode="overlay"
    x_axis={{ scale_type: x_scale }}
    y_axis={{ scale_type: y_scale }}
  />
</TestSection>

{#each y2_cases as { id, title, data, bins, y_label, y2_label } (id)}
  <TestSection {id} {title}>
    <Histogram
      series={data}
      {bins}
      mode="overlay"
      show_legend
      x_axis={{ label: `Value` }}
      y_axis={{ label: y_label }}
      y2_axis={{ label: y2_label }}
    />
  </TestSection>
{/each}
