`ScatterPlot.svelte`

The `ScatterPlot` component allows you to create interactive scatter plots with various features and configurations.

## Basic Scatter Plot

A simple scatter plot with default settings:

```svelte example stackblitz
<script>
  import { ScatterPlot } from '$lib'

  // Basic single series data
  const basic_data = {
    x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    y: [5, 7, 2, 8, 4, 9, 3, 6, 8, 5],
    point_style: { fill: 'steelblue', radius: 5 }
  }
</script>

<ScatterPlot
  series={[basic_data]}
  x_label="X Axis"
  y_label="Y Value"
  style="height: 300px; width: 100%;"
/>
```

## Multiple Series

Displaying multiple data series with different styling:

```svelte example stackblitz
<script>
  import { ScatterPlot } from '$lib'

  // Multiple series data
  const series_a = {
    x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    y: [5, 7, 2, 8, 4, 9, 3, 6, 8, 5],
    point_style: { fill: 'steelblue', radius: 4 }
  }

  const series_b = {
    x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    y: [2, 4, 6, 3, 7, 5, 8, 4, 6, 9],
    point_style: { fill: 'orangered', radius: 4 }
  }
</script>

<ScatterPlot
  series={[series_a, series_b]}
  x_label="X Axis"
  y_label="Y Value"
  markers="line+points"
  style="height: 300px; width: 100%;"
/>
```

## Display Modes

ScatterPlot supports different marker modes: `points`, `line`, or `line+points`:

```svelte example stackblitz
<script>
  import { ScatterPlot } from '$lib'

  // Data for display modes
  const data = {
    x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    y: [5, 7, 2, 8, 4, 9, 3, 6, 8, 5],
    point_style: { fill: 'steelblue', radius: 5 }
  }

  const modes = ['points', 'line', 'line+points']
</script>

<div style="display: flex; flex-direction: column; gap: 1em;">
  {#each modes as mode}
    <div>
      <h3>{mode}</h3>
      <ScatterPlot
        series={[data]}
        markers={mode}
        style="height: 200px; width: 100%;"
      />
    </div>
  {/each}
</div>
```

## Custom Tick Intervals

You can specify custom tick intervals using negative values for `x_ticks` and `y_ticks`:

```svelte example stackblitz
<script>
  import { ScatterPlot } from '$lib'

  // Data with wider range for tick demonstration
  const data = {
    x: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50],
    y: [0, 25, 10, 35, 20, 45, 15, 30, 40, 5, 50],
    point_style: { fill: 'steelblue', radius: 5 }
  }

  // Negative values represent intervals:
  // x_ticks={-10} means "use intervals of 10 units"
  // y_ticks={-5} means "use intervals of 5 units"
</script>

<ScatterPlot
  series={[data]}
  x_ticks={-10}
  y_ticks={-5}
  x_label="X Axis (interval=10)"
  y_label="Y Axis (interval=5)"
  style="height: 300px; width: 100%;"
/>
```

## Negative Values and Custom Limits

ScatterPlot handles negative values and allows setting custom axis limits:

```svelte example stackblitz
<script>
  import { ScatterPlot } from '$lib'

  // Data with negative values
  const data = {
    x: [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50],
    y: [-25, -15, -5, 0, 10, 5, -10, 15, -20, 30, -30],
    point_style: { fill: 'steelblue', radius: 5 }
  }
</script>

<ScatterPlot
  series={[data]}
  x_lim={[-60, 60]}
  y_lim={[-40, 40]}
  x_ticks={-20}
  y_ticks={-10}
  x_label="X Axis"
  y_label="Y Axis"
  style="height: 300px; width: 100%;"
/>
```

## Time-Based Scatter Plot

Using time data on the x-axis with custom formatting:

