import type { Matrix3x3, Vec3 } from '$lib/math'
import type { FlyToControls } from '$lib/scene/fly-to'
import { create_fly_to, ease_in_out } from '$lib/scene/fly-to'
import {
  get_orthographic_zoom_bounds,
  resize_orthographic_zoom,
} from '$lib/scene/props.svelte'
import type { ZoneAxisMode } from '$lib/scene/zone-axis'
import {
  is_valid_zone_axis,
  reciprocal_lattice_rows,
  zone_axis_direction,
} from '$lib/scene/zone-axis'
import { PerspectiveCamera, Vector3 } from 'three/webgpu'
import { describe, expect, test } from 'vitest'

// Deliberately triclinic (no 90-degree angle) so direct and reciprocal directions genuinely
// differ — a cubic-only test cannot tell the two conventions apart.
const triclinic: Matrix3x3 = [
  [4.2, 0, 0],
  [1.1, 5.3, 0],
  [0.7, 1.9, 6.1],
]
const cubic: Matrix3x3 = [
  [3.5, 0, 0],
  [0, 3.5, 0],
  [0, 0, 3.5],
]

// Reference directions from numpy: [uvw] as unit(indices @ A), (hkl) as unit(indices @ inv(A).T).
// The (hkl) values were independently confirmed against the plane through the axis intercepts
// a/h, b/k, c/l (max component difference 1.1e-16, i.e. below f64 eps of 2.2e-16), and
// inv(A).T matched ase.cell.Cell.reciprocal() to 1.2e-16.
const DIRECTION_TOL = 1e-12

const dot_3d = (vec_a: Vec3, vec_b: Vec3): number =>
  vec_a[0] * vec_b[0] + vec_a[1] * vec_b[1] + vec_a[2] * vec_b[2]

test.each([
  [`2x user zoom survives growth`, 80, 40, 60, undefined, undefined, 120],
  [`no minimum uses fit as zoom-out limit`, 5, 10, 20, undefined, undefined, 20],
  [`fit zoom survives shrink`, 40, 40, 20, undefined, undefined, 20],
  [`missing previous fit uses new fit`, 80, 0, 30, undefined, undefined, 30],
  [`omitted maximum leaves zoom unbounded`, 400, 10, 20, undefined, undefined, 800],
  [`fit expands maximum for small structures`, undefined, 0, 125, undefined, 100, 125],
  [`fit lowers minimum for large structures`, undefined, 0, 5, 10, 100, 5],
  [`configured maximum clamps user zoom`, 400, 10, 20, undefined, 500, 500],
  [`configured minimum preserves user zoom`, 2, 10, 20, 1, 500, 4],
] as const)(
  `rescale orthographic zoom: %s`,
  (_name, current, previous_fit, next_fit, min_zoom, max_zoom, expected) =>
    expect(resize_orthographic_zoom(current, previous_fit, next_fit, min_zoom, max_zoom)).toBe(
      expected,
    ),
)

test.each([
  [4.5, 4.5, 500],
  [800, 10, 800],
])(`orthographic bounds scale with fit %s`, (fit_zoom, min_zoom, max_zoom) => {
  expect(get_orthographic_zoom_bounds(fit_zoom, 10, 500)).toEqual({ min_zoom, max_zoom })
  expect(get_orthographic_zoom_bounds(fit_zoom).max_zoom).toBe(Number.POSITIVE_INFINITY)
})

