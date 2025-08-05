# Scatter Plot

## Basic Plot with Multiple Display Modes

A simple scatter plot showing different display modes (points, lines, or both). Notice the gear icon in the top-right corner. Click it to access styling controls including point size, colors, line width, opacity, and more:

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'

  // Basic single series data
  const basic_data = {
    x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    y: [5, 7, 2, 8, 4, 9, 3, 6, 8, 5],
    point_style: { fill: 'steelblue', radius: 5 },
    label: 'Basic Data',
    metadata: Array(10).fill(0).map((_, idx) => ({
      id: `P${idx + 1}`,
      series_label: 'Basic Data',
    })),
  }

  // Multiple series data
  const second_series = {
    x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    y: [2, 4, 6, 3, 7, 5, 8, 4, 6, 9],
    point_style: { fill: 'orangered', radius: 4 },
    label: 'Second Series',
    metadata: Array(10).fill(0).map((_, idx) => ({
      id: `S${idx + 1}`,
      series_label: 'Second Series',
    })),
  }

  // Currently selected display mode
  let display_mode = $state('line+points')
  let clicked_point_info = $state('No point clicked yet.')
  let double_clicked_point_info = $state('No point double-clicked yet.')

  // It's good practice to type event handlers if you know the structure
  function handle_point_click({ point }) {
    const { x, y, metadata, series_idx, point_idx } = point
    clicked_point_info = `Clicked: Point (${x}, ${y}), Series: '${
      metadata?.series_label ??
        (series_idx === 0 ? basic_data.label : second_series.label)
    }', Point Index: ${point_idx}`
    if (metadata) {
      clicked_point_info += `, Metadata ID: ${metadata.id}`
    }
  }

  function handle_point_double_click({ point }) {
    const { x, y, metadata, series_idx, point_idx } = point
    double_clicked_point_info = `Double-clicked: Point (${x}, ${y}), Series: '${
      metadata?.series_label ??
        (series_idx === 0 ? basic_data.label : second_series.label)
    }', Point Index: ${point_idx}`
    if (metadata) {
      double_clicked_point_info += `, Metadata ID: ${metadata.id}`
    }
  }

  const style =
    'margin: 1em 0; padding: 2pt 5pt; background-color: rgba(255, 255, 255, 0.1); border-radius: 4px'
</script>

<label style="margin-bottom: 1em; display: block">
  Display Mode:
  <select bind:value={display_mode}>
    {#each [
        ['points', 'Points only'],
        ['line', 'Lines only'],
        ['line+points', 'Lines and Points'],
      ] as
      [value, label]
      (value)
    }
      <option {value}>{label}</option>
    {/each}
  </select>
</label>

<ScatterPlot
  series={[basic_data, second_series]}
  x_label="X Axis"
  y_label="Y Value"
  markers={display_mode}
  point_events={{ onclick: handle_point_click, ondblclick: handle_point_double_click }}
  show_controls
  style="height: 300px"
/>
<div {style}>
  {clicked_point_info}
</div>
<div {style}>
  {double_clicked_point_info}
</div>
```

## Custom Point Styling and Tooltips

Demonstrate various point styles, custom tooltips, and hover effects:

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'

  // Generate data for demonstration
  const point_count = 10
  const x_values = Array(point_count).fill(0).map((_, idx) => idx + 1)

  // Create series with different point styles
  const series_with_styles = [
    // Extra large red points with thick border
    {
      x: x_values,
      y: Array(point_count).fill(10),
      point_style: {
        fill: 'crimson',
        radius: 12,
        stroke: 'darkred',
        stroke_width: 3,
      },
      point_hover: { scale: 1.3, stroke: 'gold', stroke_width: 4 },
      point_label: { text: 'Giant red', offset: { y: -20 }, font_size: '12px' },
    },
    // Medium green semi-transparent points with dramatic hover effect
    {
      x: x_values,
      y: Array(point_count).fill(8),
      point_style: {
        fill: 'mediumseagreen',
        radius: 8,
        fill_opacity: 0.6,
        stroke: 'green',
        stroke_width: 1,
      },
      point_hover: {
        scale: 2.5, // Much larger on hover
        stroke: 'lime',
        stroke_width: 2,
      },
      point_label: { text: 'Growing green', offset: { y: -20 }, font_size: '12px' },
    },
    // Outline-only points (hollow) with color change on hover
    {
      x: x_values,
      y: Array(point_count).fill(6),
      point_style: {
        fill: 'purple',
        fill_opacity: 0.4,
        radius: 6,
        stroke: 'indigo',
        stroke_width: 2,
      },
      point_hover: {
        scale: 1.8,
        stroke: 'magenta', // Different color on hover
        stroke_width: 3,
      },
      point_label: {
        text: 'Color-changing hollow',
        offset: { y: -20 },
        font_size: '12px',
      },
    },
    // Tiny points with extreme hover growth
    {
      x: x_values,
      y: Array(point_count).fill(4),
      point_style: {
        fill: 'orange',
        radius: 3,
      },
      point_hover: {
        scale: 4, // Extreme growth on hover
        stroke: 'red',
        stroke_width: 2,
      },
      point_label: { text: 'Exploding dots', offset: { y: -20 }, font_size: '12px' },
    },
    // Micro dots with custom glow effect
    {
      x: x_values,
      y: Array(point_count).fill(2),
      point_style: {
        fill: 'dodgerblue',
        radius: 1.5, // Extremely small
        stroke: 'transparent',
        stroke_width: 0,
      },
      point_hover: {
        scale: 6, // Dramatic growth
        stroke: 'cyan',
        stroke_width: 8, // Creates a glow effect
      },
      point_label: {
        text: 'Glowing microdots',
        offset: { y: -20 },
        font_size: '12px',
      },
      label: 'Glowing microdots',
    },
  ]

  // Only show labels for the first point in each series
  series_with_styles.forEach((series, series_idx) => {
    if (!series.label) {
      series.label = series.point_label?.text || `Style ${series_idx + 1}`
    }
    // Create a metadata array with empty objects except for the first one
    series.metadata = Array(point_count).fill({}).map((_, idx) => ({
      series_name: series.point_label.text,
    }))

    // Only show label on the first point of each series
    if (series.point_label) {
      // ScatterPoint doesn't accept functions for the text property,
      // so we'll clear the text for all points and manually handle
      // the first point label with metadata
      series.point_label.text = ''
    }
  })

  // Hovered point tracking for demo
  let hovered_point = null
</script>

<ScatterPlot
  series={series_with_styles}
  x_label="X Axis"
  y_label="Point Style Examples"
  y_lim={[0, 12]}
  markers="points"
  change={(point) => (hovered_point = point)}
  style="height: 400px"
>
  {#snippet tooltip({ x, y, metadata })}
    <strong>{metadata.series_name}</strong>
    Point at ({x}, {y})
  {/snippet}
</ScatterPlot>

Hovered point:
{#if hovered_point}
  {@const { x, y, metadata } = hovered_point}
  ({x}, {y}) in '{metadata.series_name}'
{:else}
  None
{/if}
```

