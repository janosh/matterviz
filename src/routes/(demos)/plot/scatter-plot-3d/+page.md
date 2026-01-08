# 3D Scatter Plot

The `ScatterPlot3D` component provides efficient 3D scatter plot visualization using Three.js (via Threlte) with instanced rendering for optimal performance with thousands of points. It supports colored surfaces, multiple data series, and interactive camera controls.

## Basic 3D Scatter Plot

A simple 3D scatter plot with multiple data series. Use mouse to rotate, scroll to zoom, and right-click drag to pan:

```svelte example
<script>
  import { ScatterPlot3D } from 'matterviz'

  // Generate helical data
  const n_points = 100
  const helix_1 = {
    x: Array.from({ length: n_points }, (_, idx) => Math.cos(idx * 0.2)),
    y: Array.from({ length: n_points }, (_, idx) => idx * 0.1),
    z: Array.from({ length: n_points }, (_, idx) => Math.sin(idx * 0.2)),
    point_style: { fill: `steelblue` },
    label: `Helix 1`,
  }

  const helix_2 = {
    x: Array.from({ length: n_points }, (_, idx) => Math.cos(idx * 0.2 + Math.PI)),
    y: Array.from({ length: n_points }, (_, idx) => idx * 0.1),
    z: Array.from({ length: n_points }, (_, idx) => Math.sin(idx * 0.2 + Math.PI)),
    point_style: { fill: `orangered` },
    label: `Helix 2`,
  }
</script>

<ScatterPlot3D
  series={[helix_1, helix_2]}
  x_axis={{ label: `X` }}
  y_axis={{ label: `Height` }}
  z_axis={{ label: `Z` }}
  style="height: 450px"
/>
```

## Color-Coded Points

Points can be colored based on data values using a continuous color scale. The color bar automatically displays the value range:

```svelte example
<script>
  import { ScatterPlot3D } from 'matterviz'

  // Generate spherical shell of points with color based on z-coordinate
  const n_points = 500
  const sphere_data = {
    x: [],
    y: [],
    z: [],
    color_values: [],
  }

  for (let idx = 0; idx < n_points; idx++) {
    // Random point on unit sphere
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    const radius = 0.8 + Math.random() * 0.4 // Slight thickness

    const x_val = radius * Math.sin(phi) * Math.cos(theta)
    const y_val = radius * Math.sin(phi) * Math.sin(theta)
    const z_val = radius * Math.cos(phi)

    sphere_data.x.push(x_val)
    sphere_data.y.push(y_val)
    sphere_data.z.push(z_val)
    sphere_data.color_values.push(z_val) // Color by z-coordinate
  }
</script>

<ScatterPlot3D
  series={[{ ...sphere_data, label: `Sphere` }]}
  x_axis={{ label: `X` }}
  y_axis={{ label: `Y` }}
  z_axis={{ label: `Z` }}
  color_scale={{ scheme: `interpolateViridis` }}
  color_bar={{ title: `Z-coordinate` }}
  style="height: 450px"
/>
```

## Grid Surface

Add a surface defined by a z = f(x, y) function. The surface is colored by the z-value by default:

```svelte example
<script>
  import { ScatterPlot3D } from 'matterviz'

  // Define a saddle surface: z = x^2 - y^2
  const saddle_surface = {
    type: `grid`,
    x_range: [-2, 2],
    y_range: [-2, 2],
    resolution: 30,
    z_fn: (x, y) => x * x - y * y,
    opacity: 0.8,
    wireframe: true,
    wireframe_color: `#444`,
  }

  // Scatter points on the surface
  const n_points = 50
  const points_on_surface = {
    x: Array.from({ length: n_points }, () => Math.random() * 4 - 2),
    y: Array.from({ length: n_points }, () => Math.random() * 4 - 2),
    z: [],
    color_values: [],
    point_style: { fill: `white`, radius: 6 },
    label: `Sample Points`,
  }

  // Calculate z values using the surface function
  for (let idx = 0; idx < n_points; idx++) {
    const x = points_on_surface.x[idx]
    const y = points_on_surface.y[idx]
    const z = x * x - y * y
    points_on_surface.z.push(z)
    points_on_surface.color_values.push(z)
  }
</script>

