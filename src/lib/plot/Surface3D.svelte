<script lang="ts">
  import type { Surface3DConfig } from '$lib/plot/types'
  import { T } from '@threlte/core'
  import * as THREE from 'three'

  let {
    config,
    x_range = [0, 1],
    y_range = [0, 1],
    z_range = [0, 1],
    scene_size = 10,
  }: {
    config: Surface3DConfig
    x_range?: [number, number]
    y_range?: [number, number]
    z_range?: [number, number]
    scene_size?: number
  } = $props()

  // Normalize coordinates to scene space
  function normalize_x(value: number): number {
    const [min_val, max_val] = x_range
    const span = max_val - min_val || 1
    return ((value - min_val) / span - 0.5) * scene_size
  }

  function normalize_y(value: number): number {
    const [min_val, max_val] = y_range
    const span = max_val - min_val || 1
    return ((value - min_val) / span - 0.5) * scene_size
  }

  function normalize_z(value: number): number {
    const [min_val, max_val] = z_range
    const span = max_val - min_val || 1
    return ((value - min_val) / span - 0.5) * scene_size
  }

  // Parse color to THREE.Color
  function parse_color(color: string): THREE.Color {
    try {
      return new THREE.Color(color)
    } catch {
      return new THREE.Color(0x4488ff)
    }
  }

  // Create geometry based on surface type
  let geometry = $derived.by((): THREE.BufferGeometry | null => {
    if (config.type === `grid`) {
      return create_grid_geometry()
    } else if (config.type === `parametric`) {
      return create_parametric_geometry()
    } else if (config.type === `triangulated`) {
      return create_triangulated_geometry()
    }
    return null
  })

  function create_grid_geometry(): THREE.BufferGeometry {
    const x_surf_range = config.x_range ?? x_range
    const y_surf_range = config.y_range ?? y_range
    const resolution = Array.isArray(config.resolution)
      ? config.resolution
      : [config.resolution ?? 20, config.resolution ?? 20]
    const [res_x, res_y] = resolution

    const vertices: number[] = []
    const colors: number[] = []
    const indices: number[] = []

    const x_step = (x_surf_range[1] - x_surf_range[0]) / (res_x - 1)
    const y_step = (y_surf_range[1] - y_surf_range[0]) / (res_y - 1)

    // Generate vertices and colors
    for (let idx_y = 0; idx_y < res_y; idx_y++) {
      for (let idx_x = 0; idx_x < res_x; idx_x++) {
        const x_val = x_surf_range[0] + idx_x * x_step
        const y_val = y_surf_range[0] + idx_y * y_step

        // Calculate z value using provided function or default to 0
        const z_val = config.z_fn ? config.z_fn(x_val, y_val) : 0

        // Normalize to scene coordinates
        vertices.push(normalize_x(x_val), normalize_z(z_val), normalize_y(y_val))

        // Calculate color
        let color: THREE.Color
        if (config.color_fn) {
          color = parse_color(config.color_fn(x_val, y_val, z_val))
        } else if (config.color) {
          color = parse_color(config.color)
        } else {
          // Default: color by z value (blue to red gradient)
          const z_normalized = (z_val - z_range[0]) / (z_range[1] - z_range[0] || 1)
          color = new THREE.Color().setHSL(0.66 - z_normalized * 0.66, 0.8, 0.5)
        }
        colors.push(color.r, color.g, color.b)
      }
    }

    // Generate triangle indices
    for (let idx_y = 0; idx_y < res_y - 1; idx_y++) {
      for (let idx_x = 0; idx_x < res_x - 1; idx_x++) {
        const top_left = idx_y * res_x + idx_x
        const top_right = top_left + 1
        const bottom_left = top_left + res_x
        const bottom_right = bottom_left + 1

        // First triangle
        indices.push(top_left, bottom_left, top_right)
        // Second triangle
        indices.push(top_right, bottom_left, bottom_right)
      }
    }

    const buffer_geometry = new THREE.BufferGeometry()
    buffer_geometry.setAttribute(
      `position`,
      new THREE.Float32BufferAttribute(vertices, 3),
    )
    buffer_geometry.setAttribute(`color`, new THREE.Float32BufferAttribute(colors, 3))
    buffer_geometry.setIndex(indices)
    buffer_geometry.computeVertexNormals()

    return buffer_geometry
  }

  function create_parametric_geometry(): THREE.BufferGeometry {
    const u_range = config.u_range ?? [0, 1]
    const v_range = config.v_range ?? [0, 1]
    const resolution = Array.isArray(config.resolution)
      ? config.resolution
      : [config.resolution ?? 20, config.resolution ?? 20]
    const [res_u, res_v] = resolution

    const vertices: number[] = []
    const colors: number[] = []
    const indices: number[] = []

    const u_step = (u_range[1] - u_range[0]) / (res_u - 1)
    const v_step = (v_range[1] - v_range[0]) / (res_v - 1)

    // Generate vertices and colors
    for (let idx_v = 0; idx_v < res_v; idx_v++) {
      for (let idx_u = 0; idx_u < res_u; idx_u++) {
        const u_val = u_range[0] + idx_u * u_step
        const v_val = v_range[0] + idx_v * v_step

        // Calculate position using parametric function
        let point = { x: u_val, y: v_val, z: 0 }
        if (config.parametric_fn) {
          point = config.parametric_fn(u_val, v_val)
        }

        // Normalize to scene coordinates
        vertices.push(
          normalize_x(point.x),
          normalize_z(point.z),
          normalize_y(point.y),
        )

        // Calculate color
        let color: THREE.Color
        if (config.color_fn) {
          color = parse_color(config.color_fn(point.x, point.y, point.z))
        } else if (config.color) {
          color = parse_color(config.color)
        } else {
          // Default: color by z value
          const z_normalized = (point.z - z_range[0]) / (z_range[1] - z_range[0] || 1)
          color = new THREE.Color().setHSL(0.66 - z_normalized * 0.66, 0.8, 0.5)
        }
        colors.push(color.r, color.g, color.b)
      }
    }

    // Generate triangle indices
    for (let idx_v = 0; idx_v < res_v - 1; idx_v++) {
      for (let idx_u = 0; idx_u < res_u - 1; idx_u++) {
        const top_left = idx_v * res_u + idx_u
        const top_right = top_left + 1
        const bottom_left = top_left + res_u
        const bottom_right = bottom_left + 1

        indices.push(top_left, bottom_left, top_right)
        indices.push(top_right, bottom_left, bottom_right)
      }
    }

    const buffer_geometry = new THREE.BufferGeometry()
    buffer_geometry.setAttribute(
      `position`,
      new THREE.Float32BufferAttribute(vertices, 3),
    )
    buffer_geometry.setAttribute(`color`, new THREE.Float32BufferAttribute(colors, 3))
    buffer_geometry.setIndex(indices)
    buffer_geometry.computeVertexNormals()

    return buffer_geometry
  }

  function create_triangulated_geometry(): THREE.BufferGeometry {
    const points = config.points ?? []
    const triangles = config.triangles

    const vertices: number[] = []
    const colors: number[] = []

    // Add all vertices
    for (const point of points) {
      vertices.push(normalize_x(point.x), normalize_z(point.z), normalize_y(point.y))

      // Calculate color
      let color: THREE.Color
      if (config.color_fn) {
        color = parse_color(config.color_fn(point.x, point.y, point.z))
      } else if (config.color) {
        color = parse_color(config.color)
      } else {
        const z_normalized = (point.z - z_range[0]) / (z_range[1] - z_range[0] || 1)
        color = new THREE.Color().setHSL(0.66 - z_normalized * 0.66, 0.8, 0.5)
      }
      colors.push(color.r, color.g, color.b)
    }

    const buffer_geometry = new THREE.BufferGeometry()
    buffer_geometry.setAttribute(
      `position`,
      new THREE.Float32BufferAttribute(vertices, 3),
    )
    buffer_geometry.setAttribute(`color`, new THREE.Float32BufferAttribute(colors, 3))

    if (triangles && triangles.length > 0) {
      const indices = triangles.flat()
      buffer_geometry.setIndex(indices)
    }

    buffer_geometry.computeVertexNormals()

    return buffer_geometry
  }

  let material_props = $derived({
    transparent: (config.opacity ?? 1) < 1,
    opacity: config.opacity ?? 1,
    side: config.double_sided ? THREE.DoubleSide : THREE.FrontSide,
    vertexColors: true,
  })

  let wireframe_material_props = $derived({
    color: config.wireframe_color ?? `#333333`,
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

  {#if config.wireframe}
    <T.LineSegments>
      <T.WireframeGeometry args={[geometry]} />
      <T.LineBasicMaterial {...wireframe_material_props} />
    </T.LineSegments>
  {/if}
{/if}
