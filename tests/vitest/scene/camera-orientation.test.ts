import type { Matrix3x3, Vec3 } from '$lib/math'
import type { FlyToControls } from '$lib/scene/fly-to'
import { create_fly_to, ease_in_out } from '$lib/scene/fly-to'
import {
  get_orthographic_zoom_bounds,
  resize_orthographic_zoom,
} from '$lib/scene/props.svelte'
import type { ZoneAxisMode } from '$lib/scene/zone-axis'
import { DEFAULTS } from '$lib/settings'
import { is_valid_zone_axis, zone_axis_direction } from '$lib/scene/zone-axis'
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
  // (0.9 * 0.3) / 0.3 is 0.9000000000000001, so a rescale that runs on an unchanged fit
  // drifts the zoom by an ulp on every bounds change
  [`unchanged fit returns the zoom bit-for-bit`, 0.9, 0.3, 0.3, 0.1, 500, 0.9],
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
])(`orthographic bounds scale with fit %s`, (fit_zoom, expected_min, expected_max) => {
  expect(get_orthographic_zoom_bounds(fit_zoom, 10, 500)).toEqual({
    min_zoom: expected_min,
    max_zoom: expected_max,
  })
  expect(get_orthographic_zoom_bounds(fit_zoom).max_zoom).toBe(Number.POSITIVE_INFINITY)
})

