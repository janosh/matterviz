import type { DataSeries3D, Surface3DConfig } from '$lib/plot/core/types'
import {
  accumulate_extent,
  empty_extent,
  nice_range_from_extent,
  type RunningExtent,
} from '$lib/plot/core/scales'
import { type Camera, type Object3D, Vector3 } from 'three/webgpu'
// Data-to-scene coordinate mapping shared by the 3D scatter scene, its surfaces and its
// reference lines/planes.

import type { Vec2 } from '$lib/math'

interface Scene3DParams {
  scene_x: number
  scene_y: number
  scene_z: number
  x_range: Vec2
  y_range: Vec2
  z_range: Vec2
}

// Apply span constraints or use full range as fallback
export const span_or = (
  span: [number | null, number | null] | undefined,
  range: Vec2,
): Vec2 => [span?.[0] ?? range[0], span?.[1] ?? range[1]]

// Normalize a data value to scene coordinates (centered around 0)
export function normalize_to_scene(
  value: number,
  [min_val, max_val]: Vec2,
  scene_size: number,
): number {
  const range = max_val - min_val
  return range === 0 ? 0 : ((value - min_val) / range - 0.5) * scene_size
}

// Create a function to convert user data coordinates to Three.js coordinates
// Note: In Three.js, Y is vertical. We map:
// - user X → Three.js X (horizontal)
// - user Y → Three.js Z (depth/horizontal)
// - user Z → Three.js Y (vertical)
export function create_to_threejs(
  params: Scene3DParams,
): (user_x: number, user_y: number, user_z: number) => { x: number; y: number; z: number } {
  const { scene_x, scene_y, scene_z, x_range, y_range, z_range } = params
  return (user_x: number, user_y: number, user_z: number) => ({
    x: normalize_to_scene(user_x, x_range, scene_x),
    y: normalize_to_scene(user_z, z_range, scene_z), // z → Y
    z: normalize_to_scene(user_y, y_range, scene_y), // y → Z
  })
}

// Anchor the tooltip above the halo in screen space, independent of orbit angle.
// Scratch vectors live with the hovered point, not with each animation frame.
export function hover_marker_geometry(marker_radius: number) {
  const radius = marker_radius * 1.15
  const center = new Vector3()
  const top = new Vector3()
  return {
    radius,
    tooltip_position: (
      object: Object3D,
      camera: Camera,
      size: { width: number; height: number },
    ): Vec2 => {
      center.setFromMatrixPosition(object.matrixWorld)
      top.setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(radius).add(center)
      center.project(camera)
      top.project(camera)
      return [((center.x + 1) * size.width) / 2, ((1 - top.y) * size.height) / 2 - 8]
    },
  }
}

// Sample surface bounds on the same grid for the renderer and the axis controls.
export function sample_surface(
  surface: Surface3DConfig,
): { x: number; y: number; z: number }[] {
  const grid_steps = 10
  const pts = surface.type === `triangulated` ? (surface.points ?? []) : []
  const is_grid = surface.type === `grid`
  if ((is_grid && surface.z_fn) || (surface.type === `parametric` && surface.parametric_fn)) {
    const [min_u, max_u] = is_grid ? (surface.x_range ?? [-1, 1]) : (surface.u_range ?? [0, 1])
    const [min_v, max_v] = is_grid ? (surface.y_range ?? [-1, 1]) : (surface.v_range ?? [0, 1])
    for (let idx_u = 0; idx_u <= grid_steps; idx_u++) {
      for (let idx_v = 0; idx_v <= grid_steps; idx_v++) {
        const param_u = min_u + (idx_u / grid_steps) * (max_u - min_u)
        const param_v = min_v + (idx_v / grid_steps) * (max_v - min_v)
        if (is_grid && surface.z_fn)
          pts.push({ x: param_u, y: param_v, z: surface.z_fn(param_u, param_v) })
        else if (surface.parametric_fn) pts.push(surface.parametric_fn(param_u, param_v))
      }
    }
  }
  return pts.filter((point) => isFinite(point.x) && isFinite(point.y) && isFinite(point.z))
}

// Share one extent collection and padding policy between 3D renderers and controls.
export function get_3d_auto_ranges(
  series: readonly DataSeries3D[],
  surface_samples: readonly { x: number; y: number; z: number }[],
) {
  const extents = { x: empty_extent(), y: empty_extent(), z: empty_extent() }
  for (const srs of series) {
    if (!srs) continue
    for (const axis of [`x`, `y`, `z`] as const) accumulate_extent(extents[axis], srs[axis])
  }
  for (const axis of [`x`, `y`, `z`] as const) {
    const extent = extents[axis]
    for (const point of surface_samples) {
      const value = point[axis]
      if (typeof value !== `number` || !Number.isFinite(value)) continue
      extent.n_finite++
      if (extent.min === undefined || value < extent.min) extent.min = value
      if (extent.max === undefined || value > extent.max) extent.max = value
    }
  }
  const auto_range = (extent: RunningExtent): Vec2 =>
    nice_range_from_extent(extent, [null, null], `linear`, 0.05)
  return { x: auto_range(extents.x), y: auto_range(extents.y), z: auto_range(extents.z) }
}