<ScatterPlot3D
  series={[points_on_surface]}
  surfaces={[saddle_surface]}
  x_axis={{ label: `X` }}
  y_axis={{ label: `Y` }}
  z_axis={{ label: `Z = X² - Y²` }}
  color_scale={{ scheme: `interpolateCool` }}
  color_bar={{ title: `Height` }}
  style="height: 500px"
/>
```

## Parametric Surface

Create surfaces using parametric equations. This example shows a torus:

```svelte example
<script>
  import { ScatterPlot3D } from 'matterviz'

  const [major_radius, minor_radius] = [0.4, 0.15]

  const torus_surface = { // Parametric torus surface
    type: `parametric`,
    u_range: [0, Math.PI * 2],
    v_range: [0, Math.PI * 2],
    resolution: [40, 20],
    parametric_fn: (u, v) => ({
      x: (major_radius + minor_radius * Math.cos(v)) * Math.cos(u),
      y: (major_radius + minor_radius * Math.cos(v)) * Math.sin(u),
      z: minor_radius * Math.sin(v),
    }),
    color_fn: (x, y, z) => { // Color by angle around the tube
      const hue = (Math.atan2(z, Math.sqrt(x * x + y * y) - major_radius) + Math.PI) /
        (2 * Math.PI)
      return `hsl(${hue * 360}, 70%, 50%)`
    },
    opacity: 0.85,
  }
</script>

<ScatterPlot3D
  surfaces={[torus_surface]}
  x_axis={{ label: `X` }}
  y_axis={{ label: `Y` }}
  z_axis={{ label: `Z` }}
  style="height: 500px"
  legend={null}
/>
```

## Lines with Markers

Display 3D trajectories as connected lines with markers at each data point. Each series can have its own color and style:

```svelte example
<script>
  import { ScatterPlot3D } from 'matterviz'

  // Generate Lissajous curves - parametric 3D curves
  const n_points = 60

  const curve_1 = {
    x: Array.from({ length: n_points }, (_, idx) => {
      const t = (idx / n_points) * Math.PI * 2
      return Math.sin(3 * t)
    }),
    y: Array.from({ length: n_points }, (_, idx) => {
      const t = (idx / n_points) * Math.PI * 2
      return Math.sin(4 * t)
    }),
    z: Array.from({ length: n_points }, (_, idx) => {
      const t = (idx / n_points) * Math.PI * 2
      return Math.sin(5 * t)
    }),
    point_style: { fill: `#e74c3c`, radius: 4 },
    line_style: { stroke: `#e74c3c`, stroke_width: 3 },
    label: `Lissajous (3:4:5)`,
  }

  const curve_2 = {
    x: Array.from({ length: n_points }, (_, idx) => {
      const t = (idx / n_points) * Math.PI * 2
      return Math.sin(2 * t + Math.PI / 4)
    }),
    y: Array.from({ length: n_points }, (_, idx) => {
      const t = (idx / n_points) * Math.PI * 2
      return Math.sin(3 * t)
    }),
    z: Array.from({ length: n_points }, (_, idx) => {
      const t = (idx / n_points) * Math.PI * 2
      return Math.cos(2 * t)
    }),
    point_style: { fill: `#3498db`, radius: 4 },
    line_style: { stroke: `#3498db`, stroke_width: 3 },
    label: `Lissajous (2:3:2)`,
  }

  // Spring/helix trajectory
  const curve_3 = {
    x: Array.from({ length: n_points }, (_, idx) => {
      const t = (idx / n_points) * Math.PI * 4
      return 0.7 * Math.cos(t)
    }),
    y: Array.from({ length: n_points }, (_, idx) => {
      const t = (idx / n_points) * Math.PI * 4
      return 0.7 * Math.sin(t)
    }),
    z: Array.from({ length: n_points }, (_, idx) => {
      return (idx / n_points) * 2 - 1
    }),
    point_style: { fill: `#2ecc71`, radius: 3 },
    line_style: { stroke: `#2ecc71`, stroke_width: 3, line_dash: `3 2` },
    label: `Helix`,
  }
</script>

<ScatterPlot3D
  series={[curve_1, curve_2, curve_3]}
  x_axis={{ label: `X` }}
  y_axis={{ label: `Y` }}
  z_axis={{ label: `Z` }}
  style="height: 500px"
