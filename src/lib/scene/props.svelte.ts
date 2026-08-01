import type { Vec3 } from '$lib/math'
import type { CameraProjection } from '$lib/settings'
import { untrack } from 'svelte'
import type { Camera, Scene, Vector3 } from 'three/webgpu'
import type { GizmoOptions } from './gizmo'

// Reactive page visibility — pause auto-rotation while the tab/window is
// hidden. Desktop embedders like Tauri often disable background throttling,
// which would otherwise leave every auto-rotating 3D canvas burning GPU.
export const page_visibility = $state({
  visible: typeof document === `undefined` || document.visibilityState === `visible`,
})

if (typeof document !== `undefined`) {
  document.addEventListener(`visibilitychange`, () => {
    page_visibility.visible = document.visibilityState === `visible`
  })
}

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
  gizmo?: boolean | GizmoOptions
  auto_rotate?: number // speed; 0 disables auto-rotation
  scene?: Scene // bindable: Threlte scene for external use (e.g. export pane)
  camera?: Camera // bindable: active camera for external use
}

// ScatterPlot3DScene keeps its own gizmo/orbit props on purpose: its gizmo offset is
// ColorBar-aware and its orbit controls differ by design (no zoom-to-cursor / ortho
// zoom-doubling / camera-moving tracking).

// Shared Gizmo config; per-axis appearance comes from GIZMO_DEFAULT_STYLES inside the gizmo
export function build_gizmo_props(gizmo: boolean | GizmoOptions): GizmoOptions {
  const overrides = typeof gizmo === `object` ? gizmo : {}
  // offset is merged, not replaced, so callers can nudge one edge (e.g. to clear a ColorBar)
  return { ...overrides, offset: { left: 5, bottom: 5, ...overrides.offset } }
}

// Fit must stay reachable: it becomes the zoom-out floor and lifts a too-low ceiling.
// Infinity (OrbitControls' own default) rather than undefined, which would clamp to NaN.
export const get_orthographic_zoom_bounds = (
  fit_zoom: number,
  min_zoom?: number,
  max_zoom?: number,
): { min_zoom: number; max_zoom: number } => ({
  min_zoom: Math.min(min_zoom ?? Number.POSITIVE_INFINITY, fit_zoom),
  max_zoom: max_zoom && max_zoom > 0 ? Math.max(max_zoom, fit_zoom) : Number.POSITIVE_INFINITY,
})

// Preserve zoom relative to fit, clamped so the fitted structure stays reachable.
export const resize_orthographic_zoom = (
  current_zoom: number | undefined,
  previous_fit_zoom: number,
  next_fit_zoom: number,
  min_zoom?: number,
  max_zoom?: number,
): number => {
  const keeps_zoom = current_zoom !== undefined && current_zoom > 0 && previous_fit_zoom > 0
  // An unchanged fit returns the zoom untouched rather than multiplying by one: (z * f) / f
  // lands an ulp away from z for some values, and callers (bounds-tracking effects call this
  // with the fit unchanged) write the result straight back into reactive state.
  const resized_zoom = !keeps_zoom
    ? next_fit_zoom
    : previous_fit_zoom === next_fit_zoom
      ? current_zoom
      : (current_zoom * next_fit_zoom) / previous_fit_zoom
  const bounds = get_orthographic_zoom_bounds(next_fit_zoom, min_zoom, max_zoom)
  return Math.max(bounds.min_zoom, Math.min(bounds.max_zoom, resized_zoom))
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
  // runs when a gesture settles (e.g. BZ/Fermi capture the zoom the user wheeled to)
  onend_extra?: () => void
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
    onend: () => {
      opts.set_camera_is_moving?.(false)
      opts.onend_extra?.()
    },
  }
}

// Camera keys StructureScene places for itself, auto-framing the structure while they hold a
// sentinel — `undefined`, or an all-zero position — and writing its choice back into the model.
const VIEWER_PLACED_SCENE_KEYS = new Set([`camera_position`, `camera_target`])

const is_unplaced_camera = (value: unknown): boolean =>
  value === undefined || (Array.isArray(value) && value.every((coord) => coord === 0))

// Shallow-merge caller-supplied scene props into the viewer's local model. This re-runs on
// every reactive pass, so a sentinel must never land on a placement the viewer already made:
// that snaps the view back to its default and discards any orbit or auto-rotation. Real
// coordinates always apply — passing them is how a caller moves the camera.
export function mirror_scene_props(model: object, incoming: object): void {
  const model_record = model as Record<string, unknown>
  for (const [key, value] of Object.entries(incoming)) {
    const keeps_placement =
      VIEWER_PLACED_SCENE_KEYS.has(key) &&
      is_unplaced_camera(value) &&
      // untracked so mirroring never takes a dependency on what it writes
      !is_unplaced_camera(untrack(() => model_record[key]))
    if (!keeps_placement) model_record[key] = value
  }
}