## Per-Point Custom Styling with Marker Symbols and Sizing

This example demonstrates how to apply different styles _and sizes_ to individual points within a single series, including different marker symbols. The size of each point is determined by its distance from the center of the spiral, controlled by the `size_values` prop.

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'
  import { symbol_names } from 'matterviz/plot'

  let show_labels = $state(true)
  let label_size = $state(14)
  let size_scale = $state({ radius_range: [2, 15], type: 'linear' }) // [min_radius, max_radius]

  const point_count = 40

  let spiral_data = $state({
    x: [],
    y: [],
    size_values: [],
    point_style: [],
    point_label: [],
    metadata: [],
  })

  // Generate initial points (run once)
  for (let idx = 0; idx < point_count; idx++) {
    // Calculate angle and radius for spiral
    const angle = idx * 0.5
    const radius = 1 + idx * 0.3

    // Convert to cartesian coordinates
    const x = Math.cos(angle) * radius
    const y = Math.sin(angle) * radius

    spiral_data.x.push(x)
    spiral_data.y.push(y)
    spiral_data.size_values.push(radius) // Use spiral radius for sizing

    // Store angle in metadata
    spiral_data.metadata.push({ angle, radius })
    // Change color gradually along the spiral
    const hue = (idx / point_count) * 360
    // Change marker type based on index
    const symbol_type = symbol_names[idx % symbol_names.length]

    // Create the point style (initial radius will be updated by effect)
    spiral_data.point_style.push({
      fill: `hsl(${hue}, 80%, 50%)`,
      stroke: 'white',
      stroke_width: 1 + idx / 20, // Gradually thicker stroke
      symbol_type,
      radius: 5, // Set fixed initial radius
    })
    spiral_data.point_label.push({ text: `P${idx}`, offset: { x: 10 } })
  }

  // Store the initially generated labels separately
  const initial_point_labels = spiral_data.point_label

  // Effect to update point styles and labels based on controls
  $effect(() => {
    for (const pt_label of spiral_data.point_label) {
      pt_label.font_size = `${label_size}px`
    }
  })

  $effect(() => {
    if (show_labels) spiral_data.point_label = initial_point_labels
    else spiral_data.point_label = [] // Assign empty array to hide all labels
  })
</script>

<div style="display: flex; flex-wrap: wrap; gap: 1em 2em; margin: 1em">
  <label>
    Label Size: {label_size}
    <input type="range" bind:value={label_size} min="8" max="20">
  </label>
  <label>
    <input type="checkbox" bind:checked={show_labels}>
    Show Labels
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
    >
  </label>
  <label>
    Size Scale:
    <select bind:value={size_scale.type}>
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
  style="height: 500px"
