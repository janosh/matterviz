# 3D Scatter Plot

`ScatterPlot3D` uses instanced Three.js/Threlte points and supports multiple series, `color_values`, and optional surfaces. Legend clicks update `hidden_series`, an array of series IDs (or indices for series without IDs). Bind it to control visibility; input series stay unchanged. Per-series `visible` provides the initial state when `hidden_series` is omitted.

Axis ranges accept independently automatic bounds: `{ range: [0, null] }` fixes the minimum while the maximum follows the data. Clear a range input to restore automatic sizing; its placeholder shows the computed bound. “Restore axes to initial values” restores the original labels and ranges, including authored limits. Standalone `ScatterPlot3DControls` takes `auto_ranges={{ x, y, z }}`; the low-level `ScatterPlot3DScene` takes final `ranges` in the same shape.

## Basic 3D Scatter Plot

```svelte example
<script lang="ts">
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

```svelte example
<script lang="ts">
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

<div class="bleed-1400 demo-pairs" style="--pair-rows: 4">
<section>

## Grid Surface

Add a surface defined by a z = f(x, y) function. The surface is colored by the z-value by default:

```svelte example
<script lang="ts">
  import { ScatterPlot3D } from 'matterviz'

  // Define a saddle surface: z = x^2 - y^2
  const saddle_surface = {
    type: `grid`,
    x_range: [-2, 2],
    y_range: [-2, 2],
    resolution: 30,
    z_fn: (coord_x, coord_y) => coord_x * coord_x - coord_y * coord_y,
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
    const coord_x = points_on_surface.x[idx]
    const coord_y = points_on_surface.y[idx]
    const coord_z = coord_x * coord_x - coord_y * coord_y
    points_on_surface.z.push(coord_z)
    points_on_surface.color_values.push(coord_z)
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

</section>
<section>

## Parametric Surface

A torus built from parametric equations:

```svelte example
<script lang="ts">
  import { ScatterPlot3D } from 'matterviz'

  const [major_radius, minor_radius] = [0.4, 0.15]

  const torus_surface = {
    // Parametric torus surface
    type: `parametric`,
    u_range: [0, Math.PI * 2],
    v_range: [0, Math.PI * 2],
    resolution: [40, 20],
    parametric_fn: (param_u, value) => ({
      x: (major_radius + minor_radius * Math.cos(value)) * Math.cos(param_u),
      y: (major_radius + minor_radius * Math.cos(value)) * Math.sin(param_u),
      z: minor_radius * Math.sin(value),
    }),
    color_fn: (coord_x, coord_y, coord_z) => {
      // Color by angle around the tube
      const hue =
        (Math.atan2(coord_z, Math.sqrt(coord_x * coord_x + coord_y * coord_y) - major_radius) +
          Math.PI) /
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

</section>
</div>

## Lines with Markers

Display 3D trajectories as connected lines with markers at each data point. Each series can have its own color and style:

```svelte example
<script lang="ts">
  import { ScatterPlot3D } from 'matterviz'

  // Parametric 3D curve sampled at 60 angles spanning `turns` full turns
  const n_points = 60
  const curve = (turns, coord_fns, { color, label, radius = 4, dash }) => {
    const angles = Array.from(
      { length: n_points },
      (_, idx) => (idx / n_points) * turns * 2 * Math.PI,
    )
    const [x, y, z] = coord_fns.map((coord_fn) => angles.map(coord_fn))
    return {
      x,
      y,
      z,
      point_style: { fill: color, radius },
      line_style: { color, width: 3, dash },
      label,
    }
  }

  const curve_1 = curve(
    1,
    [
      (angle) => Math.sin(3 * angle),
      (angle) => Math.sin(4 * angle),
      (angle) => Math.sin(5 * angle),
    ],
    { color: `#e74c3c`, label: `Lissajous (3:4:5)` },
  )
  const curve_2 = curve(
    1,
    [
      (angle) => Math.sin(2 * angle + Math.PI / 4),
      (angle) => Math.sin(3 * angle),
      (angle) => Math.cos(2 * angle),
    ],
    { color: `#3498db`, label: `Lissajous (2:3:2)` },
  )
  // Spring/helix trajectory rising linearly from z = -1 to 1 over two turns
  const curve_3 = curve(
    2,
    [
      (angle) => 0.7 * Math.cos(angle),
      (angle) => 0.7 * Math.sin(angle),
      (angle) => angle / (2 * Math.PI) - 1,
    ],
    { color: `#2ecc71`, label: `Helix`, radius: 3, dash: `3 2` },
  )
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
<script lang="ts">
  import { ScatterPlot3D } from 'matterviz'

  // Random 3D data sized and colored by distance from the origin
  const n_points = 200
  const random_coord = () => Array.from({ length: n_points }, () => Math.random() * 10 - 5)
  const [x, y, z] = [random_coord(), random_coord(), random_coord()]
  const distances = x.map((x_val, idx) => Math.hypot(x_val, y[idx], z[idx]))
  const random_data = { x, y, z, size_values: distances, color_values: distances }
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
<script lang="ts">
  import { ScatterPlot3D } from 'matterviz'

  // Generate a spiral galaxy-like structure
  const n_arms = 3
  const points_per_arm = 200
  const galaxy_data = { x: [], y: [], z: [], color_values: [] }

  for (let arm_idx = 0; arm_idx < n_arms; arm_idx++) {
    const arm_offset = (arm_idx / n_arms) * Math.PI * 2
    for (let point_idx = 0; point_idx < points_per_arm; point_idx++) {
      const fraction = point_idx / points_per_arm
      const radius = fraction * 4 + 0.5
      const angle = fraction * 4 + arm_offset
      const spread = (1 - fraction) * 0.5 // More spread at center

      const coord_x = radius * Math.cos(angle) + (Math.random() - 0.5) * spread
      const coord_y = radius * Math.sin(angle) + (Math.random() - 0.5) * spread
      const coord_z = (Math.random() - 0.5) * spread * 0.5 // Thin disk

      galaxy_data.x.push(coord_x)
      galaxy_data.y.push(coord_y)
      galaxy_data.z.push(coord_z)
      galaxy_data.color_values.push(fraction) // Color by distance from center
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
  camera_position={[0, 12, 6]}
  style="height: 500px"
  legend={null}
/>
```

## Multiple Surfaces

Combine multiple surfaces in the same plot:

```svelte example
<script lang="ts">
  import { ScatterPlot3D } from 'matterviz'

  // Paraboloid surface
  const paraboloid = {
    type: `grid`,
    x_range: [-1, 1],
    y_range: [-1, 1],
    resolution: 25,
    z_fn: (coord_x, coord_y) => coord_x * coord_x + coord_y * coord_y - 0.5,
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
  style="height: 500px"
  legend={null}
/>
```

## Performance with Many Points

The component uses instanced rendering with per-instance colors for efficient handling of large datasets:

```svelte example
<script lang="ts">
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

<div class="bleed-1400 demo-pairs" style="--pair-rows: 4">
<section>

## 3D Reference Lines

Add reference lines in 3D space to highlight axes, thresholds, or specific values. Lines can be parallel to any axis or defined as segments between points:

```svelte example
<script lang="ts">
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

</section>
<section>

## 3D Reference Planes

Add reference planes in 3D space. Planes can be aligned to axis pairs (XY, XZ, YZ), defined by a normal vector and point, or through three points:

```svelte example
<script lang="ts">
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
  style="height: 500px"
/>
```

</section>
</div>

## Combining Lines, Planes, and Surfaces

Create complex 3D visualizations by combining reference lines, planes, and surfaces:

```svelte example
<script lang="ts">
  import { ScatterPlot3D } from 'matterviz'

  // Random points on a paraboloid z = x² + y², colored by z
  const paraboloid_points = {
    x: [],
    y: [],
    z: [],
    point_style: { radius: 4 },
    label: `z = x² + y²`,
  }
  for (let idx = 0; idx < 60; idx++) {
    const theta = Math.random() * 2 * Math.PI
    const radius = Math.sqrt(Math.random()) * 1.5
    paraboloid_points.x.push(radius * Math.cos(theta))
    paraboloid_points.y.push(radius * Math.sin(theta))
    paraboloid_points.z.push(radius ** 2)
  }
  paraboloid_points.color_values = paraboloid_points.z

  // Surface definition
  const paraboloid_surface = {
    type: `grid`,
    x_range: [-1.5, 1.5],
    y_range: [-1.5, 1.5],
    resolution: 25,
    z_fn: (coord_x, coord_y) => coord_x * coord_x + coord_y * coord_y,
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
    // Square inscribed in the z = 1 circle
    ...[
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ].map(([x_val, y_val], idx, corners) => ({
      type: `segment`,
      p1: [x_val, y_val, 1],
      p2: [...corners[(idx + 1) % 4], 1],
      style: { color: `#f39c12`, width: 2, dash: `4 2` },
    })),
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
  style="height: 550px"
/>
```

## Plane Through Three Points

Define a plane by specifying three non-collinear points:

```svelte example
<script lang="ts">
  import { ScatterPlot3D } from 'matterviz'

  // Three points defining a plane
  const point_1 = [1, 0, 0]
  const point_2 = [0, 1, 0]
  const point_3 = [0, 0, 1]

  // Random barycentric combinations of the three points, plus noise
  const plane_points = {
    x: [],
    y: [],
    z: [],
    point_style: { fill: `#3498db`, radius: 5 },
    label: `Near Plane`,
  }
  for (let idx = 0; idx < 50; idx++) {
    const param_1 = Math.random()
    const param_2 = Math.random() * (1 - param_1)
    const weights = [param_1, param_2, 1 - param_1 - param_2]
    const noise = (Math.random() - 0.5) * 0.3
    const [x_val, y_val, z_val] = [0, 1, 2].map(
      (dim) =>
        point_1[dim] * weights[0] +
        point_2[dim] * weights[1] +
        point_3[dim] * weights[2] +
        noise,
    )
    plane_points.x.push(x_val)
    plane_points.y.push(y_val)
    plane_points.z.push(z_val)
  }

  // Reference plane through the three points
  const ref_planes = [
    {
      type: `points`,
      p1: point_1,
      p2: point_2,
      p3: point_3,
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
    ...[point_1, point_2, point_3].map((point, idx) => ({
      type: `segment`,
      p1: [0, 0, 0],
      p2: point,
      style: { color: [`#e74c3c`, `#2ecc71`, `#f39c12`][idx], width: 2 },
      label: `To P${idx + 1}`,
    })),
    // Triangle edges
    { type: `segment`, p1: point_1, p2: point_2, style: { color: `#3498db`, width: 3 } },
    { type: `segment`, p1: point_2, p2: point_3, style: { color: `#3498db`, width: 3 } },
    { type: `segment`, p1: point_3, p2: point_1, style: { color: `#3498db`, width: 3 } },
  ]
</script>

<ScatterPlot3D
  series={[plane_points]}
  {ref_planes}
  {ref_lines}
  x_axis={{ label: `X`, range: [-0.5, 1.5] }}
  y_axis={{ label: `Y`, range: [-0.5, 1.5] }}
  z_axis={{ label: `Z`, range: [-0.5, 1.5] }}
  style="height: 500px"
/>
```

## Custom Surface Colors

Surfaces can be colored using a custom color function that receives x, y, z coordinates:

```svelte example
<script lang="ts">
  import { ScatterPlot3D } from 'matterviz'

  // Ripple surface with custom coloring
  const ripple_surface = {
    type: `grid`,
    x_range: [-1, 1],
    y_range: [-1, 1],
    resolution: 40,
    z_fn: (coord_x, coord_y) => {
      const radius = Math.sqrt(coord_x * coord_x + coord_y * coord_y)
      return Math.sin(radius * 4) * Math.exp(-radius * 0.8) * 0.5
    },
    color_fn: (coord_x, coord_y, coord_z) => {
      // Color based on angle and height
      const angle = (Math.atan2(coord_y, coord_x) + Math.PI) / (2 * Math.PI)
      const height = (coord_z + 0.5) / 1
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
  style="height: 500px"
  legend={null}
/>
```
