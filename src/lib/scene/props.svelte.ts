import { clamp } from 'svelte-widgets/utils'
import type { Vec3 } from '#lib/math'
import { to_radians } from '#lib/math'
import { type CameraProjection, DEFAULTS } from '#lib/settings'
import { untrack } from 'svelte'
import { type Camera, OrthographicCamera, type Scene, type Vector3 } from 'three/webgpu'
import type { GizmoOptions } from './gizmo'

// Reactive page visibility to pause auto-rotation in hidden tabs, which desktop embedders
// (Tauri) often don't throttle, leaving auto-rotating canvases burning GPU
export const page_visibility = $state({
  visible: typeof document === `undefined` || document.visibilityState === `visible`,
})

if (typeof document !== `undefined`) {
  document.addEventListener(`visibilitychange`, () => {
    page_visibility.visible = document.visibilityState === `visible`
  })
}

// Corner indices of the triangle a raycast hit (three's Intersection.face)
export type HitFace = { a: number; b: number; c: number }

// Threlte pointer event type for mesh interactions. stopPropagation() stops Threlte's own
// dispatch to farther hits along the ray (nativeEvent.stopPropagation only stops the DOM event)
export type ThreltePointerEvent = {
  point: Vector3
  // Absent for non-mesh hits (points, lines)
  face?: HitFace | null
  faceIndex?: number | null // the hit triangle of a non-indexed mesh
  instanceId?: number // the hit instance of an InstancedMesh
  nativeEvent: PointerEvent
  stopPropagation: () => void
}

// Camera/lighting/interaction props shared by all Threlte scene components (BrillouinZoneScene, FermiSurfaceScene, StructureScene, ...)
export type SceneControlProps = {
  camera_projection?: CameraProjection // perspective or orthographic camera
  rotation_damping?: number // how quickly rotation comes to rest after mouse release
  max_zoom?: number // zoom-in limit in px per Å; unset or 0 = unlimited (never below the fitted zoom)
  min_zoom?: number // zoom-out limit in px per Å; unset stops at the zoom that fits the scene, lower zooms out further
  rotate_speed?: number // set to 0 to disable rotation
  zoom_speed?: number // set to 0 to disable zooming
  pan_speed?: number // set to 0 to disable panning
  zoom_to_cursor?: boolean // zoom toward cursor position instead of scene center
  fov?: number // perspective camera field of view
  initial_zoom?: number // initial orthographic camera zoom
  ambient_light?: number // intensity of the uniform fill light
  directional_light?: number // intensity of the directional key light, which shades the surfaces
  gizmo?: boolean | GizmoOptions // corner axes widget; clicking an axis flies the camera to it
  auto_rotate?: number // speed; 0 disables auto-rotation
  scene?: Scene // Threlte scene for external use (e.g. export pane)
  camera?: Camera // Active camera for external use
}

// The props above minus the bindables and the per-viewer projection, defaulting to the
// structure viewer's tuned values so every scene feels the same. Scenes hand their rest props
// to resolve_scene_controls, where `undefined` means the default, like a Svelte prop default.
export type SceneControls = Required<
  Omit<SceneControlProps, `scene` | `camera` | `camera_projection` | `min_zoom` | `max_zoom`>
> &
  Pick<SceneControlProps, `min_zoom` | `max_zoom`> // unset = unlimited
export const SCENE_CONTROL_DEFAULTS: SceneControls = {
  rotation_damping: DEFAULTS.structure.rotation_damping,
  max_zoom: DEFAULTS.structure.max_zoom,
  min_zoom: DEFAULTS.structure.min_zoom,
  rotate_speed: DEFAULTS.structure.rotate_speed,
  zoom_speed: DEFAULTS.structure.zoom_speed,
  pan_speed: DEFAULTS.structure.pan_speed,
  zoom_to_cursor: DEFAULTS.structure.zoom_to_cursor,
  fov: DEFAULTS.structure.fov,
  initial_zoom: DEFAULTS.structure.initial_zoom,
  ambient_light: DEFAULTS.structure.ambient_light,
  directional_light: DEFAULTS.structure.directional_light,
  gizmo: DEFAULTS.structure.gizmo,
  auto_rotate: DEFAULTS.structure.auto_rotate,
}

// Generic so the per-key write type-checks (a union-keyed index on a concrete type would
// demand the intersection of every value type)
function with_defaults<Shape extends object>(
  defaults: Shape,
  overrides: Partial<Shape>,
): Shape {
  const resolved = { ...defaults }
  for (const key of Object.keys(defaults) as (keyof Shape)[]) {
    const value = overrides[key]
    if (value !== undefined) resolved[key] = value
  }
  return resolved
}

export const resolve_scene_controls = (props: SceneControlProps): SceneControls =>
  with_defaults(SCENE_CONTROL_DEFAULTS, props)

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
  // An unchanged fit returns the zoom untouched: (z * f) / f can land an ulp off, and effects
  // call this with the fit unchanged and write the result back into reactive state.
  const resized_zoom = !keeps_zoom
    ? next_fit_zoom
    : previous_fit_zoom === next_fit_zoom
      ? current_zoom
      : (current_zoom * next_fit_zoom) / previous_fit_zoom
  const bounds = get_orthographic_zoom_bounds(next_fit_zoom, min_zoom, max_zoom)
  return clamp(resized_zoom, bounds.min_zoom, bounds.max_zoom)
}

