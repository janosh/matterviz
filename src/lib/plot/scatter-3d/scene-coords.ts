// Data-to-scene coordinate mapping shared by the 3D scatter scene, its surfaces and its
// reference lines/planes.

import { HOVER_SHELL_SCALE } from '#lib/scene/index.js'
import type { DataSeries3D, Surface3DConfig } from '#lib/plot/core/types.js'
import type { RunningExtent } from '#lib/plot/core/scales.js'
import {
  accumulate_extent,
  empty_extent,
  nice_range_from_extent,
} from '#lib/plot/core/scales.js'
import { Plane, Vector3 } from 'three/webgpu'
import type { Point3D, Vec2, Vec3 } from '#lib/math.js'

// Scene box: x/y are horizontal (2:2), z is vertical (1)
export const SCENE_SIZE: Vec3 = [10, 10, 5]

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

// User data coords to Three.js ones, where Y is vertical: user X → X, Y → Z (depth), Z → Y
export function create_to_threejs(
  ranges: Record<`x` | `y` | `z`, Vec2>,
): (user_x: number, user_y: number, user_z: number) => Point3D {
  const [scene_x, scene_y, scene_z] = SCENE_SIZE
  return (user_x: number, user_y: number, user_z: number) => ({
    x: normalize_to_scene(user_x, ranges.x, scene_x),
    y: normalize_to_scene(user_z, ranges.z, scene_z), // z → Y
    z: normalize_to_scene(user_y, ranges.y, scene_y), // y → Z
  })
}

// The hover halo is a translucent shell just outside the marker; tooltips keep clear of it
export const hover_halo_radius = (marker_radius: number): number =>
  marker_radius * HOVER_SHELL_SCALE

// A surface's vertices in data coordinates, exactly as Surface3D draws them: grid surfaces
// sample z_fn over their own x/y ranges (else the plot's), parametric ones their u/v ranges,
// triangulated ones use their points. `grid` gives the row layout of the first two. Null when
// a grid surface has no x/y range to span. Vertices may be non-finite; callers drop them.
export function surface_vertices(
  surface: Surface3DConfig,
  plot_ranges: { x: Vec2; y: Vec2 } | null,
): { points: Point3D[]; grid?: Vec2; triangles?: readonly Vec3[] } | null {
  const grid: Vec2 = Array.isArray(surface.resolution)
    ? surface.resolution
    : [surface.resolution ?? 20, surface.resolution ?? 20]
  const [res_a, res_b] = grid
  const sample_grid = (
    [u_0, u_1]: Vec2,
    [v_0, v_1]: Vec2,
    at: (param_u: number, param_v: number) => Point3D,
  ) => {
    const points: Point3D[] = []
    if (res_a < 2 || res_b < 2) return { points, grid }
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
    return { points, grid }
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
  (surface_vertices(surface, plot_ranges)?.points ?? []).filter((point) =>
    [point.x, point.y, point.z].every(Number.isFinite),
  )

// World-space planes bounding the scene box (Three.js axes, user z vertical), for a
// ClippingGroup that keeps lines, surfaces and reference planes inside the axes. The small
// slack keeps geometry lying exactly on a face.
export const box_clipping_planes = (scene_x: number, scene_y: number, scene_z: number) =>
  [scene_x, scene_z, scene_y].flatMap((size, axis) =>
    [1, -1].map((sign) => new Plane(new Vector3().setComponent(axis, sign), size / 2 + 1e-3)),
  )

// Share one extent collection and padding policy between 3D renderers and controls.
export function get_3d_auto_ranges(
  series: readonly DataSeries3D[],
  surface_samples: readonly { x: number; y: number; z: number }[],
) {
  const extents = { x: empty_extent(), y: empty_extent(), z: empty_extent() }
  for (const srs of series) {
    // A legend-hidden series draws nothing, so it must not widen the axes either
    if (srs.visible === false) continue
    for (const axis of [`x`, `y`, `z`] as const) accumulate_extent(extents[axis], srs[axis])
  }
  // min_positive also lands in the extents but only matters on log axes, unused here
  for (const axis of [`x`, `y`, `z`] as const) {
    accumulate_extent(
      extents[axis],
      surface_samples.map((point) => point[axis]),
    )
  }
  const auto_range = (extent: RunningExtent): Vec2 =>
    nice_range_from_extent(extent, [null, null], `linear`, 0.05)
  return { x: auto_range(extents.x), y: auto_range(extents.y), z: auto_range(extents.z) }
}
