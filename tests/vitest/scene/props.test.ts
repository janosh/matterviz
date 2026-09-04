import {
  build_orbit_props,
  perspective_distance_for_zoom,
  mirror_scene_props,
  page_visibility,
  resolve_scene_controls,
  SCENE_CONTROL_DEFAULTS,
} from '$lib/scene'
import { DEFAULTS } from '$lib/settings'
import { PerspectiveCamera, Vector3 } from 'three/webgpu'
import { afterEach, describe, expect, test, vi } from 'vitest'

describe(`build_orbit_props`, () => {
  const opts: Parameters<typeof build_orbit_props>[0] = {
    camera_projection: `perspective`,
    target: [1, 2, 3],
    rotate_speed: 1,
    zoom_speed: 0.5,
    zoom_to_cursor: true,
    pan_speed: 0,
    max_zoom: 100,
    min_zoom: 0.1,
    auto_rotate: 0,
    rotation_damping: 0.1,
  }

  test(`gates interactions on speed and doubles ortho zoom`, () => {
    const props = build_orbit_props(opts)
    expect([props.enableRotate, props.enableZoom, props.enablePan]).toEqual([
      true,
      true,
      false,
    ])
    expect([props.autoRotate, props.enableDamping]).toEqual([false, true])
    expect(props.zoomSpeed).toBe(0.5)
    expect(build_orbit_props({ ...opts, camera_projection: `orthographic` }).zoomSpeed).toBe(1)
  })

  // Rotation feel is easy to regress by nudging one default, and neither number reads as
  // wrong on its own. OrbitControls turns the camera by 360° * drag_px * rotateSpeed /
  // canvas_height_px, then pays a released gesture out at dampingFactor per frame — so assert
  // the drag distance and settle time those defaults produce, not the defaults themselves.
  test(`default rotation stays controllable on a default-height canvas`, () => {
    const { rotate_speed, rotation_damping } = DEFAULTS.structure
    const props = build_orbit_props({ ...opts, rotate_speed, rotation_damping })
    const deg_per_drag_px = (360 * props.rotateSpeed) / 500 // --struct-height default
    // a 15° nudge to peek behind an atom must be a deliberate drag, not a trackpad twitch
    expect(15 / deg_per_drag_px).toBeGreaterThan(30)
    // the queued tail decays by (1 - dampingFactor) per frame; spend it inside half a second
    // at 60 fps or the view keeps drifting past wherever the pointer was released
    expect(Math.log(0.01) / Math.log(1 - props.dampingFactor) / 60).toBeLessThan(0.5)
  })

  test(`onstart/onend toggle camera_is_moving and run on_start_extra once`, () => {
    const set_camera_is_moving = vi.fn()
    const on_start_extra = vi.fn()
    const props = build_orbit_props({ ...opts, set_camera_is_moving, on_start_extra })
    props.onstart()
    expect(set_camera_is_moving).toHaveBeenCalledWith(true)
    expect(on_start_extra).toHaveBeenCalledOnce()
    props.onend()
    expect(set_camera_is_moving).toHaveBeenLastCalledWith(false)
    expect(on_start_extra).toHaveBeenCalledOnce() // not re-run on end
  })

  describe(`page visibility`, () => {
    afterEach(() => {
      page_visibility.visible = true
    })

    test.each([
      [true, true],
      [false, false],
    ])(`visible=%s keeps autoRotate=%s (speed preserved)`, (visible, auto_rotate_on) => {
      page_visibility.visible = visible
      const props = build_orbit_props({ ...opts, auto_rotate: 1.5 })
      expect(props.autoRotate).toBe(auto_rotate_on)
      expect(props.autoRotateSpeed).toBe(1.5) // resumes at full speed when shown
    })
  })

  describe(`perspective zoom limits`, () => {
    const height = 600
    const fov = 30
    const perspective_opts = {
      ...opts,
      min_zoom: 0.1,
      max_zoom: 20_000,
      viewport_px: height,
      fov,
    }

    // Measure scale through Three.js projection matrices.
    test.each([[0.1], [1], [50], [20_000]])(
      `%s px/Å becomes the distance at which three.js draws 1 Å that big`,
      (zoom) => {
        const distance = perspective_distance_for_zoom(zoom, height, fov)
        const camera = new PerspectiveCamera(fov, 4 / 3, 0.01, 1e7)
        // two points 1 Å apart across the view, on the plane the camera orbits around
        const [left, right] = [
          new Vector3(0, 0, -distance).project(camera),
          new Vector3(1, 0, -distance).project(camera),
        ]
        // NDC spans [-1, 1] over the full viewport, so half the height converts it to pixels
        const px_per_angstrom = ((right.x - left.x) * (camera.aspect * height)) / 2
        expect(px_per_angstrom).toBeCloseTo(zoom, 6)
      },
    )

    test(`hands OrbitControls the near limit for zooming in and the far one for out`, () => {
      const props = build_orbit_props(perspective_opts)
      expect(props.minDistance).toBeCloseTo(
        perspective_distance_for_zoom(20_000, height, fov),
        9,
      )
      expect(props.maxDistance).toBeCloseTo(perspective_distance_for_zoom(0.1, height, fov), 9)
      expect(props.minDistance).toBeLessThan(props.maxDistance)
    })

    test.each([
      [`orthographic camera`, { camera_projection: `orthographic` as const }],
      [`unmeasured viewport`, { viewport_px: 0 }],
      [`missing fov`, { fov: undefined }],
      [`no configured limits`, { min_zoom: undefined, max_zoom: undefined }],
    ])(`leaves the orbit radius unclamped for a %s`, (_name, patch) => {
      const props = build_orbit_props({ ...perspective_opts, ...patch })
      expect(props.minDistance).toBe(0)
      expect(props.maxDistance).toBe(Number.POSITIVE_INFINITY)
    })
  })
})