// The auto-fit zoom, pinned to the extent of the last refit(): a trajectory's apparent size is
// data, so only resizes and explicit refits (new series, camera reset, projection change) move
// the framing. Re-runs reading the live extent landed its accumulated change as a jump (#459).
export function create_fit_zoom<Extent>(opts: {
  initial_extent: () => Extent // fitted until the first refit()
  // Maps an extent to a zoom. Must read the viewport size so resizes re-run the effect below.
  zoom_for: (extent: Extent) => number
  // False while the container has no size, as in create_orthographic_zoom.
  measured: () => boolean
  // Held until the first measured run, when there is no viewport to fit to yet. A thunk even
  // though it is read once: a prop passed by value trips svelte's state_referenced_locally.
  initial_zoom: () => number
}) {
  let fitted_extent = untrack(opts.initial_extent)
  let zoom = $state(untrack(opts.initial_zoom))
  $effect(() => {
    if (!opts.measured()) return
    zoom = opts.zoom_for(fitted_extent)
  })
  return {
    get zoom() {
      return zoom
    },
    // Re-frame on `extent`, the current content: a new series, a camera reset, a
    // projection/direction change
    refit(extent: Extent) {
      fitted_extent = extent
      zoom = untrack(() => opts.zoom_for(fitted_extent))
    },
  }
}

// Orthographic zoom following the auto-fit across resizes but yielding to the wheel. Pass
// `.zoom` to the camera; orbit_zoom_props()'s gesture end stores the user's zoom as baseline.
export function create_orthographic_zoom(opts: {
  fit_zoom: () => number
  min_zoom: () => number | undefined
  max_zoom: () => number | undefined
  // False while the container has no size. Required: without it a hidden tab or fullscreen
  // transition reporting 0 inflates the zoom into the clamp, unrecoverable on the way back.
  measured: () => boolean
  // The live camera, whose zoom a fit change rescales: hosts set camera.zoom directly (reset,
  // device loss), and a mid-gesture resize precedes the end hook.
  camera: () => Camera | undefined
}) {
  let zoom = $state(untrack(opts.fit_zoom))
  let previous_fit_zoom = 0
  const live_zoom = (): number => {
    const camera = untrack(opts.camera)
    return camera instanceof OrthographicCamera ? camera.zoom : zoom
  }
  // Scalars, not the bounds object: Threlte re-applies every spread prop when one changes
  // identity, including `target`, which snapped panned views back on each resize.
  const { min_zoom, max_zoom } = $derived(
    get_orthographic_zoom_bounds(opts.fit_zoom(), opts.min_zoom(), opts.max_zoom()),
  )
  $effect(() => {
    if (!opts.measured()) return
    // Track fit + limits so a raised ceiling re-clamps now, not at the next gesture.
    const next_fit = opts.fit_zoom()
    const next_min = opts.min_zoom()
    const next_max = opts.max_zoom()
    untrack(() => {
      // A pure limits change keeps the stored zoom: the camera may sit at a value a host wrote
      // directly, and re-clamping that would apply it as a prop change to a camera already there.
      const current = previous_fit_zoom === next_fit ? zoom : live_zoom()
      zoom = resize_orthographic_zoom(current, previous_fit_zoom, next_fit, next_min, next_max)
      previous_fit_zoom = next_fit
    })
  })
  return {
    get zoom() {
      return zoom
    },
    get min_zoom() {
      return min_zoom
    },
    get max_zoom() {
      return max_zoom
    },
    // Snap to the current fit and make it the rescale baseline (camera reset / new structure),
    // so the effect above sees an unchanged fit instead of rescaling the old zoom by the ratio.
    reset_to_fit() {
      previous_fit_zoom = untrack(opts.fit_zoom)
      zoom = previous_fit_zoom
    },
    // Bounds plus the gesture-end sync, for spreading into build_orbit_props
    orbit_zoom_props: () => ({
      min_zoom,
      max_zoom,
      on_end_extra: () => {
        const camera = opts.camera()
        if (camera instanceof OrthographicCamera) zoom = camera.zoom
      },
    }),
  }
}

// OrbitControls bounds perspective distance, not zoom. Invert target-plane pixels/Å using
// viewport height and vertical FOV; larger zoom maps to a smaller orbit radius.
export const perspective_distance_for_zoom = (
  zoom: number,
  height_px: number,
  vertical_fov_degrees: number,
): number => height_px / (2 * zoom * Math.tan(to_radians(vertical_fov_degrees) / 2))