/>
```

## Size-Scaled Points

Points can be sized based on data values using the `size_scale` prop:

```svelte example
<script>
  import { ScatterPlot3D } from 'matterviz'

  // Generate random 3D data with varying sizes
  const n_points = 200
  const random_data = {
    x: Array.from({ length: n_points }, () => Math.random() * 10 - 5),
    y: Array.from({ length: n_points }, () => Math.random() * 10 - 5),
    z: Array.from({ length: n_points }, () => Math.random() * 10 - 5),
    // Size based on distance from origin
    size_values: [],
    color_values: [],
  }

  for (let idx = 0; idx < n_points; idx++) {
    const x = random_data.x[idx]
    const y = random_data.y[idx]
    const z = random_data.z[idx]
    const distance = Math.sqrt(x * x + y * y + z * z)
    random_data.size_values.push(distance)
    random_data.color_values.push(distance)
  }
</script>

<ScatterPlot3D
  series={[{ ...random_data, label: `Random Points` }]}
  x_axis={{ label: `X` }}
  y_axis={{ label: `Y` }}
  z_axis={{ label: `Z` }}
  size_scale={{ radius_range: [0.05, 0.25] }}
  color_scale={{ scheme: `interpolatePlasma` }}
  color_bar={{ title: `Distance from Origin` }}
  style="height: 500px"
/>
```

## Auto-Rotating View

Enable automatic rotation with the `auto_rotate` prop. Use the controls pane (gear icon) to adjust rotation speed:

```svelte example
<script>
  import { ScatterPlot3D } from 'matterviz'

  // Generate a spiral galaxy-like structure
  const n_arms = 3
  const points_per_arm = 200
  const galaxy_data = { x: [], y: [], z: [], color_values: [] }

  for (let arm_idx = 0; arm_idx < n_arms; arm_idx++) {
    const arm_offset = (arm_idx / n_arms) * Math.PI * 2
    for (let point_idx = 0; point_idx < points_per_arm; point_idx++) {
      const t = point_idx / points_per_arm
      const radius = t * 4 + 0.5
      const angle = t * 4 + arm_offset
      const spread = (1 - t) * 0.5 // More spread at center

      const x = radius * Math.cos(angle) + (Math.random() - 0.5) * spread
      const y = radius * Math.sin(angle) + (Math.random() - 0.5) * spread
      const z = (Math.random() - 0.5) * spread * 0.5 // Thin disk

      galaxy_data.x.push(x)
      galaxy_data.y.push(y)
      galaxy_data.z.push(z)
      galaxy_data.color_values.push(t) // Color by distance from center
    }
  }

  let auto_rotate = $state(1)
</script>

<label style="display: block; margin-bottom: 1em">
  Rotation Speed: {auto_rotate.toFixed(1)}
  <input type="range" min="0" max="5" step="0.1" bind:value={auto_rotate} />
</label>

<ScatterPlot3D
  series={[{ ...galaxy_data, label: `Galaxy` }]}
  x_axis={{ label: `X` }}
  y_axis={{ label: `Y` }}
  z_axis={{ label: `Z` }}
  color_scale={{ scheme: `interpolateYlOrRd` }}
  {auto_rotate}
  camera_position={[0, 8, 4]}
  style="height: 500px"
  legend={null}
/>
```

## Multiple Surfaces

Combine multiple surfaces in the same plot:

```svelte example
<script>
  import { ScatterPlot3D } from 'matterviz'

  // Paraboloid surface
  const paraboloid = {
    type: `grid`,
    x_range: [-1, 1],
    y_range: [-1, 1],
    resolution: 25,
    z_fn: (x, y) => (x * x + y * y) - 0.5,
    color: `#3498db`,
    opacity: 0.6,
  }

  // Plane cutting through
  const plane = {
    type: `grid`,
    x_range: [-1, 1],
    y_range: [-1, 1],
    resolution: 5,
    z_fn: () => 0.25,
    color: `#e74c3c`,
    opacity: 0.5,
    wireframe: true,
    wireframe_color: `#c0392b`,
  }
</script>

<ScatterPlot3D
  surfaces={[paraboloid, plane]}
  x_axis={{ label: `X` }}
  y_axis={{ label: `Y` }}
  z_axis={{ label: `Z` }}
  camera_position={[4, 3, 3]}
  style="height: 500px"
  legend={null}
