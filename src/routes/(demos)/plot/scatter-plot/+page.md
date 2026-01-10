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
  let hovered_point_info = $state('No point hovered yet.')

  // It's good practice to type event handlers if you know the structure
  function on_point_click({ point }) {
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

  function handle_point_hover({ point }) {
    if (point) {
      const { x, y, metadata, series_idx, point_idx } = point
      hovered_point_info = `Hovering: Point (${x}, ${y}), Series: '${
        metadata?.series_label ??
          (series_idx === 0 ? basic_data.label : second_series.label)
      }', Point Index: ${point_idx}`
      if (metadata) {
        hovered_point_info += `, Metadata ID: ${metadata.id}`
      }
    } else {
      hovered_point_info = 'No point hovered yet.'
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
  series={[
    { ...basic_data, markers: display_mode },
    { ...second_series, markers: display_mode },
  ]}
  x_axis={{ label: 'X Axis' }}
  y_axis={{ label: 'Y Value' }}
  point_events={{ onclick: on_point_click, ondblclick: handle_point_double_click }}
  on_point_hover={handle_point_hover}
  style="height: 300px"
/>
<div {style}>
  {clicked_point_info}
</div>
<div {style}>
  {double_clicked_point_info}
</div>
<div {style}>
  {hovered_point_info}
</div>
```

## Custom Point Styling and Tooltips

Demonstrate various point styles, custom tooltips, and hover effects:

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'

  // Generate data for demonstration
  const n_points = 10
  const x_values = Array(n_points).fill(0).map((_, idx) => idx + 1)

  // Create series with different point styles
  const series_with_styles = [
    // Extra large red points with thick border
    {
      x: x_values,
      y: Array(n_points).fill(10),
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
      y: Array(n_points).fill(8),
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
      y: Array(n_points).fill(6),
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
      y: Array(n_points).fill(4),
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
      y: Array(n_points).fill(2),
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
    series.metadata = Array.from({ length: n_points }, (_, idx) => ({
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
  series={series_with_styles.map((srs) => ({ ...srs, markers: 'points' }))}
  x_axis={{ label: 'X Axis' }}
  y_axis={{ label: 'Point Style Examples', range: [0, 12] }}
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
  import { symbol_names } from 'matterviz/labels'

  let show_labels = $state(true)
  let label_size = $state(14)
  let size_scale = $state({ radius_range: [2, 15], type: 'linear' }) // [min_radius, max_radius]

  const n_points = 40

  let spiral_data = $state({
    x: [],
    y: [],
    size_values: [],
    point_style: [],
    point_label: [],
    metadata: [],
  })

  // Generate initial points (run once)
  for (let idx = 0; idx < n_points; idx++) {
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
    const hue = (idx / n_points) * 360
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
  series={[{ ...spiral_data, markers: 'points' }]}
  x_axis={{ label: 'X Axis', range: [-15, 15] }}
  y_axis={{ label: 'Y Axis', range: [-15, 15] }}
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
  series={series_data.map((srs) => ({ ...srs, markers: 'points' }))}
  x_axis={{ label: "X Value", range: [-15, 15], ticks: ticks.x }}
  y_axis={{ label: "Y Value", range: [-15, 15], ticks: ticks.y }}
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

Using time data on the x-axis with custom formatting. This example also demonstrates `tick.label.inside` which positions tick labels inside the plot area for a more compact design:

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
  let date_format = $state('%b %d')
  let y_format = $state('.1f')
  let inside = $state(false)
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
  <label style="margin-left: 1em">
    <input type="checkbox" bind:checked={inside} />
    Tick Labels Inside
  </label>

  <ScatterPlot
    series={time_series.map((srs) => ({ ...srs, markers: 'line+points' }))}
    x_axis={{ format: date_format, ticks: -7, label: 'Date', tick: { label: { inside } } }}
    y_axis={{ format: y_format, ticks: 5, label: 'Value', tick: { label: { inside } } }}
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
  x_axis={{ range: [0, 10], ticks: 1, label: 'X Axis' }}
  y_axis={{ range: [0, 6], ticks: 1, label: 'Y Axis' }}
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
  series={[{ ...data, markers: 'points' }]}
  x_axis={{ label: 'X Axis', range: [0, 10] }}
  y_axis={{ label: 'Y Axis', range: [0, 10] }}
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
  series={[{ ...position_data, markers: 'points' }]}
  x_axis={{ label: 'X Axis', range: [0, 10] }}
  y_axis={{ label: 'Y Axis', range: [0, 6] }}
  style="height: 350px"
/>
```

## Interactive Log-Scaled Axes

ScatterPlot supports logarithmic scaling for data that spans multiple orders of magnitude. This example combines multiple datasets and allows you to dynamically switch between linear and logarithmic scales for both the X and Y axes using the checkboxes below. Observe how the appearance of the data changes, particularly for power-law relationships which appear as straight lines on log-log plots.

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'
  import { symbol_names } from 'matterviz/labels'
  import * as math from 'matterviz/math'

  const n_points = 50

  // Series 1: Exponential Decay
  const decay_data = {
    x: [],
    y: [],
    size_values: [],
    point_style: { fill: 'coral' },
    label: 'Exponential Decay',
    metadata: [],
  }
  for (let idx = 0; idx < n_points; idx++) {
    const x_val = 0.1 + (idx / (n_points - 1)) * 10 // x from 0.1 to 10.1
    const y_val = 10000 * Math.exp(-0.5 * x_val)
    decay_data.x.push(x_val)
    // Ensure y is not exactly 0 for log scale, clamp to a small positive value
    const safe_y_val = Math.max(y_val, math.LOG_EPS)
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
  for (let idx = 0; idx < n_points * 2; idx++) { // More points for smoother curve
    const x_val = Math.pow(10, -1 + (idx / (n_points * 2 - 1)) * 4) // x from 0.1 to 1000 log-spaced
    const y_val = 500 + 400 * Math.sin(Math.log10(x_val) * 5)
    log_sine_data.x.push(x_val)
    const safe_y_val = Math.max(y_val, math.LOG_EPS) // Clamp potential near-zero y
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
    const safe_y_val = Math.max(y_val, math.LOG_EPS) // Clamp y
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
    const safe_y_val = Math.max(y_val, math.LOG_EPS) // Clamp y
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
  let x_range = $derived(x_is_log ? [0.1, 1000] : [null, 1000])
  let y_range = $derived(y_is_log ? [0.1, 10000] : [null, 10000])
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

  <ScatterPlot
    series={all_series.map((srs) => ({ ...srs, markers: 'line+points' }))}
    x_axis={{
      scale_type: x_scale_type,
      range: x_range,
      label: `X Axis (${x_scale_type})`,
      format: '~s',
    }}
    y_axis={{
      scale_type: y_scale_type,
      range: y_range,
      label: `Y Axis (${y_scale_type})`,
      format: '~s',
    }}
    {size_scale}
    style="height: 400px"
  >
    {#snippet tooltip({ x, y, x_formatted, y_formatted, metadata })}
      <strong>{metadata.label ?? metadata.series}</strong><br />
      X: {x_formatted || x.toPrecision(3)}<br />
      Y: {y_formatted || y.toPrecision(3)}
    {/snippet}
  </ScatterPlot>
</div>
```

## Arcsinh Scale: Handling Negative Values and Wide Ranges

The **arcsinh scale** (`scale_type='arcsinh'`) is ideal for data spanning positive, negative, and zero values with wide dynamic range. Unlike log scale which can't handle non-positive values, arcsinh behaves linearly near zero and logarithmically for large absolute values—perfect for data like formation energies, charge densities, or financial metrics.

The configurable `threshold` parameter controls the transition point: smaller values make the transition sharper, larger values extend the linear region.

```svelte example
<script lang="ts">
  import { ScatterPlot } from 'matterviz'

  const scale_types = [`linear`, `log`, `arcsinh`]
  let x_scale_type = $state(`arcsinh`)
  let y_scale_type = $state(`arcsinh`)
  let color_scale_type = $state(`arcsinh`)
  let arcsinh_threshold = $state(10)

  // Seeded random for reproducibility
  function seeded_random(seed) {
    let state = seed
    return () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff
      return state / 0x7fffffff
    }
  }

  // Generate formation energy-like data: clusters at different magnitudes
  const rng = seeded_random(42)
  const n_points = 80

  // Generate data with interesting structure across wide range
  const x_vals = []
  const y_vals = []
  const color_vals = []
  const metadata = []

  for (let idx = 0; idx < n_points; idx++) {
    // Create clusters at different orders of magnitude
    const magnitude = Math.pow(10, Math.floor(rng() * 4)) // 1, 10, 100, 1000
    const sign_x = rng() > 0.5 ? 1 : -1
    const sign_y = rng() > 0.5 ? 1 : -1

    // Add some points near zero for linear region demo
    const near_zero = rng() < 0.2
    const x = near_zero
      ? (rng() - 0.5) * 20
      : sign_x * magnitude * (0.5 + rng() * 0.5)
    const y = near_zero
      ? (rng() - 0.5) * 20
      : sign_y * magnitude * (0.3 + rng() * 0.7)
    const color = x * y / 1000 // Correlation between x, y creates gradient

    x_vals.push(x)
    y_vals.push(y)
    color_vals.push(color)
    metadata.push({
      idx,
      quadrant: `${sign_x > 0 ? `+` : `-`}X, ${sign_y > 0 ? `+` : `-`}Y`,
      magnitude: near_zero ? `near zero` : magnitude.toLocaleString(),
    })
  }

  const series_data = {
    x: x_vals,
    y: y_vals,
    color_values: color_vals,
    point_style: {
      radius: 6,
      stroke: `white`,
      stroke_width: 0.5,
      fill_opacity: 0.85,
    },
    metadata,
  }

  // Data compatibility checks for log scale warnings
  const x_has_non_positive = x_vals.some((v) => v <= 0)
  const y_has_non_positive = y_vals.some((v) => v <= 0)
  const color_has_non_positive = color_vals.some((v) => v <= 0)

  // Build scale configs with threshold
  let x_scale = $derived(
    x_scale_type === `arcsinh`
      ? { type: `arcsinh`, threshold: arcsinh_threshold }
      : x_scale_type,
  )
  let y_scale = $derived(
    y_scale_type === `arcsinh`
      ? { type: `arcsinh`, threshold: arcsinh_threshold }
      : y_scale_type,
  )
  let color_scale = $derived(
    color_scale_type === `arcsinh`
      ? { type: `arcsinh`, threshold: arcsinh_threshold, scheme: `interpolateRdBu` }
      : { type: color_scale_type, scheme: `interpolateRdBu` },
  )
</script>

<div
  style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1em; margin-bottom: 1em"
>
  <fieldset>
    <legend>X Axis Scale</legend>
    {#each scale_types as scale (scale)}
      <label style="margin-right: 0.5em">
        <input type="radio" bind:group={x_scale_type} value={scale} />
        {scale}
      </label>
    {/each}
  </fieldset>

  <fieldset>
    <legend>Y Axis Scale</legend>
    {#each scale_types as scale (scale)}
      <label style="margin-right: 0.5em">
        <input type="radio" bind:group={y_scale_type} value={scale} />
        {scale}
      </label>
    {/each}
  </fieldset>

  <fieldset>
    <legend>Color Scale</legend>
    {#each scale_types as scale (scale)}
      <label style="margin-right: 0.5em">
        <input type="radio" bind:group={color_scale_type} value={scale} />
        {scale}
      </label>
    {/each}
  </fieldset>
</div>

{#if x_scale_type === `arcsinh` || y_scale_type === `arcsinh` ||
    color_scale_type === `arcsinh`}
  <label style="display: block; margin-bottom: 1em">
    Arcsinh Threshold: {arcsinh_threshold}
    <input
      type="range"
      bind:value={arcsinh_threshold}
      min="0.1"
      max="100"
      step="0.1"
      style="width: 200px"
    />
    <span style="font-size: 0.85em; opacity: 0.7">
      (smaller = sharper transition at zero)
    </span>
  </label>
{/if}

{#if x_scale_type === `log` && x_has_non_positive}
  <p
    style="color: #e74c3c; font-size: 0.9em; margin: 0.5em 0; padding: 0.5em; background: rgba(231, 76, 60, 0.1); border-radius: 4px"
  >
    ⚠️ <strong>X-axis log scale invalid:</strong> Data contains negative/zero values.
    Points with x ≤ 0 will not render.
  </p>
{/if}

{#if y_scale_type === `log` && y_has_non_positive}
  <p
    style="color: #e74c3c; font-size: 0.9em; margin: 0.5em 0; padding: 0.5em; background: rgba(231, 76, 60, 0.1); border-radius: 4px"
  >
    ⚠️ <strong>Y-axis log scale invalid:</strong> Data contains negative/zero values.
    Points with y ≤ 0 will not render.
  </p>
{/if}

{#if color_scale_type === `log` && color_has_non_positive}
  <p
    style="color: #e74c3c; font-size: 0.9em; margin: 0.5em 0; padding: 0.5em; background: rgba(231, 76, 60, 0.1); border-radius: 4px"
  >
    ⚠️ <strong>Color log scale invalid:</strong> Data contains negative/zero values. Color
    mapping may fail for those points.
  </p>
{/if}

<p style="font-size: 0.9em; opacity: 0.8; margin-bottom: 0.5em">
  <strong>80 points</strong> spanning ±1000 with clusters at different magnitudes. Switch
  to "log" to see points with negative values disappear.
</p>

<ScatterPlot
  series={[{ ...series_data, markers: `points` }]}
  x_axis={{ label: `X Axis (${x_scale_type})`, scale_type: x_scale }}
  y_axis={{ label: `Y Axis (${y_scale_type})`, scale_type: y_scale }}
  {color_scale}
  color_bar={{ title: `X × Y / 1000` }}
  style="height: 450px"
>
  {#snippet tooltip({ x, y, color_value, metadata })}
    <strong>Point #{metadata.idx + 1}</strong><br />
    X: {x.toFixed(1)}<br />
    Y: {y.toFixed(1)}<br />
    Color: {color_value?.toFixed(2)}<br />
    Quadrant: {metadata.quadrant}<br />
    Magnitude: {metadata.magnitude}
  {/snippet}
</ScatterPlot>
```

## Combined Interactive Scatter Plot with Custom Controls

This example combines multiple features including different display modes, custom styling, various marker types, interactive controls for axis customization, and hover styling. It demonstrates the new grid customization options with independent X and Y grid controls and custom grid styling. Click the gear icon in the top-right corner to open a control pane with point size, line width, colors, and styling options:

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'
  import { symbol_names } from 'matterviz/labels'

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
  let display = $state({ x_grid: grid.x })
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
    series={displayed_series.map((srs) => ({ ...srs, markers: display_mode }))}
    x_axis={{ label: axis_labels.x }}
    y_axis={{ label: axis_labels.y }}
    change={(point) => (hovered_point = point)}
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
    series={random_series.map((srs) => ({ ...srs, markers: 'points' }))}
    x_axis={{ label: axis_labels.x, range: [-15, 15], ticks: ticks.x }}
    y_axis={{ label: axis_labels.y, range: [-15, 15], ticks: ticks.y }}
    bind:display
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
      // Assign a color value (e.g. based on distance from origin)
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
    (quadrant)
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
  series={plot_series.map((srs) => ({ ...srs, markers: 'points+text' }))}
  x_axis={{ label: 'X Position', range: [0, 100], format: '.2' }}
  y_axis={{ label: 'Y Position', range: [0, 100], format: '.2' }}
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

To enable this feature, set `auto_placement: true` within the `point_label` object for the desired points. The system automatically:

- **Prevents label overlaps** using improved rectangular collision detection
- **Avoids marker overlap** with a repulsion force that keeps labels clear of their markers
- **Respects font sizes** by accurately calculating label dimensions
- **Stays within bounds** by constraining labels to the plot area

This example demonstrates automatic placement with both clustered points (showing collision avoidance) and isolated markers (showing how labels position below markers without overlap):

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'

  // Function to generate a dense cluster of points
  const generate_cluster = (
    center_x,
    center_y,
    count,
    radius,
    label_prefix,
    font_size,
  ) => {
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
      points.point_style.push({ fill: 'rebeccapurple', radius: 8 })
      points.point_label.push({
        text: `${label_prefix}${idx + 1}`,
        auto_placement: true,
        font_size: font_size,
      })
    }
    return points
  }

  // Function to generate isolated markers (well-spaced)
  const generate_isolated = (positions, label_prefix, font_size) => {
    const points = {
      x: [],
      y: [],
      point_style: [],
      point_label: [],
    }
    for (let idx = 0; idx < positions.length; idx++) {
      const [px, py] = positions[idx]
      points.x.push(px)
      points.y.push(py)
      points.point_style.push({ fill: 'darkorange', radius: 10 })
      points.point_label.push({
        text: `${label_prefix}${idx + 1}`,
        auto_placement: true,
        font_size: font_size,
      })
    }
    return points
  }

  // Dense clusters (test collision avoidance)
  const cluster1 = generate_cluster(25, 75, 10, 6, 'Dense-', '13px')
  const cluster2 = generate_cluster(75, 25, 8, 5, 'Packed-', '11px')

  // Isolated markers (test marker avoidance and boundary constraints)
  const isolated = generate_isolated(
    [[10, 10], [90, 90], [10, 90], [90, 10], [50, 50]],
    'Solo-',
    '16px',
  )

  // Combine all points
  const combined_series = {
    x: [...cluster1.x, ...cluster2.x, ...isolated.x],
    y: [...cluster1.y, ...cluster2.y, ...isolated.y],
    point_style: [
      ...cluster1.point_style,
      ...cluster2.point_style,
      ...isolated.point_style,
    ],
    point_label: [
      ...cluster1.point_label,
      ...cluster2.point_label,
      ...isolated.point_label,
    ],
  }

  let auto_place_enabled = $state(true)

  // Derive the series data reactively
  const series_data = $derived([{
    ...combined_series,
    point_label: combined_series.point_label.map((lbl) => ({
      ...lbl,
      auto_placement: auto_place_enabled,
    })),
  }])
</script>

<div>
  <label style="margin-bottom: 1em; display: block">
    <input type="checkbox" bind:checked={auto_place_enabled} />
    Enable Automatic Label Placement
  </label>

  <p style="margin-bottom: 1em; font-size: 0.95em; opacity: 0.9">
    Toggle to compare: with auto-placement ON, clustered labels (purple markers) separate
    to avoid overlap, and isolated labels (orange markers) position below their markers.
    With it OFF, you'll see overlaps.
  </p>

  <ScatterPlot
    series={series_data.map((srs) => ({ ...srs, markers: 'points' }))}
    x_axis={{ label: 'X Position', range: [0, 100] }}
    y_axis={{ label: 'Y Position', range: [0, 100] }}
    style="height: 500px"
  />
</div>
```

**Key improvements in action:**

- **Dense clusters** (purple): Labels intelligently spread out using improved collision detection
- **Isolated markers** (orange): Labels position below markers with proper spacing
- **Different font sizes**: System accurately accounts for label dimensions (11px, 13px, 16px)
- **Boundary awareness**: Labels near plot edges stay within the visible area

## External Vertical Color Bar with Dynamic Controls

This example shows how to place the color bar vertically on the right side of the plot, outside the main plotting area, and make it span the full height available. It also demonstrates how to dynamically change the color scheme and toggle between linear and log color scales.

```svelte example
<script>
  import { ColorScaleSelect, ScatterPlot } from 'matterviz'

  // Generate data where color value relates to y-value
  const n_points = 50
  const vertical_color_data = {
    x: Array(n_points).fill(0).map((_, idx) => (idx / n_points) * 90 + 5), // Range 5 to 95
    y: Array(n_points).fill(0).map(() => Math.random() * 90 + 5), // Range 5 to 95
    // Color value based on the y-coordinate
    color_values: Array(n_points).fill(0).map((_, idx) => idx * 2 + 1), // 1..99
    point_style: {
      radius: 6,
      stroke: `black`,
      stroke_width: 0.5,
    },
    metadata: Array(n_points).fill(0).map((_, idx) => ({ value: idx * 2 })),
  }

  // Adjust right padding to make space for the external color bar
  const plot_padding = { t: 20, b: 50, l: 60, r: 70 } // Increased right padding

  // Color Scaling Controls
  let color_scale = $state({ type: `linear`, scheme: `interpolateCool` }) // Track which color scale type is active
</script>

<div
  style="margin-bottom: 1em; display: flex; gap: 6pt; flex-wrap: wrap; align-items: center"
>
  <strong>Color Scale Type:</strong>
  {#each [`linear`, `log`] as scale_type (scale_type)}
    <label>
      <input
        type="radio"
        name="scale_type"
        value={scale_type}
        bind:group={color_scale.type}
      />
      {scale_type}
    </label>
  {/each}

  <ColorScaleSelect bind:value={color_scale.scheme} selected={[color_scale.scheme]} />
</div>

The color bar is positioned vertically to the right, outside the plot. The plot's right
padding is increased to prevent overlap. Use the controls above to change the color scheme
and scale type.

<ScatterPlot
  series={[{ ...vertical_color_data, markers: 'points' }]}
  x_axis={{ label: 'X Position', range: [0, 100], format: '.2' }}
  y_axis={{ label: 'Y Position', range: [0, 100], format: '.2' }}
  {color_scale}
  padding={plot_padding}
  color_bar={{
    title: `Color Bar Title (${color_scale.type})`,
    orientation: `vertical`,
    tick_side: `primary`,
    wrapper_style: `
      position: absolute;
      right: 10px;
      top: ${plot_padding.t}px;
      height: calc(100% - ${plot_padding.t + plot_padding.b}px);
    `,
    bar_style: `width: 15px; height: 100%;`,
  }}
  style="height: 400px"
>
  {#snippet tooltip({ x_formatted, y_formatted, metadata, color_value })}
    Point ({x_formatted}, {y_formatted})<br />
    Color value: {color_value?.toFixed(1)}
  {/snippet}
</ScatterPlot>
```

## Line Clipping with Fixed Ranges

This example demonstrates how lines are clipped when they extend beyond the fixed `x_axis.range` and `y_axis.range` provided to the `ScatterPlot`. Lines originating and ending outside the plot area are cut off at the plot boundaries on all four sides (top, bottom, left, right). This verifies the `clipPath` functionality.

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'

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
  series={clipping_series.map((srs) => ({ ...srs, markers: 'line' }))}
  x_axis={{ range: [-5, 5], label: 'X Axis (Fixed Range)' }}
  y_axis={{ range: [-5, 5], label: 'Y Axis (Fixed Range)' }}
  style="height: 400px"
/>
```

## Legend Grouping

When comparing results from multiple methods or categories, you can organize legend items into collapsible groups using the `legend_group` property. This is particularly useful for comparing DFT methods, ML potentials, or experimental data. Click the group header to toggle visibility of all series in that group, or click the chevron (▶) to collapse/expand the group.

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'

  // Grouped series data - comparing DFT methods vs ML potentials vs experiment
  const grouped_series = [
    // DFT group
    {
      x: [1, 2, 3, 4, 5],
      y: [2.1, 4.2, 3.1, 5.3, 4.0],
      label: 'PBE',
      legend_group: 'DFT',
      point_style: { fill: '#3498db', radius: 5 },
      line_style: { stroke: '#3498db', stroke_width: 2 },
      markers: 'line+points',
    },
    {
      x: [1, 2, 3, 4, 5],
      y: [2.3, 4.5, 3.4, 5.6, 4.2],
      label: 'LDA',
      legend_group: 'DFT',
      point_style: { fill: '#2980b9', radius: 5 },
      line_style: { stroke: '#2980b9', stroke_width: 2, line_dash: '5 3' },
      markers: 'line+points',
    },
    // ML Potentials group
    {
      x: [1, 2, 3, 4, 5],
      y: [2.0, 4.0, 3.0, 5.1, 3.9],
      label: 'MACE',
      legend_group: 'ML Potentials',
      point_style: { fill: '#e74c3c', radius: 5 },
      line_style: { stroke: '#e74c3c', stroke_width: 2 },
      markers: 'line+points',
    },
    {
      x: [1, 2, 3, 4, 5],
      y: [2.2, 4.3, 3.2, 5.4, 4.1],
      label: 'CHGNet',
      legend_group: 'ML Potentials',
      point_style: { fill: '#c0392b', radius: 5 },
      line_style: { stroke: '#c0392b', stroke_width: 2, line_dash: '5 3' },
      markers: 'line+points',
    },
    {
      x: [1, 2, 3, 4, 5],
      y: [1.9, 3.8, 2.9, 4.9, 3.7],
      label: 'M3GNet',
      legend_group: 'ML Potentials',
      point_style: { fill: '#a93226', radius: 5 },
      line_style: { stroke: '#a93226', stroke_width: 2, line_dash: '2 2' },
      markers: 'line+points',
    },
    // Experiment (ungrouped)
    {
      x: [1, 2, 3, 4, 5],
      y: [2.0, 4.1, 3.0, 5.2, 4.0],
      label: 'Experiment',
      point_style: { fill: '#2ecc71', radius: 7, symbol_type: 'Star' },
      markers: 'points',
    },
  ]
</script>

<ScatterPlot
  series={grouped_series}
  x_axis={{ label: 'Sample Index' }}
  y_axis={{ label: 'Energy (eV)' }}
  legend={{ draggable: true }}
  style="height: 400px"
>
  {#snippet tooltip({ x, y, label })}
    <strong>{label}</strong><br>
    Sample {x}: {y.toFixed(2)} eV
  {/snippet}
</ScatterPlot>
```

## Multiple Plots in 2×2 Grid Layout

Display multiple scatter plots in a responsive 2×2 grid:

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'

  const make_data = (fn) => {
    const x_vals = Array.from({ length: 30 }, (_, idx) => idx)
    return { x: x_vals, y: x_vals.map(fn) }
  }

  const plots = [
    { title: 'Linear', data: make_data((x) => 2 * x + Math.random() * 10) },
    {
      title: 'Quadratic',
      data: make_data((x) => (x - 15) ** 2 / 10 + Math.random() * 5),
    },
    {
      title: 'Exponential',
      data: make_data((x) => Math.exp(x / 10) + Math.random() * 2),
    },
    {
      title: 'Sine',
      data: make_data((x) => 15 + 10 * Math.sin(x / 3) + Math.random() * 2),
    },
  ]
</script>

<div class="grid">
  {#each plots as { title, data }}
    <div class="cell">
      <h4>{title}</h4>
      <ScatterPlot series={[data]} x_axis={{ label: 'x' }} y_axis={{ label: 'y' }} />
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

## Fill Between Series and Error Bands

The `fill_regions` prop enables filling areas between boundaries defined by series, constants, functions, or raw data arrays. The `error_bands` prop provides a convenient shorthand for showing uncertainty ranges around data series. Both support hover interactions and appear in the legend.

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'

  // Generate two series to fill between
  const x_values = Array.from({ length: 20 }, (_, idx) => idx)
  const upper_series = {
    x: x_values,
    y: x_values.map((val) => 10 + 3 * Math.sin(val * 0.5) + Math.random()),
    label: 'Upper Bound',
    point_style: { fill: '#e74c3c', radius: 4 },
    line_style: { stroke: '#e74c3c', stroke_width: 2 },
    markers: 'line+points',
  }
  const lower_series = {
    x: x_values,
    y: x_values.map((val) => 5 + 2 * Math.sin(val * 0.5) + Math.random()),
    label: 'Lower Bound',
    point_style: { fill: '#3498db', radius: 4 },
    line_style: { stroke: '#3498db', stroke_width: 2 },
    markers: 'line+points',
  }

  // Series with error bands
  const data_with_errors = {
    x: x_values,
    y: x_values.map((val) => 15 + 2 * Math.cos(val * 0.3)),
    label: 'Measurement',
    point_style: { fill: '#2ecc71', radius: 5 },
    line_style: { stroke: '#2ecc71', stroke_width: 2 },
    markers: 'line+points',
  }

  // Asymmetric errors (larger above than below)
  const upper_errors = x_values.map(() => 1 + Math.random() * 1.5)
  const lower_errors = x_values.map(() => 0.5 + Math.random() * 0.5)

  // Fill between the two series
  const fill_regions = [
    {
      upper: { type: 'series', series_idx: 0 },
      lower: { type: 'series', series_idx: 1 },
      fill: 'rgba(155, 89, 182, 0.3)',
      label: 'Range Between',
      edge_upper: { color: '#9b59b6', width: 1 },
    },
  ]

  // Error band with asymmetric errors
  const error_bands = [
    {
      series: { type: 'series', series_idx: 2 },
      error: { upper: upper_errors, lower: lower_errors },
      fill: '#2ecc71',
      fill_opacity: 0.25,
      label: '±Error',
    },
  ]

  let hovered_fill = $state(null)
</script>

<ScatterPlot
  series={[upper_series, lower_series, data_with_errors]}
  {fill_regions}
  {error_bands}
  on_fill_hover={(event) => (hovered_fill = event)}
  x_axis={{ label: 'X Value' }}
  y_axis={{ label: 'Y Value', range: [0, 20] }}
  style="height: 400px"
/>

<div style="margin-top: 0.5em; font-size: 0.9em">
  {#if hovered_fill}
    Hovering: {hovered_fill.label ?? `Fill region ${hovered_fill.region_idx}`}
  {:else}
    Hover over filled areas to see interaction
  {/if}
</div>
```

## Conditional Fills and Function Boundaries

Use the `where` condition to fill only where a condition is true—for example, highlighting regions where one series exceeds another. Boundaries can also be defined as functions for dynamic fills like confidence intervals or thresholds.

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'

  // Two crossing series
  const x_values = Array.from({ length: 30 }, (_, idx) => idx * 0.5)
  const series_a = {
    x: x_values,
    y: x_values.map((val) => 8 + 4 * Math.sin(val)),
    label: 'Series A',
    point_style: { fill: '#e74c3c', radius: 3 },
    line_style: { stroke: '#e74c3c', stroke_width: 2 },
    markers: 'line+points',
  }
  const series_b = {
    x: x_values,
    y: x_values.map((val) => 8 + 3 * Math.cos(val * 0.8)),
    label: 'Series B',
    point_style: { fill: '#3498db', radius: 3 },
    line_style: { stroke: '#3498db', stroke_width: 2 },
    markers: 'line+points',
  }

  // Fill only where A > B (green) and where B > A (orange)
  const fill_regions = [
    {
      upper: { type: 'series', series_idx: 0 },
      lower: { type: 'series', series_idx: 1 },
      where: (_x, y_upper, y_lower) => y_upper > y_lower,
      fill: 'rgba(46, 204, 113, 0.4)',
      label: 'A > B',
      curve: 'monotoneX',
    },
    {
      upper: { type: 'series', series_idx: 1 },
      lower: { type: 'series', series_idx: 0 },
      where: (_x, y_upper, y_lower) => y_upper > y_lower,
      fill: 'rgba(230, 126, 34, 0.4)',
      label: 'B > A',
      curve: 'monotoneX',
    },
    // Function boundary: fill below a threshold line
    {
      upper: { type: 'function', fn: () => 4 },
      lower: 0,
      fill: 'rgba(52, 152, 219, 0.15)',
      label: 'Below Threshold',
      z_index: 'below-grid',
    },
  ]

  let clicked_region = $state(null)
</script>

<ScatterPlot
  series={[series_a, series_b]}
  {fill_regions}
  on_fill_click={(event) => (clicked_region = event)}
  x_axis={{ label: 'X Value' }}
  y_axis={{ label: 'Y Value', range: [0, 14] }}
  style="height: 400px"
/>

<div style="margin-top: 0.5em; font-size: 0.9em">
  {#if clicked_region}
    Clicked: <strong>{clicked_region.label}</strong> at x={clicked_region.px.toFixed(0)}px
  {:else}
    Click on a filled region to see the event
  {/if}
</div>
```

## Fill Between Series with Mismatched X-Values

A key feature of the fill-between API is automatic interpolation when series have different x-values. This example demonstrates filling between two series with completely different sampling points—the fill utility automatically aligns them using linear interpolation.

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'

  // Series A: sparse sampling (every 2 units)
  const sparse_x = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20]
  const series_sparse = {
    x: sparse_x,
    y: sparse_x.map((val) => 8 + 3 * Math.sin(val * 0.4)),
    label: 'Sparse (11 pts)',
    point_style: { fill: '#e74c3c', radius: 6 },
    line_style: { stroke: '#e74c3c', stroke_width: 2 },
    markers: 'line+points',
  }

  // Series B: dense sampling (every 0.5 units) with offset x-values
  const dense_x = Array.from({ length: 41 }, (_, idx) => idx * 0.5)
  const series_dense = {
    x: dense_x,
    y: dense_x.map((val) => 5 + 2 * Math.cos(val * 0.6)),
    label: 'Dense (41 pts)',
    point_style: { fill: '#3498db', radius: 3 },
    line_style: { stroke: '#3498db', stroke_width: 2 },
    markers: 'line+points',
  }

  // Fill between mismatched series - interpolation happens automatically
  const fill_regions = [
    {
      upper: { type: 'series', series_idx: 0 },
      lower: { type: 'series', series_idx: 1 },
      fill: 'rgba(155, 89, 182, 0.35)',
      label: 'Interpolated Fill',
      curve: 'monotoneX',
    },
  ]
</script>

The sparse series (red, 11 points) and dense series (blue, 41 points) have completely
different x-coordinates. The fill region correctly interpolates between them:

<ScatterPlot
  series={[series_sparse, series_dense]}
  {fill_regions}
  x_axis={{ label: 'X Value', range: [0, 20] }}
  y_axis={{ label: 'Y Value', range: [0, 14] }}
  style="height: 350px"
/>
```

## Non-Overlapping Series with Extrapolation

When series have non-overlapping x-ranges, the fill utility extrapolates using the nearest available values. This example shows three scenarios: partial overlap, no overlap, and one series contained within another.

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'

  // Series 1: x from 0 to 8
  const series_left = {
    x: [0, 2, 4, 6, 8],
    y: [3, 5, 7, 6, 4],
    label: 'Left (0-8)',
    point_style: { fill: '#e74c3c', radius: 5 },
    line_style: { stroke: '#e74c3c', stroke_width: 2 },
    markers: 'line+points',
  }

  // Series 2: x from 6 to 14 (partial overlap with series 1)
  const series_right = {
    x: [6, 8, 10, 12, 14],
    y: [2, 3, 5, 4, 3],
    label: 'Right (6-14)',
    point_style: { fill: '#3498db', radius: 5 },
    line_style: { stroke: '#3498db', stroke_width: 2 },
    markers: 'line+points',
  }

  // Series 3: x from 16 to 20 (no overlap)
  const series_far = {
    x: [16, 17, 18, 19, 20],
    y: [6, 8, 7, 9, 8],
    label: 'Far Right (16-20)',
    point_style: { fill: '#2ecc71', radius: 5 },
    line_style: { stroke: '#2ecc71', stroke_width: 2 },
    markers: 'line+points',
  }

  // Multiple fills showing different overlap scenarios
  const fill_regions = [
    {
      upper: { type: 'series', series_idx: 0 },
      lower: { type: 'series', series_idx: 1 },
      fill: 'rgba(155, 89, 182, 0.3)',
      label: 'Partial Overlap',
      curve: 'linear',
    },
    {
      upper: { type: 'series', series_idx: 2 },
      lower: 2, // Constant boundary
      fill: 'rgba(46, 204, 113, 0.3)',
      label: 'No Overlap (extrapolates)',
      curve: 'linear',
    },
  ]
</script>

<ScatterPlot
  series={[series_left, series_right, series_far]}
  {fill_regions}
  x_axis={{ label: 'X Value', range: [0, 22] }}
  y_axis={{ label: 'Y Value', range: [0, 12] }}
  style="height: 350px"
/>
```

## Fill with Different Curve Types

The `curve` property controls how the fill area is interpolated between data points. This example compares different curve types side-by-side, showing how each affects the fill shape.

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'

  // Same data for all plots
  const x_values = [0, 2, 4, 6, 8, 10, 12, 14]
  const upper_y = [8, 10, 7, 11, 9, 12, 8, 10]
  const lower_y = [3, 5, 2, 4, 3, 5, 2, 4]

  const make_series = () => [
    {
      x: x_values,
      y: upper_y,
      label: 'Upper',
      point_style: { fill: '#e74c3c', radius: 4 },
      line_style: { stroke: '#e74c3c', stroke_width: 2 },
      markers: 'line+points',
    },
    {
      x: x_values,
      y: lower_y,
      label: 'Lower',
      point_style: { fill: '#3498db', radius: 4 },
      line_style: { stroke: '#3498db', stroke_width: 2 },
      markers: 'line+points',
    },
  ]

  const curve_types = ['linear', 'monotoneX', 'step', 'basis']
  const colors = [
    'rgba(155, 89, 182, 0.4)',
    'rgba(46, 204, 113, 0.4)',
    'rgba(230, 126, 34, 0.4)',
    'rgba(52, 152, 219, 0.4)',
  ]
</script>

<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1em">
  {#each curve_types as curve_type, idx (curve_type)}
    <div>
      <strong style="text-transform: capitalize">{curve_type}</strong>
      <ScatterPlot
        series={make_series()}
        fill_regions={[{
          upper: { type: 'series', series_idx: 0 },
          lower: { type: 'series', series_idx: 1 },
          fill: colors[idx],
          label: `${curve_type} Fill`,
          curve: curve_type,
        }]}
        x_axis={{ label: 'X', range: [0, 15] }}
        y_axis={{ label: 'Y', range: [0, 14] }}
        style="height: 250px"
        legend={null}
      />
    </div>
  {/each}
</div>
```

## Reference Lines: Horizontal, Vertical, and Diagonal

Use `ref_lines` to add horizontal, vertical, and diagonal reference lines to your plots. These are useful for thresholds, targets, parity lines, and annotations. Lines support custom styling, annotations, z-index positioning, hover effects, and click handlers.

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'

  // Sample data points
  const data = {
    x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    y: [2.1, 3.8, 5.2, 4.5, 6.8, 7.2, 8.5, 9.1, 8.8, 10.2],
    point_style: { fill: `steelblue`, radius: 6 },
    markers: `points`,
    label: `Measurements`,
  }

  // Reference lines with different types
  let ref_lines = $state([
    // Horizontal line - target value
    {
      type: `horizontal`,
      y: 7,
      label: `Target`,
      style: { color: `#e74c3c`, width: 2, dash: `8 4` },
      annotation: { text: `Target = 7`, position: `end`, side: `above` },
    },
    // Vertical line - threshold
    {
      type: `vertical`,
      x: 5.5,
      label: `Phase Boundary`,
      style: { color: `#2ecc71`, width: 2 },
      annotation: { text: `Phase I → II`, position: `center`, side: `right` },
    },
    // Diagonal line - parity/identity line
    {
      type: `diagonal`,
      slope: 1,
      intercept: 0,
      label: `y = x`,
      style: { color: `#9b59b6`, width: 1.5, dash: `4 2` },
      annotation: { text: `Parity`, position: `end`, side: `below` },
    },
    // Another diagonal - trend line
    {
      type: `diagonal`,
      slope: 0.8,
      intercept: 1.5,
      label: `Trend`,
      style: { color: `#f39c12`, width: 2 },
      annotation: { text: `Trend: y = 0.8x + 1.5`, position: `start`, side: `above` },
      z_index: `below-grid`,
    },
  ])

  let clicked_line = $state(null)
  let hovered_line = $state(null)
</script>

<ScatterPlot
  series={[data]}
  {ref_lines}
  x_axis={{ label: `X Value`, range: [0, 12] }}
  y_axis={{ label: `Y Value`, range: [0, 12] }}
  style="height: 400px"
/>

<div
  style="margin-top: 0.5em; font-size: 0.9em; display: flex; gap: 1em; flex-wrap: wrap"
>
  {#each ref_lines as line}
    <label>
      <input
        type="checkbox"
        checked={line.visible !== false}
        onchange={() => {
          line.visible = line.visible === false
          ref_lines = [...ref_lines]
        }}
      />
      {line.label}
    </label>
  {/each}
</div>
```

## Reference Line Segments and Through-Points

Create line segments between specific points, or lines that extend through two points to the plot edges:

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'

  // Data with clusters
  const cluster_a = {
    x: [2, 2.5, 3, 2.8, 2.2],
    y: [8, 8.5, 7.8, 9, 8.2],
    point_style: { fill: `#e74c3c`, radius: 6 },
    label: `Cluster A`,
    markers: `points`,
  }

  const cluster_b = {
    x: [7, 7.5, 8, 7.2, 8.2],
    y: [3, 2.5, 3.5, 2.8, 3.2],
    point_style: { fill: `#3498db`, radius: 6 },
    label: `Cluster B`,
    markers: `points`,
  }

  // Reference lines connecting clusters and showing decision boundaries
  const ref_lines = [
    // Segment connecting cluster centers
    {
      type: `segment`,
      p1: [2.5, 8.3],
      p2: [7.5, 3],
      label: `Cluster Link`,
      style: { color: `#2ecc71`, width: 2 },
      annotation: { text: `d = 6.7`, position: `center`, side: `above` },
    },
    // Decision boundary (perpendicular bisector, extends to edges)
    {
      type: `line`,
      p1: [3, 4],
      p2: [7, 7],
      label: `Decision Boundary`,
      style: { color: `#9b59b6`, width: 2, dash: `6 3` },
      annotation: { text: `Boundary`, position: `end`, side: `above` },
    },
    // Horizontal mean line for cluster A
    {
      type: `horizontal`,
      y: 8.3,
      x_span: [1.5, 3.5],
      label: `A mean`,
      style: { color: `#e74c3c`, width: 1, dash: `4 2`, opacity: 0.7 },
    },
    // Horizontal mean line for cluster B
    {
      type: `horizontal`,
      y: 3,
      x_span: [6.5, 8.5],
      label: `B mean`,
      style: { color: `#3498db`, width: 1, dash: `4 2`, opacity: 0.7 },
    },
  ]
</script>

<ScatterPlot
  series={[cluster_a, cluster_b]}
  {ref_lines}
  x_axis={{ label: `Feature 1`, range: [0, 10] }}
  y_axis={{ label: `Feature 2`, range: [0, 10] }}
  style="height: 400px"
/>
```

## Interactive Reference Lines with Hover and Click

Reference lines support interactive features including hover styling, click handlers, and custom metadata:

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'

  const data = {
    x: Array.from({ length: 20 }, () => Math.random() * 10),
    y: Array.from({ length: 20 }, () => Math.random() * 10),
    point_style: { fill: `steelblue`, radius: 5 },
    markers: `points`,
  }

  let clicked_info = $state(`Click on a reference line`)
  let hovered_info = $state(`Hover over a line`)

  const ref_lines = [
    {
      type: `horizontal`,
      y: 3,
      id: `lower_threshold`,
      label: `Lower Threshold`,
      style: { color: `#e74c3c`, width: 2 },
      hover_style: { color: `#c0392b`, width: 4 },
      annotation: { text: `Min = 3`, position: `start`, side: `below` },
      metadata: { description: `Minimum acceptable value`, severity: `warning` },
      on_click: (event) => {
        clicked_info = `Clicked: ${event.label} (id: ${event.line_id}), metadata: ${
          JSON.stringify(event.metadata)
        }`
      },
      on_hover: (event) => {
        hovered_info = event ? `Hovering: ${event.label}` : `Hover over a line`
      },
    },
    {
      type: `horizontal`,
      y: 7,
      id: `upper_threshold`,
      label: `Upper Threshold`,
      style: { color: `#2ecc71`, width: 2 },
      hover_style: { color: `#27ae60`, width: 4 },
      annotation: { text: `Max = 7`, position: `start`, side: `above` },
      metadata: { description: `Maximum acceptable value`, severity: `info` },
      on_click: (event) => {
        clicked_info = `Clicked: ${event.label} (id: ${event.line_id}), metadata: ${
          JSON.stringify(event.metadata)
        }`
      },
      on_hover: (event) => {
        hovered_info = event ? `Hovering: ${event.label}` : `Hover over a line`
      },
    },
    {
      type: `vertical`,
      x: 5,
      id: `midpoint`,
      label: `Midpoint`,
      style: { color: `#f39c12`, width: 2, dash: `5 5` },
      hover_style: { color: `#d35400`, width: 3 },
      annotation: { text: `x = 5`, position: `end`, side: `right` },
      on_click: (event) => {
        clicked_info = `Clicked: ${event.label} at x=${
          event.type === 'vertical' ? 5 : 'N/A'
        }`
      },
      on_hover: (event) => {
        hovered_info = event ? `Hovering: ${event.label}` : `Hover over a line`
      },
    },
  ]
</script>

<ScatterPlot
  series={[data]}
  {ref_lines}
  x_axis={{ label: `X`, range: [0, 10] }}
  y_axis={{ label: `Y`, range: [0, 10] }}
  style="height: 400px"
/>

<div
  style="margin-top: 0.5em; padding: 0.5em; background: rgba(255, 255, 255, 0.05); border-radius: 4px; font-size: 0.9em"
>
  <div><strong>Clicked:</strong> {clicked_info}</div>
  <div><strong>Hovered:</strong> {hovered_info}</div>
</div>
```

## Reference Lines with Z-Index Layering

Control where reference lines appear in the rendering stack using `z_index`. Options are `below-grid`, `below-lines`, `below-points` (default), and `above-all`:

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'

  const series = [{
    x: [1, 2, 3, 4, 5, 6, 7, 8],
    y: [2, 4, 3, 6, 5, 8, 7, 9],
    point_style: { fill: `#3498db`, radius: 8 },
    line_style: { stroke: `#3498db`, stroke_width: 2 },
    markers: `line+points`,
    label: `Data Series`,
  }]

  let z_index = $state(`below-points`)

  const ref_line_config = $derived({
    type: `horizontal`,
    y: 5.5,
    style: { color: `#e74c3c`, width: 3 },
    z_index,
    annotation: {
      text: `z_index: ${z_index}`,
      position: `end`,
      side: `above`,
    },
  })
</script>

<div style="margin-bottom: 1em">
  <strong>Z-Index:</strong>
  {#each [`below-grid`, `below-lines`, `below-points`, `above-all`] as zi}
    <label style="margin-left: 1em">
      <input type="radio" bind:group={z_index} value={zi} />
      {zi}
    </label>
  {/each}
</div>

<ScatterPlot
  {series}
  ref_lines={[ref_line_config]}
  x_axis={{ label: `X`, range: [0, 10] }}
  y_axis={{ label: `Y`, range: [0, 10] }}
  style="height: 350px"
/>
```

## Reference Lines with Time Axes

Reference lines work seamlessly with time-based x-axes. Use Date objects or ISO strings for time values:

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'

  // Generate time series data for the past 30 days
  const now = Date.now()
  const day_ms = 24 * 60 * 60 * 1000
  const dates = Array.from({ length: 30 }, (_, idx) => now - (30 - idx) * day_ms)
  const values = dates.map((_, idx) =>
    50 + 20 * Math.sin(idx * 0.3) + Math.random() * 10
  )

  const series = [{
    x: dates,
    y: values,
    point_style: { fill: `steelblue`, radius: 4 },
    line_style: { stroke: `steelblue`, stroke_width: 2 },
    markers: `line+points`,
    label: `Daily Metric`,
  }]

  // Reference lines using Date objects
  const ref_lines = [
    {
      type: `vertical`,
      x: now - 15 * day_ms,
      style: { color: `#e74c3c`, width: 2 },
      annotation: { text: `Release Date`, position: `end`, side: `right` },
    },
    {
      type: `vertical`,
      x: now - 7 * day_ms,
      style: { color: `#2ecc71`, width: 2, dash: `4 2` },
      annotation: { text: `Week Ago`, position: `end`, side: `left` },
    },
    {
      type: `horizontal`,
      y: 65,
      style: { color: `#f39c12`, width: 2, dash: `6 3` },
      annotation: { text: `Target`, position: `end`, side: `above` },
    },
    {
      type: `horizontal`,
      y: 35,
      style: { color: `#9b59b6`, width: 1.5, dash: `4 4` },
      annotation: { text: `Minimum`, position: `end`, side: `below` },
    },
  ]
</script>

<ScatterPlot
  {series}
  {ref_lines}
  x_axis={{ label: `Date`, format: `%b %d` }}
  y_axis={{ label: `Value`, range: [20, 80] }}
  style="height: 400px"
/>
```

## Interactive Axis Labels with Lazy Data Loading

This demo showcases **interactive axis labels** with lazy data loading. Features:

- **240 data points** (80 per material class) to test rendering performance
- **6 switchable properties** on each axis with realistic correlations
- **Multi-series support** with 3 material classes (Metals, Ceramics, Polymers)
- **Variable loading delays** (200-800ms) simulating real API latency
- **Error simulation** (5% chance) to test error handling

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'

  // Seeded random for reproducible data
  function seeded_random(seed) {
    let state = seed
    return () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff
      return state / 0x7fffffff
    }
  }

  // Generate realistic materials data with correlations
  function generate_property_data(n_points, base_seed) {
    const rng = seeded_random(base_seed)
    const data = { metals: [], ceramics: [], polymers: [] }

    for (let idx = 0; idx < n_points; idx++) {
      // Metals: high density, low bandgap, high conductivity
      data.metals.push({
        density: 5 + rng() * 15 + Math.sin(idx * 0.1) * 2,
        bandgap: rng() * 0.5,
        conductivity: 1e5 + rng() * 1e7,
        formation_energy: -3 - rng() * 2 + Math.cos(idx * 0.05),
        bulk_modulus: 50 + rng() * 200,
        thermal_expansion: 5 + rng() * 20,
      })

      // Ceramics: medium density, wide bandgap, low conductivity
      data.ceramics.push({
        density: 2 + rng() * 6,
        bandgap: 2 + rng() * 8,
        conductivity: 1e-10 + rng() * 1e-5,
        formation_energy: -5 - rng() * 3 - Math.sin(idx * 0.08),
        bulk_modulus: 100 + rng() * 300,
        thermal_expansion: 2 + rng() * 10,
      })

      // Polymers: low density, variable bandgap, insulating
      data.polymers.push({
        density: 0.8 + rng() * 1.5,
        bandgap: 3 + rng() * 6,
        conductivity: 1e-18 + rng() * 1e-12,
        formation_energy: -1 - rng() * 2,
        bulk_modulus: 1 + rng() * 10,
        thermal_expansion: 50 + rng() * 200,
      })
    }
    return data
  }

  const n_points = 80
  const all_data = generate_property_data(n_points, 42)

  // Property definitions with realistic units
  const properties = {
    density: { label: `Density`, unit: `g/cm³`, scale: `linear` },
    bandgap: { label: `Band Gap`, unit: `eV`, scale: `linear` },
    conductivity: { label: `Conductivity`, unit: `S/m`, scale: `log` },
    formation_energy: { label: `Formation Energy`, unit: `eV/atom`, scale: `linear` },
    bulk_modulus: { label: `Bulk Modulus`, unit: `GPa`, scale: `linear` },
    thermal_expansion: { label: `Thermal Exp.`, unit: `ppm/K`, scale: `linear` },
  }

  // Series colors
  const colors = {
    metals: `#e74c3c`,
    ceramics: `#3498db`,
    polymers: `#2ecc71`,
  }

  // Build series from data
  function build_series(x_prop, y_prop) {
    const series_list = []
    for (const [material, color] of Object.entries(colors)) {
      const mat_data = all_data[material]
      series_list.push({
        x: mat_data.map((d) => d[x_prop]),
        y: mat_data.map((d) => d[y_prop]),
        label: material.charAt(0).toUpperCase() + material.slice(1),
        point_style: { fill: color, radius: 4, fill_opacity: 0.7 },
        markers: `points`,
      })
    }
    return series_list
  }

  // Initial state
  let x_key = $state(`density`)
  let y_key = $state(`formation_energy`)
  let series = $state(build_series(x_key, y_key))
  let loading_log = $state([])
  let error_count = $state(0)
  let load_count = $state(0)
  let load_start = $state(0)

  // Async data loader - side-effect free, state updates in on_axis_change
  async function data_loader(axis, property_key, current_series) {
    load_start = performance.now()
    loading_log = [...loading_log, `⏳ Loading ${properties[property_key].label}...`]

    // Variable delay (200-800ms) to simulate real network conditions
    const delay = 200 + Math.random() * 600
    await new Promise((resolve) => setTimeout(resolve, delay))

    // 5% chance of simulated error
    if (Math.random() < 0.05) {
      error_count++
      throw new Error(`Simulated network error for ${property_key}`)
    }

    // Determine new keys for series build (don't mutate x_key/y_key here)
    const new_x_key = axis === `x` ? property_key : x_key
    const new_y_key = axis === `y` ? property_key : y_key

    const prop = properties[property_key]
    return {
      series: build_series(new_x_key, new_y_key),
      axis_label: `${prop.label} (${prop.unit})`,
    }
  }

  function on_axis_change(axis, property_key) {
    load_count++
    if (axis === `x`) x_key = property_key
    if (axis === `y`) y_key = property_key
    const elapsed = (performance.now() - load_start).toFixed(0)
    loading_log = [
      ...loading_log,
      `✓ Loaded ${properties[property_key].label} (${elapsed}ms)`,
    ]
  }

  function handle_error(err) {
    // err is AxisLoadError: { axis, key, message }
    loading_log = [
      ...loading_log,
      `❌ ${err.axis}-axis error (${err.key}): ${err.message}`,
    ]
  }

  // Axis options from properties
  const axis_options = Object.entries(properties).map(([key, prop]) => ({
    key,
    label: prop.label,
    unit: prop.unit,
  }))
</script>

<p style="margin-bottom: 0.5em; font-size: 0.9em; opacity: 0.85">
  <strong>Stress test:</strong> 240 points across 3 series. Click axis labels to switch
  properties. ~5% of loads will fail to test error recovery.
</p>

<div style="display: flex; gap: 1em; margin-bottom: 0.5em; font-size: 0.8em">
  <span>Loads: <strong>{load_count}</strong></span>
  <span>Errors: <strong style="color: #e74c3c">{error_count}</strong></span>
</div>

<ScatterPlot
  bind:series
  x_axis={{
    label: `${properties[x_key].label} (${properties[x_key].unit})`,
    options: axis_options,
    selected_key: x_key,
  }}
  y_axis={{
    label: `${properties[y_key].label} (${properties[y_key].unit})`,
    options: axis_options,
    selected_key: y_key,
  }}
  {data_loader}
  {on_axis_change}
  on_error={handle_error}
  legend={{ layout: `horizontal`, wrapper_style: `justify-content: center` }}
  style="height: 400px"
/>

<div
  style="margin-top: 0.5em; padding: 0.5em; background: var(--surface-bg-hover, rgba(0, 0, 0, 0.05)); border-radius: 4px; font-size: 0.8em; max-height: 80px; overflow-y: auto; font-family: monospace"
>
  {#each loading_log.slice(-6) as msg}
    <div>{msg}</div>
  {/each}
  {#if loading_log.length === 0}
    <div style="opacity: 0.6">Click an axis label to see loading activity</div>
  {/if}
</div>
```

## Interactive Color Dimension with Dynamic ColorBar

This example demonstrates combining **interactive axis labels** with an **interactive ColorBar** for full 3-axis exploration. The built-in ColorBar supports property and color scale selection via dropdowns. Users can switch:

- **X-axis property** (click x-axis label)
- **Y-axis property** (click y-axis label)
- **Color property** (click ColorBar title/property dropdown)
- **Color scheme** (click ColorBar color scale dropdown)

All changes trigger lazy data loading with simulated network delays.

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'

  // Seeded random for reproducible data
  function seeded_random(seed) {
    let state = seed
    return () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff
      return state / 0x7fffffff
    }
  }

  // Generate correlated materials data
  function generate_data(n_points, base_seed) {
    const rng = seeded_random(base_seed)
    const data = []

    for (let idx = 0; idx < n_points; idx++) {
      const base_density = 2 + rng() * 18
      data.push({
        density: base_density,
        volume: 8 + (20 - base_density) * 2 + rng() * 5,
        formation_energy: -4 + rng() * 8 - base_density * 0.1,
        bandgap: Math.max(0, 5 - base_density * 0.2 + rng() * 3),
        bulk_modulus: 20 + base_density * 10 + rng() * 50,
        thermal_cond: 5 + base_density * 3 + rng() * 30,
      })
    }
    return data
  }

  const n_points = 150
  const all_data = generate_data(n_points, 12345)

  // Property definitions
  const properties = {
    density: { label: `Density`, unit: `g/cm³` },
    volume: { label: `Volume`, unit: `Å³/atom` },
    formation_energy: { label: `Formation Energy`, unit: `eV/atom` },
    bandgap: { label: `Band Gap`, unit: `eV` },
    bulk_modulus: { label: `Bulk Modulus`, unit: `GPa` },
    thermal_cond: { label: `Thermal Cond.`, unit: `W/mK` },
  }

  // Color scale options for ColorBar dropdown
  const color_scale_options = [
    { key: `viridis`, label: `Viridis`, scale: `interpolateViridis` },
    { key: `plasma`, label: `Plasma`, scale: `interpolatePlasma` },
    { key: `inferno`, label: `Inferno`, scale: `interpolateInferno` },
    { key: `turbo`, label: `Turbo`, scale: `interpolateTurbo` },
    { key: `cool`, label: `Cool`, scale: `interpolateCool` },
  ]

  // Build series with color values
  function build_series(x_key, y_key, color_key) {
    const color_vals = all_data.map((d) => d[color_key])
    return [{
      x: all_data.map((d) => d[x_key]),
      y: all_data.map((d) => d[y_key]),
      color_values: color_vals,
      point_style: {
        radius: 5,
        fill_opacity: 0.8,
        stroke: `white`,
        stroke_width: 0.5,
      },
      markers: `points`,
      metadata: all_data.map((d, idx) => ({
        idx,
        ...Object.fromEntries(Object.keys(properties).map((k) => [k, d[k]])),
      })),
    }]
  }

  // Get range for a property
  function get_range(key) {
    const vals = all_data.map((d) => d[key])
    return [Math.min(...vals), Math.max(...vals)]
  }

  // State
  let x_key = $state(`density`)
  let y_key = $state(`formation_energy`)
  let color_key = $state(`bandgap`)
  let color_scale_key = $state(`viridis`)
  let series = $state(build_series(x_key, y_key, color_key))
  let axis_switches = $state(0)
  let color_switches = $state(0)

  // Axis options (for x/y axis dropdowns)
  const axis_options = Object.entries(properties).map(([key, prop]) => ({
    key,
    label: prop.label,
    unit: prop.unit,
  }))

  // Property options for ColorBar (same structure)
  const color_property_options = axis_options

  // Axis data loader - side-effect free, returns data only
  async function axis_data_loader(axis, property_key, current_series) {
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 400))
    const new_x = axis === `x` ? property_key : x_key
    const new_y = axis === `y` ? property_key : y_key
    const prop = properties[property_key]
    return {
      series: build_series(new_x, new_y, color_key),
      axis_label: prop.label,
      axis_unit: prop.unit,
    }
  }

  // Called after successful axis change - safe to update state
  function handle_axis_change(axis, property_key) {
    axis_switches++
    if (axis === `x`) x_key = property_key
    if (axis === `y`) y_key = property_key
  }

  // Returns ColorBar-specific data. Series update handled in on_property_change.
  async function colorbar_data_loader(property_key) {
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 400))
    const prop = properties[property_key]
    const range = get_range(property_key)
    const title = `${prop.label} (${prop.unit})`
    return { range, title }
  }

  // Called after ColorBar successfully loads new property data
  function handle_color_property_change(property_key) {
    color_switches++
    color_key = property_key
    series = build_series(x_key, y_key, property_key)
  }

  // Handle color scale change (no data loading needed, just update scheme)
  function handle_color_scale_change(key) {
    color_scale_key = key
  }

  // Format tooltip value
  function fmt(val) {
    return typeof val === `number` ? val.toFixed(2) : val
  }
</script>

<p style="font-size: 0.9em; opacity: 0.85; margin-bottom: 0.5em">
  <strong>150 points</strong> with 3 interactive dimensions. Click axis labels to switch
  X/Y properties. Click the ColorBar title to switch color property, or the color scale
  dropdown to change the color scheme.
</p>

<div style="display: flex; gap: 1em; font-size: 0.8em; margin-bottom: 0.5em">
  <span>Axis switches: <strong>{axis_switches}</strong></span>
  <span>Color switches: <strong>{color_switches}</strong></span>
</div>

<ScatterPlot
  bind:series
  x_axis={{
    label: `${properties[x_key].label} (${properties[x_key].unit})`,
    options: axis_options,
    selected_key: x_key,
  }}
  y_axis={{
    label: `${properties[y_key].label} (${properties[y_key].unit})`,
    options: axis_options,
    selected_key: y_key,
  }}
  data_loader={axis_data_loader}
  on_axis_change={handle_axis_change}
  color_scale={{
    scheme: color_scale_options.find((o) => o.key === color_scale_key)?.scale ??
      `interpolateViridis`,
  }}
  color_bar={{
    title: `${properties[color_key].label} (${properties[color_key].unit})`,
    property_options: color_property_options,
    selected_property_key: color_key,
    data_loader: colorbar_data_loader,
    on_property_change: handle_color_property_change,
    color_scale_options,
    selected_color_scale_key: color_scale_key,
    on_color_scale_change: handle_color_scale_change,
  }}
  style="height: 450px"
  legend={null}
>
  {#snippet tooltip({ x, y, color_value, metadata })}
    <strong>Point #{metadata.idx + 1}</strong><br>
    {properties[x_key].label}: {fmt(x)}<br>
    {properties[y_key].label}: {fmt(y)}<br>
    {properties[color_key].label}: {fmt(color_value)}
  {/snippet}
</ScatterPlot>
```

## Stress Test: Many Interpolated Fills

This example creates multiple fill regions between series with varying sample densities to stress test the interpolation algorithm:

```svelte example
<script>
  import { ScatterPlot } from 'matterviz'

  // Generate series with different densities and offsets
  const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6']

  const make_series = (n_points, offset, amplitude, color, label) => {
    const step = 20 / (n_points - 1)
    const x_vals = Array.from({ length: n_points }, (_, idx) => idx * step)
    return {
      x: x_vals,
      y: x_vals.map((val) => offset + amplitude * Math.sin(val * 0.5 + offset * 0.2)),
      label,
      point_style: { fill: color, radius: 3 },
      line_style: { stroke: color, stroke_width: 1.5 },
      markers: 'line+points',
    }
  }

  // Create 5 series with different sampling rates
  const all_series = [
    make_series(8, 4, 2, colors[0], '8 pts'),
    make_series(15, 7, 2, colors[1], '15 pts'),
    make_series(25, 10, 2, colors[2], '25 pts'),
    make_series(12, 13, 2, colors[3], '12 pts'),
    make_series(40, 16, 2, colors[4], '40 pts'),
  ]

  // Create fills between each consecutive pair
  const fill_regions = [
    {
      upper: { type: 'series', series_idx: 1 },
      lower: { type: 'series', series_idx: 0 },
      fill: 'rgba(231, 76, 60, 0.25)',
      label: 'Fill 0-1',
      curve: 'monotoneX',
    },
    {
      upper: { type: 'series', series_idx: 2 },
      lower: { type: 'series', series_idx: 1 },
      fill: 'rgba(52, 152, 219, 0.25)',
      label: 'Fill 1-2',
      curve: 'monotoneX',
    },
    {
      upper: { type: 'series', series_idx: 3 },
      lower: { type: 'series', series_idx: 2 },
      fill: 'rgba(46, 204, 113, 0.25)',
      label: 'Fill 2-3',
      curve: 'monotoneX',
    },
    {
      upper: { type: 'series', series_idx: 4 },
      lower: { type: 'series', series_idx: 3 },
      fill: 'rgba(243, 156, 18, 0.25)',
      label: 'Fill 3-4',
      curve: 'monotoneX',
    },
  ]
</script>

Five series with 8, 15, 25, 12, and 40 points respectively. Each fill region interpolates
between adjacent series with different densities:

<ScatterPlot
  series={all_series}
  {fill_regions}
  x_axis={{ label: 'X Value', range: [0, 20] }}
  y_axis={{ label: 'Y Value', range: [0, 20] }}
  style="height: 400px"
  legend={{ layout: 'horizontal', wrapper_style: 'justify-content: center;' }}
/>
```
