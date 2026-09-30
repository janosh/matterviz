import {
  camera_flight_frame,
  create_camera_flight_controller,
  create_camera_flight_sampler,
  orbit_camera_flight,
  validate_camera_flight,
  type CameraFlight,
  type CameraPose,
} from '$lib/scene/camera-flight'
import { read_pan_offset, set_pan_offset } from '$lib/scene/pan'
import { plan_movie, movie_frame, type MovieRequest } from '$lib/trajectory/movie'
import {
  Matrix4,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Vector3,
} from 'three/webgpu'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { describe, expect, it, vi } from 'vitest'

const pose: CameraPose = {
  position: [0, 0, 10],
  target: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
  projection: `perspective`,
  zoom: 1,
  fov: 50,
  pan: [0, 0],
}
const path = (): CameraFlight => ({
  interpolation: `smooth`,
  keyframes: [
    { ...structuredClone(pose), time: 0 },
    {
      ...structuredClone(pose),
      position: [4, 0, 10],
      time: 2,
      zoom: 4,
      fov: 70,
      pan: [0.2, -0.1],
    },
    { ...structuredClone(pose), position: [10, 0, 10], time: 5 },
  ],
})
// 30° above an off-origin target (polar angle 60° from world up) and rolled about the view axis
const tilted_target = new Vector3(1, 0.5, -2)
const tilted_position = new Vector3()
  .setFromSphericalCoords(10, Math.PI / 3, 0.6)
  .add(tilted_target)
const tilted: CameraPose = {
  ...pose,
  position: tilted_position.toArray(),
  target: tilted_target.toArray(),
  quaternion: new Quaternion()
    .setFromRotationMatrix(
      new Matrix4().lookAt(tilted_position, tilted_target, new Vector3(0.3, 1, 0).normalize()),
    )
    .toArray(),
}

describe(`movie plans`, () => {
  const video = { width: 1920, height: 1080, fps: 30, duration_s: 12 }
  it.each([1, 6, 5001])(`samples %s source frames independently of video FPS`, (count) => {
    const plan = plan_movie({ video, camera: path() }, count, pose)
    expect(plan.video.frame_count).toBe(360)
    expect(movie_frame(plan, 0)).toEqual({ source_frame: 0, camera_time: 0, timestamp_us: 0 })
    expect(movie_frame(plan, 359)).toEqual({
      source_frame: count - 1,
      camera_time: 12,
      timestamp_us: 11_966_667,
    })
    expect(plan.camera.keyframes.map(({ time }) => time)).toEqual([0, 4.8, 12])
    // A saved explicit path reproduces the resolved plan, including its frame schedule.
    const serialized = JSON.stringify(plan)
    expect(plan_movie(JSON.parse(serialized), count, pose)).toEqual(plan)
    const edited = JSON.parse(serialized)
    edited.video.fps = 60
    edited.video.duration_s = 4
    edited.camera_viewport_height = 720
    const replanned = plan_movie(edited, count, pose)
    expect(replanned.video.frame_count).toBe(240)
    expect(replanned.camera_viewport_height).toBe(720)
    expect(replanned.camera.keyframes.at(-1)?.time).toBe(4)
    expect(() => movie_frame(plan, 360)).toThrow(`outside`)
  })
  it(`keeps a selected range and holds the initial pose for a single output frame`, () => {
    const plan = plan_movie(
      { video: { ...video, duration_s: 1 / 30 }, frames: { start: 5, end: 8 } },
      10,
      pose,
    )
    expect(movie_frame(plan, 0).source_frame).toBe(5)
    expect(plan.camera.keyframes[0]).toEqual({ ...pose, time: 0 })
    expect(plan.frames).toEqual({ start: 5, end: 8 })
  })
  it.each([`perspective`, `orthographic`] as const)(
    `builds a serializable %s orbit`,
    (projection) => {
      const plan = plan_movie(
        {
          video,
          camera: { preset: `orbit`, turns: 0.5, elevation_deg: 30, distance_scale: 2 },
        },
        3,
        { ...pose, projection },
      )
      validate_camera_flight(plan.camera)
      expect(plan.camera.keyframes[0].zoom).toBe(projection === `orthographic` ? 0.5 : 1)
      for (const frame of plan.camera.keyframes) {
        // Trig and vector products at a radius of 20: allow 16 f64 eps relative.
        expect(Math.abs(Math.hypot(...frame.position) - 20)).toBeLessThan(
          16 * Number.EPSILON * 20,
        )
      }
      expect(plan.camera.keyframes[0].position).not.toEqual(
        plan.camera.keyframes.at(-1)?.position,
      )
    },
  )
  it.each([
    { video: { ...video, width: 1919 } },
    { video: { ...video, fps: 0 } },
    { video: { ...video, duration_s: NaN } },
    { video: { ...video, bitrate: -1 } },
    { video, frames: { start: 3, end: 3 } },
    { video, frames: { start: 0, end: 11 } },
    { video, camera: { preset: `orbit`, distance_scale: 0 } },
  ] satisfies MovieRequest[])(`rejects invalid movie settings: %j`, (request) => {
    expect(() => plan_movie(request, 10, pose)).toThrow(/movie|Movie|orbit/)
  })
})

