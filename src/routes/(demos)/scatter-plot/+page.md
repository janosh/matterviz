The `ScatterPlot` component creates versatile interactive scatter plots.

## Basic Plot with Multiple Display Modes

A simple scatter plot showing different display modes (points, lines, or both):

```svelte example stackblitz
<script>
  import { ScatterPlot } from '$lib'

  // Basic single series data
  const basic_data = {
    x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    y: [5, 7, 2, 8, 4, 9, 3, 6, 8, 5],
    point_style: { fill: 'steelblue', radius: 5 }
  }

  // Multiple series data
  const second_series = {
    x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    y: [2, 4, 6, 3, 7, 5, 8, 4, 6, 9],
    point_style: { fill: 'orangered', radius: 4 }
  }

  // Currently selected display mode
  let display_mode = 'line+points'
</script>

<div>
  <div style="margin-bottom: 1em;">
    <label>
      Display Mode:
      <select bind:value={display_mode}>
        <option value="points">Points only</option>
        <option value="line">Lines only</option>
        <option value="line+points">Lines and Points</option>
      </select>
    </label>
  </div>

  <ScatterPlot
    series={[basic_data, second_series]}
    x_label="X Axis"
    y_label="Y Value"
    markers={display_mode}
    style="height: 300px; width: 100%;"
  />
</div>
```

## Custom Point Styling and Tooltips

Demonstrate various point styles, custom tooltips, and hover effects:

```svelte example stackblitz
<script>
  import { ScatterPlot } from '$lib'

  // Generate data for demonstration
  const point_count = 10
  const x_values = Array.from({ length: point_count }, (_, idx) => idx + 1)

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
        stroke_width: 3
      },
      point_hover: {
        scale: 1.3,
        stroke: 'gold',
        stroke_width: 4
      },
      point_label: {
        text: 'Giant red',
        offset_y: -20,
        font_size: '12px'
      }
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
        stroke_width: 1
      },
      point_hover: {
        scale: 2.5, // Much larger on hover
        stroke: 'lime',
        stroke_width: 2
      },
      point_label: {
        text: 'Growing green',
        offset_y: -20,
        font_size: '12px'
      }
    },
    // Outline-only points (hollow) with color change on hover
    {
      x: x_values,
      y: Array(point_count).fill(6),
      point_style: {
        fill: 'white',
        fill_opacity: 0.1,
        radius: 6,
        stroke: 'purple',
        stroke_width: 2
      },
      point_hover: {
        scale: 1.8,
        stroke: 'magenta', // Different color on hover
        stroke_width: 3
      },
      point_label: {
        text: 'Color-changing hollow',
        offset_y: -20,
        font_size: '12px'
      }
    },
    // Tiny points with extreme hover growth
    {
      x: x_values,
      y: Array(point_count).fill(4),
      point_style: {
        fill: 'orange',
        radius: 3
      },
      point_hover: {
        scale: 4, // Extreme growth on hover
        stroke: 'red',
        stroke_width: 2
      },
      point_label: {
        text: 'Exploding dots',
        offset_y: -20,
        font_size: '12px'
      }
    },
    // Micro dots with custom glow effect
    {
      x: x_values,
      y: Array(point_count).fill(2),
      point_style: {
        fill: 'dodgerblue',
        radius: 1.5, // Extremely small
        stroke: 'transparent',
        stroke_width: 0
      },
      point_hover: {
        scale: 6, // Dramatic growth
        stroke: 'cyan',
        stroke_width: 8 // Creates a glow effect
      },
      point_label: {
        text: 'Glowing microdots',
        offset_y: -20,
        font_size: '12px'
      }
    }
  ]

  // Only show labels for the first point in each series
  series_with_styles.forEach((series, series_idx) => {
    // Create a metadata array with empty objects except for the first one
    series.metadata = Array(point_count).fill({}).map((_, idx) => {
      return idx === 0 ? { firstPoint: true, seriesName: series.point_label.text } : {};
    });

    // Only show label on the first point of each series
    if (series.point_label) {
      // ScatterPoint doesn't accept functions for the text property,
      // so we'll clear the text for all points and manually handle
      // the first point label with metadata
      series.point_label.text = '';
    }
  });

  // Selected point tracking for demo
  let selected_point = null
</script>

<ScatterPlot
  series={series_with_styles}
  x_label="X Axis"
  y_label="Point Style Examples"
  y_lim={[0, 12]}
  markers="points"
  change={(event) => (selected_point = event)}
  style="height: 400px; width: 100%;"
>
  {#snippet tooltip({ x, y, metadata })}
    <div style="white-space: nowrap;">
      {#if metadata?.firstPoint}
        <strong>{metadata.seriesName}</strong>
      {:else}
        Point at ({x}, {y})
      {/if}
    </div>
  {/snippet}
</ScatterPlot>

{#if selected_point}
  <div style="margin-top: 1em; padding: 0.5em; border: 1px solid #ccc; border-radius: 4px;">
    Selected point: ({selected_point.x}, {selected_point.y})
    {#if selected_point.metadata?.firstPoint}
      - {selected_point.metadata.seriesName}
    {/if}
  </div>
{/if}
```