```svelte example stackblitz
<script>
  import { ScatterPlot } from '$lib'

  // Generate dates for the past 30 days
  const dates = Array.from({ length: 30 }, (_, idx) => {
    const date = new Date()
    date.setDate(date.getDate() - (30 - idx))
    return date.getTime()
  })

  // Random data values
  const values = Array.from({ length: 30 }, () => Math.random() * 100)

  const time_data = {
    x: dates,
    y: values,
    point_style: { fill: 'steelblue', radius: 4 }
  }
</script>

<ScatterPlot
  series={[time_data]}
  markers="line+points"
  x_format="%b %d"
  x_ticks={-7}
  y_ticks={-10}
  x_label="Date"
  y_label="Value"
  style="height: 300px; width: 100%;"
/>
```

## Multiple Series with Custom Tooltips

Demonstrating custom tooltips with multiple series:

```svelte example stackblitz
<script>
  import { ScatterPlot } from '$lib'

  // Multiple series with metadata
  const series_a = {
    x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    y: [5, 7, 2, 8, 4, 9, 3, 6, 8, 5],
    point_style: { fill: 'steelblue', radius: 5 },
    metadata: Array.from({ length: 10 }, (_, idx) => ({ name: `Point A${idx+1}`, series: 'Series A' }))
  }

  const series_b = {
    x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    y: [2, 4, 6, 3, 7, 5, 8, 4, 6, 9],
    point_style: { fill: 'orangered', radius: 5 },
    metadata: Array.from({ length: 10 }, (_, idx) => ({ name: `Point B${idx+1}`, series: 'Series B' }))
  }

  let selected_point = null
</script>

<ScatterPlot
  series={[series_a, series_b]}
  x_label="X Value"
  y_label="Y Value"
  markers="line+points"
  change={(event) => (selected_point = event)}
  style="height: 300px; width: 100%;"
  tooltip={({ x, y, metadata }) => `
    <div style="background: rgba(0,0,0,0.7); padding: 0.5em; border-radius: 4px;">
      <strong>${metadata?.name || 'Point'}</strong><br />
      Series: ${metadata?.series || 'Unknown'}<br />
      X: ${x}, Y: ${y}
    </div>
  `}
/>

{#if selected_point}
  <div style="margin-top: 1em; padding: 0.5em; border: 1px solid #ccc; border-radius: 4px;">
    Selected point: (${selected_point.x}, ${selected_point.y})
    {#if selected_point.metadata}
      - ${selected_point.metadata.name} from ${selected_point.metadata.series}
    {/if}
  </div>
{/if}
```

## Complete Feature Demo

This example combines various features of the ScatterPlot component:

```svelte example stackblitz
<script>
  import { ScatterPlot } from '$lib'

  // Generate some complex data
  function generate_data(count, x_min, x_max, y_callback, metadata_gen) {
    const x_values = Array.from({ length: count }, (_, idx) =>
      x_min + (x_max - x_min) * (idx / (count - 1))
    )

    const y_values = x_values.map(y_callback)

    return {
      x: x_values,
      y: y_values,
      metadata: metadata_gen ? x_values.map((x, idx) => metadata_gen(x, y_values[idx], idx)) : undefined
    }
  }

  // Create three different series
  const sine_data = {
    ...generate_data(
      50, -10, 10,
      x => Math.sin(x) * 5,
      (x, y, idx) => ({ type: 'sine', index: idx })
    ),
    point_style: { fill: 'rgb(65, 105, 225)', radius: 3 }
  }

  const cosine_data = {
    ...generate_data(
      50, -10, 10,
      x => Math.cos(x) * 5,
      (x, y, idx) => ({ type: 'cosine', index: idx })
    ),
    point_style: { fill: 'rgb(220, 20, 60)', radius: 3 }
  }

  const linear_data = {
    ...generate_data(
      20, -10, 10,
      x => x * 0.5,
      (x, y, idx) => ({ type: 'linear', index: idx })
    ),
    point_style: { fill: 'rgb(50, 205, 50)', radius: 4 }
  }

  let display_mode = 'line+points'
  let x_tick_interval = -2
  let y_tick_interval = -1
</script>

<div style="margin-bottom: 1em;">
  <label>
    Display Mode:
    <select bind:value={display_mode}>
      <option value="points">Points only</option>
      <option value="line">Lines only</option>
      <option value="line+points">Lines and Points</option>
    </select>
  </label>

  <label style="margin-left: 1em;">
    X-Tick Interval:
    <select bind:value={x_tick_interval}>
      <option value={-1}>1 unit</option>
      <option value={-2}>2 units</option>
      <option value={-5}>5 units</option>
    </select>
  </label>

  <label style="margin-left: 1em;">
    Y-Tick Interval:
    <select bind:value={y_tick_interval}>
      <option value={-1}>1 unit</option>
      <option value={-2}>2 units</option>
      <option value={-5}>5 units</option>
    </select>
  </label>
</div>

<ScatterPlot
  series={[sine_data, cosine_data, linear_data]}
  markers={display_mode}
  x_ticks={x_tick_interval}
  y_ticks={y_tick_interval}
  x_lim={[-12, 12]}
  y_lim={[-6, 6]}
  x_label="X Axis"
  y_label="Y Axis"
  style="height: 400px; width: 100%;"
  tooltip={({ x, y, metadata }) => `
    <div style="background: rgba(0,0,0,0.8); color: white; padding: 0.5em; border-radius: 4px;">
      <strong>${metadata?.type || 'Point'} #${metadata?.index ?? ''}</strong><br />
      (${x.toFixed(2)}, ${y.toFixed(2)})
    </div>
  `}
/>
```

