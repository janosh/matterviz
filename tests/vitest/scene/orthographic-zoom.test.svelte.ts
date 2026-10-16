import {
  create_fit_zoom,
  create_orthographic_zoom,
  create_scene_camera,
  build_orbit_props,
  SCENE_CONTROL_DEFAULTS,
} from '#lib/scene/props.svelte.js'
import { camera_flight_registry } from '#lib/scene/camera-flight.js'
import { camera_resets } from '#lib/scene/camera-reset.js'
import { create_fly_to } from '#lib/scene/fly-to.js'
import SceneCamera from '#lib/scene/SceneCamera.svelte'
import { read_pan_offset, set_pan_offset } from '#lib/scene/pan.js'
import { type ComponentProps, flushSync } from 'svelte'
import { type Camera, OrthographicCamera, PerspectiveCamera } from 'three/webgpu'
import { expect, onTestFinished, test, vi } from 'vitest'
import { mount_scene } from './mount'

// SceneCamera with no position yet (as while a scene measures its bounds) unless given one
const mount_camera = (
  camera_projection: 'orthographic' | 'perspective',
  extra: Partial<ComponentProps<typeof SceneCamera>> = {},
  [min_zoom, max_zoom]: [number?, number?] = [],
) => {
  const props = $state<ComponentProps<typeof SceneCamera>>({
    camera_projection,
    position: undefined,
    orbit_props: build_orbit_props({
      ...SCENE_CONTROL_DEFAULTS,
      camera_projection,
      target: [0, 0, 0],
      min_zoom,
      max_zoom,
    }),
    orbit_controls: undefined, // bound back by SceneCamera
    ...extra,
  })
  const scene = mount_scene((anchor) => SceneCamera(anchor, props))
  onTestFinished(scene.unmount_scene)
  flushSync()
  return { props, ...scene }
}

test.each([`orthographic`, `perspective`] as const)(
  `%s camera retains identity and pan when its position changes`,
  (camera_projection) => {
    const { props, camera: camera_store } = mount_camera(camera_projection)
    const camera = camera_store.current
    set_pan_offset(camera, [30, 15], 400, 300)
    for (const position of [[3, 4, 5], [0, 0, 0], undefined] as const) {
      props.position = position && [...position]
      flushSync()
      expect(camera_store.current).toBe(camera)
      expect(read_pan_offset(camera)).toEqual([30, 15])
    }
  },
)

// The `r` key's reset (reset_scene_cameras): back to the props' framing, without pan
test.each([`orthographic`, `perspective`] as const)(
  `%s camera reset restores position, target and zoom and drops the pan`,
  async (camera_projection) => {
    const reset_zoom = vi.fn()
    // OrbitControls clamps the zoom on update: unset bounds would make it NaN
    const {
      props,
      canvas,
      camera: camera_store,
      unmount_scene,
    } = mount_camera(camera_projection, { position: [3, 4, 5], zoom: 7, reset_zoom }, [1, 50])
    const controls = props.orbit_controls
    const reset = camera_resets.get(canvas)
    if (!controls || !reset) throw new Error(`SceneCamera registered no reset`)
    const camera = camera_store.current
    if (!(camera instanceof OrthographicCamera || camera instanceof PerspectiveCamera))
      throw new Error(`SceneCamera made no zoomable camera`)
    camera.position.set(9, 9, 9)
    controls.target.set(1, 1, 1)
    camera.zoom = 99
    set_pan_offset(camera, [30, 15], 400, 300)
    reset()
    expect(reset_zoom).toHaveBeenCalledOnce()
    // OrbitControls.update() round-trips the offset through spherical coords: ~1e-15 off
    for (const [axis, value] of [3, 4, 5].entries())
      expect(camera.position.getComponent(axis)).toBeCloseTo(value, 12)
    expect(controls.target.toArray()).toEqual([0, 0, 0])
    // only an orthographic camera zooms; a perspective one dollies
    expect(camera.zoom).toBe(camera_projection === `orthographic` ? 7 : 99)
    expect(read_pan_offset(camera)).toEqual([0, 0])
    await unmount_scene()
    expect(camera_resets.has(canvas)).toBe(false)
  },
)

// A zone-axis swing in the air or clicked mid-flight would pull the camera off the movie's poses
test(`a camera flight ends and blocks fly-tos on its controls until it lets go`, () => {
  const { props, canvas } = mount_camera(`perspective`)
  const controls = props.orbit_controls
  const controller = camera_flight_registry.get(canvas)
  if (!controls || !controller) throw new Error(`SceneCamera set up no camera flight`)
  const fly = create_fly_to({
    camera: () => controls.object,
    controls: () => controls,
    duration_ms: () => 400,
    invalidate: () => {},
  })
  fly.start([1, 0, 0])
  const lease = controller.begin()
  fly.start([0, 1, 0])
  expect(fly.active).toBe(false)
  lease.commit()
  fly.start([0, 1, 0])
  expect(fly.active).toBe(true)
})

