import { create_orthographic_zoom, create_scene_camera } from '$lib/scene'
import { flushSync } from 'svelte'
import { type Camera, OrthographicCamera, PerspectiveCamera } from 'three/webgpu'
import { expect, test } from 'vitest'

// Shared by BrillouinZoneScene, FermiSurfaceScene, ScatterPlot3DScene and StructureScene, so a
// regression here hits four renderers at once — and both bugs this replaced lived in exactly
// this logic.
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

test(`bounds keep the fit reachable and re-clamp as soon as a limit moves`, () => {
  with_ortho_zoom((zoom, set, camera) => {
    expect([zoom.min_zoom, zoom.max_zoom]).toEqual([10, 500])
    // a fit below the interaction floor lowers it, or the initial framing is unreachable
    camera.zoom = zoom.zoom
    set({ fit: 5 })
    expect(zoom.min_zoom).toBe(5)
    // lowering the ceiling clamps the live zoom now, not at the next gesture
    wheel_to(camera, zoom, 400)
    set({ max: 50 })
    expect(zoom.zoom).toBe(50)
  })
})

test(`orbit_zoom_props carries the bounds and stores the camera's zoom when a gesture ends`, () => {
  with_ortho_zoom((zoom, set, camera) => {
    const props = zoom.orbit_zoom_props()
    expect([props.min_zoom, props.max_zoom]).toEqual([10, 500])
    // the user wheels to 250: OrbitControls writes the camera, the end hook stores it
    camera.zoom = 250
    props.on_end_extra()
    expect(zoom.zoom).toBe(250)
    set({ fit: 50 })
    expect(zoom.zoom).toBe(125)
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

// The bundle the four scenes use: orbit props follow the controls, and the zoom limits handed
// to OrbitControls are the fit-aware bounds rather than the raw min/max
test(`create_scene_camera derives orbit props from controls, target and fit-aware zoom bounds`, () => {
  const cleanup = $effect.root(() => {
    const controls = $state({
      camera_projection: `orthographic` as const,
      rotate_speed: 1,
      zoom_speed: 1,
      zoom_to_cursor: false,
      pan_speed: 1,
      auto_rotate: 0,
      rotation_damping: 0,
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