>
  {#snippet tooltip({ x, y, metadata })}
    <strong>Spiral Point</strong><br>
    Position: ({x.toFixed(2)}, {y.toFixed(2)})<br>
    Angle: {metadata.angle.toFixed(2)} rad<br>
    Value (Radius): {metadata.radius.toFixed(2)}
  {/snippet}
</ScatterPlot>
```

## Categorized Data and Custom Axis Tick Intervals

This example shows categorized data with color coding, custom tick intervals, and demonstrates handling negative values:

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'

  // Define categories
  const categories = ['Category A', 'Category B', 'Category C', 'Category D']

  // Define colors for each category
  const category_colors = [
    'crimson',
    'royalblue',
    'goldenrod',
    'mediumseagreen'
  ]

  // Generate sample data points with categories
  const sample_count = 40
  const sample_data = Array(sample_count).fill(0).map(() => {
    const category_idx = Math.floor(Math.random() * categories.length)
    // Generate points across positive and negative coordinate space
    return {
      x: (Math.random() * 20) - 10, // Range from -10 to 10
      y: (Math.random() * 20) - 10, // Range from -10 to 10
      category: categories[category_idx],
      color: category_colors[category_idx]
    }
  })

  // Group data by category to create series
  const series_data = categories.map((category, idx) => {
    const points = sample_data.filter(d => d.category === category)

    return {
      x: points.map(p => p.x),
      y: points.map(p => p.y),
      point_style: {
        fill: category_colors[idx],
        radius: 6 - idx, // Size varies by category
        stroke: 'black',
        stroke_width: 0.5
      },
      metadata: points.map(p => ({ category: p.category, color: p.color })),
      label: category
    }
  })

  const ticks = $state({ x: -5, y: -5 }) // Tick interval settings
</script>

{#each Object.keys(ticks) as axis (axis)}
  <label style="display: inline-block; margin: 1em;">
    {axis} Tick Interval:
    <select bind:value={ticks[axis]}>
    {#each [2, 5, 10] as num (num)}
      <option value={-num}>{num} units</option>
    {/each}
    </select>
  </label>
{/each}

<ScatterPlot
  series={series_data}
  x_label="X Value"
  y_label="Y Value"
  x_lim={[-15, 15]}
  y_lim={[-15, 15]}
  x_ticks={ticks.x}
  y_ticks={ticks.y}
  markers="points"
  style="height: 400px;"
>
  {#snippet tooltip({ x, y, metadata })}
    <strong>{metadata.category}</strong><br>
    Position: ({x.toFixed(2)}, {y.toFixed(2)})
  {/snippet}
</ScatterPlot>

<!-- Legend -->
<div style="display: flex; justify-content: center; margin: 1em; gap: 3ex;">
  {#each categories as category, idx}
    <div style="display: flex; align-items: center;">
      <span style="width: 12px; height: 12px; background: {category_colors[idx]}; border-radius: 50%;"></span>
      &ensp;{category}
    </div>
  {/each}
</div>
```

## Time-Based Data with Custom Formatting

Using time data on the x-axis with custom formatting:

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'

  // Generate dates for the past 30 days
  const dates = Array(30).fill(0).map((_, idx) => {
    const date = new Date()
    date.setDate(date.getDate() - (30 - idx))
    return date.getTime()
  })

  // Random data values for multiple series
  const values1 = Array(30).fill(0).map(() => Math.random() * 100)
  const values2 = Array(30).fill(0).map(() => Math.random() * 70 + 30)

  const time_series = [
    {
      x: dates,
      y: values1,
      point_style: { fill: 'steelblue', radius: 4 },
      label: 'Series A',
      metadata: Array(30).fill(0).map((_, idx) => ({ series: 'Series A', day: idx })),
    },
    {
      x: dates,
      y: values2,
      point_style: { fill: 'orangered', radius: 4 },
      label: 'Series B',
      metadata: Array(30).fill(0).map((_, idx) => ({ series: 'Series B', day: idx })),
    },
  ]

  // Format options
  let date_format = '%b %d'
  let y_format = '.1f'
</script>

<div>
  <label>
    Date Format:
    <select bind:value={date_format}>
      {#each [['%b %d', 'Month Day (Jan 01)'], ['%Y-%m-%d', 'YYYY-MM-DD'], [
          '%d/%m',
          'DD/MM',
        ]] as
        [value, label]
        (value)
      }
        <option {value}>{label}</option>
      {/each}
    </select>
  </label>
  <label style="margin-left: 1em">
    Y-Value Format:
    <select bind:value={y_format}>
      {#each [['.1f', '1 decimal'], ['.2f', '2 decimals'], ['d', 'Integer']] as
        [value, label]
        (value)
      }
        <option {value}>{label}</option>
      {/each}
    </select>
  </label>

  <ScatterPlot
    series={time_series}
    markers="line+points"
    x_format={date_format}
    {y_format}
    x_ticks={-7}
    y_ticks={5}
    x_label="Date"
    y_label="Value"
    style="height: 350px"
    legend={{
      layout: `horizontal`,
      n_items: 3,
      wrapper_style: `max-width: none; justify-content: center;`,
    }}
  >
    {#snippet tooltip({ x, y, x_formatted, y_formatted, metadata })}
      <strong>{metadata?.series}</strong><br />
      Date: {x_formatted}<br />
      Value: {y_formatted}
    {/snippet}
  </ScatterPlot>
</div>
```

## Points with Shared Coordinates

This example demonstrates how points with identical coordinates can still be individually identified and interacted with:

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'

  // Create points with shared X or Y coordinates
  const shared_coords_data = {
    x: [5, 5, 5, 5, 5, 1, 2, 3, 4, 5, 7, 8, 9, 7, 9],
    y: [1, 2, 3, 4, 5, 3, 3, 3, 3, 3, 1, 2, 3, 4, 5],
    point_style: { fill: 'steelblue', radius: 6 },
    // Add distinct metadata for each point to identify them
    metadata: [
      // Vertical line points
      { id: 'v1', label: 'V1 (5,1)' },
      { id: 'v2', label: 'V2 (5,2)' },
      { id: 'v3', label: 'V3 (5,3)' },
      { id: 'v4', label: 'V4 (5,4)' },
      { id: 'v5', label: 'V5 (5,5)' },
      // Horizontal line points
      { id: 'h1', label: 'H1 (1,3)' },
      { id: 'h2', label: 'H2 (2,3)' },
      { id: 'h3', label: 'H3 (3,3)' },
      { id: 'h4', label: 'H4 (4,3)' },
      { id: 'h5', label: 'H5 (5,3)' },
      // Random points
      { id: 'r1', label: 'R1 (7,1)' },
      { id: 'r2', label: 'R2 (8,2)' },
      { id: 'r3', label: 'R3 (9,3)' },
      { id: 'r4', label: 'R4 (7,4)' },
      { id: 'r5', label: 'R5 (9,5)' },
    ],
  }

  let hovered_point = null
</script>

<ScatterPlot
  series={[shared_coords_data]}
  x_lim={[0, 10]}
  y_lim={[0, 6]}
  x_ticks={1}
  y_ticks={1}
  x_label="X Axis"
  y_label="Y Axis"
  change={(point) => (hovered_point = point)}
  style="height: 350px"
>
  {#snippet tooltip({ x, y, metadata })}
    {@const { label, id } = metadata}
    <strong>{label}</strong><br />
    Coordinates: ({x}, {y})<br />
    ID: {id}
  {/snippet}
</ScatterPlot>

<strong>Currently hovered:</strong>
{#if hovered_point}
  {@const { x, y, metadata } = hovered_point}
  {metadata?.label || 'Unknown point'} at ({x}, {y})
{:else}
  nothing
{/if}
```

## Text Annotations for Scatter Points

This example shows how to add permanent text labels to your scatter points:

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'

  // Data with text labels
  const data = {
    x: [1, 3, 5, 7, 9],
    y: [2, 5, 3, 7, 4],
    point_style: { fill: 'steelblue', radius: 6 },
    // Add text labels to each point
    point_label: [
      { text: 'Point A', offset: { y: -15 } },
      { text: 'Point B', offset: { y: 15 } },
      { text: 'Point C', offset: { y: -15 } },
      { text: 'Point D', offset: { y: -15 } },
      { text: 'Point E', offset: { y: 15 } },
    ],
  }
</script>

<ScatterPlot
  series={[data]}
  x_label="X Axis"
  y_label="Y Axis"
  x_lim={[0, 10]}
  y_lim={[0, 10]}
  markers="points"
  style="height: 350px"
/>
```

### Different Label Positions

You can position labels in different directions relative to each point:

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'

  const position_data = {
    x: [5, 5, 5, 5, 5],
    y: [1, 2, 3, 4, 5],
    point_style: { fill: 'goldenrod', radius: 5 },
    // Different positions for labels
    point_label: [
      { text: 'Above', offset: { y: -15, x: 0 } },
      { text: 'Right', offset: { x: 15, y: 0 } },
      { text: 'Below', offset: { y: 15, x: 0 } },
      { text: 'Left', offset: { x: -30, y: 0 } },
      { text: 'Diagonal', offset: { x: 10, y: -10 } },
    ],
  }
</script>

<ScatterPlot
  series={[position_data]}
  x_label="X Axis"
  y_label="Y Axis"
  x_lim={[0, 10]}
  y_lim={[0, 6]}
  markers="points"
  style="height: 350px"
/>
```

## Interactive Log-Scaled Axes

ScatterPlot supports logarithmic scaling for data that spans multiple orders of magnitude. This example combines multiple datasets and allows you to dynamically switch between linear and logarithmic scales for both the X and Y axes using the checkboxes below. Observe how the appearance of the data changes, particularly for power-law relationships which appear as straight lines on log-log plots.

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'
  import { symbol_names } from 'matterviz/plot'
  import * as math from 'matterviz/math'

  const point_count = 50

  // Series 1: Exponential Decay
  const decay_data = {
    x: [],
    y: [],
    size_values: [],
    point_style: { fill: 'coral' },
    label: 'Exponential Decay',
    metadata: [],
  }
  for (let idx = 0; idx < point_count; idx++) {
    const x_val = 0.1 + (idx / (point_count - 1)) * 10 // x from 0.1 to 10.1
    const y_val = 10000 * Math.exp(-0.5 * x_val)
    decay_data.x.push(x_val)
    // Ensure y is not exactly 0 for log scale, clamp to a small positive value
    const safe_y_val = Math.max(y_val, math.LOG_MIN_EPS)
    decay_data.y.push(safe_y_val)
    decay_data.size_values.push(safe_y_val)
    decay_data.metadata.push({ series: 'Exponential Decay' })
  }

  // Series 2: Logarithmic Sine Wave
  const log_sine_data = {
    x: [],
    y: [],
    size_values: [],
    point_style: { fill: 'deepskyblue' },
    label: 'Log Sine Wave',
    metadata: [],
  }
  for (let idx = 0; idx < point_count * 2; idx++) { // More points for smoother curve
    const x_val = Math.pow(10, -1 + (idx / (point_count * 2 - 1)) * 4) // x from 0.1 to 1000 log-spaced
    const y_val = 500 + 400 * Math.sin(Math.log10(x_val) * 5)
    log_sine_data.x.push(x_val)
    const safe_y_val = Math.max(y_val, math.LOG_MIN_EPS) // Clamp potential near-zero y
    log_sine_data.y.push(safe_y_val)
    log_sine_data.size_values.push(safe_y_val)
    log_sine_data.metadata.push({ series: 'Log Sine Wave' })
  }

  // Series 4: Power Law (y = x^2)
  const power_law_data = {
    x: [],
    y: [],
    size_values: [],
    point_style: { fill: 'mediumseagreen' },
    label: 'y = x^2',
    metadata: [],
  }
  for (let idx = -1; idx <= 3; idx += 0.25) {
    const x_val = Math.pow(10, idx)
    const y_val = Math.pow(x_val, 2) // y = x^2
    power_law_data.x.push(x_val)
    const safe_y_val = Math.max(y_val, math.LOG_MIN_EPS) // Clamp y
    power_law_data.y.push(safe_y_val)
    power_law_data.size_values.push(safe_y_val)
    power_law_data.metadata.push({ series: 'y = x^2' })
  }

  // Series 5: Inverse Power Law (y = x^0.5)
  const inverse_power_data = {
    x: [],
    y: [],
    size_values: [],
    point_style: { fill: 'purple' },
    label: 'y = x^0.5',
    metadata: [],
  }
  for (let idx = -1; idx <= 3; idx += 0.25) {
    const x_val = Math.pow(10, idx)
    const y_val = Math.pow(x_val, 0.5) // y = √x
    inverse_power_data.x.push(x_val)
    const safe_y_val = Math.max(y_val, math.LOG_MIN_EPS) // Clamp y
    inverse_power_data.y.push(safe_y_val)
    inverse_power_data.size_values.push(safe_y_val)
    inverse_power_data.metadata.push({ series: 'y = x^0.5' })
  }

  // Combine all series
  const all_series = [decay_data, log_sine_data, power_law_data, inverse_power_data]

  // State for controlling scale types
  let x_is_log = $state(false)
  let y_is_log = $state(false)
  // State for size controls
  let size_scale = $state({
    radius_range: [2, 8],
    type: 'linear',
    value_range: [1, 1000],
  })

  // Derived scale types based on state
  let x_scale_type = $derived(x_is_log ? `log` : `linear`)
  let y_scale_type = $derived(y_is_log ? `log` : `linear`)

  // Reactive limits based on scale type to avoid log(0) issues and accommodate data
  let x_lim = $derived(x_is_log ? [0.1, 1000] : [null, 1000])
  let y_lim = $derived(y_is_log ? [0.1, 10000] : [null, 10000])
</script>

<div>
  <div style="display: flex; justify-content: center; gap: 2em; margin-bottom: 1em">
    <label>
      <input type="checkbox" bind:checked={x_is_log} />
      Log X-Axis
    </label>
    <label>
      <input type="checkbox" bind:checked={y_is_log} />
      Log Y-Axis
    </label>
  </div>

  <div style="display: flex; justify-content: center; gap: 2em; margin-bottom: 1em">
    <label>
      Min Size (px):
      <input
        type="number"
        bind:value={size_scale.radius_range[0]}
        min="0.5"
        max="10"
        step="0.5"
        style="width: 50px"
      >
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
      >
    </label>
    <label>
      Size Scale:
      <select bind:value={size_scale.type}>
        <option value="linear">Linear</option>
        <option value="log">Log</option>
      </select>
    </label>
  </div>

  <!-- Use #key to ensure plot redraws correctly when scale types change -->
  {#key [x_scale_type, y_scale_type]}
    <ScatterPlot
      series={all_series}
      {x_scale_type}
      {y_scale_type}
      {x_lim}
      {y_lim}
      x_label="X Axis ({x_scale_type})"
      y_label="Y Axis ({y_scale_type})"
      {size_scale}
      x_format="~s"
      y_format="~s"
      markers="line+points"
      style="height: 400px"
    >
      {#snippet tooltip({ x, y, x_formatted, y_formatted, metadata })}
        <strong>{metadata.label ?? metadata.series}</strong><br />
        X: {x_formatted || x.toPrecision(3)}<br />
        Y: {y_formatted || y.toPrecision(3)}
      {/snippet}
    </ScatterPlot>
  {/key}
</div>
```

## Combined Interactive Scatter Plot with Custom Controls

This example combines multiple features including different display modes, custom styling, various marker types, interactive controls for axis customization, and hover styling. It demonstrates the new grid customization options with independent X and Y grid controls and custom grid styling. Click the gear icon in the top-right corner to open a control panel with point size, line width, colors, and styling options:

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'
  import { symbol_names } from 'matterviz/plot'

  // Define categories and colors for data points
  const categories = ['Group A', 'Group B', 'Group C']
  const category_colors = ['crimson', 'royalblue', 'mediumseagreen']

  // Create three data series with different styling
  const series_data = categories.map((category, cat_idx) => {
    const points = 10
    const symbol = symbol_names[cat_idx % symbol_names.length];
    return {
      x: Array(points).fill(0).map((_, idx) => idx + 1),
      y: Array(points).fill(0).map(() => 3 + cat_idx * 3 + Math.random() * 2),
      point_style: {
        fill: category_colors[cat_idx],
        radius: 6 - cat_idx,
        stroke: 'black',
        stroke_width: 0.5,
        symbol_type: symbol,
        symbol_size: 40 + cat_idx * 5
      },
      metadata: Array(points).fill(0).map((_, idx) => ({
        category, color: category_colors[cat_idx], symbol, idx
      })),
      label: category
    }
  })

  let display_mode = $state('line+points')

  // Toggle series visibility
  let visible_series = $state({
    [categories[0]]: true,
    [categories[1]]: true,
    [categories[2]]: true
  })

  // Controls for random data points
  let ticks = $state({ x: -5, y: -5 })

  // Grid controls
  let grid = $state({ x: true, y: true })
  let grid_color = $state('gray')
  let grid_width = $state(0.4)
  let grid_dash = $state('4')

  // Custom axis labels
  let axis_labels = $state({ x: "X Axis", y: "Y Value" })

  // Hovered point tracking
  let hovered_point = $state(null)

  // Update series based on visibility toggles
  let displayed_series = $derived(series_data.filter((_, idx) => visible_series[categories[idx]]))

  // Generate random data points across positive and negative space for multiple series
  const series_count = 3
  const random_series = $derived.by(() => {
    const output = []
    for (let s_idx = 0; s_idx < series_count; s_idx++) {
      const sample_count = 20 + Math.floor(Math.random() * 20) // Varying number of points
      output.push({
        x: Array(sample_count).fill(0).map(() => (Math.random() * 20) - 10),
        y: Array(sample_count).fill(0).map(() => (Math.random() * 20) - 10),
        point_style: {
          fill: category_colors[s_idx % category_colors.length], // Use category colors
          radius: 4 + s_idx, // Slightly different sizes
          stroke: 'black',
          stroke_width: 0.5,
          symbol_type: symbol_names[(s_idx + 3) % symbol_names.length]
        },
        point_hover: {
          scale: 1.5 + s_idx * 0.5, // Different hover scales
          fill: 'orange',
          stroke: 'white',
          stroke_width: 2
        },
        label: `Random Series ${s_idx + 1}`, // Add labels for legend
        metadata: Array(sample_count).fill(0).map((_, p_idx) => ({ series: `Series ${s_idx + 1}`, point: p_idx }))
      })
    }
    return output
  })
</script>

<div>
  <h3>Interactive Multi-Series Plot</h3>
  <label>
    Display Mode:
    <select bind:value={display_mode}>
      <option value="points">Points only</option>
      <option value="line">Lines only</option>
      <option value="line+points">Lines and Points</option>
    </select>
  </label>

  <!-- Legend with toggles -->
  <div style="display: flex; margin-left: 2em;">
    {#each categories as category, idx}
      <label style="margin-right: 1em; display: flex; align-items: center;">
        <input type="checkbox" bind:checked={visible_series[category]} />
        <span style="display: inline-block; width: 12px; height: 12px; background: {category_colors[idx]}; border-radius: 50%; margin: 0 0.5em;"></span>
        {category}
      </label>
    {/each}
  </div>

  <ScatterPlot
    series={displayed_series}
    x_label={axis_labels.x}
    y_label={axis_labels.y}
    markers={display_mode}
    change={(point) => (hovered_point = point)}
    show_controls
    style="height: 400px;"
    legend={null}
  >
    {#snippet tooltip({ x, y, metadata })}
      <strong>{metadata.category}</strong><br>
      Point {metadata.idx + 1} ({x}, {y.toFixed(2)})<br>
      Symbol: {metadata.symbol}
    {/snippet}
  </ScatterPlot>

  {#if hovered_point}
    {@const { x, y, metadata } = hovered_point}
    Hovered point: ({x}, {y.toFixed(2)}) from '{metadata.category}'
  {:else}
    No point hovered
  {/if}

  <h3 style="margin-top: 2em;">Random Points with Custom Controls and External Legend</h3>
  <div style="margin-bottom: 1em; display: flex; flex-wrap: wrap; gap: 1em;">
    {#each Object.keys(ticks) as axis (axis)}
      <label>
        {axis} Tick Interval:
        <select bind:value={ticks[axis]}>
          {#each [2, 5, 10] as num (num)}
            <option value={-num}>{num} units</option>
          {/each}
        </select>
      </label>
    {/each}

    {#each Object.keys(grid) as axis (axis)}
      <label>
        <input type="checkbox" bind:checked={grid[axis]} />
        {axis} Grid
      </label>
    {/each}

    <label>
      Grid Color:
      <select bind:value={grid_color}>
        <option value="gray">Gray</option>
        <option value="lightgray">Light Gray</option>
        <option value="darkgray">Dark Gray</option>
        <option value="#aaaaaa">#aaa</option>
      </select>
    </label>

    {#each Object.keys(axis_labels) as axis (axis)}
      <label>
        {axis} Label:
        <input type="text" bind:value={axis_labels[axis]} style="width: 120px" />
      </label>
    {/each}
  </div>

  <ScatterPlot
    series={random_series}
    x_label={axis_labels.x}
    y_label={axis_labels.y}
    x_lim={[-15, 15]}
    y_lim={[-15, 15]}
    x_ticks={ticks.x}
    y_ticks={ticks.y}
    x_grid={grid.x}
    markers="points"
    style="height: 400px; position: relative;"
    legend={{
      wrapper_style: `
        position: absolute;
        top: 3pt;
        left: 100%;
        background: rgba(255, 255, 255, 0.1);
        padding: 5px 5px 5px 0;
        border-radius: 3px;
        border: none;
      `
    }}
  >
    {#snippet tooltip({ x, y, metadata })}
      <strong>{metadata.series}</strong><br/>
      Position: ({x.toFixed(2)}, {y.toFixed(2)})<br/>
      Point Index: {metadata.point}
    {/snippet}
  </ScatterPlot>
</div>
```

## Automatic Color Bar Placement

This example demonstrates how the color bar automatically positions itself in one of the four corners (top-left, top-right, bottom-left, bottom-right) based on where the data points are least dense. Use the sliders to adjust the number of points generated in each quadrant and observe how the color bar moves to avoid overlapping the data.

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'

  // State for controlling point density in each quadrant
  let density = $state({
    top_left: 10,
    top_right: 50,
    bottom_left: 10,
    bottom_right: 10,
  })

  // Function to generate points within a specific quadrant
  const make_quadrant_points = (count, x_range, y_range) => {
    const points = []
    for (let idx = 0; idx < count; idx++) {
      const x_val = x_range[0] + Math.random() * (x_range[1] - x_range[0])
      const y_val = y_range[0] + Math.random() * (y_range[1] - y_range[0])
      // Assign a color value (e.g., based on distance from origin)
      const color_val = Math.sqrt(
        Math.pow(x_range[0] + (x_range[1] - x_range[0]) / 2, 2) +
          Math.pow(y_range[0] + (y_range[1] - y_range[0]) / 2, 2),
      ) * Math.random() * 2 // Add some variation

      points.push({
        x: x_val,
        y: y_val,
        color_value: color_val,
        label: color_val.toFixed(1),
      })
    }
    return points
  }

  // Reactive generation of plot data based on densities
  let plot_series = $derived.by(() => {
    const plot_width = 100
    const plot_height = 100
    const center_x = plot_width / 2
    const center_y = plot_height / 2

    const tl_points = make_quadrant_points(density.bottom_left, [0, center_x], [
      0,
      center_y,
    ])
    const tr_points = make_quadrant_points(density.bottom_right, [
      center_x,
      plot_width,
    ], [0, center_y])
    const bl_points = make_quadrant_points(density.top_left, [0, center_x], [
      center_y,
      plot_height,
    ])
    const br_points = make_quadrant_points(
      density.top_right,
      [center_x, plot_width],
      [center_y, plot_height],
    )

    const all_points = [...tl_points, ...tr_points, ...bl_points, ...br_points]

    return [{
      x: all_points.map((p) => p.x),
      y: all_points.map((p) => p.y),
      color_values: all_points.map((p) => p.color_value),
      point_label: all_points.map((p) => ({
        text: p.label,
        offset: { x: 0, y: -10 },
        font_size: '14px',
      })),
      point_style: {
        radius: 5,
        stroke: 'white',
        stroke_width: 0.5,
      },
    }]
  })
</script>

<div
  style="display: grid; grid-template-columns: repeat(2, max-content); gap: 1em 2em; place-content: center; margin: 1em"
>
  {#each [
      ['top_left', 'Top Left'],
      ['top_right', 'Top Right'],
      ['bottom_left', 'Bottom Left'],
      ['bottom_right', 'Bottom Right'],
    ] as
    [quadrant, label]
  }
    <label>{label}: {density[quadrant]}
      <input
        type="range"
        min="0"
        max="100"
        value={density[quadrant]}
        onchange={(evt) => (density[quadrant] = Number(evt.target.value))}
        style="width: 100px; margin-left: 0.5em"
      />
    </label>
  {/each}
</div>

<ScatterPlot
  series={plot_series}
  x_label="X Position"
  y_label="Y Position"
  x_lim={[0, 100]}
  y_lim={[0, 100]}
  x_format=".2"
  y_format=".2"
  markers="points+text"
  color_scale={{ scheme: `turbo` }}
  color_bar={{ title: `Color Bar Title`, margin: { t: 20, r: 60, b: 90, l: 80 } }}
  style="height: 450px; margin-block: 1em"
>
  {#snippet tooltip({ x_formatted, y_formatted, metadata, color_value })}
    Point ({x_formatted}, {y_formatted})<br />
    Color value: {color_value?.toFixed(2)}
  {/snippet}
</ScatterPlot>
```

## Automatic Label Placement (Repel Mode)

When points are clustered closely together, manually positioning labels can become tedious and result in overlaps. The `ScatterPlot` component offers an automatic label placement feature using a force simulation (`d3-force`). This feature intelligently positions labels to minimize overlaps while keeping them close to their corresponding data points.

To enable this feature, set `auto_placement: true` within the `point_label` object for the desired points.

This example demonstrates automatic placement with several clusters of points:

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'

  // Function to generate a cluster of points
  const generate_cluster = (center_x, center_y, count, radius, label_prefix) => {
    const points = {
      x: [],
      y: [],
      point_style: [],
      point_label: [],
    }
    for (let idx = 0; idx < count; idx++) {
      const angle = Math.random() * 2 * Math.PI
      const dist = Math.random() * radius
      points.x.push(center_x + Math.cos(angle) * dist)
      points.y.push(center_y + Math.sin(angle) * dist)
      points.point_style.push({ fill: 'rebeccapurple', radius: 9 })
      points.point_label.push({
        text: `${label_prefix}-${idx + 1}`,
        auto_placement: true, // Enable auto-placement
        font_size: '14px', // Increased font size
      })
    }
    return points
  }

  // Generate multiple clusters
  const cluster1 = generate_cluster(20, 80, 8, 5, 'C1')
  const cluster2 = generate_cluster(80, 20, 10, 8, 'C2')
  const cluster3 = generate_cluster(50, 50, 12, 10, 'C3')
  const cluster4 = generate_cluster(15, 15, 6, 4, 'C4')

  // Combine into a single series for simplicity in this demo
  const combined_series = {
    x: [...cluster1.x, ...cluster2.x, ...cluster3.x, ...cluster4.x],
    y: [...cluster1.y, ...cluster2.y, ...cluster3.y, ...cluster4.y],
    point_style: [
      ...cluster1.point_style,
      ...cluster2.point_style,
      ...cluster3.point_style,
      ...cluster4.point_style,
    ],
    point_label: [
      ...cluster1.point_label,
      ...cluster2.point_label,
      ...cluster3.point_label,
      ...cluster4.point_label,
    ],
  }

  let auto_place_enabled = true
</script>

<div>
  <label style="margin-bottom: 1em; display: block">
    <input type="checkbox" bind:checked={auto_place_enabled} />
    Enable Automatic Label Placement
  </label>

  <!-- Use #key to force re-render when auto_place_enabled changes -->
  {#key auto_place_enabled}
    <ScatterPlot
      series={[{
        ...combined_series,
        point_label: combined_series.point_label.map((lbl) => ({
          ...lbl,
          auto_placement: auto_place_enabled,
        })),
      }]}
      x_label="X Position"
      y_label="Y Position"
      x_lim={[0, 100]}
      y_lim={[0, 100]}
      markers="points"
      style="height: 500px"
    />
  {/key}
</div>
```

Try toggling the checkbox to see the difference between manual (default) offset and automatic placement.

## External Vertical Color Bar with Dynamic Controls

This example shows how to place the color bar vertically on the right side of the plot, outside the main plotting area, and make it span the full height available. It also demonstrates how to dynamically change the color scheme and toggle between linear and log color scales.

```svelte example
<script>
  import { ColorScaleSelect, ScatterPlot } from 'matterviz'

  // Generate data where color value relates to y-value
  const point_count = 50
  const vertical_color_data = {
    x: Array(point_count).fill(0).map((_, idx) => (idx / point_count) * 90 + 5), // Range 5 to 95
    y: Array(point_count).fill(0).map(() => Math.random() * 90 + 5), // Range 5 to 95
    // Color value based on the y-coordinate
    color_values: Array(point_count).fill(0).map((_, idx) => idx * 2), // Values from 0 to 98
    point_style: {
      radius: 6,
      stroke: `black`,
      stroke_width: 0.5,
    },
    metadata: Array(point_count).fill(0).map((_, idx) => ({ value: idx * 2 })),
  }

  // Adjust right padding to make space for the external color bar
  const plot_padding = { t: 20, b: 50, l: 60, r: 70 } // Increased right padding

  // Color Scaling Controls
  let color_scale = $state({ type: `linear`, scheme: `interpolateCool` }) // Track which color scale type is active
</script>

<div>
  <div
    style="margin-bottom: 1em; display: flex; gap: 1em; flex-wrap: wrap; align-items: center"
  >
    <div>
      <strong>Color Scale Type:</strong>
      {#each ['linear', 'log'] as scale_type}
        <label style="margin-left: 0.5em">
          <input
            type="radio"
            name="scale_type"
            value={scale_type}
            bind:group={color_scale.type}
          />
          {scale_type}
        </label>
      {/each}
    </div>

    <ColorScaleSelect bind:value={color_scale.scheme} selected={[color_scale.scheme]} />
  </div>

  The color bar is positioned vertically to the right, outside the plot. The plot's right
  padding is increased to prevent overlap. Use the controls above to change the color
  scheme and scale type.

  <ScatterPlot
    series={[vertical_color_data]}
    x_label="X Position"
    y_label="Y Position"
    x_lim={[0, 100]}
    y_lim={[0, 100]}
    x_format=".2"
    y_format=".2"
    markers="points"
    {color_scale}
    padding={plot_padding}
    color_bar={{
      title: `Color Bar Title (${color_scale.type})`,
      orientation: `vertical`,
      tick_side: `primary`,
      wrapper_style: `
        position: absolute;
        /* Position outside the plot area using padding values */
        right: 10px; /* Distance from the container's right edge */
        top: ${plot_padding.t}px; /* Align with top padding */
        /* Set height directly for the wrapper */
        height: calc(100% - ${
        plot_padding.t + plot_padding.b
      }px); /* Fill vertical space */
      `,
      style: `width: 15px; height: 100%;`,
    }}
    style="height: 400px"
  >
    {#snippet tooltip({ x_formatted, y_formatted, metadata, color_value })}
      Point ({x_formatted}, {y_formatted})<br />
      Color value: {color_value?.toFixed(1)}
    {/snippet}
  </ScatterPlot>
</div>
```

## Line Clipping with Fixed Ranges

This example demonstrates how lines are clipped when they extend beyond the fixed `x_lim` and `y_lim` provided to the `ScatterPlot`. Observe how the lines originating and ending outside the plot area are correctly cut off at the plot boundaries on all four sides (top, bottom, left, right). This verifies the `clipPath` functionality.

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'

  // Define fixed plot limits
  const x_limits = [-5, 5]
  const y_limits = [-5, 5]

  // Function to generate a line that extends beyond the limits
  const generate_line = (start_x, start_y, end_x, end_y, steps, label) => {
    const line = { x: [], y: [], label }
    for (let idx = 0; idx <= steps; idx++) {
      const t = idx / steps
      line.x.push(start_x + (end_x - start_x) * t)
      line.y.push(start_y + (end_y - start_y) * t)
    }
    return line
  }

  // Function to generate a curved line (parabola)
  const generate_parabola = (
    start_x,
    end_x,
    curvature,
    vertical_shift,
    steps,
    label,
  ) => {
    const curve = { x: [], y: [], label }
    for (let idx = 0; idx <= steps; idx++) {
      const x = start_x + (end_x - start_x) * (idx / steps)
      // Simple downward-opening parabola: y = -curvature * x^2 + shift
      curve.x.push(x)
      curve.y.push(-curvature * x * x + vertical_shift)
    }
    return curve
  }

  // Function to generate a curved line (sine wave)
  const generate_sine_wave = (
    start_x,
    end_x,
    amplitude,
    frequency,
    vertical_shift,
    steps,
    label,
  ) => {
    const wave = { x: [], y: [], label }
    for (let idx = 0; idx <= steps; idx++) {
      const x = start_x + (end_x - start_x) * (idx / steps)
      wave.x.push(x)
      wave.y.push(amplitude * Math.sin(frequency * x) + vertical_shift)
    }
    return wave
  }

  // Create lines that cross all boundaries
  const clipping_series = [
    // Line crossing left and right boundaries
    generate_line(-10, 0, 10, 0, 20, 'Left-Right'),
    // Line crossing top and bottom boundaries
    generate_line(0, -10, 0, 10, 20, 'Top-Bottom'),
    // Diagonal line crossing top-left and bottom-right
    generate_line(-10, 10, 10, -10, 20, 'TopLeft-BottomRight'),
    // Diagonal line crossing bottom-left and top-right
    generate_line(-10, -10, 10, 10, 20, 'BottomLeft-TopRight'),
    // Line completely outside (should not be visible)
    generate_line(15, 15, 20, 20, 5, 'Outside'),
    // Line starting inside, ending outside (top-right)
    generate_line(2, 2, 15, 15, 10, 'Inside-TopRight'),
    // Line starting outside (bottom-left), ending inside
    generate_line(-15, -15, -2, -2, 10, 'BottomLeft-Inside'),
    // Parabola opening downwards, exiting bottom
    generate_parabola(-10, 10, 0.2, 0, 40, 'Parabola (Bottom Exit)'),
    // Sine wave mostly below the bottom edge
    generate_sine_wave(-10, 10, 4, 1, -6, 50, 'Sine Wave (Below Bottom)'),
    // Parabola starting inside, exiting bottom-right
    generate_parabola(-2, 10, 0.15, 4, 30, 'Parabola (Inside-BottomRight Exit)'),
  ]

  // Add some basic styling
  clipping_series.forEach((series_data, idx) => {
    series_data.line_style = {
      stroke: `hsl(${idx * 60}, 70%, 50%)`,
      stroke_width: 2,
    }
  })
</script>

<ScatterPlot
  series={clipping_series}
  x_lim={x_limits}
  y_lim={y_limits}
  x_label="X Axis (Fixed Range)"
  y_label="Y Axis (Fixed Range)"
  markers="line"
  style="height: 400px"
  show_zero_lines
  padding={{ l: 150 }}
  legend={{
    wrapper_style:
      `position: absolute; right: 0; transform: translateX(100%); max-width: 400px;`,
  }}
/>
```
