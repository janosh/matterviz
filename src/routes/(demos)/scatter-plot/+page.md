`ScatterPlot.svelte`

The `ScatterPlot` component allows you to create interactive scatter plots with various features and customizations.

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

## Categorized Data and Custom Tick Intervals

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
    y_format={y_format}
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