/>
```

## Performance with Many Points

The component uses instanced rendering with per-instance colors for efficient handling of large datasets:

```svelte example
<script>
  import { ScatterPlot3D } from 'matterviz'

  // Generate many random points
  const n_points = 3_000
  const large_dataset = {
    x: Array.from({ length: n_points }, () => (Math.random() - 0.5) * 10),
    y: Array.from({ length: n_points }, () => (Math.random() - 0.5) * 10),
    z: Array.from({ length: n_points }, () => (Math.random() - 0.5) * 10),
    color_values: Array.from({ length: n_points }, () => Math.random()),
    point_style: { radius: 3 },
    label: `${n_points.toLocaleString()} Points`,
  }
</script>

<p style="margin-bottom: 0.5em">
  Rendering {n_points.toLocaleString()} points with per-instance colors
</p>

<ScatterPlot3D
  series={[large_dataset]}
  x_axis={{ label: `X` }}
  y_axis={{ label: `Y` }}
  z_axis={{ label: `Z` }}
  color_scale={{ scheme: `interpolateRainbow` }}
  sphere_segments={12}
  style="height: 500px"
/>
```

## 3D Reference Lines

Add reference lines in 3D space to highlight axes, thresholds, or specific values. Lines can be parallel to any axis or defined as segments between points:

```svelte example
<script>
  import { ScatterPlot3D } from 'matterviz'

  // Generate random 3D data
  const n_points = 100
  const scatter_data = {
    x: Array.from({ length: n_points }, () => Math.random() * 4 - 2),
    y: Array.from({ length: n_points }, () => Math.random() * 4 - 2),
    z: Array.from({ length: n_points }, () => Math.random() * 4 - 2),
    color_values: Array.from({ length: n_points }, (_, idx) => idx / n_points),
    point_style: { radius: 4 },
    label: `Data Points`,
  }

  // Reference lines parallel to axes
  const ref_lines = [
    // Line parallel to X-axis at y=0, z=0 (the X-axis itself)
    {
      type: `x-axis`,
      y: 0,
      z: 0,
      label: `X-axis`,
      style: { color: `#e74c3c`, width: 3 },
    },
    // Line parallel to Y-axis at x=0, z=0 (the Y-axis itself)
    {
      type: `y-axis`,
      x: 0,
      z: 0,
      label: `Y-axis`,
      style: { color: `#2ecc71`, width: 3 },
    },
    // Line parallel to Z-axis at x=0, y=0 (the Z-axis itself)
    {
      type: `z-axis`,
      x: 0,
      y: 0,
      label: `Z-axis`,
      style: { color: `#3498db`, width: 3 },
    },
    // Threshold line parallel to X-axis
    {
      type: `x-axis`,
      y: 1.5,
      z: 1.5,
      label: `Threshold`,
      style: { color: `#f39c12`, width: 2, dash: `4 2` },
    },
    // Segment between two points
    {
      type: `segment`,
      p1: [-2, -2, -2],
      p2: [2, 2, 2],
      label: `Diagonal`,
      style: { color: `#9b59b6`, width: 2 },
    },
  ]
</script>

<ScatterPlot3D
  series={[scatter_data]}
  {ref_lines}
  x_axis={{ label: `X`, range: [-2.5, 2.5] }}
  y_axis={{ label: `Y`, range: [-2.5, 2.5] }}
  z_axis={{ label: `Z`, range: [-2.5, 2.5] }}
  color_scale={{ scheme: `interpolateViridis` }}
  style="height: 500px"