## Per-Point Custom Styling with Marker Symbols

This example demonstrates how to apply different styles to individual points within a single series, including different marker symbols:

```svelte example stackblitz
<script>
  import { ScatterPlot } from '$lib'

  // Create a dataset with points arranged in a spiral pattern
  const point_count = 40;
  const spiral_data = {
    x: [],
    y: [],
    point_style: [], // Array of styles for each point
    metadata: []     // Store angle for each point
  };

  // Generate points in a spiral pattern
  for (let idx = 0; idx < point_count; idx++) {
    // Calculate angle and radius for spiral
    const angle = idx * 0.5;
    const radius = 1 + idx * 0.3;

    // Convert to cartesian coordinates
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;

    spiral_data.x.push(x);
    spiral_data.y.push(y);

    // Store angle in metadata
    spiral_data.metadata.push({ angle, radius });

    // Create unique style for each point
    // Change color gradually along the spiral
    const hue = (idx / point_count) * 360;

    // Change size dramatically from tiny to huge
    const size_factor = 1 + idx / 5; // More aggressive size increase

    // Alternate marker types
    const marker_types = ['circle', 'diamond', 'star', 'triangle', 'cross', 'wye'];
    const marker_idx = idx % marker_types.length;

    // Create the point style
    spiral_data.point_style.push({
      fill: `hsl(${hue}, 80%, 50%)`,
      radius: 1 + size_factor * 3, // Much larger variation in size
      stroke: 'white',
      stroke_width: 1 + idx / 20, // Gradually thicker stroke
      marker_type: marker_types[marker_idx],
      marker_size: 20 + size_factor * 25 // More dramatic size progression
    });
  }
</script>

<ScatterPlot
  series={[spiral_data]}
  x_label="X Axis"
  y_label="Y Axis"
  x_lim={[-15, 15]}
  y_lim={[-15, 15]}
  markers="points"
  style="height: 500px; width: 100%;"
>
  {#snippet tooltip({ x, y, metadata })}
    <div style="white-space: nowrap;">
      <strong>Spiral Point</strong><br>
      Position: ({x.toFixed(2)}, {y.toFixed(2)})<br>
      Angle: {metadata.angle.toFixed(2)} rad<br>
      Radius: {metadata.radius.toFixed(2)}
    </div>
  {/snippet}
</ScatterPlot>
```

## Categorized Data and Custom Axis Tick Intervals

This example shows categorized data with color coding, custom tick intervals, and demonstrates handling negative values:

```svelte example stackblitz
<script>
  import { ScatterPlot } from '$lib'

  // Define categories
  const categories = ['Category A', 'Category B', 'Category C', 'Category D'];

  // Define colors for each category
  const category_colors = [
    'crimson',
    'royalblue',
    'goldenrod',
    'mediumseagreen'
  ];

  // Generate sample data points with categories
  const sample_count = 40;
  const sample_data = Array(sample_count).fill(0).map(() => {
    const category_idx = Math.floor(Math.random() * categories.length);
    // Generate points across positive and negative coordinate space
    return {
      x: (Math.random() * 20) - 10, // Range from -10 to 10
      y: (Math.random() * 20) - 10, // Range from -10 to 10
      category: categories[category_idx],
      color: category_colors[category_idx]
    }
  });

  // Group data by category to create series
  const series_data = categories.map((category, idx) => {
    const points = sample_data.filter(d => d.category === category);

    return {
      x: points.map(p => p.x),
      y: points.map(p => p.y),
      point_style: {
        fill: category_colors[idx],
        radius: 6 - idx, // Size varies by category
        stroke: 'black',
        stroke_width: 0.5
      },
      metadata: points.map(p => ({
        category: p.category,
        color: p.color
      }))
    };
  });

  // Tick interval settings
  let x_tick_interval = -5;
  let y_tick_interval = -5;
</script>

<div>
  <div style="margin-bottom: 1em;">
    <label>
      X-Tick Interval:
      <select bind:value={x_tick_interval}>
        <option value={-2}>2 units</option>
        <option value={-5}>5 units</option>
        <option value={-10}>10 units</option>
      </select>
    </label>
    <label style="margin-left: 1em;">
      Y-Tick Interval:
      <select bind:value={y_tick_interval}>
        <option value={-2}>2 units</option>
        <option value={-5}>5 units</option>
        <option value={-10}>10 units</option>
      </select>
    </label>
  </div>

  <ScatterPlot
    series={series_data}
    x_label="X Value"
    y_label="Y Value"
    x_lim={[-15, 15]}
    y_lim={[-15, 15]}
    x_ticks={x_tick_interval}
    y_ticks={y_tick_interval}
    markers="points"
    style="height: 400px; width: 100%;"
  >
    {#snippet tooltip({ x, y, metadata })}
      <div style="white-space: nowrap;">
        <span style="color: {metadata.color};">●</span>
        <strong>{metadata.category}</strong><br>
        Position: ({x.toFixed(2)}, {y.toFixed(2)})
      </div>
    {/snippet}
  </ScatterPlot>

  <!-- Legend -->
  <div style="display: flex; justify-content: center; margin-top: 1em;">
    {#each categories as category, idx}
      <div style="margin: 0 1em; display: flex; align-items: center;">
        <span style="display: inline-block; width: 12px; height: 12px; background: {category_colors[idx]}; border-radius: 50%; margin-right: 0.5em;"></span>
        {category}
      </div>
    {/each}
  </div>
</div>
```

## Time-Based Data with Custom Formatting

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

  // Random data values for multiple series
  const values1 = Array.from({ length: 30 }, () => Math.random() * 100)
  const values2 = Array.from({ length: 30 }, () => Math.random() * 70 + 30)

  const time_series = [
    {
      x: dates,
      y: values1,
      point_style: { fill: 'steelblue', radius: 4 },
      metadata: Array.from({ length: 30 }, (_, idx) => ({ series: 'Series A', day: idx }))
    },
    {
      x: dates,
      y: values2,
      point_style: { fill: 'orangered', radius: 4 },
      metadata: Array.from({ length: 30 }, (_, idx) => ({ series: 'Series B', day: idx }))
    }
  ]

  // Format options
  let date_format = '%b %d';
  let y_format = '.1f';
</script>