describe(`zone axis directions`, () => {
  // oxfmt-ignore
  test.each([
    [`uvw`, `[001] leans along c, which is tilted in a triclinic cell`, [0, 0, 1], [0.108910673202, 0.295614684406, 0.949078723619]],
    [`uvw`, `[111] body diagonal`, [1, 1, 1], [0.536549015526, 0.643858818631, 0.545491499118]],
    [`uvw`, `[101] face diagonal`, [1, 0, 1], [0.608566538292, 0.235974780154, 0.757603241547]],
    [`uvw`, `[2-13] with mixed signs`, [2, -1, 3], [0.456822302225, 0.019439246903, 0.88934554582]],
    [`uvw`, `[1-10] lies in the a-b plane`, [1, -1, 0], [0.504883315038, -0.863187603129, 0]],
    [`hkl`, `(001) normal is perpendicular to a and b`, [0, 0, 1], [0, 0, 1]],
    [`hkl`, `(111) normal`, [1, 1, 1], [0.81773643973, 0.478298672295, 0.320214764212]],
    [`hkl`, `(101) normal`, [1, 0, 1], [0.830268369786, -0.172319850333, 0.530056886866]],
    [`hkl`, `(2-13) normal with mixed signs`, [2, -1, 3], [0.621611596286, -0.375312661909, 0.687560491283]],
    [`hkl`, `(1-10) normal is tilted out of the a-b plane`, [1, -1, 0], [0.700363357165, -0.700363357165, 0.137776398131]],
  ] as [ZoneAxisMode, string, Vec3, Vec3][])(
    `resolves triclinic %s direction: %s`,
    (mode, _name, indices, expected) => {
      const actual = zone_axis_direction(triclinic, indices, mode)
      for (const [idx, component] of expected.entries()) {
        expect(actual[idx]).toBeCloseTo(component, 11)
      }
      expect(Math.hypot(...actual)).toBeCloseTo(1, 14)
    },
  )

  test.each([
    [[0, 0, 1] as Vec3, 18.3632],
    [[1, 1, 1] as Vec3, 22.8703],
    [[1, 0, 1] as Vec3, 29.9819],
    [[2, -1, 3] as Vec3, 27.3584],
    [[1, -1, 0] as Vec3, 16.6352],
  ])(
    `separates [uvw] from (hkl) by a large angle in a triclinic cell for %s`,
    (indices, expected_deg) => {
      const uvw = zone_axis_direction(triclinic, indices, `uvw`)
      const hkl = zone_axis_direction(triclinic, indices, `hkl`)
      const angle_deg = (Math.acos(dot_3d(uvw, hkl)) * 180) / Math.PI
      expect(angle_deg).toBeCloseTo(expected_deg, 3)
      expect(angle_deg).toBeGreaterThan(15) // far beyond any rounding: the two really differ
    },
  )

  test.each([
    [[0, 0, 1] as Vec3],
    [[1, 1, 1] as Vec3],
    [[1, 0, 1] as Vec3],
    [[2, -1, 3] as Vec3],
    [[1, -1, 0] as Vec3],
  ])(`collapses [uvw] and (hkl) onto each other in a cubic cell for %s`, (indices) => {
    const uvw = zone_axis_direction(cubic, indices, `uvw`)
    const hkl = zone_axis_direction(cubic, indices, `hkl`)
    for (const [idx, component] of uvw.entries()) {
      expect(hkl[idx]).toBeCloseTo(component, 14)
    }
  })

  test(`builds reciprocal rows satisfying a_i . b_j = delta_ij`, () => {
    const recip = reciprocal_lattice_rows(triclinic)
    for (const [row_idx, direct_row] of triclinic.entries()) {
      for (const [col_idx, recip_row] of recip.entries()) {
        const expected = row_idx === col_idx ? 1 : 0
        expect(dot_3d(direct_row, recip_row)).toBeCloseTo(expected, 14)
      }
    }
  })

  test(`makes each (hkl) normal perpendicular to lattice vectors lying in that plane`, () => {
    // (110) contains c and the in-plane vector a - b
    const normal = zone_axis_direction(triclinic, [1, 1, 0], `hkl`)
    const in_plane_diff: Vec3 = [
      triclinic[0][0] - triclinic[1][0],
      triclinic[0][1] - triclinic[1][1],
      triclinic[0][2] - triclinic[1][2],
    ]
    expect(dot_3d(normal, triclinic[2])).toBeCloseTo(0, 13)
    expect(dot_3d(normal, in_plane_diff)).toBeCloseTo(0, 13)
  })

  test.each([
    [`a mixed-sign index set`, [1, -1, 2] as Vec3],
    [`an index set with a zero`, [1, 0, 2] as Vec3],
  ])(
    `reports the same axis for scaled indices and the opposite one for negated %s`,
    (_name, indices) => {
      const base = zone_axis_direction(triclinic, indices, `uvw`)
      const doubled = zone_axis_direction(
        triclinic,
        indices.map((index) => index * 2) as Vec3,
        `uvw`,
      )
      const negated = zone_axis_direction(
        triclinic,
        indices.map((index) => -index) as Vec3,
        `uvw`,
      )
      for (const [idx, component] of base.entries()) {
        expect(doubled[idx]).toBeCloseTo(component, 14)
        expect(negated[idx]).toBeCloseTo(-component, 14)
      }
      expect(Math.abs(dot_3d(base, doubled) - 1)).toBeLessThan(DIRECTION_TOL)
    },
  )

  test.each([[`all-zero indices`, [0, 0, 0] as Vec3, /must not be all zero/]])(
    `refuses %s`,
    (_name, indices, pattern) => {
      expect(() => zone_axis_direction(triclinic, indices, `uvw`)).toThrow(pattern)
      expect(() => zone_axis_direction(triclinic, indices, `hkl`)).toThrow(pattern)
    },
  )

  test(`refuses a singular lattice when the reciprocal lattice is required`, () => {
    const flat: Matrix3x3 = [
      [1, 0, 0],
      [2, 0, 0],
      [0, 0, 1],
    ]
    expect(() => zone_axis_direction(flat, [1, 0, 0], `hkl`)).toThrow(/singular/)
    // the direct-lattice direction is still well defined without inverting
    expect(zone_axis_direction(flat, [1, 0, 0], `uvw`)).toEqual([1, 0, 0])
  })

  test.each([
    [[0, 0, 1] as Vec3, true],
    [[-1, 0, 0] as Vec3, true],
    [[0, 0, 0] as Vec3, false],
    [[Number.NaN, 0, 1] as Vec3, false],
    [[1, Number.POSITIVE_INFINITY, 0] as Vec3, false],
  ])(`validates indices %s as %s`, (indices, expected) => {
    expect(is_valid_zone_axis(indices)).toBe(expected)
  })
})