// Shared OrbitControls config; `on_start_extra` runs extra cleanup when the camera starts moving
// (e.g. StructureScene closes hover tooltips/context menus).
export function build_orbit_props(opts: {
  camera_projection: CameraProjection
  target: Vec3
  rotate_speed: number
  zoom_speed: number
  zoom_to_cursor: boolean
  pan_speed: number
  max_zoom: number | undefined
  min_zoom: number | undefined
  // Height and vertical FOV convert px/Å limits to perspective orbit radii.
  viewport_px?: number
  fov?: number
  auto_rotate: number
  rotation_damping: number
  set_camera_is_moving?: (moving: boolean) => void
  on_start_extra?: () => void
  // runs when a gesture settles (create_orthographic_zoom stores the zoom the user wheeled to)
  on_end_extra?: () => void
}) {
  const is_ortho = opts.camera_projection === `orthographic`
  const { viewport_px, fov, min_zoom, max_zoom } = opts
  // Unmeasured views and unset/nonpositive/infinite limits remain unbounded.
  const orbit_distance_for_zoom = (zoom: number | undefined): number | undefined => {
    if (is_ortho || zoom === undefined || !(zoom > 0) || !Number.isFinite(zoom))
      return undefined
    if (viewport_px === undefined || !(viewport_px > 0)) return undefined
    if (fov === undefined || !(fov > 0) || fov >= 180) return undefined
    return perspective_distance_for_zoom(zoom, viewport_px, fov)
  }
  // Callers disable hover raycasts while the camera moves. OrbitControls' `start` fires before
  // threlte sees the same pointerdown, so flagging it there would swallow the press (a click
  // deleting a bond): flag the gesture's first `change`, which a click or claimed press lacks.
  let gesture_pending = false
  return {
    target: opts.target,
    enableRotate: opts.rotate_speed > 0,
    rotateSpeed: opts.rotate_speed,
    enableZoom: opts.zoom_speed > 0,
    zoomSpeed: is_ortho ? opts.zoom_speed * 2 : opts.zoom_speed,
    zoomToCursor: opts.zoom_to_cursor,
    // consumed by SceneCamera's view-offset pan (pan.ts), which disables OrbitControls' own
    enablePan: opts.pan_speed > 0,
    panSpeed: opts.pan_speed,
    maxZoom: max_zoom,
    minZoom: min_zoom,
    // falling back to OrbitControls' own defaults, i.e. unclamped either way
    minDistance: orbit_distance_for_zoom(max_zoom) ?? 0,
    maxDistance: orbit_distance_for_zoom(min_zoom) ?? Number.POSITIVE_INFINITY,
    // pause auto-rotation while the page is hidden: callers derive these props, so the flip
    // stops threlte's per-frame OrbitControls task (run only while autoRotate/damping is on)
    autoRotate: Boolean(opts.auto_rotate) && page_visibility.visible,
    autoRotateSpeed: opts.auto_rotate,
    enableDamping: Boolean(opts.rotation_damping),
    dampingFactor: opts.rotation_damping,
    onstart: () => {
      gesture_pending = true
      opts.on_start_extra?.()
    },
    // damping and auto-rotation also dispatch `change`, but outside a gesture
    onchange: () => {
      if (!gesture_pending) return
      gesture_pending = false
      opts.set_camera_is_moving?.(true)
    },
    onend: () => {
      gesture_pending = false
      opts.set_camera_is_moving?.(false)
      opts.on_end_extra?.()
    },
  }
}

// Orthographic auto-fit zoom plus the OrbitControls props of a camera orbiting `target`, as
// the 3D scenes share. `fit_zoom` frames the scene at the current viewport, `measured` as in
// create_orthographic_zoom. Pass `.zoom` to the camera and `.orbit_props` to SceneCamera.
export function create_scene_camera(opts: {
  controls: () => Pick<
    SceneControls,
    | `rotate_speed`
    | `zoom_speed`
    | `zoom_to_cursor`
    | `pan_speed`
    | `auto_rotate`
    | `rotation_damping`
    | `min_zoom`
    | `max_zoom`
  > & { camera_projection: CameraProjection }
  target: () => Vec3
  fit_zoom: () => number
  measured: () => boolean
  camera: () => Camera | undefined
  // Omit for orthographic-only scenes.
  viewport_px?: () => number
  fov?: () => number
  set_camera_is_moving?: (moving: boolean) => void
  on_start_extra?: () => void
}) {
  const ortho_zoom = create_orthographic_zoom({
    fit_zoom: opts.fit_zoom,
    min_zoom: () => opts.controls().min_zoom,
    max_zoom: () => opts.controls().max_zoom,
    measured: opts.measured,
    camera: opts.camera,
  })
  const orbit_props = $derived(
    build_orbit_props({
      ...opts.controls(),
      target: opts.target(),
      // fit-aware zoom limits replace the raw min/max above, plus the gesture-end sync keeping
      // the user's zoom as the resize baseline
      ...ortho_zoom.orbit_zoom_props(),
      viewport_px: opts.viewport_px?.(),
      fov: opts.fov?.(),
      set_camera_is_moving: opts.set_camera_is_moving,
      on_start_extra: opts.on_start_extra,
    }),
  )
  return {
    get zoom() {
      return ortho_zoom.zoom
    },
    get orbit_props() {
      return orbit_props
    },
    reset_to_fit: () => ortho_zoom.reset_to_fit(),
  }
}