// Shared by BrillouinZoneScene, FermiSurfaceScene, ScatterPlot3DScene and StructureScene
type ZoomInputs = { fit: number; measured: boolean; max: number; camera: Camera | undefined }

// `camera` stands in for the renderer's live camera
const with_zoom = <Cam extends Camera>(
  run: (
    zoom: ReturnType<typeof create_orthographic_zoom>,
    // `then` runs in the same flush as the patch, before effects (a host's $effect.pre)
    set: (inputs: Partial<ZoomInputs>, then?: () => void) => void,
    camera: Cam,
  ) => void,
  camera: Cam,
) => {
  const cleanup = $effect.root(() => {
    const inputs: ZoomInputs = $state({ fit: 100, measured: true, max: 500, camera })
    const zoom = create_orthographic_zoom({
      fit_zoom: () => inputs.fit,
      min_zoom: () => 10,
      max_zoom: () => inputs.max,
      measured: () => inputs.measured,
      camera: () => inputs.camera,
    })
    flushSync()
    run(
      zoom,
      (patch, then) =>
        flushSync(() => {
          Object.assign(inputs, patch)
          then?.()
        }),
      camera,
    )
  })
  cleanup()
}
const with_ortho_zoom = (run: Parameters<typeof with_zoom<OrthographicCamera>>[0]) =>
  with_zoom(run, new OrthographicCamera())

// The only way into the stored zoom is the gesture-end hook reading the camera, as in the
// renderers: OrbitControls writes camera.zoom, on_end_extra stores it. Between gestures the
// camera sits at the stored zoom (Threlte applies it as a prop), mirrored here by hand.
const wheel_to = (
  camera: OrthographicCamera,
  zoom: ReturnType<typeof create_orthographic_zoom>,
  value: number,
) => {
  camera.zoom = value
  zoom.orbit_zoom_props().on_end_extra()
}

test(`zoom follows the fit, and a user zoom keeps its ratio across resizes`, () => {
  with_ortho_zoom((zoom, set, camera) => {
    expect(zoom.zoom).toBe(100)
    // a resize with no user input just adopts the new fit
    camera.zoom = zoom.zoom
    set({ fit: 50 })
    expect(zoom.zoom).toBe(50)
    // the zoom the user landed on becomes the baseline the next resize rescales from
    wheel_to(camera, zoom, 200)
    set({ fit: 100 })
    expect(zoom.zoom).toBe(400)
    camera.zoom = zoom.zoom
    set({ fit: 50 })
    expect(zoom.zoom).toBe(200)
  })
})

test(`an unmeasured container freezes the zoom instead of rescaling against a placeholder`, () => {
  with_ortho_zoom((zoom, set, camera) => {
    wheel_to(camera, zoom, 300)
    // a zero-size container reports a placeholder fit; rescaling then clamping would lose 300
    set({ measured: false, fit: 1 })
    expect(zoom.zoom).toBe(300)
    set({ measured: true, fit: 100 })
    expect(zoom.zoom).toBe(300)
  })
})

test(`bounds keep the fit reachable, reach orbit_zoom_props and re-clamp when a limit moves`, () => {
  with_ortho_zoom((zoom, set, camera) => {
    expect([zoom.min_zoom, zoom.max_zoom]).toEqual([10, 500])
    const { min_zoom, max_zoom } = zoom.orbit_zoom_props()
    expect([min_zoom, max_zoom]).toEqual([10, 500])
    // a fit below the interaction floor lowers it, or the initial framing is unreachable
    camera.zoom = zoom.zoom
    set({ fit: 5 })
    expect([zoom.min_zoom, zoom.orbit_zoom_props().min_zoom]).toEqual([5, 5])
    // lowering the ceiling clamps the live zoom now, not at the next gesture
    wheel_to(camera, zoom, 400)
    set({ max: 50 })
    expect(zoom.zoom).toBe(50)
  })
})

test(`a fit change rescales the zoom the camera is actually at, not the stored one`, () => {
  // Hosts write camera.zoom directly (StructureViewport's reset and device-loss recovery) and
  // a resize can land mid-gesture before the end hook ran — either way the camera is the truth.
  with_ortho_zoom((zoom, set, camera) => {
    camera.zoom = 300
    set({ fit: 50 })
    expect(zoom.zoom).toBe(150)
    // a pure limits change keeps the stored zoom rather than re-reading a camera it may not own
    camera.zoom = 999
    set({ max: 400 })
    expect(zoom.zoom).toBe(150)
  })
})

test(`a perspective camera has no zoom to read, so the stored zoom is rescaled`, () => {
  with_zoom((zoom, set, camera) => {
    // a perspective camera's own zoom is unrelated: reading it would rescale 7, not the stored 100
    camera.zoom = 7
    set({ fit: 50 })
    expect(zoom.zoom).toBe(50)
    // the end hook is a no-op: a perspective gesture dollies instead of zooming
    zoom.orbit_zoom_props().on_end_extra()
    expect(zoom.zoom).toBe(50)
  }, new PerspectiveCamera())
})