## Points with Shared Coordinates

This example demonstrates how points that share the same X or Y coordinates can still be individually hovered:

```svelte example stackblitz
<script>
  import { ScatterPlot } from '$lib'

  // Create points with shared X or Y coordinates
  const shared_coords_data = {
    // Points with same X values (vertical line)
    x: [5, 5, 5, 5, 5,
    // Points with same Y values (horizontal line)
       1, 2, 3, 4, 5,
    // Some random points
       7, 8, 9, 7, 9],
    y: [1, 2, 3, 4, 5,
       3, 3, 3, 3, 3,
       1, 2, 3, 4, 5],
    point_style: { fill: 'steelblue', radius: 6 },
    // Add distinct metadata for each point to identify them
    metadata: [
      // Vertical line points
      {id: 'v1', label: 'V1 (5,1)'}, {id: 'v2', label: 'V2 (5,2)'},
      {id: 'v3', label: 'V3 (5,3)'}, {id: 'v4', label: 'V4 (5,4)'},
      {id: 'v5', label: 'V5 (5,5)'},
      // Horizontal line points
      {id: 'h1', label: 'H1 (1,3)'}, {id: 'h2', label: 'H2 (2,3)'},
      {id: 'h3', label: 'H3 (3,3)'}, {id: 'h4', label: 'H4 (4,3)'},
      {id: 'h5', label: 'H5 (5,3)'},
      // Random points
      {id: 'r1', label: 'R1 (7,1)'}, {id: 'r2', label: 'R2 (8,2)'},
      {id: 'r3', label: 'R3 (9,3)'}, {id: 'r4', label: 'R4 (7,4)'},
      {id: 'r5', label: 'R5 (9,5)'}
    ]
  }

  let hovered_point = null;
</script>

<ScatterPlot
  series={[shared_coords_data]}
  x_lim={[0, 10]}
  y_lim={[0, 6]}
  x_ticks={1}
  y_ticks={1}
  x_label="X Axis"
  y_label="Y Axis"
  change={(event) => (hovered_point = event)}
  tooltip={({ x, y, metadata }) => `
    <div style="background: rgba(0,0,0,0.8); color: white; padding: 0.5em; border-radius: 4px; max-width: 200px;">
      <strong>${metadata?.label || 'Point'}</strong><br />
      Coordinates: (${x}, ${y})<br />
      ID: ${metadata?.id || 'unknown'}
    </div>
  `}
  style="height: 350px; width: 100%;"
/>

{#if hovered_point}
  <div style="margin-top: 1em; padding: 0.5em; border: 1px solid #ccc; border-radius: 4px;">
    <strong>Currently hovering:</strong> {hovered_point.metadata?.label || 'Unknown point'} at ({hovered_point.x}, {hovered_point.y})
  </div>
{/if}
```
