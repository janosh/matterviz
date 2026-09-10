<script lang="ts">
  import type { Vec3 } from '$lib/math'
  import type { ScatterProbe } from '../../../../tests/playwright/plot/scatter-plot-3d.test'
  import { ScatterPlot3D } from '$lib'
  import { tick } from 'svelte'
  import { page } from '$app/state'
  import { browser } from '$app/environment'
  import type { DataSeries3D, InternalPoint3D } from '$lib/plot/core/types'
  import {
    type Camera,
    InstancedMesh,
    OrthographicCamera,
    type Scene,
    Matrix4,
    Vector3,
  } from 'three/webgpu'

  // Generate test data with color values to trigger ColorBar rendering
  // This replicates the original issue where ColorBar could block gizmo clicks
  const params = browser ? page.url.searchParams : undefined
  const initial_count = Number(params?.get(`points`) ?? 50)
  const varying_sizes = params?.has(`varying_sizes`)
  const make_helix = (n_points: number): DataSeries3D => ({
    x: Array.from({ length: n_points }, (_, idx) => Math.cos(idx * 0.2)),
    y: Array.from({ length: n_points }, (_, idx) => idx * 0.1),
    z: Array.from({ length: n_points }, (_, idx) => Math.sin(idx * 0.2)),
    color_values: Array.from({ length: n_points }, (_, idx) => idx / n_points),
    size_values: varying_sizes
      ? Array.from({ length: n_points }, (_, idx) => idx / n_points)
      : undefined,
    label: `Test Helix`,
  })
  let series = $state.raw([make_helix(initial_count)])

  // Expose camera state for testing
  let camera_position = $state<Vec3>([8, 8, 8])
  let hovered_point = $state<InternalPoint3D | null>(null)
  let camera = $state<Camera>()
  let scene = $state<Scene>()
  let display = $state({
    projections: {
      xy: params?.has(`projections`) ?? false,
      xz: params?.has(`projections`) ?? false,
      yz: params?.has(`projections`) ?? false,
    },
  })
  let wrapper: HTMLDivElement | undefined = $state()
  $effect(() => {
    window.scatter_probe = {
      set_count: (count) => {
        series = [make_helix(count)]
      },
      zoom: () => (camera instanceof OrthographicCamera ? camera.zoom : Number.NaN),
      set_view: async (position) => {
        camera_position = position
        await tick()
        camera?.lookAt(0, 0, 0)
        camera?.updateMatrixWorld()
      },
      hover: () => hovered_point?.point_idx ?? null,
      targets: () => {
        if (!camera || !scene || !wrapper) return []
        const current_camera = camera
        const viewport = wrapper.getBoundingClientRect()
        const targets: ReturnType<ScatterProbe['targets']> = []
        const matrix = new Matrix4()
        const position = new Vector3()
        scene.traverse((object) => {
          if (!(object instanceof InstancedMesh)) return
          const material = Array.isArray(object.material)
            ? object.material[0]
            : object.material
          if (material.transparent) return
          for (let point_idx = 0; point_idx < object.count; point_idx++) {
            object.getMatrixAt(point_idx, matrix)
            position
              .setFromMatrixPosition(matrix)
              .applyMatrix4(object.matrixWorld)
              .project(current_camera)
            targets.push({
              point_idx,
              x: viewport.x + ((position.x + 1) * viewport.width) / 2,
              y: viewport.y + ((1 - position.y) * viewport.height) / 2,
              depth: position.z,
            })
          }
        })
        return targets.toSorted((left, right) => left.depth - right.depth)
      },
      instances: () => {
        const meshes: ReturnType<ScatterProbe['instances']> = []
        scene?.traverse((object) => {
          if (!(object instanceof InstancedMesh)) return
          const material = Array.isArray(object.material)
            ? object.material[0]
            : object.material
          meshes.push({
            count: object.count,
            matrices: Array.from(object.instanceMatrix.array).slice(0, object.count * 16),
            colors: Array.from(object.instanceColor?.array ?? []).slice(0, object.count * 3),
            projection: material.transparent,
          })
        })
        return meshes
      },
    }
    return () => {
      Reflect.deleteProperty(window, `scatter_probe`)
    }
  })
</script>

<h1 id="scatterplot3d-test-page">ScatterPlot3D Test Page</h1>

<ScatterPlot3D
  id="test-scatter-3d"
  style="height: 500px; width: 100%"
  {series}
  bind:tooltip_point={hovered_point}
  bind:camera_position
  bind:camera
  bind:scene
  bind:display
  bind:wrapper
/>

<!-- Expose camera position for test assertions -->
<div data-testid="camera-position" style="margin-top: 1em">
  Camera: x={camera_position[0].toFixed(2)}, y={camera_position[1].toFixed(2)}, z={camera_position[2].toFixed(
    2,
  )}
</div>
