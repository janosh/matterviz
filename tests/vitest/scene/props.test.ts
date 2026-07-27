import {
  build_gizmo_props,
  build_orbit_props,
  mirror_scene_props,
  GIZMO_DEFAULT_STYLES,
  page_visibility,
} from '$lib/scene'
import { afterEach, describe, expect, test, vi } from 'vitest'

describe(`build_gizmo_props`, () => {
  test(`shared axis defaults`, () => {
    expect(build_gizmo_props(true)).toEqual({ offset: { left: 5, bottom: 5 } })
    // negative axes render denser than positive ones
    const { nx, x: px } = GIZMO_DEFAULT_STYLES
    expect([nx.opacity, nx.hover?.opacity]).toEqual([0.9, 1])
    expect([px.opacity, px.hover?.opacity]).toEqual([0.8, 0.9])
  })

  test(`object gizmo overrides axes and merges offset over the defaults`, () => {
    const props = build_gizmo_props({
      size: 42,
      x: { color: `#abc` },
      offset: { right: 10, bottom: 20 },
    }) as Record<string, unknown>
    expect(props.size).toBe(42)
    expect(props.x).toEqual({ color: `#abc` })
    // caller edges win; edges it left out keep their defaults
    expect(props.offset).toEqual({ left: 5, bottom: 20, right: 10 })
  })
})

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
    // onstart/onend are safe when set_camera_is_moving is omitted
    expect(() => {
      props.onstart()
      props.onend()
    }).not.toThrow()
  })

  test(`onstart/onend toggle camera_is_moving and run onstart_extra once`, () => {
    const set_camera_is_moving = vi.fn()
    const onstart_extra = vi.fn()
    const props = build_orbit_props({ ...opts, set_camera_is_moving, onstart_extra })
    props.onstart()
    expect(set_camera_is_moving).toHaveBeenCalledWith(true)
    expect(onstart_extra).toHaveBeenCalledOnce()
    props.onend()
    expect(set_camera_is_moving).toHaveBeenLastCalledWith(false)
    expect(onstart_extra).toHaveBeenCalledOnce() // not re-run on end
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
