# Histogram

## Basic Histogram

This example demonstrates bar styling options including `border_radius` for rounded corners and `stroke_color`/`stroke_width` for bar borders:

```svelte example
<script>
  import { format_num, Histogram } from 'matterviz'
  import { generate_normal } from '$site/plot-utils'

  let bins = $state(50)
  let sample_size = $state(1000)
  let show_controls = $state(true)
  let border_radius = $state(2)
  let hover_info = $state('Hover over a bar to see details')
  let click_info = $state('Click on a bar to select it')

  let data = $derived({
    y: generate_normal(sample_size, 50, 15),
    label: `Normal Distribution (μ=50, σ=15)`,
  })

  function handle_bar_hover(data) {
    if (data) {
      const { value, count, property } = data
      hover_info = `Hovering: ${property} - Value: ${
        value.toFixed(1)
      }, Count: ${count}, Percentage: ${format_num(count / sample_size, `.2~%`)}`
    } else {
      hover_info = 'Hover over a bar to see details'
    }
  }

  function handle_bar_click(data) {
    const { value, count, property } = data
    click_info = `Clicked: ${property} - Value: ${
      value.toFixed(1)
    }, Count: ${count}, Percentage: ${format_num(count / sample_size, `.2~%`)}`
  }

  const info_style =
    'margin: 1em 0; padding: 2pt 5pt; background-color: rgba(255, 255, 255, 0.1); border-radius: 4px'
</script>

<label>Bins: {bins}<input type="range" bind:value={bins} min="5" max="200" /></label>
<label>Size: {sample_size}
  <input type="range" bind:value={sample_size} min="100" max="10000" step="100" />
</label>
<label><input type="checkbox" bind:checked={show_controls} />Controls</label>
<label>Radius: {border_radius}<input
    type="range"
    bind:value={border_radius}
    min="0"
    max="8"
  /></label>

{#snippet tooltip({ value, count })}
  Value: {value.toFixed(1)}<br>Count: {count}<br>
  %: {format_num(count / sample_size, `.2~%`)}
{/snippet}

<Histogram
  series={[data]}
  {bins}
  {show_controls}
  bar={{ border_radius, stroke_color: `#364fc7`, stroke_width: 0.5 }}
  on_bar_hover={handle_bar_hover}
  on_bar_click={handle_bar_click}
  {tooltip}
  style="height: 400px"
/>

<div style={info_style} data-testid="hover-status">{hover_info}</div>
<div style={info_style} data-testid="click-status">{click_info}</div>
```

## Dual Y-Axes for Different Sample Sizes

When comparing distributions with vastly different sample sizes, use **dual y-axes** for independent scaling. This example shows test scores from two cohorts with 1000 vs 200 samples:

```svelte example
<script>
  import { Histogram } from 'matterviz'
  import { generate_normal } from '$site/plot-utils'

  let display = $state({ x_grid: true, y_grid: false, y2_grid: false })
  let series = $state([
    {
      y: generate_normal(1000, 75, 12),
      label: `Main Cohort (n=1000)`,
      line_style: { stroke: `steelblue` },
    },
    {
      y: generate_normal(200, 82, 10),
      label: `Control Group (n=200)`,
      line_style: { stroke: `coral` },
      y_axis: `y2`,
    },
  ])
</script>

<div style="display: flex; gap: 1em; margin-bottom: 1em">
  <label><input type="checkbox" bind:checked={display.x_grid} />X grid</label>
  <label><input type="checkbox" bind:checked={display.y_grid} />Y1 grid</label>
  <label><input type="checkbox" bind:checked={display.y2_grid} />Y2 grid</label>
</div>

<Histogram
  {series}
  mode="overlay"
  bins={40}
  x_axis={{ label: `Test Score` }}
  y_axis={{ label: `Count (Main Cohort)` }}
  y2_axis={{ label: `Count (Control)` }}
  bind:display
  bar={{ opacity: 0.6 }}
  style="height: 400px"