describe(`camera flight sampling`, () => {
  it.each([`linear`, `smooth`] as const)(
    `samples %s paths independently of render order`,
    (interpolation) => {
      const flight = { ...path(), interpolation }
      const sample = create_camera_flight_sampler(flight)
      expect(sample(-1)).toEqual(pose)
      expect(sample(6)).toEqual({ ...pose, position: [10, 0, 10] })
      expect(sample(2)).toEqual({
        ...pose,
        position: [4, 0, 10],
        zoom: 4,
        fov: 70,
        pan: [0.2, -0.1],
      })
      const midpoint = sample(1)
      expect(midpoint).toEqual({
        ...pose,
        position: [2, 0, 10],
        zoom: 2,
        fov: 60,
        pan: [0.1, -0.05],
      })
      sample(4)
      expect(sample(1)).toEqual(midpoint)
      // Sampling owns its input snapshot and its output arrays.
      flight.keyframes[0].position[0] = 100
      midpoint.position[0] = 200
      expect(sample(1).position).toEqual([2, 0, 10])
      expect(() => sample(NaN)).toThrow(`Invalid camera flight time`)
    },
  )

  it(`interpolates the shortest quaternion arc, including equivalent opposite signs`, () => {
    const flight = path()
    flight.keyframes[1].quaternion = [0, 1, 0, 0]
    const rotation = create_camera_flight_sampler(flight)(1).quaternion
    const direction = new Vector3(0, 0, -1).applyQuaternion(new Quaternion(...rotation))
    // Unit quaternion operations: 8 f64 eps allows the two products plus normalization.
    expect(direction.distanceTo(new Vector3(-1, 0, 0))).toBeLessThan(8 * Number.EPSILON)
    flight.keyframes[1].quaternion = [0, 0, 0, -1]
    expect(create_camera_flight_sampler(flight)(1).quaternion).toEqual(pose.quaternion)
  })

  // Level camera, and the 30° elevated rolled one whose orbit is a small circle around world up
  // (not a great circle, so slerping offsets alone would leave it) and which gets leveled
  it.each([
    [pose, 0],
    [tilted, Math.PI / 6],
  ])(`flies an exactly circular, uniform, level orbit from %j`, (start, elevation) => {
    const flight = orbit_camera_flight(start, 8)
    expect(flight.keyframes).toHaveLength(9)
    const { quaternion } = flight.keyframes[0]
    expect(flight.keyframes[0]).toEqual({ ...start, time: 0, quaternion })
    expect(flight.keyframes[8]).toEqual({ ...start, time: 8, quaternion })
    expect(() => orbit_camera_flight({ ...start, position: start.target })).toThrow(
      `orbit target`,
    )
    const [x_pos, y_pos, z_pos] = start.target
    const overhead: CameraPose = { ...start, position: [x_pos, y_pos + 1, z_pos] }
    expect(() => orbit_camera_flight(overhead)).toThrow(`|elevation| < 89°`)
    const sample = create_camera_flight_sampler(flight)
    const center = new Vector3(...start.target)
    const start_offset = new Vector3(...start.position).sub(center)
    const radius = start_offset.length()
    const up = new Vector3(0, 1, 0)
    const in_plane = (vec: Vector3) => vec.clone().projectOnPlane(up)
    // Each sample is a few quaternion products, one slerp and a vector add, each exact to a
    // couple of f64 eps; 64 eps (1.4e-14) of the radius bounds their sum with margin.
    const tol = 64 * Number.EPSILON * radius
    for (let step = 0; step <= 800; step++) {
      const time = step / 100
      const { position, quaternion: rotation } = sample(time)
      const vec = new Vector3(...position).sub(center)
      expect(Math.abs(vec.length() - radius)).toBeLessThan(tol)
      // asin's slope 1 / cos 30° < 2 at most doubles that relative bound (measured 1.5 eps).
      const elevation_error = Math.asin(vec.dot(up) / vec.length()) - elevation
      expect(Math.abs(elevation_error)).toBeLessThan(128 * Number.EPSILON)
      // No roll: the camera's up axis stays in the plane of world up and the view direction.
      // Unit vectors from two rotations, a cross product and a normalize (measured 2.3 eps).
      const camera_rotation = new Quaternion(...rotation)
      const forward = new Vector3(0, 0, -1).applyQuaternion(camera_rotation)
      const camera_up = new Vector3(0, 1, 0).applyQuaternion(camera_rotation)
      const roll = camera_up.dot(up.clone().cross(forward).normalize())
      expect(Math.abs(roll)).toBeLessThan(64 * Number.EPSILON)
      // Uniform angular speed: swept azimuth is exactly proportional to time. angleTo is an
      // acos, which resolves angles near 0 and π only to ~sqrt(2 eps) = 2e-8 rad.
      const swept = in_plane(start_offset).angleTo(in_plane(vec))
      const expected = Math.PI - Math.abs(Math.PI - (2 * Math.PI * time) / 8)
      expect(Math.abs(swept - expected)).toBeLessThan(1e-7)
    }
  })

  it.each([
    [0, 5],
    [0.5, 10],
    [1, 15],
    [-1, 5],
    [2, 15],
  ])(`maps progress %s to trajectory frame %s`, (progress, expected) => {
    expect(camera_flight_frame(progress, 5, 15)).toBe(expected)
    expect(camera_flight_frame(progress, 7, 7)).toBe(7)
  })

  it.each<[string, (flight: CameraFlight) => void]>([
    [`empty`, (flight) => (flight.keyframes = [])],
    [`duplicate time`, (flight) => (flight.keyframes[1].time = 0)],
    [`nonzero start`, (flight) => (flight.keyframes[0].time = 1)],
    [`NaN`, (flight) => (flight.keyframes[1].position[0] = NaN)],
    [`sparse vector`, (flight) => Reflect.deleteProperty(flight.keyframes[1].position, 0)],
    [`zero zoom`, (flight) => (flight.keyframes[1].zoom = 0)],
    [`invalid FOV`, (flight) => (flight.keyframes[1].fov = 180)],
    [`non-unit quaternion`, (flight) => (flight.keyframes[1].quaternion = [0, 0, 0, 0])],
    [`mixed projections`, (flight) => (flight.keyframes[1].projection = `orthographic`)],
  ])(`rejects %s before touching a camera`, (_name, corrupt) => {
    const flight = path()
    corrupt(flight)
    expect(() => validate_camera_flight(flight)).toThrow(/keyframe|Keyframe/)
  })
})