/>
```

## 3D Reference Planes

Add reference planes in 3D space. Planes can be aligned to axis pairs (XY, XZ, YZ), defined by a normal vector and point, or through three points:

```svelte example
<script>
  import { ScatterPlot3D } from 'matterviz'

  // Generate data clustered above and below a plane
  const n_points = 80
  const above_plane = {
    x: Array.from({ length: n_points / 2 }, () => Math.random() * 3 - 1.5),
    y: Array.from({ length: n_points / 2 }, () => Math.random() * 3 - 1.5),
    z: Array.from({ length: n_points / 2 }, () => 0.3 + Math.random() * 1.5),
    point_style: { fill: `#2ecc71`, radius: 5 },
    label: `Class A (above)`,
  }

  const below_plane = {
    x: Array.from({ length: n_points / 2 }, () => Math.random() * 3 - 1.5),
    y: Array.from({ length: n_points / 2 }, () => Math.random() * 3 - 1.5),
    z: Array.from({ length: n_points / 2 }, () => -0.3 - Math.random() * 1.5),
    point_style: { fill: `#e74c3c`, radius: 5 },
    label: `Class B (below)`,
  }

  // Reference planes
  const ref_planes = [
    // XY plane at z=0 (decision boundary)
    {
      type: `xy`,
      z: 0,
      label: `Decision Boundary`,
      style: {
        color: `#3498db`,
        opacity: 0.3,
        wireframe: true,
        wireframe_color: `#2980b9`,
      },
    },
    // YZ plane at x=0 (vertical slice)
    {
      type: `yz`,
      x: 0,
      label: `YZ Slice`,
      style: {
        color: `#f39c12`,
        opacity: 0.2,
      },
    },
  ]
</script>

<ScatterPlot3D
  series={[above_plane, below_plane]}
  {ref_planes}
  x_axis={{ label: `Feature 1`, range: [-2, 2] }}
  y_axis={{ label: `Feature 2`, range: [-2, 2] }}
  z_axis={{ label: `Feature 3`, range: [-2, 2] }}
  camera_position={[5, 4, 3]}
  style="height: 500px"
/>
```

## Combining Lines, Planes, and Surfaces

Create complex 3D visualizations by combining reference lines, planes, and surfaces:

```svelte example
<script>
  import { ScatterPlot3D } from 'matterviz'

  // Generate points on a paraboloid z = x² + y²
  const n_points = 60
  const paraboloid_points = {
    x: [],
    y: [],
    z: [],
    color_values: [],
    point_style: { radius: 4 },
    label: `z = x² + y²`,
  }

  for (let idx = 0; idx < n_points; idx++) {
    const theta = Math.random() * 2 * Math.PI
    const r = Math.sqrt(Math.random()) * 1.5
    const x = r * Math.cos(theta)
    const y = r * Math.sin(theta)
    const z = x * x + y * y
    paraboloid_points.x.push(x)
    paraboloid_points.y.push(y)
    paraboloid_points.z.push(z)
    paraboloid_points.color_values.push(z)
  }

  // Surface definition
  const paraboloid_surface = {
    type: `grid`,
    x_range: [-1.5, 1.5],
    y_range: [-1.5, 1.5],
    resolution: 25,
    z_fn: (x, y) => x * x + y * y,
    opacity: 0.5,
    wireframe: true,
    wireframe_color: `#666`,
  }

  // Reference lines showing axis intercepts and key values
  const ref_lines = [
    // Vertical line at origin
    {
      type: `z-axis`,
      x: 0,
      y: 0,
      label: `Z-axis`,
      style: { color: `#e74c3c`, width: 3 },
    },
    // Circle at z = 1 (projected down)
    {
      type: `segment`,
      p1: [1, 0, 1],
      p2: [0, 1, 1],
      style: { color: `#f39c12`, width: 2, dash: `4 2` },
    },
    {
      type: `segment`,
      p1: [0, 1, 1],
      p2: [-1, 0, 1],
      style: { color: `#f39c12`, width: 2, dash: `4 2` },
    },
    {
      type: `segment`,
      p1: [-1, 0, 1],
      p2: [0, -1, 1],
      style: { color: `#f39c12`, width: 2, dash: `4 2` },
    },
    {
      type: `segment`,
      p1: [0, -1, 1],
      p2: [1, 0, 1],
      style: { color: `#f39c12`, width: 2, dash: `4 2` },
    },
  ]

  // Reference plane at z = 1
  const ref_planes = [
    {
      type: `xy`,
      z: 1,
      label: `z = 1`,
      style: { color: `#2ecc71`, opacity: 0.15 },
    },
  ]
</script>

<ScatterPlot3D
  series={[paraboloid_points]}
  surfaces={[paraboloid_surface]}
  {ref_lines}
  {ref_planes}
  x_axis={{ label: `X` }}
  y_axis={{ label: `Y` }}
  z_axis={{ label: `Z = X² + Y²` }}
  color_scale={{ scheme: `interpolatePlasma` }}
  color_bar={{ title: `Height` }}
  camera_position={[4, 4, 3]}
  style="height: 550px"