>
  {#snippet tooltip({ value, count, property })}
    <strong>{property}</strong><br>
    Score: {value.toFixed(1)}<br>Count: {count}
  {/snippet}
</Histogram>
```

## Multiple Histograms with Dual Y-Axes

Compare distributions with vastly different scales using **dual y-axes**. Some distributions use the left axis, while others use the independent right y2-axis:

```svelte example
<script>
  import { Histogram } from 'matterviz'
  import * as utils from '$site/plot-utils'

  let x_axis = $state({scale_type: `linear`})
  let y_axis = $state({scale_type: `linear`, label: `Count (Normal/Uniform)`})
  let y2_axis = $state({scale_type: `linear`, label: `Count (Exp/Gamma)`})
  let display = $state({ x_grid: true, y_grid: true, y2_grid: false })
  let bar = $state({ opacity: 0.6, stroke_width: 1.5 })

  let series = $state([
    { y: utils.generate_normal(1200, 5, 2), label: `Normal (μ=5, σ=2)`, line_style: { stroke: `crimson` } },
    { y: utils.generate_exponential(1200, 0.3), label: `Exponential (λ=0.3)`, line_style: { stroke: `royalblue` }, y_axis: `y2` },
    { y: utils.generate_uniform(1200, 0, 15), label: `Uniform (0-15)`, line_style: { stroke: `mediumseagreen` } },
    { y: utils.generate_gamma(1000, 2, 3), label: `Gamma (α=2, β=3)`, line_style: { stroke: `darkorange` }, y_axis: `y2` },
  ])

  function toggle_series(idx) {
    series[idx].visible = !series[idx].visible
    series = [...series]
  }
</script>

<div style="display: flex; gap: 1em; flex-wrap: wrap; margin-block: 2em; align-items: center;">
  <label>Opacity:
    <input type="number" bind:value={bar.opacity} min="0.1" max="1" step="0.1" />
    <input type="range" bind:value={bar.opacity} min="0.1" max="1" step="0.1" />
  </label>
  <label>Stroke Width:
    <input type="number" bind:value={bar.stroke_width} min="0" max="5" step="0.5" />
    <input type="range" bind:value={bar.stroke_width} min="0" max="5" step="0.5" />
  </label>

  <label style="display: flex; gap: 5pt">X: {#each [`linear`, `log`] as scale}
    <input type="radio" bind:group={x_axis.scale_type} value={scale} />{scale}
  {/each}</label>
  <label style="display: flex; gap: 5pt">Y1: {#each [`linear`, `log`] as scale}
    <input type="radio" bind:group={y_axis.scale_type} value={scale} />{scale}
  {/each}</label>
  <label style="display: flex; gap: 5pt">Y2: {#each [`linear`, `log`] as scale}
    <input type="radio" bind:group={y2_axis.scale_type} value={scale} />{scale}
  {/each}</label>

  <label><input type="checkbox" bind:checked={display.x_grid} />X grid</label>
  <label><input type="checkbox" bind:checked={display.y_grid} />Y1 grid</label>
  <label><input type="checkbox" bind:checked={display.y2_grid} />Y2 grid</label>
</div>

{#each series as srs, idx}
  <label>
    <input type="checkbox" checked={srs.visible} onchange={() => toggle_series(idx)} />
    <span style="width: 16px; height: 16px; margin: 0 0.5em; background: {srs.line_style.stroke}"></span>
    {srs.label} {srs.y_axis === `y2` ? `(Y2)` : `(Y1)`}
  </label>
{/each}

<Histogram
  {series}
  mode="overlay"
  bins={50}
  {bar}
  {x_axis}
  {y_axis}
  {y2_axis}
  {display}
  style="height: 450px; margin-block: 1em;"
>
  {#snippet tooltip({ value, count, property })}
    <strong style="color: {series.find(srs => srs.label === property)?.line_style?.stroke}">{property}</strong><br>
    Value: {value.toFixed(2)}<br>Count: {count}
  {/snippet}
</Histogram>
```

## Logarithmic Scales

```svelte example
<script>
  import { Histogram } from 'matterviz'
  import * as utils from '$site/plot-utils'

  let x_axis = $state({ scale_type: `linear` })
  let y_axis = $state({ scale_type: `log` })
  $effect(() => {
    x_axis.label = `Value (${x_axis.scale_type} scale)`
    x_axis.format = x_axis.scale_type === `log` ? `~s` : `d`
    y_axis.label = `Frequency (${y_axis.scale_type} scale)`
    y_axis.format = y_axis.scale_type === `log` ? `~s` : `d`
  })
  let bins = $state(40)

  let series = $state([
    {
      y: utils.generate_log_normal(1500, 2, 1),
      label: `Log-Normal (μ=2, σ=1)`,
      line_style: { stroke: `darkorange` },
    },
    {
      y: utils.generate_power_law(1500, 2.5),
      label: `Power Law (α=2.5)`,
      line_style: { stroke: `darkgreen` },
    },
    {
      y: utils.generate_pareto(1200, 1, 3),
      label: `Pareto (α=3)`,
      line_style: { stroke: `darkviolet` },
    },
  ])
</script>

X: {#each [`linear`, `log`] as scale (scale)}
  <label>
    <input type="radio" bind:group={x_axis.scale_type} value={scale} />{scale}
  </label>
{/each}
Y: {#each [`linear`, `log`] as scale (scale)}
  <label>
    <input type="radio" bind:group={y_axis.scale_type} value={scale} />{scale}
  </label>
{/each}

<label>Bins: {bins}<input
    type="range"
    bind:value={bins}
    min="10"
    max="100"
    step="5"
  /></label>

<Histogram
  {series}
  mode="overlay"
  {bins}
  {x_axis}
  {y_axis}
  style="height: 450px; margin-block: 1em"
>
  {#snippet tooltip({ value, count, property })}
    <strong>{property}</strong><br>
    Value: {value.toExponential(2)}<br>Count: {count}
  {/snippet}
</Histogram>
```

## Real-World Distributions

```svelte example
<script>
  import { Histogram } from 'matterviz'
  import * as utils from '$site/plot-utils'
  import { format_num } from 'matterviz'

  let selected = $state(`bimodal`)
  let mode = $state(`single`)
  let x_axis = $state({})
  let y_axis = $state({ label: `Count` })
  $effect(() => {
    x_axis.label = { discrete: `Rating`, age: `Age` }[selected] ?? `Value`
    x_axis.format = selected === `discrete` ? `.1f` : `.0f`
  })

  let distributions = $derived({
    bimodal: {
      data: utils.generate_bimodal(1500),
      label: `Bimodal Distribution`,
      color: `#e74c3c`,
    },
    skewed: {
      data: utils.generate_skewed(1200),
      label: `Right-Skewed Distribution`,
      color: `#3498db`,
    },
    discrete: {
      data: utils.generate_discrete(1000),
      label: `Survey Responses (1-10)`,
      color: `#2ecc71`,
    },
    age: {
      data: utils.generate_age_distribution(2000),
      label: `Age Distribution`,
      color: `#9b59b6`,
    },
    mixture: {
      data: utils.generate_mixture(1800),
      label: `Complex Mixture`,
      color: `#f39c12`,
    },
  })

  let current = $derived(distributions[selected])
  let series_data = $derived(
    mode === `single`
      ? [{
        y: current.data,
        label: current.label,
        line_style: { stroke: current.color },
      }]
      : Object.entries(distributions).map(([key, dist]) => ({
        y: dist.data,
        label: dist.label,
        line_style: { stroke: dist.color },
        visible: key === selected,
      })),
  )
</script>

<select bind:value={selected}>
  {#each Object.entries(distributions) as [key, dist]}
    <option value={key}>{dist.label}</option>
  {/each}
</select>

{#each [`single`, `overlay`] as display_mode}
  <label><input type="radio" bind:group={mode} value={display_mode} />{
      display_mode
    }</label>
{/each}

<Histogram
  series={series_data}
  {mode}
  {x_axis}
  {y_axis}
  bins={selected === `discrete` ? 10 : 40}
  show_legend={mode === `overlay`}
  style="height: 450px; margin-block: 1em"
>
  {#snippet tooltip({ value, count, property })}
    <strong>{property}</strong><br>
    {{ age: `Age`, discrete: `Rating` }[selected] ?? `Value`}: {
      format_num(value, selected === `discrete` ? `.1f` : `.0f`)
    }<br>
    Count: {count}<br>%: {format_num(count / current.data.length, `.2~%`)}
  {/snippet}
</Histogram>
```

## Bin Size Comparison

```svelte example
<script>
  import { Histogram } from 'matterviz'
  import * as utils from '$site/plot-utils'

  let bin_counts = $state([10, 25, 50, 100])
  let show_overlay = $state(true)
  let data_type = $state(`mixed`)
  let bar = $state({ opacity: 0.6 })

  const base_data = $derived(data_type === `mixed` ? utils.generate_mixed_data(3000) : utils.generate_complex_distribution(3000))
  const colors = [`#e74c3c`, `#3498db`, `#2ecc71`, `#f39c12`]

  let series = $derived(
    show_overlay
      ? bin_counts.map((bins, idx) => ({
        y: base_data,
        label: `${bins} bins`,
        line_style: { stroke: colors[idx] },
      }))
      : [{ y: base_data, label: `${data_type === `mixed` ? `Mixed` : `Complex`} Distribution`, line_style: { stroke: `#8e44ad` } }]
  )
</script>

{#each [`mixed`, `complex`] as type (type)}
  <label><input type="radio" bind:group={data_type} value={type} />{type}</label>
{/each}

<label><input type="checkbox" bind:checked={show_overlay} />Multiple Bin Sizes</label>

<label>Opacity: {bar.opacity}<input type="range" bind:value={bar.opacity} min="0.1" max="1" step="0.1" /></label>

{#if !show_overlay}
  <label>Bins: {bin_counts[1]}<input type="range" bind:value={bin_counts[1]} min="5" max="200" step="5" /></label>
{:else}
  {#each bin_counts as count, idx (count)}
    <label style="color: {colors[idx]}">{count} bins: <input type="range" bind:value={bin_counts[idx]} min="5" max="200" step="5" /></label>
  {/each}
{/if}

<Histogram
  {series}
  bins={show_overlay ? 25 : bin_counts[1]}
  mode={show_overlay ? `overlay` : `single`}
  bind:bar
  show_legend={show_overlay}
  style="height: 450px; margin-block: 1em;"
>
  {#snippet tooltip({ value, count, property })}
    <strong>{property}</strong><br>Range: {value.toFixed(1)}<br>Count: {count}
  {/snippet}
</Histogram>
```

## Custom Styling

```svelte example
<script>
  import { Histogram } from 'matterviz'
  import * as utils from '$site/plot-utils'

  let color_scheme = $state(`default`)
  let x_format = $state(`number`)
  let y_format = $state(`count`)
  let data_source = $state(`financial`)

  const color_schemes = {
    default: [`#3498db`], warm: [`#e74c3c`, `#f39c12`, `#e67e22`],
    cool: [`#3498db`, `#2ecc71`, `#1abc9c`], monochrome: [`#2c3e50`, `#34495e`, `#7f8c8d`],
  }

  const x_formats = { number: `.1f`, scientific: `.2e`, percentage: `.1%`, currency: `$,.0f`, engineering: `.2~s` }
  const y_formats = { count: `d`, percentage: `.1%`, thousands: `,.0f`, scientific: `.1e` }

  let x_axis = $state({})
  let y_axis = $state({})
  $effect(() => {
    x_axis.label = x_format === `currency` ? `Stock Price` : `Value`
    x_axis.format = x_formats[x_format]
    y_axis.label = y_format === `percentage` ? `Percentage` : `Count`
    y_axis.format = y_format === `percentage` ? `.1%` : y_formats[y_format]
  })
  let data = $derived(data_source === `financial` ? utils.generate_financial_data(1200) : utils.generate_scientific_data(1200))
  let series = $derived([{
    y: data,
    label: data_source === `financial` ? `Stock Prices` : `Scientific Measurements`,
    line_style: { stroke: color_schemes[color_scheme][0] },
  }])
</script>

{#each [`financial`, `scientific`] as source}<label><input type="radio" bind:group={data_source} value={source} />{source}</label>{/each}

<select bind:value={color_scheme}>
  {#each Object.keys(color_schemes) as scheme}<option value={scheme}>{scheme}</option>{/each}
</select>

<select bind:value={x_format}>
  {#each Object.entries(x_formats) as [key, format]}<option value={key}>{key} ({format})</option>{/each}
</select>

<select bind:value={y_format}>
  {#each Object.entries(y_formats) as [key, format]}<option value={key}>{key} ({format})</option>{/each}
</select>

<Histogram
  {series}
  {x_axis}
  {y_axis}
  bins={35}
  style="height: 450px; border: 2px solid {color_schemes[color_scheme][0]}; border-radius: 8px;"
>
  {#snippet tooltip({ value, count, property })}
    <div style="background: {color_schemes[color_scheme][0]}; color: white; padding: 8px; border-radius: 6px;">
      <strong>{property}</strong><br>
      {x_format === `currency` ? `Price: $${value.toFixed(0)}` : `Value: ${value.toFixed(2)}`}<br>
      Count: {count}
    </div>
  {/snippet}
</Histogram>
```

## Performance Test

```svelte example
<script>
  import { Histogram } from 'matterviz'
  import * as utils from '$site/plot-utils'

  let dataset_size = $state(10000)
  let data_type = $state(`normal`)
  let bins = $state(50)
  let mode = $state(`single`)

  let performance_data = $derived({
    normal: utils.generate_large_dataset(dataset_size, `normal`),
    uniform: utils.generate_large_dataset(dataset_size, `uniform`),
    sparse: utils.generate_sparse_data(dataset_size),
  })

  let series_data = $derived(
    mode === `single`
      ? [{
        y: performance_data[data_type],
        label: `${data_type} (${dataset_size.toLocaleString()} points)`,
        line_style: { stroke: `#2c3e50` },
      }]
      : Object.entries(performance_data).map(([key, data]) => ({
        y: data,
        label: `${key} (${data.length.toLocaleString()} points)`,
        line_style: {
          stroke: key === `normal`
            ? `#e74c3c`
            : key === `uniform`
            ? `#3498db`
            : `#2ecc71`,
        },
        visible: key === data_type,
      })),
  )
</script>

<label>Size: {dataset_size.toLocaleString()}<input
    type="range"
    bind:value={dataset_size}
    min="1000"
    max="50000"
    step="1000"
  /></label>

{#each [`normal`, `uniform`, `sparse`] as type}<label><input
      type="radio"
      bind:group={data_type}
      value={type}
    />{type}</label>{/each}

<label>Bins: {bins}<input
    type="range"
    bind:value={bins}
    min="10"
    max="200"
    step="10"
  /></label>

{#each [`single`, `overlay`] as display_mode}
  <label><input
      type="radio"
      bind:group={mode}
      value={display_mode}
    />{display_mode}</label>
{/each}

<strong>Performance:</strong> {data_type} distribution, {dataset_size.toLocaleString()}
points, {bins} bins, {mode} mode

<Histogram
  series={series_data}
  {mode}
  {bins}
  show_legend={mode === `overlay`}
  style="height: 450px; margin-block: 1em"
>
  {#snippet tooltip({ value, count, property })}
    <strong>{property}</strong><br>Value: {value.toFixed(2)}<br>Count: {count}
  {/snippet}
</Histogram>
```

## Reference Lines: Statistical Markers and Distribution Comparison

Use `ref_lines` to show statistical reference values like mean, median, standard deviations, or to compare distributions against expected values. Toggle between single distribution (with full statistics) and comparison mode:

```svelte example
<script>
  import { Histogram } from 'matterviz'
  import { generate_normal } from '$site/plot-utils'

  let comparison_mode = $state(false)

  // Single distribution data
  const sample_size = 1000
  const std_dev = 12
  const data = generate_normal(sample_size, 50, std_dev)
  const sorted = [...data].sort((a, b) => a - b)
  const actual_mean = data.reduce((sum, val) => sum + val, 0) / data.length
  const actual_median = sorted[Math.floor(sorted.length / 2)]

  // Comparison data
  const sample_a = generate_normal(800, 45, 10)
  const sample_b = generate_normal(800, 55, 8)
  const mean_a = sample_a.reduce((s, v) => s + v, 0) / sample_a.length
  const mean_b = sample_b.reduce((s, v) => s + v, 0) / sample_b.length

  let series = $derived(
    comparison_mode
      ? [
        { y: sample_a, label: `Control`, line_style: { stroke: `#3498db` } },
        { y: sample_b, label: `Treatment`, line_style: { stroke: `#e74c3c` } },
      ]
      : [{
        y: data,
        label: `Normal Distribution`,
        line_style: { stroke: `#4c6ef5` },
      }],
  )

  let ref_lines = $derived(
    comparison_mode
      ? [
        {
          type: `vertical`,
          x: mean_a,
          label: `Control Mean`,
          style: { color: `#3498db`, width: 2.5 },
          annotation: {
            text: `μ₁ = ${mean_a.toFixed(1)}`,
            position: `end`,
            side: `left`,
          },
        },
        {
          type: `vertical`,
          x: mean_b,
          label: `Treatment Mean`,
          style: { color: `#e74c3c`, width: 2.5 },
          annotation: {
            text: `μ₂ = ${mean_b.toFixed(1)}`,
            position: `end`,
            side: `right`,
          },
        },
        {
          type: `vertical`,
          x: 50,
          label: `Expected`,
          style: { color: `#2ecc71`, width: 2, dash: `8 4` },
          annotation: { text: `Expected = 50`, position: `center`, side: `right` },
          z_index: `below-grid`,
        },
      ]
      : [
        {
          type: `vertical`,
          x: actual_mean,
          label: `Mean`,
          style: { color: `#e74c3c`, width: 2.5 },
          annotation: {
            text: `μ = ${actual_mean.toFixed(1)}`,
            position: `end`,
            side: `right`,
          },
        },
        {
          type: `vertical`,
          x: actual_median,
          label: `Median`,
          style: { color: `#2ecc71`, width: 2, dash: `6 3` },
          annotation: {
            text: `Med = ${actual_median.toFixed(1)}`,
            position: `end`,
            side: `left`,
          },
        },
        {
          type: `vertical`,
          x: actual_mean - std_dev,
          label: `-1σ`,
          style: { color: `#9b59b6`, width: 1.5, dash: `4 2` },
          annotation: { text: `-1σ`, position: `center`, side: `left` },
        },
        {
          type: `vertical`,
          x: actual_mean + std_dev,
          label: `+1σ`,
          style: { color: `#9b59b6`, width: 1.5, dash: `4 2` },
          annotation: { text: `+1σ`, position: `center`, side: `right` },
        },
      ],
  )
</script>

<label style="margin-bottom: 1em; display: block">
  <input type="checkbox" bind:checked={comparison_mode} /> Compare distributions
</label>

<Histogram
  {series}
  {ref_lines}
  mode={comparison_mode ? `overlay` : `single`}
  bins={comparison_mode ? 35 : 40}
  bar={{ opacity: comparison_mode ? 0.5 : 1 }}
  x_axis={{ label: comparison_mode ? `Score` : `Value` }}
  y_axis={{ label: comparison_mode ? `Frequency` : `Count` }}
  style="height: 400px"
/>

<div style="margin-top: 0.5em; font-size: 0.9em; text-align: center">
  {#if comparison_mode}
    Δμ = {(mean_b - mean_a).toFixed(2)} (Treatment − Control)
  {:else}
    <span><strong style="color: #e74c3c">━</strong> Mean: {actual_mean.toFixed(2)}</span>
    <span style="margin-left: 2em"><strong style="color: #2ecc71">╌</strong> Median: {
        actual_median.toFixed(2)
      }</span>
    <span style="margin-left: 2em"><strong style="color: #9b59b6">┄</strong> ±1σ</span>
  {/if}
</div>
```

## Interactive Axis Labels for Property Exploration

This demo stress-tests histograms with interactive property switching:

- **9,000 data points** (3,000 per series) for performance testing
- **8 different distributions** with varied shapes (normal, exponential, bimodal, etc.)
- **Multi-series comparison** showing 3 material classes simultaneously
- **Dynamic bin adjustment** based on selected property
- **Rapid property switching** to test state management

```svelte example
<script>
  import { Histogram } from 'matterviz'

  // Seeded random number generator
  function seeded_random(seed) {
    let state = seed
    return () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff
      return state / 0x7fffffff
    }
  }

  // Box-Muller transform for normal distribution
  function box_muller(rng) {
    const u1 = rng()
    const u2 = rng()
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  }

  // Generate various distributions
  function generate_distribution(type, n, seed) {
    const rng = seeded_random(seed)
    const data = []

    for (let i = 0; i < n; i++) {
      let val
      switch (type) {
        case `normal`:
          val = box_muller(rng) * 1.5 - 2
          break
        case `exponential`:
          val = -Math.log(rng()) * 2
          break
        case `bimodal`:
          val = rng() < 0.4 ? box_muller(rng) * 0.8 - 3 : box_muller(rng) * 1.2 + 2
          break
        case `uniform`:
          val = rng() * 10 - 2
          break
        case `log_normal`:
          val = Math.exp(box_muller(rng) * 0.8)
          break
        case `heavy_tail`:
          val = box_muller(rng) / (rng() + 0.1)
          break
        case `skewed`:
          const u = rng()
          val = Math.pow(u, 3) * 15 - 2
          break
        case `multimodal`:
          const mode = Math.floor(rng() * 4)
          val = box_muller(rng) * 0.5 + mode * 3 - 4
          break
      }
      data.push(val)
    }
    return data
  }

  const n_points = 3000 // Per series

  // Pre-generate all distributions for 3 material classes
  const material_classes = [`Oxides`, `Sulfides`, `Nitrides`]
  const colors = [`#e74c3c`, `#3498db`, `#2ecc71`]

  const property_configs = {
    formation_energy: {
      type: `normal`,
      label: `Formation Energy`,
      unit: `eV/atom`,
      bins: 50,
    },
    band_gap: {
      type: `exponential`,
      label: `Band Gap`,
      unit: `eV`,
      bins: 40,
    },
    volume: {
      type: `bimodal`,
      label: `Volume`,
      unit: `Å³/atom`,
      bins: 45,
    },
    density: {
      type: `log_normal`,
      label: `Density`,
      unit: `g/cm³`,
      bins: 50,
    },
    bulk_modulus: {
      type: `heavy_tail`,
      label: `Bulk Modulus`,
      unit: `GPa`,
      bins: 60,
    },
    thermal_cond: {
      type: `skewed`,
      label: `Thermal Conductivity`,
      unit: `W/m·K`,
      bins: 45,
    },
    melting_point: {
      type: `uniform`,
      label: `Melting Point`,
      unit: `K`,
      bins: 40,
    },
    hardness: {
      type: `multimodal`,
      label: `Hardness`,
      unit: `GPa`,
      bins: 55,
    },
  }

  // Generate data for all combinations
  const all_data = {}
  let seed = 100
  for (const [prop_key, config] of Object.entries(property_configs)) {
    all_data[prop_key] = material_classes.map((_, idx) => {
      seed += 17
      // Shift each class slightly for variety
      return generate_distribution(config.type, n_points, seed + idx * 1000)
        .map((v) => v + idx * 0.5)
    })
  }

  // Build series for a property
  function build_series(prop_key) {
    return material_classes.map((name, idx) => ({
      y: all_data[prop_key][idx],
      label: name,
      line_style: { stroke: colors[idx], stroke_width: 2 },
      bar_style: { fill: colors[idx], opacity: 0.4 },
    }))
  }

  // State
  let current_prop = $state(`formation_energy`)
  let series = $state(build_series(current_prop))
  let bins = $state(property_configs.formation_energy.bins)
  let load_times = $state([])
  let switch_count = $state(0)

  // Data loader
  async function data_loader(axis, property_key) {
    const start = performance.now()
    switch_count++

    // Simulate variable network delay
    await new Promise((r) => setTimeout(r, 100 + Math.random() * 400))

    current_prop = property_key
    bins = property_configs[property_key].bins

    const elapsed = Math.round(performance.now() - start)
    load_times = [...load_times.slice(-9), elapsed]

    const config = property_configs[property_key]
    return {
      series: build_series(property_key),
      axis_label: `${config.label} (${config.unit})`,
    }
  }

  // X-axis options
  const x_options = Object.entries(property_configs).map(([key, config]) => ({
    key,
    label: config.label,
    unit: config.unit,
  }))

  let avg_load = $derived(
    load_times.length > 0
      ? Math.round(load_times.reduce((a, b) => a + b, 0) / load_times.length)
      : 0,
  )

  let total_points = $derived(n_points * material_classes.length)
</script>

<div style="margin-bottom: 0.5em; font-size: 0.85em; opacity: 0.7">
  Points: <strong>{total_points.toLocaleString()}</strong> | Bins: <strong>{bins}</strong>
  | Switches: <strong>{switch_count}</strong> | Avg load: <strong>{avg_load}ms</strong>
</div>

<Histogram
  bind:series
  {bins}
  x_axis={{
    label: `${property_configs[current_prop].label} (${
      property_configs[current_prop].unit
    })`,
    options: x_options,
    selected_key: current_prop,
  }}
  y_axis={{ label: `Count` }}
  {data_loader}
  bar={{ border_radius: 1 }}
  legend={{ layout: `horizontal`, wrapper_style: `justify-content: center` }}
  style="height: 400px"
/>

<p style="margin-top: 0.5em; font-size: 0.8em; opacity: 0.7">
  {total_points.toLocaleString()} samples across 3 material classes. Try rapidly switching
  properties. Current distribution type: <code>{
    property_configs[current_prop].type
  }</code>
</p>
```

## Multiple Plots in 2×2 Grid Layout

Display multiple histograms in a responsive 2×2 grid:

```svelte example
<script>
  import { Histogram } from 'matterviz'
  import * as utils from '$site/plot-utils'

  const plots = [
    {
      title: `Normal Distribution`,
      data: utils.generate_normal(1000, 50, 10),
      color: `#4c6ef5`,
      x_label: `Value`,
      bins: 40,
    },
    {
      title: `Exponential Distribution`,
      data: utils.generate_exponential(1000, 0.05),
      color: `#ff6b6b`,
      x_label: `Time`,
      bins: 35,
    },
    {
      title: `Uniform Distribution`,
      data: utils.generate_uniform(1000, 0, 100),
      color: `#51cf66`,
      x_label: `Random Value`,
      bins: 30,
    },
    {
      title: `Gamma Distribution`,
      data: utils.generate_gamma(1000, 2, 15),
      color: `#ffd43b`,
      x_label: `Measurement`,
      bins: 40,
    },
  ]
</script>

<div class="grid">
  {#each plots as { title, data, color, x_label, bins }}
    <div class="cell">
      <h4>{title}</h4>
      <Histogram
        series={[{ y: data, line_style: { stroke: color } }]}
        {bins}
        x_axis={{ label: x_label }}
        y_axis={{ label: `Count` }}
        show_legend={false}
      />
    </div>
  {/each}
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 1em;
    margin: 2em 0;
  }
  .cell {
    border: 1px solid var(--border-color, #ddd);
    border-radius: 8px;
    padding: 3pt;
  }
  .cell h4 {
    margin: 0;
    text-align: center;
    font-size: 1em;
  }
  @media (min-width: 768px) {
    .grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
```