it.each([`perspective`, `orthographic`] as const)(
  `restores %s camera, target, zoom and pan on release`,
  (projection) => {
    const camera =
      projection === `perspective` ? new PerspectiveCamera(50) : new OrthographicCamera()
    camera.position.set(0, 0, 10)
    camera.zoom = 3
    set_pan_offset(camera, [20, -30], 800, 600)
    const target = new Vector3(1, 2, 3)
    const active = vi.fn()
    const invalidate = vi.fn()
    const controller = create_camera_flight_controller(
      { object: camera, target },
      () => ({ width: 800, height: 600 }),
      active,
      invalidate,
    )
    const original = controller.capture()
    const lease = controller.begin()
    expect(() => controller.begin()).toThrow(`already flying`)
    const update_projection = vi.spyOn(camera, `updateProjectionMatrix`)
    lease.apply({ ...pose, projection, position: [2, 4, 8], zoom: 2, pan: [0.25, 0] })
    expect(update_projection).toHaveBeenCalledOnce()
    expect(camera.position.toArray()).toEqual([2, 4, 8])
    expect(read_pan_offset(camera)).toEqual([200, 0])
    expect(camera.zoom).toBe(2)
    lease.restore()
    expect(controller.capture()).toEqual(original)
    expect(active.mock.calls).toEqual([[true], [false]])
    expect(invalidate).toHaveBeenCalledTimes(2)
    lease.restore()
    expect(active).toHaveBeenCalledTimes(2)
    const next = controller.begin()
    next.apply({ ...pose, projection, zoom: 4 })
    next.commit()
    expect(controller.capture().zoom).toBe(4)
    expect(active).toHaveBeenLastCalledWith(false)
    const final = controller.begin()
    // An old lease cannot restore its snapshot or release a newer owner.
    lease.restore()
    next.commit()
    expect(active).toHaveBeenLastCalledWith(true)
    expect(() => next.apply(pose)).toThrow(`lease has ended`)
    expect(() => controller.begin()).toThrow(`already flying`)
    controller.dispose()
    expect(() => final.apply(pose)).toThrow(`replaced`)
    expect(() => final.restore()).not.toThrow()
  },
)