// Fly-to is shared by the orientation gizmo (axis handles) and the zone-axis control, so its
// distance preservation, easing and pole handling are tested once here rather than per caller.
describe(`camera fly-to`, () => {
  const make_rig = (
    camera_pos: Vec3 = [0, 0, 10],
    target_pos: Vec3 = [0, 0, 0],
    up: Vec3 = [0, 1, 0],
  ) => {
    const camera = new PerspectiveCamera()
    camera.position.set(...camera_pos)
    camera.up.set(...up)
    const controls: FlyToControls = {
      target: new Vector3(...target_pos),
      enabled: true,
      update: () => {},
    }
    let invalidations = 0
    const hook_calls: string[] = []
    const fly = create_fly_to({
      camera: () => camera,
      controls: () => controls,
      duration_ms: () => 400,
      invalidate: () => (invalidations += 1),
      onstart: () => hook_calls.push(`start`),
      onchange: () => hook_calls.push(`change`),
      onend: () => hook_calls.push(`end`),
    })
    return { camera, controls, fly, hook_calls, invalidations: () => invalidations }
  }

  test.each([
    [0, 0],
    [0.25, 0.125],
    [0.5, 0.5],
    [0.75, 0.875],
    [1, 1],
  ])(`eases progress %s to %s`, (progress, expected) => {
    expect(ease_in_out(progress)).toBeCloseTo(expected, 14)
  })

  test(`rises monotonically over the whole flight`, () => {
    let previous = -1
    for (let step_idx = 0; step_idx <= 100; step_idx += 1) {
      const eased = ease_in_out(step_idx / 100)
      expect(eased).toBeGreaterThanOrEqual(previous)
      previous = eased
    }
  })

  test(`keeps the viewing distance constant while swinging the direction`, () => {
    const { camera, controls, fly } = make_rig([0, 0, 10], [1, 2, 3])
    const distance_before = camera.position.distanceTo(controls.target)
    fly.start([1, 0, 0])
    fly.step(10) // far past the 400 ms duration, so the flight lands
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(distance_before, 10)
    // landed looking down +x from the target
    expect(camera.position.x - controls.target.x).toBeCloseTo(distance_before, 10)
    expect(camera.position.y - controls.target.y).toBeCloseTo(0, 10)
    expect(camera.position.z - controls.target.z).toBeCloseTo(0, 10)
  })

  // Offsets from the orbit target partway through a 400 ms swing from +z to +x. Each is
  // ease_in_out(elapsed/400) of the way from (0,0,10) to (10,0,0), renormalized to radius 10 —
  // a linear ramp or an instant snap to the destination lands nowhere near these.
  test.each([
    // 25% of the flight, eased to 12.5%: unit(0.125 * (10,0,0) + 0.875 * (0,0,10)) * 10
    [0.1, [Math.SQRT2, 0, 7 * Math.SQRT2]],
    [0.2, [5 * Math.SQRT2, 0, 5 * Math.SQRT2]], // halfway: the exact 45 degree bisector
    [0.3, [7 * Math.SQRT2, 0, Math.SQRT2]], // 75% of the flight, eased to 87.5%
  ] as [number, Vec3][])(
    `holds the viewing radius and eases the direction %s s into the flight`,
    (elapsed_s, expected_offset) => {
      const { camera, controls, fly } = make_rig([0, 0, 10])
      fly.start([1, 0, 0])
      fly.step(elapsed_s)
      expect(fly.active).toBe(true) // still mid-flight, so this is a real intermediate frame
      expect(camera.position.distanceTo(controls.target)).toBeCloseTo(10, 12)
      const offset = camera.position.clone().sub(controls.target)
      for (const [idx, axis] of ([`x`, `y`, `z`] as const).entries()) {
        expect(offset[axis]).toBeCloseTo(expected_offset[idx], 12)
      }
    },
  )

  test(`keeps the camera aimed at the orbit target mid-flight, not only on landing`, () => {
    const { camera, controls, fly } = make_rig([0, 0, 10], [1, 2, 3])
    fly.start([1, 0, 0])
    fly.step(0.1)
    const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
    const to_target = controls.target.clone().sub(camera.position).normalize()
    expect(forward.angleTo(to_target)).toBeCloseTo(0, 12)
  })

  test(`reports the flight through the start, change and end hooks`, () => {
    const rig = make_rig()
    rig.fly.start([1, 0, 0])
    expect(rig.hook_calls).toEqual([`start`])
    rig.fly.step(0.1)
    expect(rig.hook_calls).toEqual([`start`, `change`])
    rig.fly.step(10) // lands
    expect(rig.hook_calls).toEqual([`start`, `change`, `change`, `end`])
    rig.fly.step(0.1) // nothing left to animate, so nothing more is reported
    expect(rig.hook_calls).toEqual([`start`, `change`, `change`, `end`])
  })

  test(`normalizes the requested direction, so index magnitude does not move the camera`, () => {
    const short = make_rig()
    short.fly.start([1, 1, 1])
    short.fly.step(10)
    const long = make_rig()
    long.fly.start([37, 37, 37])
    long.fly.step(10)
    for (const axis of [`x`, `y`, `z`] as const) {
      expect(long.camera.position[axis]).toBeCloseTo(short.camera.position[axis], 10)
    }
  })

  test(`nudges off the pole when asked to look straight down the camera up axis`, () => {
    const { camera, controls, fly } = make_rig([0, 0, 10], [0, 0, 0], [0, 1, 0])
    fly.start([0, 1, 0])
    fly.step(10)
    const offset = camera.position.clone().sub(controls.target)
    // still essentially along +y, but with a sliver of z so OrbitControls' polar angle is defined
    expect(offset.y).toBeGreaterThan(9.9)
    expect(offset.z).toBeGreaterThan(0)
    expect(offset.z).toBeLessThan(0.05)
  })

  test(`leaves an off-pole direction untouched`, () => {
    const { camera, controls, fly } = make_rig([0, 0, 10], [0, 0, 0], [0, 1, 0])
    fly.start([1, 0, 0])
    fly.step(10)
    const offset = camera.position.clone().sub(controls.target)
    expect(offset.y).toBeCloseTo(0, 12)
    expect(offset.z).toBeCloseTo(0, 12)
  })

  test(`suspends orbit controls for the duration of a flight and restores them on landing`, () => {
    const { controls, fly } = make_rig()
    expect(controls.enabled).toBe(true)
    fly.start([1, 0, 0])
    expect([controls.enabled, fly.active]).toEqual([false, true])
    fly.step(0.1) // 100 ms of a 400 ms flight
    expect([controls.enabled, fly.active]).toEqual([false, true])
    fly.step(0.4)
    expect([controls.enabled, fly.active]).toEqual([true, false])
  })

  test(`restores orbit controls when released mid-flight`, () => {
    const { controls, fly, hook_calls } = make_rig()
    fly.start([1, 0, 0])
    fly.step(0.1)
    expect(controls.enabled).toBe(false)
    fly.release()
    expect([controls.enabled, fly.active]).toEqual([true, false])
    expect(hook_calls).toEqual([`start`, `change`, `end`])
    fly.release()
    expect(hook_calls).toEqual([`start`, `change`, `end`]) // no duplicate end
  })

  test.each([
    [`a zero-length direction`, [0, 0, 0] as Vec3],
    [`a direction below the usable length floor`, [1e-14, 0, 0] as Vec3],
  ])(`ignores %s instead of producing a NaN camera position`, (_name, direction) => {
    const { camera, fly } = make_rig([0, 0, 10])
    fly.start(direction)
    expect(fly.active).toBe(false)
    expect([camera.position.x, camera.position.y, camera.position.z]).toEqual([0, 0, 10])
  })

  test(`requests a repaint on start and on every step`, () => {
    const rig = make_rig()
    rig.fly.start([1, 0, 0])
    expect(rig.invalidations()).toBe(1)
    rig.fly.step(0.1)
    expect(rig.invalidations()).toBe(2)
  })
})
