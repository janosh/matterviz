import type { CameraProjection } from '$lib/settings'
import type { Gizmo } from '@threlte/extras'
import type { ComponentProps } from 'svelte'
import type { Camera, Scene, Vector3 } from 'three'

// Threlte pointer event type for mesh interactions
export type ThreltePointerEvent = { point: Vector3; nativeEvent: PointerEvent }

// Camera/lighting/interaction props shared by all Threlte scene components (BrillouinZoneScene, FermiSurfaceScene, StructureScene, ...)
export type SceneControlProps = {
  camera_projection?: CameraProjection
  rotation_damping?: number // how quickly rotation comes to rest after mouse release
  max_zoom?: number
  min_zoom?: number
  rotate_speed?: number // set to 0 to disable rotation
  zoom_speed?: number // set to 0 to disable zooming
  pan_speed?: number // set to 0 to disable panning
  zoom_to_cursor?: boolean // zoom toward cursor position instead of scene center
  fov?: number // perspective camera field of view
  initial_zoom?: number // initial orthographic camera zoom
  ambient_light?: number
  directional_light?: number
  gizmo?: boolean | ComponentProps<typeof Gizmo>
  auto_rotate?: number // speed; 0 disables auto-rotation
  camera_is_moving?: boolean // bindable: true while orbit controls are active
  scene?: Scene // bindable: Threlte scene for external use (e.g. export pane)
  camera?: Camera // bindable: active camera for external use
}
