import { build_gizmo_props, build_orbit_props, page_visibility } from '$lib/scene'
import { afterEach, describe, expect, test, vi } from 'vitest'

describe(`build_gizmo_props`, () => {
  test(`shared axis defaults`, () => {
    const props = build_gizmo_props(true) as Record<string, unknown>
    expect(props.className).toBe(`responsive-gizmo`)
    expect(props.offset).toEqual({ left: 5, bottom: 5 })
    // negative axes render denser than positive ones
    const nx = props.nx as { opacity: number; hover: { opacity: number } }
    const px = props.x as { opacity: number; hover: { opacity: number } }
    expect([nx.opacity, nx.hover.opacity]).toEqual([0.9, 1])
    expect([px.opacity, px.hover.opacity]).toEqual([0.8, 0.9])
  })

  test(`object gizmo overrides axes but offset is applied last`, () => {
    const props = build_gizmo_props({ size: 42, x: { color: `#abc` } }) as Record<
      string,
      unknown
    >
    expect(props.size).toBe(42)
    expect(props.x).toEqual({ color: `#abc` })
    expect(props.offset).toEqual({ left: 5, bottom: 5 })
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
