<script lang="ts">
  import type { Vec3 } from '#lib/math.js'
  import type { ScatterProbe } from '../../../../tests/playwright/plot/scatter-plot-3d.test'
  import { ScatterPlot3D } from '#lib'
  import { tick } from 'svelte'
  import { page } from '$app/state'
  import { browser } from '$app/env'
  import type { DataSeries3D, InternalPoint3D } from '#lib/plot/core/types.js'
  import type { Camera, Scene } from 'three/webgpu'
  import { InstancedMesh, OrthographicCamera, Matrix4, Vector3 } from 'three/webgpu'

  // Generate test data with color values to trigger ColorBar rendering
  // This replicates the original issue where ColorBar could block gizmo clicks
  const params = browser ? page.url.searchParams : undefined
  const initial_count = Number(params?.get(`points`) ?? 50)
  const varying_sizes = params?.has(`varying_sizes`)
  const make_helix = (n_points: number): DataSeries3D => {
    const indices = Array.from({ length: n_points }, (_, idx) => idx)
    return {
      x: indices.map((idx) => Math.cos(idx * 0.2)),
      y: indices.map((idx) => idx * 0.1),
      z: indices.map((idx) => Math.sin(idx * 0.2)),
      color_values: indices.map((idx) => idx / n_points),
      size_values: varying_sizes ? indices.map((idx) => idx / n_points) : undefined,
      label: `Test Helix`,
    }
  }
  let series = $state.raw([make_helix(initial_count)])

  // Expose camera state for testing
  let camera_position = $state<Vec3>([8, 8, 8])
  let hovered_point = $state<InternalPoint3D | null>(null)
  let camera = $state<Camera>()
  let scene = $state<Scene>()
  const show_projections = params?.has(`projections`) ?? false
  let display = $state({
    projections: { xy: show_projections, xz: show_projections, yz: show_projections },
  })
  // Instanced meshes in the scene with their (first) material
  const instanced_meshes = () => {
    const meshes: { mesh: InstancedMesh; transparent: boolean }[] = []
    scene?.traverse((object) => {
      if (!(object instanceof InstancedMesh)) return
      const material = Array.isArray(object.material) ? object.material[0] : object.material
      meshes.push({ mesh: object, transparent: material.transparent })
    })
    return meshes
  }
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
        const viewport = wrapper.getBoundingClientRect()
        const targets: ReturnType<ScatterProbe['targets']> = []
        const matrix = new Matrix4()
        const position = new Vector3()
        for (const { mesh, transparent } of instanced_meshes()) {
          if (transparent) continue
          for (let point_idx = 0; point_idx < mesh.count; point_idx++) {
            mesh.getMatrixAt(point_idx, matrix)
            position
              .setFromMatrixPosition(matrix)
              .applyMatrix4(mesh.matrixWorld)
              .project(camera)
            targets.push({
              point_idx,
              x: viewport.x + ((position.x + 1) * viewport.width) / 2,
              y: viewport.y + ((1 - position.y) * viewport.height) / 2,
              depth: position.z,
            })
          }
        }
        return targets.toSorted((left, right) => left.depth - right.depth)
      },
      instances: () =>
        instanced_meshes().map(({ mesh, transparent }) => ({
          count: mesh.count,
          matrices: Array.from(mesh.instanceMatrix.array).slice(0, mesh.count * 16),
          colors: Array.from(mesh.instanceColor?.array ?? []).slice(0, mesh.count * 3),
          projection: transparent,
        })),
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
