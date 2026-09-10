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
