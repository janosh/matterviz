# Histogram

## Basic Histogram

```svelte example
<script>
  import { format_num, Histogram } from 'matterviz'
  import { generate_normal } from '$site/plot-utils'

  let bins = $state(50)
  let sample_size = $state(1000)
  let show_controls = $state(true)
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

{#snippet tooltip({ value, count })}
  Value: {value.toFixed(1)}<br>Count: {count}<br>
  %: {format_num(count / sample_size, `.2~%`)}
{/snippet}

<Histogram
  series={[data]}
  {bins}
  {show_controls}
  on_bar_hover={handle_bar_hover}
  on_bar_click={handle_bar_click}
  {tooltip}
  style="height: 400px"
/>

<div style={info_style}>{hover_info}</div>
<div style={info_style}>{click_info}</div>
```

## Multiple Histograms Overlaid

```svelte example
<script>
  import { Histogram } from 'matterviz'
  import { generate_normal, generate_exponential, generate_uniform, generate_gamma } from '$site/plot-utils'

  let x_axis = $state({scale_type: `linear`})
  let y_axis = $state({scale_type: `linear`})
  let display = $state({ x_grid: true, y_grid: true })
  let bar = $state({ opacity: 0.6, stroke_width: 1.5 })

  let series = $state([
    { y: generate_normal(1200, 5, 2), label: `Normal (μ=5, σ=2)`, line_style: { stroke: `crimson` } },
    { y: generate_exponential(1200, 0.3), label: `Exponential (λ=0.3)`, line_style: { stroke: `royalblue` } },
    { y: generate_uniform(1200, 0, 15), label: `Uniform (0-15)`, line_style: { stroke: `mediumseagreen` } },
    { y: generate_gamma(1000, 2, 3), label: `Gamma (α=2, β=3)`, line_style: { stroke: `darkorange` } },
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
  <label style="display: flex; gap: 5pt">Y: {#each [`linear`, `log`] as scale}
    <input type="radio" bind:group={y_axis.scale_type} value={scale} />{scale}
  {/each}</label>

  <label><input type="checkbox" bind:checked={display.x_grid} />Show x grid</label>
  <label><input type="checkbox" bind:checked={display.y_grid} />Show y grid</label>
</div>

{#each series as srs, idx}
  <label>
    <input type="checkbox" checked={srs.visible} onchange={() => toggle_series(idx)} />
    <span style="width: 16px; height: 16px; margin: 0 0.5em; background: {srs.line_style.stroke}"></span>
    {srs.label}
  </label>
{/each}

<Histogram
  {series}
  mode="overlay"
  bins={50}
  bind:bar
  bind:x_axis
  bind:y_axis
  bind:display
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
  import {
    generate_log_normal,
    generate_pareto,
    generate_power_law,
  } from '$site/plot-utils'

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
      y: generate_log_normal(1500, 2, 1),
      label: `Log-Normal (μ=2, σ=1)`,
      line_style: { stroke: `darkorange` },
    },
    {
      y: generate_power_law(1500, 2.5),
      label: `Power Law (α=2.5)`,
      line_style: { stroke: `darkgreen` },
    },
    {
      y: generate_pareto(1200, 1, 3),
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
  bind:x_axis
  bind:y_axis
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
  import {
    generate_age_distribution,
    generate_bimodal,
    generate_discrete,
    generate_mixture,
    generate_skewed,
  } from '$site/plot-utils'
  import { format_num } from 'matterviz'

  let selected = $state(`bimodal`)
  let mode = $state(`single`)

  let distributions = $derived({
    bimodal: {
      data: generate_bimodal(1500),
      label: `Bimodal Distribution`,
      color: `#e74c3c`,
    },
    skewed: {
      data: generate_skewed(1200),
      label: `Right-Skewed Distribution`,
      color: `#3498db`,
    },
    discrete: {
      data: generate_discrete(1000),
      label: `Survey Responses (1-10)`,
      color: `#2ecc71`,
    },
    age: {
      data: generate_age_distribution(2000),
      label: `Age Distribution`,
      color: `#9b59b6`,
    },
    mixture: {
      data: generate_mixture(1800),
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
  bins={selected === `discrete` ? 10 : 40}
  x_axis={{
    label: selected === `age`
      ? `Age (years)`
      : selected === `discrete`
      ? `Rating`
      : `Value`,
    format: selected === `discrete` ? `.1f` : `.0f`,
  }}
  y_axis={{ label: `Count` }}
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
  import { generate_mixed_data, generate_complex_distribution } from '$site/plot-utils'

  let bin_counts = $state([10, 25, 50, 100])
  let show_overlay = $state(true)
  let data_type = $state(`mixed`)
  let opacity = $state(0.6)

  const base_data = $derived(data_type === `mixed` ? generate_mixed_data(3000) : generate_complex_distribution(3000))
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

<label>Opacity: {opacity}<input type="range" bind:value={opacity} min="0.1" max="1" step="0.1" /></label>

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
  bar={{ opacity }}
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
  import { generate_financial_data, generate_scientific_data } from '$site/plot-utils'

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

  let data = $derived(data_source === `financial` ? generate_financial_data(1200) : generate_scientific_data(1200))
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
  bins={35}
  x_axis={{ label: x_format === `currency` ? `Stock Price` : `Value`, format: x_formats[x_format] }}
  y_axis={{ label: y_format === `percentage` ? `Percentage` : `Count`, format: y_format === `percentage` ? `.1%` : y_formats[y_format] }}
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
  import { generate_large_dataset, generate_sparse_data } from '$site/plot-utils'

  let dataset_size = $state(10000)
  let data_type = $state(`normal`)
  let bins = $state(50)
  let mode = $state(`single`)

  let performance_data = $derived({
    normal: generate_large_dataset(dataset_size, `normal`),
    uniform: generate_large_dataset(dataset_size, `uniform`),
    sparse: generate_sparse_data(dataset_size),
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