// The bounds are absolute pixels per Angstrom while the fit zoom is min(canvas_px) / extent, so
// defaults that suit one structure size pin the camera at the fit for another: the former 10/500
// pair left a 60 A cell (fit 10 on a 600 px canvas) unable to zoom out at all, and a 3 A molecule
// (fit 200) able to zoom in only 2.5x
test.each([[3], [10], [60], [200]])(
  `default zoom bounds leave at least 10x in and out of a %s A structure`,
  (extent_angstrom) => {
    const fit_zoom = 600 / extent_angstrom
    const { min_zoom, max_zoom } = get_orthographic_zoom_bounds(
      fit_zoom,
      DEFAULTS.structure.min_zoom,
      DEFAULTS.structure.max_zoom,
    )
    expect(fit_zoom / min_zoom).toBeGreaterThanOrEqual(10)
    expect(max_zoom / fit_zoom).toBeGreaterThanOrEqual(10)
  },
)

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

  test.each([
    [`all-zero indices`, [0, 0, 0] as Vec3, /must not be all zero/],
    [`a NaN index`, [Number.NaN, 0, 1] as Vec3, /Degenerate/],
    [`an infinite index`, [1, Number.POSITIVE_INFINITY, 0] as Vec3, /Degenerate/],
  ])(`refuses %s`, (_name, indices, pattern) => {
    expect(() => zone_axis_direction(triclinic, indices, `uvw`)).toThrow(pattern)
    expect(() => zone_axis_direction(triclinic, indices, `hkl`)).toThrow(pattern)
  })

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
    duration_ms = 400,
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
      duration_ms: () => duration_ms,
      invalidate: () => (invalidations += 1),
      on_start: () => hook_calls.push(`start`),
      on_change: () => hook_calls.push(`change`),
      on_end: () => hook_calls.push(`end`),
    })
    const offset = () => camera.position.clone().sub(controls.target)
    return { camera, controls, fly, hook_calls, invalidations: () => invalidations, offset }
  }
  const to_array = (vec: Vector3): Vec3 => [vec.x, vec.y, vec.z]

  test.each([
    [0, 0],
    [0.25, 0.125],
    [0.5, 0.5],
    [0.75, 0.875],
    [1, 1],
  ])(`eases progress %s to %s`, (progress, expected) => {
    expect(ease_in_out(progress)).toBe(expected) // exact: these are dyadic rationals
  })

  test(`easing is monotone, symmetric about the midpoint and never overshoots`, () => {
    let previous = 0
    for (let step_idx = 1; step_idx <= 1000; step_idx += 1) {
      const progress = step_idx / 1000
      const eased = ease_in_out(progress)
      expect(eased).toBeGreaterThanOrEqual(previous)
      expect(eased).toBeLessThanOrEqual(1)
      expect(eased + ease_in_out(1 - progress)).toBeCloseTo(1, 15)
      previous = eased
    }
  })

  test(`keeps the viewing distance constant while swinging the direction`, () => {
    const { camera, controls, fly, offset } = make_rig([0, 0, 10], [1, 2, 3])
    const distance_before = camera.position.distanceTo(controls.target)
    fly.start([1, 0, 0])
    fly.step(10) // far past the 400 ms duration, so the flight lands
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(distance_before, 10)
    // landed exactly on +x from the target: an off-pole direction gets no nudge
    expect(to_array(offset())).toEqual(
      [distance_before, 0, 0].map((expected) => expect.closeTo(expected, 10)),
    )
  })

  // Offsets from the orbit target partway through a 400 ms swing from +z to +x: the camera has
  // turned ease_in_out(elapsed / 400) of the 90 degrees at radius 10. A lerp of the endpoints
  // would sit at atan(1/7) = 8.1 degrees instead of 11.25 after the first quarter.
  test.each([
    [0.1, 11.25], // 25% of the flight, eased to 12.5%
    [0.2, 45], // halfway: the exact bisector
    [0.3, 78.75], // 75% of the flight, eased to 87.5%
  ])(`has swept the eased share of the angle %s s into the flight`, (elapsed_s, angle_deg) => {
    const { camera, controls, fly, offset } = make_rig([1, 2, 13], [1, 2, 3]) // offset (0,0,10)
    fly.start([1, 0, 0])
    fly.step(elapsed_s)
    expect(fly.active).toBe(true) // still mid-flight, so this is a real intermediate frame
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(10, 12)
    const angle_rad = (angle_deg * Math.PI) / 180
    expect(to_array(offset())).toEqual([
      expect.closeTo(10 * Math.sin(angle_rad), 12),
      0,
      expect.closeTo(10 * Math.cos(angle_rad), 12),
    ])
    // and stays aimed at the target mid-flight, not only on landing. Distance, not angleTo:
    // acos amplifies a 1e-16 dot-product rounding to 1.5e-8
    const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
    const to_target = controls.target.clone().sub(camera.position).normalize()
    expect(forward.distanceTo(to_target)).toBeLessThan(1e-12)
  })

  // A lerp between opposite offsets passes through zero: the camera held still, spent a frame
  // on the orbit target (radius 0, scene gone) and snapped to the far side. The flight has to
  // orbit the whole way round at full radius, around the camera's up axis so it stays level.
  test.each([
    [`+x to -x`, [10, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, -10]],
    [`+z to -z`, [0, 0, 10], [0, 0, -1], [0, 1, 0], [10, 0, 0]],
    [`+x to -x with z up`, [10, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 10, 0]],
    // pole to pole has no level path; the off-pole nudge on the destination picks the plane
    [`+y to -y`, [0, 10, 0], [0, -1, 0], [0, 1, 0], [0, 0, 10]],
  ] as [string, Vec3, Vec3, Vec3, Vec3][])(
    `orbits antipodal handles at full radius: %s`,
    (_name, camera_pos, dir, up, expected_midpoint) => {
      const { camera, controls, fly, offset } = make_rig(camera_pos, [0, 0, 0], up)
      fly.start(dir)
      let swept_deg = 0
      for (let frame = 0; frame < 20; frame += 1) {
        fly.step(0.01) // 200 ms in: eased progress 0.5, i.e. the 90 degree midpoint
        expect(camera.position.distanceTo(controls.target)).toBeCloseTo(10, 10)
        const next_deg = (new Vector3(...camera_pos).angleTo(offset()) * 180) / Math.PI
        expect(next_deg).toBeGreaterThanOrEqual(swept_deg) // monotone, no back-swing
        swept_deg = next_deg
      }
      expect(swept_deg).toBeCloseTo(90, 1)
      for (const [idx, axis] of ([`x`, `y`, `z`] as const).entries()) {
        expect(offset()[axis]).toBeCloseTo(expected_midpoint[idx], 2)
      }
      fly.step(1) // lands on `dir` (up to the 1e-3 pole nudge for +y to -y)
      expect(to_array(offset().normalize())).toEqual(dir.map((val) => expect.closeTo(val, 2)))
    },
  )

  test(`reports through the hooks, repaints each frame and suspends orbiting until landing`, () => {
    const rig = make_rig()
    expect(rig.controls.enabled).toBe(true)
    rig.fly.start([1, 0, 0])
    expect(rig.hook_calls).toEqual([`start`])
    expect([rig.invalidations(), rig.controls.enabled, rig.fly.active]).toEqual([
      1,
      false,
      true,
    ])
    rig.fly.step(0.1) // 100 ms of a 400 ms flight
    expect(rig.hook_calls).toEqual([`start`, `change`])
    expect([rig.invalidations(), rig.controls.enabled, rig.fly.active]).toEqual([
      2,
      false,
      true,
    ])
    rig.fly.step(0.4) // lands
    expect(rig.hook_calls).toEqual([`start`, `change`, `change`, `end`])
    expect([rig.invalidations(), rig.controls.enabled, rig.fly.active]).toEqual([
      3,
      true,
      false,
    ])
    rig.fly.step(0.1) // nothing left to animate, so nothing more is reported
    expect(rig.hook_calls).toEqual([`start`, `change`, `change`, `end`])
    expect(rig.invalidations()).toBe(3)
  })

  test(`a new flight takes over mid-air from the current pose without a jump`, () => {
    const { fly, hook_calls, offset, controls } = make_rig([0, 0, 10])
    fly.start([1, 0, 0])
    fly.step(0.2) // 45 degrees round
    const mid_flight = offset()
    fly.start([0, 0, -1])
    fly.step(0) // first frame of the second flight: still exactly where the first left off
    expect(to_array(offset())).toEqual(
      to_array(mid_flight).map((val) => expect.closeTo(val, 12)),
    )
    expect(hook_calls).toEqual([`start`, `change`, `start`, `change`]) // no end in between
    expect(controls.enabled).toBe(false)
    fly.step(10)
    expect(to_array(offset())).toEqual([expect.closeTo(0, 10), 0, expect.closeTo(-10, 10)])
    expect(controls.enabled).toBe(true)
  })

  test(`normalizes the requested direction, so index magnitude does not move the camera`, () => {
    const short = make_rig()
    short.fly.start([1, 1, 1])
    short.fly.step(10)
    const long = make_rig()
    long.fly.start([37, 37, 37])
    long.fly.step(10)
    expect(to_array(long.camera.position)).toEqual(
      to_array(short.camera.position).map((val) => expect.closeTo(val, 10)),
    )
    expect(short.camera.position.length()).toBeCloseTo(10, 10)
  })

  test(`nudges off the pole when asked to look straight down the camera up axis`, () => {
    const { fly, offset } = make_rig([0, 0, 10], [0, 0, 0], [0, 1, 0])
    fly.start([0, 1, 0])
    fly.step(10)
    // still essentially along +y, but with a sliver of z so OrbitControls' polar angle is defined
    expect(offset().y).toBeGreaterThan(9.9)
    expect(offset().z).toBeGreaterThan(0)
    expect(offset().z).toBeLessThan(0.05)
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
    expect(to_array(camera.position)).toEqual([0, 0, 10])
  })

  test(`a camera sitting on the target lands one unit out along the direction`, () => {
    const { camera, fly } = make_rig([1, 2, 3], [1, 2, 3])
    fly.start([0, 0, 2])
    fly.step(10)
    expect(to_array(camera.position)).toEqual([1, 2, 4])
  })

  test(`a zero duration snaps to the destination on the first frame`, () => {
    const { fly, offset, controls } = make_rig([0, 0, 10], [0, 0, 0], [0, 1, 0], 0)
    fly.start([1, 0, 0])
    fly.step(0)
    expect(to_array(offset())).toEqual([expect.closeTo(10, 12), 0, expect.closeTo(0, 12)])
    expect([fly.active, controls.enabled]).toEqual([false, true])
  })
})
