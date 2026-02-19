<script lang="ts">
  import { ScatterPlot3D } from '$lib'
  import type { Vec3 } from '$lib/math'
  import type { DataSeries3D } from '$lib/plot/types'

  // Generate test data with color values to trigger ColorBar rendering
  // This replicates the original issue where ColorBar could block gizmo clicks
  const n_points = 50
  const helix: DataSeries3D = {
    x: Array.from({ length: n_points }, (_, idx) => Math.cos(idx * 0.2)),
    y: Array.from({ length: n_points }, (_, idx) => idx * 0.1),
    z: Array.from({ length: n_points }, (_, idx) => Math.sin(idx * 0.2)),
    color_values: Array.from({ length: n_points }, (_, idx) => idx / n_points),
    label: `Test Helix`,
  }

  // Expose camera position for testing
  let camera_position = $state<Vec3>([8, 8, 8])
  let wrapper: HTMLDivElement | undefined = $state()
</script>

<h1>ScatterPlot3D Test Page</h1>

<div id="test-scatter-3d" style="height: 500px; width: 100%">
  <ScatterPlot3D
    series={[helix]}
    x_axis={{ label: `X` }}
    y_axis={{ label: `Y` }}
    z_axis={{ label: `Z` }}
    gizmo={true}
    bind:camera_position
    bind:wrapper
  />
</div>

<!-- Expose camera position for test assertions -->
<div data-testid="camera-position" style="margin-top: 1em">
  Camera: x={camera_position[0].toFixed(2)}, y={camera_position[1].toFixed(2)}, z={
    camera_position[2].toFixed(2)
  }
</div>