/>
```

## Plane Through Three Points

Define a plane by specifying three non-collinear points:

```svelte example
<script>
  import { ScatterPlot3D } from 'matterviz'

  // Three points defining a plane
  const p1 = [1, 0, 0]
  const p2 = [0, 1, 0]
  const p3 = [0, 0, 1]

  // Generate random points near the plane
  const n_points = 50
  const plane_normal = { x: 1, y: 1, z: 1 }
  const plane_points = {
    x: [],
    y: [],
    z: [],
    point_style: { fill: `#3498db`, radius: 5 },
    label: `Near Plane`,
  }

  for (let idx = 0; idx < n_points; idx++) {
    const t1 = Math.random()
    const t2 = Math.random() * (1 - t1)
    const t3 = 1 - t1 - t2
    const noise = (Math.random() - 0.5) * 0.3
    plane_points.x.push(p1[0] * t1 + p2[0] * t2 + p3[0] * t3 + noise)
    plane_points.y.push(p1[1] * t1 + p2[1] * t2 + p3[1] * t3 + noise)
    plane_points.z.push(p1[2] * t1 + p2[2] * t2 + p3[2] * t3 + noise)
  }

  // Reference plane through the three points
  const ref_planes = [
    {
      type: `points`,
      p1,
      p2,
      p3,
      label: `Fitted Plane`,
      style: {
        color: `#9b59b6`,
        opacity: 0.4,
        wireframe: true,
        wireframe_color: `#7d3c98`,
        double_sided: true,
      },
    },
  ]

  // Reference lines from origin to corner points
  const ref_lines = [
    {
      type: `segment`,
      p1: [0, 0, 0],
      p2: p1,
      style: { color: `#e74c3c`, width: 2 },
      label: `To P1`,
    },
    {
      type: `segment`,
      p1: [0, 0, 0],
      p2: p2,
      style: { color: `#2ecc71`, width: 2 },
      label: `To P2`,
    },
    {
      type: `segment`,
      p1: [0, 0, 0],
      p2: p3,
      style: { color: `#f39c12`, width: 2 },
      label: `To P3`,
    },
    // Triangle edges
    { type: `segment`, p1, p2, style: { color: `#3498db`, width: 3 } },
    { type: `segment`, p1: p2, p2: p3, style: { color: `#3498db`, width: 3 } },
    { type: `segment`, p1: p3, p2: p1, style: { color: `#3498db`, width: 3 } },
  ]
</script>

<ScatterPlot3D
  series={[plane_points]}
  {ref_planes}
  {ref_lines}
  x_axis={{ label: `X`, range: [-0.5, 1.5] }}
  y_axis={{ label: `Y`, range: [-0.5, 1.5] }}
  z_axis={{ label: `Z`, range: [-0.5, 1.5] }}
  camera_position={[3, 3, 3]}
  style="height: 500px"
/>
```

## Custom Surface Colors

Surfaces can be colored using a custom color function that receives x, y, z coordinates:

```svelte example
<script>
  import { ScatterPlot3D } from 'matterviz'

  // Ripple surface with custom coloring
  const ripple_surface = {
    type: `grid`,
    x_range: [-1, 1],
    y_range: [-1, 1],
    resolution: 40,
    z_fn: (x, y) => {
      const r = Math.sqrt(x * x + y * y)
      return Math.sin(r * 4) * Math.exp(-r * 0.8) * 0.5
    },
    color_fn: (x, y, z) => {
      // Color based on angle and height
      const angle = (Math.atan2(y, x) + Math.PI) / (2 * Math.PI)
      const height = (z + 0.5) / 1
      return `hsl(${angle * 360}, ${50 + height * 50}%, ${40 + height * 30}%)`
    },
    opacity: 0.7,
    double_sided: true,
  }
</script>

<ScatterPlot3D
  surfaces={[ripple_surface]}
  x_axis={{ label: `X` }}
  y_axis={{ label: `Y` }}
  z_axis={{ label: `Z` }}
  camera_position={[4, 3, 3]}
  style="height: 500px"
  legend={null}
/>
```