<div>
  <div style="margin-bottom: 1em;">
    <label>
      Date Format:
      <select bind:value={date_format}>
        <option value="%b %d">Month Day (Jan 01)</option>
        <option value="%Y-%m-%d">YYYY-MM-DD</option>
        <option value="%d/%m">DD/MM</option>
      </select>
    </label>
    <label style="margin-left: 1em;">
      Y-Value Format:
      <select bind:value={y_format}>
        <option value=".1f">1 decimal</option>
        <option value=".2f">2 decimals</option>
        <option value="d">Integer</option>
      </select>
    </label>
  </div>

  <ScatterPlot
    series={time_series}
    markers="line+points"
    x_format={date_format}
    {y_format}
    x_ticks={-7}
    y_ticks={5}
    x_label="Date"
    y_label="Value"
    style="height: 350px; width: 100%;"
  >
    {#snippet tooltip({ x, y, x_formatted, y_formatted, metadata })}
      <div style="white-space: nowrap;">
        <strong>{metadata?.series}</strong><br />
        Date: {x_formatted}<br />
        Value: {y_formatted}
      </div>
    {/snippet}
  </ScatterPlot>
</div>
```

## Points with Shared Coordinates

This example demonstrates how points with identical coordinates can still be individually identified and interacted with:

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
  style="height: 350px; width: 100%;"
>
  {#snippet tooltip({ x, y, metadata })}
    {@const { label, id } = metadata}
    <div style="white-space: nowrap;">
      <strong>{label}</strong><br />
      Coordinates: ({x}, {y})<br />
      ID: {id}
    </div>
  {/snippet}
</ScatterPlot>

{#if hovered_point}
  <div style="margin-top: 1em; padding: 0.5em; border: 1px solid #ccc; border-radius: 4px;">
    <strong>Currently hovering:</strong> {hovered_point.metadata?.label || 'Unknown point'} at ({hovered_point.x}, {hovered_point.y})
  </div>
{/if}
```

## Text Annotations for Scatter Points

This example shows how to add permanent text labels to your scatter points:

```svelte example stackblitz
<script>
  import { ScatterPlot } from '$lib'

  // Data with text labels
  const data = {
    x: [1, 3, 5, 7, 9],
    y: [2, 5, 3, 7, 4],
    point_style: { fill: 'steelblue', radius: 6 },
    // Add text labels to each point
    point_label: [
      { text: 'Point A', offset_y: -15 },
      { text: 'Point B', offset_y: 15 },
      { text: 'Point C', offset_y: -15 },
      { text: 'Point D', offset_y: -15 },
      { text: 'Point E', offset_y: 15 }
    ]
  }
</script>

<ScatterPlot
  series={[data]}
  x_label="X Axis"
  y_label="Y Axis"
  x_lim={[0, 10]}
  y_lim={[0, 10]}
  markers="points"
  style="height: 350px; width: 100%;"
/>
```

### Different Label Positions

You can position labels in different directions relative to each point:

```svelte example stackblitz
<script>
  import { ScatterPlot } from '$lib'

  const position_data = {
    x: [5, 5, 5, 5, 5],
    y: [1, 2, 3, 4, 5],
    point_style: { fill: 'goldenrod', radius: 5 },
    // Different positions for labels
    point_label: [
      { text: 'Above', offset_y: -15, offset_x: 0 },
      { text: 'Right', offset_x: 15, offset_y: 0 },
      { text: 'Below', offset_y: 15, offset_x: 0 },
      { text: 'Left', offset_x: -30, offset_y: 0 },
      { text: 'Diagonal', offset_x: 10, offset_y: -10 }
    ]
  }
</script>

<ScatterPlot
  series={[position_data]}
  x_label="X Axis"
  y_label="Y Axis"
  x_lim={[0, 10]}
  y_lim={[0, 6]}
  markers="points"
  style="height: 350px; width: 100%;"
/>
```

### Example Code

Here's how to add text annotations to your scatter points:

```js
// Data with text labels
const data = {
  x: [1, 3, 5, 7, 9],
  y: [2, 5, 3, 7, 4],
  point_style: {
    fill: 'steelblue',
    radius: 6,
  },
  // Add text labels to each point
  point_label: [
    { text: 'Point A', offset_y: -15, font_size: '14px' },
    { text: 'Point B', offset_y: -15, font_size: '14px' },
    { text: 'Point C', offset_y: -15, font_size: '14px' },
    { text: 'Point D', offset_y: -15, font_size: '14px' },
    { text: 'Point E', offset_y: -15, font_size: '14px' },
  ],
}
```

## Log-Scaled Axes

ScatterPlot supports logarithmic scaling for data that spans multiple orders of magnitude.

### X-Axis Log Scale

Visualize exponential growth or data with large ranges on the X-axis:

```svelte example stackblitz
<script>
  import { ScatterPlot } from '$lib'

  // Create data with exponential growth on x-axis
  const x_log_data = {
    x: [0.1, 0.5, 1, 5, 10, 50, 100, 500, 1000, 5000],
    y: [10, 20, 25, 35, 40, 50, 55, 65, 70, 80],
    point_style: { fill: 'steelblue', radius: 6 },
    point_label: [
      { text: '0.1', offset_y: -15 },
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      { text: '5000', offset_y: -15 }
    ]
  }
</script>

<div>
  <h3>Exponential X-Axis Data (Log Scale)</h3>
  <p>
    Notice how equally spaced values on a log scale represent equal ratios rather than equal intervals.
    The distance from 1 to 10 is the same as 10 to 100.
  </p>
  <ScatterPlot
    series={[x_log_data]}
    x_scale_type="log"
    y_scale_type="linear"
    x_label="Log-Scaled X Axis"
    y_label="Linear Y Axis"
    markers="line+points"
    style="height: 350px; width: 100%;"
  />
</div>
```

### Y-Axis Log Scale

Perfect for data with exponential growth on the Y-axis:

```svelte example stackblitz
<script>
  import { ScatterPlot } from '$lib'

  // Create data with exponential growth on y-axis
  const y_log_data = {
    x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    y: [1, 3, 10, 30, 100, 300, 1000, 3000, 10000, 30000],
    point_style: { fill: 'orangered', radius: 6 },
    point_label: [
      { text: '1', offset_x: 15 },
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      { text: '30,000', offset_x: 15 }
    ]
  }
</script>

<div>
  <h3>Exponential Y-Axis Data (Log Scale)</h3>
  <p>
    Y-axis log scaling makes it easy to visualize data that grows exponentially or spans many orders of magnitude.
    Percentage growth appears as straight lines on a log scale.
  </p>
  <ScatterPlot
    series={[y_log_data]}
    x_scale_type="linear"
    y_scale_type="log"
    x_label="Linear X Axis"
    y_label="Log-Scaled Y Axis"
    y_format="~s"
    markers="line+points"
    style="height: 350px; width: 100%;"
  />
</div>
```

### Both Axes Log-Scaled

For comparing data across multiple orders of magnitude on both axes:

```svelte example stackblitz
<script>
  import { ScatterPlot } from '$lib'

  // Generate power law relationship data (y = x^2)
  const power_law_data = {
    x: [],
    y: [],
    point_style: { fill: 'mediumseagreen', radius: 5 }
  }

  // Add points from 0.1 to 1000 with exponential spacing
  for (let i = -1; i <= 3; i += 0.25) {
    const x = Math.pow(10, i);
    const y = Math.pow(x, 2);  // y = x^2 (power law relationship)
    power_law_data.x.push(x);
    power_law_data.y.push(y);
  }

  // Add another series with a different power law (y = x^0.5)
  const inverse_power_data = {
    x: [],
    y: [],
    point_style: { fill: 'purple', radius: 5 }
  }

  // Similar range but with y = sqrt(x)
  for (let i = -1; i <= 3; i += 0.25) {
    const x = Math.pow(10, i);
    const y = Math.pow(x, 0.5);  // y = √x (square root relationship)
    inverse_power_data.x.push(x);
    inverse_power_data.y.push(y);
  }
</script>

<div>
  <h3>Power Law Relationships (Both Axes Log-Scaled)</h3>
  <p>
    Log-log plots are ideal for power law relationships. A straight line on a log-log plot
    indicates a power law relationship (y = x^n), with the slope indicating the exponent.
  </p>

  <div style="display: flex; justify-content: center; margin-bottom: 1em;">
    <div style="margin: 0 1em; display: flex; align-items: center;">
      <span style="display: inline-block; width: 12px; height: 12px; background: mediumseagreen; border-radius: 50%; margin-right: 0.5em;"></span>
      y = x<sup>2</sup>
    </div>
    <div style="margin: 0 1em; display: flex; align-items: center;">
      <span style="display: inline-block; width: 12px; height: 12px; background: purple; border-radius: 50%; margin-right: 0.5em;"></span>
      y = x<sup>0.5</sup>
    </div>
  </div>

  <ScatterPlot
    series={[power_law_data, inverse_power_data]}
    x_scale_type="log"
    y_scale_type="log"
    x_label="x (log scale)"
    y_label="y (log scale)"
    x_format="~s"
    y_format="~s"
    markers="line+points"
    style="height: 400px; width: 100%;"
  />
</div>
```

### Scientific Data with Log Scale

This example demonstrates a real-world use case with scientific data spanning many orders of magnitude:

```svelte example stackblitz
<script>
  import { ScatterPlot } from '$lib'

  // Typical particle size distribution data
  const particle_data = {
    // Particle size in micrometers (µm) - using non-powers of 10 to test gridlines
    x: [0.17, 0.42, 0.83, 1.3, 2.7, 4.9, 8.6, 23.4, 47.8, 93.2, 187, 422, 876],
    // Number of particles detected - also using non-power-of-10 values
    y: [58423, 32756, 12384, 6290, 2745, 1372, 687, 253, 124, 63, 31, 8, 2],
    point_style: {
      fill: 'royalblue',
      radius: 6,
      stroke: 'darkblue',
      stroke_width: 1
    },
    point_hover: {
      scale: 1.5,
      stroke: 'white',
      stroke_width: 2
    }
  }

  let hover_point = null;
</script>

<div>
  <h3>Particle Size Distribution (Log-Log Plot)</h3>
  <p>
    Scientists often use log-log plots for data spanning multiple orders of magnitude.
    This example shows a particle size distribution from 0.1µm to 1000µm (1mm).
  </p>

  <ScatterPlot
    series={[particle_data]}
    x_scale_type="log"
    y_scale_type="log"
    x_label="Particle Size (µm)"
    y_label="Particle Count"
    x_format="~s"
    y_format="~s"
    markers="line+points"
    style="height: 400px; width: 100%;"
    change={(point) => hover_point = point}
  >
    {#snippet tooltip({ x, y, x_formatted, y_formatted })}
      <div style="white-space: nowrap;">
        <strong>Particle Data</strong><br />
        Size: {x_formatted} µm<br />
        Count: {y_formatted} particles
      </div>
    {/snippet}
  </ScatterPlot>

  {#if hover_point}
    <div style="margin-top: 1em; text-align: center;">
      A particle size of {hover_point.x.toFixed(1)} µm corresponds to {hover_point.y.toFixed(0)} particles
    </div>
  {/if}
</div>
```

## Combined Interactive Scatter Plot with Custom Controls

This example combines multiple features including different display modes, custom styling, various marker types, interactive controls for axis customization, and hover styling. It demonstrates the new grid customization options with independent X and Y grid controls and custom grid styling:

```svelte example stackblitz
<script>
  import { ScatterPlot } from '$lib'

  // Define categories and colors for data points
  const categories = ['Group A', 'Group B', 'Group C']
  const category_colors = ['crimson', 'royalblue', 'mediumseagreen']

  // Generate sample data with categories and different marker types
  const marker_types = ['circle', 'diamond', 'star', 'triangle', 'cross', 'wye']

  // Create three data series with different styling
  const series_data = categories.map((category, cat_idx) => {
    const points = 10
    return {
      x: Array.from({ length: points }, (_, idx) => idx + 1),
      y: Array.from({ length: points }, () => 3 + cat_idx * 3 + Math.random() * 2),
      point_style: Array.from({ length: points }, (_, idx) => ({
        fill: category_colors[cat_idx],
        radius: 6 - cat_idx,
        stroke: 'black',
        stroke_width: 0.5,
        marker_type: marker_types[idx % marker_types.length],
        marker_size: 15 + cat_idx * 5
      })),
      metadata: Array.from({ length: points }, (_, idx) => ({
        category,
        color: category_colors[cat_idx],
        marker: marker_types[idx % marker_types.length],
        idx
      }))
    }
  })

  // Currently selected display mode
  let display_mode = 'line+points'

  // Toggle series visibility
  let visible_series = {
    [categories[0]]: true,
    [categories[1]]: true,
    [categories[2]]: true
  }

  // Controls for random data points
  let x_tick_interval = -5
  let y_tick_interval = -5

  // Grid controls
  let x_grid = true
  let y_grid = true
  let grid_color = 'gray'
  let grid_width = 0.4
  let grid_dash = '4'

  // Custom axis labels
  let x_axis_label = "X Axis"
  let y_axis_label = "Y Value"

  // Selected point tracking
  let selected_point = null

  // Update series based on visibility toggles
  $: displayed_series = series_data.filter((_, idx) =>
    visible_series[categories[idx]])

  // Generate random data points across positive and negative space
  const sample_count = 40
  const sample_data = {
    x: Array(sample_count).fill(0).map(() => (Math.random() * 20) - 10),
    y: Array(sample_count).fill(0).map(() => (Math.random() * 20) - 10),
    point_style: {
      fill: 'goldenrod',
      radius: 5,
      stroke: 'black',
      stroke_width: 0.5
    },
    point_hover: {
      scale: 2,
      fill: 'orange',
      stroke: 'white',
      stroke_width: 2
    }
  }
</script>

<div>
  <h3>Interactive Multi-Series Plot</h3>
  <div style="margin-bottom: 1em;">
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
  </div>

  <ScatterPlot
    series={displayed_series}
    x_label={x_axis_label}
    y_label={y_axis_label}
    markers={display_mode}
    change={(event) => (selected_point = event)}
    style="height: 400px; width: 100%;"
  >
    {#snippet tooltip({ x, y, metadata })}
      <div style="white-space: nowrap;">
        <span style="color: {metadata.color};">●</span>
        <strong>{metadata.category}</strong><br>
        Point {metadata.idx + 1} ({x}, {y.toFixed(2)})<br>
        Marker: {metadata.marker}
      </div>
    {/snippet}
  </ScatterPlot>

  {#if selected_point}
    <div style="margin-top: 1em; padding: 0.5em; border: 1px solid #ccc; border-radius: 4px;">
      Selected point: ({selected_point.x}, {selected_point.y.toFixed(2)}) from {selected_point.metadata.category}
    </div>
  {/if}

  <h3 style="margin-top: 2em;">Random Points with Custom Controls</h3>
  <div style="margin-bottom: 1em; display: flex; flex-wrap: wrap; gap: 1em;">
    <label>
      X-Tick Interval:
      <select bind:value={x_tick_interval}>
        <option value={-2}>2 units</option>
        <option value={-5}>5 units</option>
        <option value={-10}>10 units</option>
      </select>
    </label>

    <label>
      Y-Tick Interval:
      <select bind:value={y_tick_interval}>
        <option value={-2}>2 units</option>
        <option value={-5}>5 units</option>
        <option value={-10}>10 units</option>
      </select>
    </label>

    <label>
      <input type="checkbox" bind:checked={x_grid} />
      X Grid
    </label>

    <label>
      <input type="checkbox" bind:checked={y_grid} />
      Y Grid
    </label>


    <label>
      Grid Color:
      <select bind:value={grid_color}>
        <option value="gray">Gray</option>
        <option value="lightgray">Light Gray</option>
        <option value="darkgray">Dark Gray</option>
        <option value="#aaaaaa">#aaa</option>
      </select>
    </label>

    <label>
      X-Axis Label:
      <input type="text" bind:value={x_axis_label} style="width: 120px" />
    </label>

    <label>
      Y-Axis Label:
      <input type="text" bind:value={y_axis_label} style="width: 120px" />
    </label>
  </div>

  <ScatterPlot
    series={[sample_data]}
    x_label={x_axis_label}
    y_label={y_axis_label}
    x_lim={[-15, 15]}
    y_lim={[-15, 15]}
    x_ticks={x_tick_interval}
    y_ticks={y_tick_interval}
    {x_grid}
    {y_grid}
    markers="points"
    style="height: 400px; width: 100%;"
  >
    {#snippet tooltip({ x, y })}
      <div style="white-space: nowrap;">
        Position: ({x.toFixed(2)}, {y.toFixed(2)})
      </div>
    {/snippet}
  </ScatterPlot>
</div>
```

## Color Scaling with Linear and Log Modes

This example demonstrates how to use `color_values` to apply color mapping to points based on data values, and toggle between linear and log color scales:

```svelte example stackblitz
<script>
  import { ScatterPlot } from '$lib'

  // Create data with exponentially increasing values
  const make_exponential_data = (size, base = 2) => {
    return {
      x: Array.from({ length: size }, (_, idx) => idx + 1),
      y: Array.from({ length: size }, (_, idx) => idx + 1),
      // Exponential distribution of values (1, 2, 4, 8, 16, 32, etc. for base 2)
      color_values: Array.from({ length: size }, (_, idx) => Math.pow(base, idx)),
      // Store metadata for tooltips
      metadata: Array.from({ length: size }, (_, idx) => ({
        value: Math.pow(base, idx)
      })),
      point_style: {
        radius: 10,
        stroke: `black`,
        stroke_width: 1
      }
    }
  }
  const data_base2 = make_exponential_data(10, 2)

  // Track which color scale type is active
  let color_scale_type = `linear`

  // Color scheme options
  const color_schemes = [
    `viridis`, `inferno`, `plasma`, `magma`, `cividis`,
    `turbo`, `warm`, `cool`, `spectral`
  ]
  let selected_scheme = `viridis`
</script>

<div>
  <div style="margin-bottom: 1em;">
    <div style="display: flex; gap: 1em; flex-wrap: wrap; align-items: center; margin-bottom: 0.5em;">
      <div>
        <strong>Color Scale Type:</strong>
        {#each ['linear', 'log'] as scale_type}
          <label style="margin-left: 0.5em;">
            <input type="radio" name="scale_type" value={scale_type}
              bind:group={color_scale_type} /> {scale_type}
          </label>
        {/each}
      </div>

      <div>
        <strong>Color Scheme:</strong>
        <select bind:value={selected_scheme}>
          {#each color_schemes as scheme}
            <option value={scheme}>{scheme}</option>
          {/each}
        </select>
      </div>
    </div>

    <p>
      <strong>Note:</strong> Using log scale for color values is especially useful when the data has an exponential distribution
      or spans many orders of magnitude. It helps visualize patterns in the data that would be hard to see with a linear scale.
    </p>
  </div>

  <h3>Base-2 Exponential Data</h3>
  <!-- TODO figure out why ScatterPlot doesn't react to color_scale_type and selected_scheme without #key here -->
  {#key color_scale_type && selected_scheme}
    <ScatterPlot
      series={[data_base2]}
      x_label="X Position"
      y_label="Y Position"
      markers="points"
      color_scheme={selected_scheme}
      {color_scale_type}
      style="height: 300px; width: 100%;"
    >
      {#snippet tooltip({ x, y, metadata })}
        <div style="white-space: nowrap; padding: 0.25em; background: rgba(0,0,0,0.7); color: white;">
          <strong>Value: {metadata.value}</strong><br/>
          2<sup>{x-1}</sup> = {metadata.value}
        </div>
      {/snippet}
    </ScatterPlot>
  {/key}
</div>
```

## Automatic Color Bar Placement

This example demonstrates how the color bar automatically positions itself in one of the four corners (top-left, top-right, bottom-left, bottom-right) based on where the data points are least dense. Use the sliders to adjust the number of points generated in each quadrant and observe how the color bar moves to avoid overlapping the data.

```svelte example stackblitz
<script>
  import { ScatterPlot } from '$lib'

  // State for controlling point density in each quadrant
  let density_top_left = $state(10);
  let density_top_right = $state(50);
  let density_bottom_left = $state(10);
  let density_bottom_right = $state(10);

  // Function to generate points within a specific quadrant
  const generate_quadrant_points = (count, x_range, y_range) => {
    const points = [];
    for (let i = 0; i < count; i++) {
      points.push({
        x: x_range[0] + Math.random() * (x_range[1] - x_range[0]),
        y: y_range[0] + Math.random() * (y_range[1] - y_range[0]),
        // Assign a color value (e.g., based on distance from origin)
        color_value: Math.sqrt(
          Math.pow(x_range[0] + (x_range[1] - x_range[0]) / 2, 2) +
          Math.pow(y_range[0] + (y_range[1] - y_range[0]) / 2, 2)
        ) * Math.random() * 2 // Add some variation
      });
    }
    return points;
  };

  // Reactive generation of plot data based on densities
  let plot_series = $derived(() => {
    const plot_width = 100;
    const plot_height = 100;
    const center_x = plot_width / 2;
    const center_y = plot_height / 2;

    const tl_points = generate_quadrant_points(density_top_left, [0, center_x], [0, center_y]);
    const tr_points = generate_quadrant_points(density_top_right, [center_x, plot_width], [0, center_y]);
    const bl_points = generate_quadrant_points(density_bottom_left, [0, center_x], [center_y, plot_height]);
    const br_points = generate_quadrant_points(density_bottom_right, [center_x, plot_width], [center_y, plot_height]);

    const all_points = [...tl_points, ...tr_points, ...bl_points, ...br_points];

    return [{
      x: all_points.map(p => p.x),
      y: all_points.map(p => p.y),
      color_values: all_points.map(p => p.color_value),
      point_style: {
        radius: 5,
        stroke: 'white',
        stroke_width: 0.5
      }
    }];
  });

  // Style for sliders
  const slider_style = 'width: 100px; margin-left: 0.5em;';
</script>

<div>
  <div style="display: flex; flex-wrap: wrap; gap: 1.5em; margin-bottom: 1em; justify-content: center;">
    <label>Bottom-Left: {density_top_left}
      <input type="range" min="0" max="100" bind:value={density_top_left} style={slider_style} />
    </label>
    <label>Bottom-Right: {density_top_right}
      <input type="range" min="0" max="100" bind:value={density_top_right} style={slider_style} />
    </label>
    <label>Top-Left: {density_bottom_left}
      <input type="range" min="0" max="100" bind:value={density_bottom_left} style={slider_style} />
    </label>
    <label>Top-Right: {density_bottom_right}
      <input type="range" min="0" max="100" bind:value={density_bottom_right} style={slider_style} />
    </label>
  </div>

  <ScatterPlot
    series={plot_series()}
    x_label="X Position"
    y_label="Y Position"
    x_lim={[0, 100]}
    y_lim={[0, 100]}
    markers="points"
    color_scheme="turbo"
    show_color_bar={true}
    color_bar_label="Value"
    style="height: 450px; width: 100%;"
  >
    {#snippet tooltip({ x, y, metadata, color_value })}
      <div style="white-space: nowrap; padding: 0.25em; background: rgba(0,0,0,0.7); color: white;">
        Point ({x.toFixed(1)}, {y.toFixed(1)})<br/>
        Value: {color_value?.toFixed(2)}
      </div>
    {/snippet}
  </ScatterPlot>
</div>
```
