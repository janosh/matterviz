<script lang="ts">
  import type { Surface3DConfig } from '$lib/plot/types'
  import { T } from '@threlte/core'
  import * as THREE from 'three'

  let {
    config,
    x_range = [0, 1],
    y_range = [0, 1],
    z_range = [0, 1],
    scene_x = 10,
    scene_y = 10,
    scene_z = 5,
  }: {
    config: Surface3DConfig
    x_range?: [number, number]
    y_range?: [number, number]
    z_range?: [number, number]
    scene_x?: number
    scene_y?: number
    scene_z?: number
  } = $props()

  // Normalize value to scene coordinates (centered around 0)
  function normalize(
    value: number,
    [min_val, max_val]: [number, number],
    scene_size: number,
  ): number {
    return ((value - min_val) / (max_val - min_val || 1) - 0.5) * scene_size
  }

  // Parse color to THREE.Color with fallback
  function parse_color(color: string): THREE.Color {
    try {
      return new THREE.Color(color)
    } catch {
      return new THREE.Color(0x4488ff)
    }
  }

  // Calculate vertex color based on config
  function get_vertex_color(
    x_val: number,
    y_val: number,
    z_val: number,
  ): THREE.Color {
    if (config.color_fn) return parse_color(config.color_fn(x_val, y_val, z_val))
    if (config.color) return parse_color(config.color)
    // Default: color by z value (blue to red gradient)
    const z_norm = (z_val - z_range[0]) / (z_range[1] - z_range[0] || 1)
    return new THREE.Color().setHSL(0.66 - z_norm * 0.66, 0.8, 0.5)
  }

  // Add vertex position (with Y/Z swap for Three.js) and color to arrays
  function add_vertex(
    positions: number[],
    colors: number[],
    x_val: number,
    y_val: number,
    z_val: number,
  ): void {
    positions.push(
      normalize(x_val, x_range, scene_x),
      normalize(z_val, z_range, scene_z), // user Z → Three.js Y (vertical)
      normalize(y_val, y_range, scene_y), // user Y → Three.js Z (depth)
    )
    const color = get_vertex_color(x_val, y_val, z_val)
    colors.push(color.r, color.g, color.b)
  }

  // Build geometry from positions/colors arrays with optional grid indices
  function build_geometry(
    positions: number[],
    colors: number[],
    res_a?: number,
    res_b?: number,
    triangles?: number[][],
  ): THREE.BufferGeometry {
    const geom = new THREE.BufferGeometry()
    geom.setAttribute(`position`, new THREE.Float32BufferAttribute(positions, 3))
    geom.setAttribute(`color`, new THREE.Float32BufferAttribute(colors, 3))
    // Set indices: either from explicit triangles or generate grid
    if (triangles?.length) {
      geom.setIndex(triangles.flat())
    } else if (res_a && res_b && res_a >= 2 && res_b >= 2) {
      const indices: number[] = []
      for (let ib = 0; ib < res_b - 1; ib++) {
        for (let ia = 0; ia < res_a - 1; ia++) {
          const tl = ib * res_a + ia
          indices.push(tl, tl + res_a, tl + 1, tl + 1, tl + res_a, tl + res_a + 1)
        }
      }
      geom.setIndex(indices)
    }
    geom.computeVertexNormals()
    return geom
  }

  // Parse resolution config into [res_a, res_b]
  function get_resolution(): [number, number] {
    return Array.isArray(config.resolution)
      ? config.resolution
      : [config.resolution ?? 20, config.resolution ?? 20]
  }

  function create_geometry(): THREE.BufferGeometry | null {
    const [res_a, res_b] = get_resolution()
    const positions: number[] = []
    const colors: number[] = []

    if (config.type === `grid` && config.z_fn) {
      if (res_a < 2 || res_b < 2) return null
      const [x0, x1] = config.x_range ?? x_range
      const [y0, y1] = config.y_range ?? y_range
      const x_step = (x1 - x0) / (res_a - 1)
      const y_step = (y1 - y0) / (res_b - 1)
      for (let ib = 0; ib < res_b; ib++) {
        for (let ia = 0; ia < res_a; ia++) {
          const x_val = x0 + ia * x_step
          const y_val = y0 + ib * y_step
          add_vertex(positions, colors, x_val, y_val, config.z_fn(x_val, y_val))
        }
      }
      return build_geometry(positions, colors, res_a, res_b)
    }

    if (config.type === `parametric` && config.parametric_fn) {
      if (res_a < 2 || res_b < 2) return null
      const [u0, u1] = config.u_range ?? [0, 1]
      const [v0, v1] = config.v_range ?? [0, 1]
      const u_step = (u1 - u0) / (res_a - 1)
      const v_step = (v1 - v0) / (res_b - 1)
      for (let ib = 0; ib < res_b; ib++) {
        for (let ia = 0; ia < res_a; ia++) {
          const pt = config.parametric_fn(u0 + ia * u_step, v0 + ib * v_step)
          add_vertex(positions, colors, pt.x, pt.y, pt.z)
        }
      }
      return build_geometry(positions, colors, res_a, res_b)
    }

    if (config.type === `triangulated` && config.points?.length) {
      for (const pt of config.points) {
        add_vertex(positions, colors, pt.x, pt.y, pt.z)
      }
      return build_geometry(positions, colors, undefined, undefined, config.triangles)
    }

    return null
  }

  // Geometry with proper disposal on change/unmount
  let geometry: THREE.BufferGeometry | null = $state(null)
  let wireframe_geometry: THREE.WireframeGeometry | null = $state(null)

  $effect(() => {
    const new_geom = create_geometry()
    const new_wireframe = new_geom ? new THREE.WireframeGeometry(new_geom) : null
    geometry = new_geom
    wireframe_geometry = new_wireframe
    return () => {
      new_geom?.dispose()
      new_wireframe?.dispose()
    }
  })

  // Material properties
  let is_transparent = $derived((config.opacity ?? 1) < 1)
  let material_props = $derived({
    transparent: is_transparent,
    opacity: config.opacity ?? 1,
    side: (config.double_sided ?? is_transparent)
      ? THREE.DoubleSide
      : THREE.FrontSide,
    vertexColors: true,
    depthWrite: true,
  })

  let wireframe_props = $derived({
    color: config.wireframe_color ?? `#333`,
    linewidth: config.wireframe_width ?? 1,
    transparent: true,
    opacity: 0.5,
  })
</script>

{#if geometry}
  <T.Mesh>
    <T is={geometry} />
    <T.MeshStandardMaterial {...material_props} />
  </T.Mesh>

  {#if config.wireframe && wireframe_geometry}
    <T.LineSegments>
      <T is={wireframe_geometry} />
      <T.LineBasicMaterial {...wireframe_props} />
    </T.LineSegments>
  {/if}
{/if}
