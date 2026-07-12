import { AXIS_COLORS, NEG_AXIS_COLORS } from '$lib/colors'
import type { Vec3 } from '$lib/math'
import type { CameraProjection } from '$lib/settings'
import type { Gizmo } from '@threlte/extras'
import type { ComponentProps } from 'svelte'
import type { Camera, Scene, Vector3 } from 'three'
import { page_visibility } from './visibility.svelte'

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
  scene?: Scene // bindable: Threlte scene for external use (e.g. export pane)
  camera?: Camera // bindable: active camera for external use
}

// ScatterPlot3DScene keeps its own gizmo/orbit props on purpose: its gizmo offset is
// ColorBar-aware (build_gizmo_props' fixed offset would clobber it) and its orbit controls
// differ by design (no zoom-to-cursor / ortho zoom-doubling / camera-moving tracking).

// Shared Gizmo config: colored +/- axis handles, transparent background, responsive sizing. An object `gizmo` overrides the per-axis defaults.
export function build_gizmo_props(gizmo: boolean | ComponentProps<typeof Gizmo>) {
  return {
    background: { enabled: false },
    className: `responsive-gizmo`,
    ...Object.fromEntries(
      [...AXIS_COLORS, ...NEG_AXIS_COLORS].map(([axis, color, hover]) => [
        axis,
        {
          color,
          labelColor: `#111`,
          opacity: axis.startsWith(`n`) ? 0.9 : 0.8,
          hover: {
            color: hover,
            labelColor: `#222`,
            opacity: axis.startsWith(`n`) ? 1 : 0.9,
          },
        },
      ]),
    ),
    ...(typeof gizmo === `object` ? gizmo : {}),
    offset: { left: 5, bottom: 5 },
  }
}

// Shared OrbitControls config; `onstart_extra` runs extra cleanup when the camera starts moving (e.g. StructureScene closes hover tooltips/context menus)
export function build_orbit_props(opts: {
  camera_projection: CameraProjection
  target: Vec3
  rotate_speed: number
  zoom_speed: number
  zoom_to_cursor: boolean
  pan_speed: number
  max_zoom: number | undefined
  min_zoom: number | undefined
  auto_rotate: number
  rotation_damping: number
  set_camera_is_moving?: (moving: boolean) => void
  onstart_extra?: () => void
}) {
  const is_ortho = opts.camera_projection === `orthographic`
  return {
    position: [0, 0, 0] as Vec3,
    target: opts.target,
    enableRotate: opts.rotate_speed > 0,
    rotateSpeed: opts.rotate_speed,
    enableZoom: opts.zoom_speed > 0,
    zoomSpeed: is_ortho ? opts.zoom_speed * 2 : opts.zoom_speed,
    zoomToCursor: opts.zoom_to_cursor,
    enablePan: opts.pan_speed > 0,
    panSpeed: opts.pan_speed,
    maxZoom: opts.max_zoom,
    minZoom: opts.min_zoom,
    // pause auto-rotation while the page is hidden: callers build these props
    // in $derived, so the visibility flip re-runs them and stops the per-frame
    // OrbitControls task (threlte only runs it while autoRotate/damping is on)
    autoRotate: Boolean(opts.auto_rotate) && page_visibility.visible,
    autoRotateSpeed: opts.auto_rotate,
    enableDamping: Boolean(opts.rotation_damping),
    dampingFactor: opts.rotation_damping,
    onstart: () => {
      opts.set_camera_is_moving?.(true)
      opts.onstart_extra?.()
    },
    onend: () => opts.set_camera_is_moving?.(false),
  }
}
