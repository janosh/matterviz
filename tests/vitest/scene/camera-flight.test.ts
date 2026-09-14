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
import { OrthographicCamera, PerspectiveCamera, Quaternion, Vector3 } from 'three/webgpu'
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

  it(`builds a full orbit with exact loop endpoints and a constant-radius waypoint ring`, () => {
    const flight = orbit_camera_flight(pose, 8)
    expect(flight.keyframes).toHaveLength(9)
    expect(flight.keyframes[0]).toEqual({ ...pose, time: 0 })
    expect(flight.keyframes[8]).toEqual({ ...pose, time: 8 })
    for (const frame of flight.keyframes)
      expect(Math.abs(Math.hypot(...frame.position) - 10)).toBeLessThan(
        16 * Number.EPSILON * 10,
      )
    expect(() => orbit_camera_flight({ ...pose, position: [0, 0, 0] })).toThrow(`orbit target`)
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
