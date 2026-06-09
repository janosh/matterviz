import { build_gizmo_props, build_orbit_props } from '$lib/scene'
import { describe, expect, test, vi } from 'vitest'

describe(`build_gizmo_props`, () => {
  test.each([true, false])(`returns shared axis defaults for boolean gizmo=%s`, (gizmo) => {
    const props = build_gizmo_props(gizmo) as Record<string, unknown>
    expect(props.className).toBe(`responsive-gizmo`)
    expect(props.background).toEqual({ enabled: false })
    expect(props.offset).toEqual({ left: 5, bottom: 5 })
    for (const axis of [`x`, `y`, `z`, `nx`, `ny`, `nz`]) {
      const axis_opts = props[axis] as { opacity: number; hover: { opacity: number } }
      expect(axis_opts.opacity).toBe(axis.startsWith(`n`) ? 0.9 : 0.8)
      expect(axis_opts.hover.opacity).toBe(axis.startsWith(`n`) ? 1 : 0.9)
    }
  })

  test(`object gizmo overrides axis defaults but not offset`, () => {
    const props = build_gizmo_props({ size: 42, x: { color: `#abcdef` } }) as Record<
      string,
      unknown
    >
    expect(props.size).toBe(42)
    expect(props.x).toEqual({ color: `#abcdef` })
    expect(props.offset).toEqual({ left: 5, bottom: 5 }) // applied after overrides
  })
})

describe(`build_orbit_props`, () => {
  const base_opts: Parameters<typeof build_orbit_props>[0] = {
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
    set_camera_is_moving: () => {},
  }

  test(`maps props and disables interactions at zero speed`, () => {
    const props = build_orbit_props({ ...base_opts })
    expect(props.target).toEqual([1, 2, 3])
    expect(props.position).toEqual([0, 0, 0])
    expect(props.enableRotate).toBe(true)
    expect(props.enableZoom).toBe(true)
    expect(props.enablePan).toBe(false) // pan_speed = 0
    expect(props.zoomSpeed).toBe(0.5)
    expect(props.zoomToCursor).toBe(true)
    expect(props.maxZoom).toBe(100)
    expect(props.minZoom).toBe(0.1)
    expect(props.autoRotate).toBe(false)
    expect(props.enableDamping).toBe(true)
    expect(props.dampingFactor).toBe(0.1)
  })

  test(`doubles zoom speed for orthographic projection`, () => {
    const ortho = build_orbit_props({ ...base_opts, camera_projection: `orthographic` })
    expect(ortho.zoomSpeed).toBe(1)
  })

  test(`onstart/onend toggle camera_is_moving and run onstart_extra hook`, () => {
    const set_camera_is_moving = vi.fn()
    const onstart_extra = vi.fn()
    const props = build_orbit_props({ ...base_opts, set_camera_is_moving, onstart_extra })

    props.onstart()
    expect(set_camera_is_moving).toHaveBeenCalledWith(true)
    expect(onstart_extra).toHaveBeenCalledOnce()

    props.onend()
    expect(set_camera_is_moving).toHaveBeenLastCalledWith(false)
    expect(onstart_extra).toHaveBeenCalledOnce() // not re-run on end
  })
})
