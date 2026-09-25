import type { DataSeries3D, Surface3DConfig } from '$lib/plot/core/types'
import {
  accumulate_extent,
  empty_extent,
  nice_range_from_extent,
  type RunningExtent,
} from '$lib/plot/core/scales'
import { type Camera, type Object3D, Plane, Vector3 } from 'three/webgpu'
// Data-to-scene coordinate mapping shared by the 3D scatter scene, its surfaces and its
// reference lines/planes.

import type { Point3D, Vec2, Vec3 } from '$lib/math'

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

// A surface's vertices in data coordinates, exactly as Surface3D draws them: grid surfaces
// sample z_fn at `resolution` over their own x/y ranges (else the plot's), parametric ones
// their u/v ranges, triangulated ones use their points. `grid` gives the row layout of the
// first two. Null when a grid surface has neither its own nor a plot x/y range to span.
// Vertices may be non-finite (a z_fn undefined off its domain); callers drop them.
export function surface_vertices(
  surface: Surface3DConfig,
  plot_ranges: { x: Vec2; y: Vec2 } | null,
): { points: Point3D[]; grid?: Vec2; triangles?: readonly Vec3[] } | null {
  const [res_a, res_b] = Array.isArray(surface.resolution)
    ? surface.resolution
    : [surface.resolution ?? 20, surface.resolution ?? 20]
  const sample_grid = (
    [u_0, u_1]: Vec2,
    [v_0, v_1]: Vec2,
    at: (param_u: number, param_v: number) => Point3D,
  ) => {
    if (res_a < 2 || res_b < 2) return { points: [], grid: [res_a, res_b] as Vec2 }
    const points: Point3D[] = []
    for (let idx_b = 0; idx_b < res_b; idx_b++) {
      for (let idx_a = 0; idx_a < res_a; idx_a++) {
        points.push(
          at(
            u_0 + (idx_a / (res_a - 1)) * (u_1 - u_0),
            v_0 + (idx_b / (res_b - 1)) * (v_1 - v_0),
          ),
        )
      }
    }
    return { points, grid: [res_a, res_b] as Vec2 }
  }
  if (surface.type === `grid` && surface.z_fn) {
    const { z_fn } = surface
    const x_span = surface.x_range ?? plot_ranges?.x
    const y_span = surface.y_range ?? plot_ranges?.y
    if (!x_span || !y_span) return null
    return sample_grid(x_span, y_span, (x, y) => ({ x, y, z: z_fn(x, y) }))
  }
  if (surface.type === `parametric` && surface.parametric_fn) {
    return sample_grid(
      surface.u_range ?? [0, 1],
      surface.v_range ?? [0, 1],
      surface.parametric_fn,
    )
  }
  if (surface.type === `triangulated` && surface.points?.length) {
    return { points: surface.points, triangles: surface.triangles }
  }
  return null
}

// Finite surface vertices for axis bounds: the same vertices the renderer draws, so a peak
// between coarse samples can't poke out of the box
export const sample_surface = (
  surface: Surface3DConfig,
  plot_ranges: { x: Vec2; y: Vec2 } | null = null,
): Point3D[] =>
  (surface_vertices(surface, plot_ranges)?.points ?? []).filter(
    (point) =>
      Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z),
  )

// World-space planes bounding the scene box ([-scene_x/2, scene_x/2] etc. in Three.js axes,
// user z vertical), for a ClippingGroup that keeps lines, surfaces and reference planes from
// drawing past the axes. The small slack keeps geometry lying exactly on a face.
export function box_clipping_planes(
  scene_x: number,
  scene_y: number,
  scene_z: number,
): Plane[] {
  const slack = 1e-3
  const halves: Vec3 = [scene_x / 2, scene_z / 2, scene_y / 2]
  return halves.flatMap((half, axis) =>
    [1, -1].map((sign) => {
      const normal: Vec3 = [0, 0, 0]
      normal[axis] = sign
      return new Plane(new Vector3(...normal), half + slack)
    }),
  )
}

// Share one extent collection and padding policy between 3D renderers and controls.
export function get_3d_auto_ranges(
  series: readonly DataSeries3D[],
  surface_samples: readonly { x: number; y: number; z: number }[],
) {
  const extents = { x: empty_extent(), y: empty_extent(), z: empty_extent() }
  for (const srs of series) {
    // A legend-hidden series draws nothing, so it must not widen the axes either
    if (!srs || srs.visible === false) continue
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