describe(`resolve_scene_controls`, () => {
  // Scenes forward their undestructured rest props, so an omitted prop arrives as undefined
  // and must resolve to the structure viewer's default exactly like a Svelte prop default
  test(`fills undefined props from the shared defaults and keeps explicit values`, () => {
    const resolved = resolve_scene_controls({
      rotate_speed: 3,
      gizmo: false,
      max_zoom: undefined,
      camera_projection: `orthographic`,
    })
    expect(resolved).toEqual({ ...SCENE_CONTROL_DEFAULTS, rotate_speed: 3, gizmo: false })
    expect(SCENE_CONTROL_DEFAULTS.fov).toBe(DEFAULTS.structure.fov)
    expect(`camera_projection` in resolved).toBe(false) // per-viewer default, not shared
  })
})

describe(`mirror_scene_props`, () => {
  // The viewer auto-frames the structure and the orbit controls move the camera from there,
  // so a later pass must not copy the caller's "you choose" sentinels back over the result.
  test.each([
    [`all-zero position`, [0, 0, 0]],
    [`absent position`, undefined],
  ])(`keeps the viewer's placement over an incoming %s`, (_label, camera_position) => {
    const model = { show_bonds: false, camera_position: [9, 9, 9], camera_target: [1, 1, 1] }

    mirror_scene_props(model, { show_bonds: true, camera_position, camera_target: undefined })

    expect(model.camera_position).toEqual([9, 9, 9])
    expect(model.camera_target).toEqual([1, 1, 1])
    expect(model.show_bonds).toBe(true) // non-camera config always applies
  })

  test.each([
    [`nothing placed yet`, [0, 0, 0], undefined],
    [`a placement already made`, [9, 9, 9], [1, 1, 1]],
  ])(`applies real coordinates over %s`, (_label, camera_position, camera_target) => {
    const model = { camera_position, camera_target }

    mirror_scene_props(model, { camera_position: [1, 2, 3], camera_target: [4, 5, 6] })

    expect(model.camera_position).toEqual([1, 2, 3])
    expect(model.camera_target).toEqual([4, 5, 6])
  })

  // Regression: gating camera keys to the first mirror pass left callers unable to move the
  // camera at all once mounted, since the first pass runs before their props arrive.
  test(`honours repeated moves after the viewer has placed the camera`, () => {
    const model: Record<string, unknown> = { camera_position: [0, 0, 0] }

    mirror_scene_props(model, { camera_position: [1, 2, 30] })
    expect(model.camera_position).toEqual([1, 2, 30])

    mirror_scene_props(model, { camera_position: [40, 3, 4] })
    expect(model.camera_position).toEqual([40, 3, 4])

    // re-asserting the same coordinates after the viewer drifted away still lands
    model.camera_position = [55, 17, 45]
    mirror_scene_props(model, { camera_position: [40, 3, 4] })
    expect(model.camera_position).toEqual([40, 3, 4])
  })
})