// "Return to original view" re-applies the captured pose and commits: a pose OrbitControls
// already holds must come back bit-identical, not re-derived through the view axis
it(`committing a pose the controls already hold keeps it exactly`, () => {
  const camera = new PerspectiveCamera(50)
  const controls = new OrbitControls(camera)
  camera.position.set(3, 4, 12)
  controls.target.set(Math.PI, Math.E, 1 / 3)
  controls.update()
  const controller = create_camera_flight_controller(
    { object: camera, target: controls.target },
    () => ({ width: 800, height: 600 }),
    vi.fn(),
    vi.fn(),
  )
  const original = controller.capture()
  const lease = controller.begin()
  lease.apply(original)
  lease.commit()
  expect(controller.capture()).toEqual(original)
})

// `path()` samples aim past their target, which commit must move onto the view axis; a level
// orbit sample (from the rolled 30° elevated start) is one OrbitControls holds as is.
it.each([
  [`linear`, { ...path(), interpolation: `linear` }, 1],
  [`smooth`, path(), 1],
  [`orbit`, orbit_camera_flight(tilted, 8), 1],
] satisfies [string, CameraFlight, number][])(
  `a committed %s flight view survives the next OrbitControls update`,
  (_name, flight, time) => {
    const camera = new PerspectiveCamera(50)
    const controls = new OrbitControls(camera)
    const controller = create_camera_flight_controller(
      { object: camera, target: controls.target },
      () => ({ width: 800, height: 600 }),
      vi.fn(),
      vi.fn(),
    )
    const sampled = create_camera_flight_sampler(flight)(time)
    const lease = controller.begin()
    lease.apply(sampled)
    lease.commit()
    const committed = controller.capture()
    controls.update()
    const updated = controller.capture()
    const forward = ({ quaternion }: CameraPose) =>
      new Vector3(0, 0, -1).applyQuaternion(new Quaternion(...quaternion))
    const turn = (pose_a: CameraPose, pose_b: CameraPose) =>
      new Quaternion(...pose_a.quaternion).angleTo(new Quaternion(...pose_b.quaternion))
    // angleTo is an acos, which resolves angles near 0 only to ~sqrt(2 eps) = 2e-8 rad.
    // Commit keeps the sampled position and view direction, dropping only roll...
    expect(committed.position).toEqual(sampled.position)
    expect(forward(committed).angleTo(forward(sampled))).toBeLessThan(1e-7)
    // ...so the update's lookAt and spherical round trip (a few f64 eps of the radius of 10 or
    // so; 64 eps bounds it with margin) leave the committed view in place.
    expect(turn(updated, committed)).toBeLessThan(1e-7)
    const moved = new Vector3(...updated.position).distanceTo(
      new Vector3(...committed.position),
    )
    expect(moved).toBeLessThan(64 * Number.EPSILON * 12)
  },
)
