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

  const major_radius = 2
  const minor_radius = 0.7

  // Parametric torus surface
  const torus_surface = {
    type: `parametric`,
    u_range: [0, Math.PI * 2],
    v_range: [0, Math.PI * 2],
    resolution: [40, 20],
    parametric_fn: (u, v) => ({
      x: (major_radius + minor_radius * Math.cos(v)) * Math.cos(u),
      y: (major_radius + minor_radius * Math.cos(v)) * Math.sin(u),
      z: minor_radius * Math.sin(v),
    }),
    color_fn: (x, y, z) => {
      // Color by angle around the tube
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
  camera_position={[6, 4, 4]}
  style="height: 500px"
  legend={null}
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

## Orthographic Projection

Switch between perspective and orthographic camera projection. Orthographic is useful for technical/CAD-style visualization:

```svelte example
<script>
  import { ScatterPlot3D } from 'matterviz'

  // Create a simple cubic lattice
  const lattice_data = { x: [], y: [], z: [], color_values: [] }
  const size = 3

  for (let ix = 0; ix < size; ix++) {
    for (let iy = 0; iy < size; iy++) {
      for (let iz = 0; iz < size; iz++) {
        lattice_data.x.push(ix - (size - 1) / 2)
        lattice_data.y.push(iy - (size - 1) / 2)
        lattice_data.z.push(iz - (size - 1) / 2)
        lattice_data.color_values.push(ix + iy + iz)
      }
    }
  }

  let camera_projection = $state(`orthographic`)
</script>

<label style="display: block; margin-bottom: 1em">
  Camera Projection:
  <select bind:value={camera_projection}>
    <option value="perspective">Perspective</option>
    <option value="orthographic">Orthographic</option>
  </select>
</label>

<ScatterPlot3D
  series={[{ ...lattice_data, label: `Cubic Lattice`, point_style: { radius: 8 } }]}
  x_axis={{ label: `X` }}
  y_axis={{ label: `Y` }}
  z_axis={{ label: `Z` }}
  color_scale={{ scheme: `interpolateBlues` }}
  {camera_projection}
  style="height: 450px"
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
    x_range: [-2, 2],
    y_range: [-2, 2],
    resolution: 25,
    z_fn: (x, y) => (x * x + y * y) / 2 - 1,
    color: `#3498db`,
    opacity: 0.6,
  }

  // Plane cutting through
  const plane = {
    type: `grid`,
    x_range: [-2, 2],
    y_range: [-2, 2],
    resolution: 5,
    z_fn: () => 0.5,
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
  camera_position={[5, 5, 5]}
  style="height: 500px"
  legend={null}
/>
```

## Performance with Many Points

The component uses instanced rendering for efficient handling of large datasets. This example renders 5,000 points:

```svelte example
<script>
  import { ScatterPlot3D } from 'matterviz'

  // Generate many random points
  const n_points = 5000
  const large_dataset = {
    x: Array.from({ length: n_points }, () => (Math.random() - 0.5) * 10),
    y: Array.from({ length: n_points }, () => (Math.random() - 0.5) * 10),
    z: Array.from({ length: n_points }, () => (Math.random() - 0.5) * 10),
    color_values: Array.from({ length: n_points }, () => Math.random()),
    point_style: { radius: 3 },
    label: `5K Points`,
  }
</script>

<p style="margin-bottom: 0.5em">
  Rendering {n_points.toLocaleString()} points with instanced meshes
</p>

<ScatterPlot3D
  series={[large_dataset]}
  x_axis={{ label: `X` }}
  y_axis={{ label: `Y` }}
  z_axis={{ label: `Z` }}
  color_scale={{ scheme: `interpolateRainbow` }}
  sphere_segments={8}
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
    x_range: [-5, 5],
    y_range: [-5, 5],
    resolution: 50,
    z_fn: (x, y) => {
      const r = Math.sqrt(x * x + y * y)
      return Math.sin(r * 2) * Math.exp(-r * 0.3)
    },
    color_fn: (x, y, z) => {
      // Color based on angle and height
      const angle = (Math.atan2(y, x) + Math.PI) / (2 * Math.PI)
      const height = (z + 1) / 2
      return `hsl(${angle * 360}, ${50 + height * 50}%, ${40 + height * 30}%)`
    },
    opacity: 0.9,
    double_sided: true,
  }
</script>

<ScatterPlot3D
  surfaces={[ripple_surface]}
  x_axis={{ label: `X` }}
  y_axis={{ label: `Y` }}
  z_axis={{ label: `Z` }}
  camera_position={[8, 6, 5]}
  style="height: 500px"
  legend={null}
/>
```