test(`reset_to_fit snaps to the new fit in the same flush instead of rescaling by ratio`, () => {
  with_ortho_zoom((zoom, set, camera) => {
    wheel_to(camera, zoom, 400)
    // StructureScene's fit pre-effect writes the new fit and resets before the zoom effect runs
    set({ fit: 80 }, () => zoom.reset_to_fit())
    expect(zoom.zoom).toBe(80)
    // the fit is now the baseline: the camera (at the fit) rescales from it, not from 400
    camera.zoom = 80
    set({ fit: 40 })
    expect(zoom.zoom).toBe(40)
  })
})

// #459: the fit effect must not read the live extent when something else re-runs it (hover
// revealing the gizmo hands StructureScene fresh scene_props). A resize stands in for that re-run.
type FitInputs = { extent: number; width: number; measured: boolean }

const with_fit_zoom = (
  run: (
    fit: ReturnType<typeof create_fit_zoom>,
    set: (patch: Partial<FitInputs>) => void,
  ) => void,
  { initial_zoom = 1, measured = true } = {},
) => {
  const cleanup = $effect.root(() => {
    const inputs: FitInputs = $state({ extent: 10, width: 600, measured })
    const fit = create_fit_zoom({
      extent: () => inputs.extent,
      zoom_for: (extent) => inputs.width / extent,
      measured: () => inputs.measured,
      initial_zoom: () => initial_zoom,
    })
    flushSync()
    run(fit, (patch) => flushSync(() => Object.assign(inputs, patch)))
  })
  cleanup()
}

test(`the fit is pinned to its extent: only refit() adopts new content`, () => {
  with_fit_zoom((fit, set) => {
    expect(fit.zoom).toBe(60)

    // next trajectory frame, cell 3x larger: the framing must hold
    set({ extent: 30 })
    expect(fit.zoom).toBe(60)

    // and must still hold when a resize re-runs the effect: it rescales against the pinned
    // extent, so a round trip lands back on the original zoom rather than on 900/30 = 30
    set({ width: 900 })
    expect(fit.zoom).toBe(90)
    set({ width: 600 })
    expect(fit.zoom).toBe(60)

    // an explicit re-frame (new series, camera reset, projection change) adopts the extent
    fit.refit()
    expect(fit.zoom).toBe(20)
    set({ width: 900 })
    expect(fit.zoom).toBe(30)
  })
})

test(`an unmeasured container holds the initial zoom until it has a size`, () => {
  with_fit_zoom(
    (fit, set) => {
      expect(fit.zoom).toBe(42)
      set({ measured: true })
      expect(fit.zoom).toBe(60)
    },
    { initial_zoom: 42, measured: false },
  )
})

// The bundle the four scenes use: orbit props follow the controls, and the zoom limits handed
// to OrbitControls are the fit-aware bounds rather than the raw min/max
test(`create_scene_camera derives orbit props from controls, target and fit-aware zoom bounds`, () => {
  const cleanup = $effect.root(() => {
    const controls = $state({
      ...SCENE_CONTROL_DEFAULTS,
      camera_projection: `orthographic` as const,
      zoom_speed: 1,
      min_zoom: 10,
      max_zoom: 50,
    })
    const inputs = $state({ fit: 100, target: [1, 2, 3] as [number, number, number] })
    const camera = new OrthographicCamera()
    const scene_camera = create_scene_camera({
      controls: () => controls,
      target: () => inputs.target,
      fit_zoom: () => inputs.fit,
      measured: () => true,
      camera: () => camera,
    })
    flushSync()
    expect(scene_camera.zoom).toBe(100)
    expect(scene_camera.orbit_props.target).toEqual([1, 2, 3])
    // the fit lies above max_zoom, so the ceiling lifts to keep it reachable
    expect([scene_camera.orbit_props.minZoom, scene_camera.orbit_props.maxZoom]).toEqual([
      10, 100,
    ])
    expect(scene_camera.orbit_props.zoomSpeed).toBe(2) // orthographic doubling

    controls.rotate_speed = 0
    inputs.target = [0, 0, 0]
    flushSync()
    expect(scene_camera.orbit_props.enableRotate).toBe(false)
    expect(scene_camera.orbit_props.target).toEqual([0, 0, 0])

    camera.zoom = 40
    scene_camera.orbit_props.onend() // gesture end stores the wheeled zoom
    inputs.fit = 200
    flushSync()
    expect(scene_camera.zoom).toBe(80) // user zoom keeps its ratio to the fit
    scene_camera.reset_to_fit()
    expect(scene_camera.zoom).toBe(200)
  })
  cleanup()
})
