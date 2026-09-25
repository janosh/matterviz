// Serializable camera paths shared by static structures and time-dependent trajectories.
import { clamp, lerp, type Vec2, type Vec3 } from '$lib/math'
import {
  Matrix4,
  type OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Vector3,
} from 'three/webgpu'
import { read_pan_offset, set_pan_offset } from './pan'

export type CameraPose = {
  position: Vec3
  target: Vec3
  quaternion: [number, number, number, number]
  projection: 'perspective' | 'orthographic'
  zoom: number
  fov: number
  // Normalized screen offset, independent of preview/export resolution.
  pan: Vec2
}
export type CameraKeyframe = CameraPose & { time: number }
export type CameraFlight = {
  keyframes: CameraKeyframe[]
  interpolation: 'smooth' | 'linear'
}

const copy_pose = (pose: CameraPose): CameraPose => ({
  position: [...pose.position],
  target: [...pose.target],
  quaternion: [...pose.quaternion],
  projection: pose.projection,
  zoom: pose.zoom,
  fov: pose.fov,
  pan: [...pose.pan],
})

export function validate_camera_flight(value: unknown): asserts value is CameraFlight {
  if (!value || typeof value !== `object`) throw new Error(`Camera flight must be an object`)
  const { keyframes, interpolation } = value as Partial<CameraFlight>
  if (!Array.isArray(keyframes) || keyframes.length < 2)
    throw new Error(`A camera flight needs at least two keyframes`)
  if (interpolation !== `smooth` && interpolation !== `linear`)
    throw new Error(`Unknown camera interpolation: ${interpolation}`)
  const finite_vector = (vector: unknown, size: number): boolean =>
    Array.isArray(vector) &&
    vector.length === size &&
    Array.from(vector).every(Number.isFinite)
  for (const [idx, frame] of keyframes.entries()) {
    if (
      !frame ||
      typeof frame !== `object` ||
      !finite_vector(frame.position, 3) ||
      !finite_vector(frame.target, 3) ||
      !finite_vector(frame.quaternion, 4) ||
      !finite_vector(frame.pan, 2) ||
      !Number.isFinite(frame.time) ||
      !Number.isFinite(frame.zoom) ||
      frame.zoom <= 0 ||
      !Number.isFinite(frame.fov) ||
      frame.fov <= 0 ||
      frame.fov >= 180 ||
      ![`perspective`, `orthographic`].includes(frame.projection)
    )
      throw new Error(`Invalid camera keyframe ${idx + 1}`)
    if (Math.abs(Math.hypot(...frame.quaternion) - 1) > 1e-6)
      throw new Error(`Camera keyframe ${idx + 1} needs a unit quaternion`)
    if (idx === 0 ? frame.time !== 0 : frame.time <= keyframes[idx - 1].time)
      throw new Error(
        `Keyframe times must start at zero and increase strictly (keyframe ${idx + 1})`,
      )
    if (frame.projection !== keyframes[0].projection)
      throw new Error(`All keyframes must use the same camera projection`)
  }
}

// Same camera placement to within float noise (scale-relative for position and target;
// q and -q are the same rotation)
const same_view = (pose_a: CameraPose, pose_b: CameraPose): boolean => {
  const close = (vec_a: readonly number[], vec_b: readonly number[]) =>
    Math.hypot(...vec_a.map((value, idx) => value - vec_b[idx])) <=
    1e-9 * Math.max(1, Math.hypot(...vec_a))
  const quat_dot = pose_a.quaternion.reduce(
    (sum, value, idx) => sum + value * pose_b.quaternion[idx],
    0,
  )
  return (
    close(pose_a.position, pose_b.position) &&
    close(pose_a.target, pose_b.target) &&
    Math.abs(quat_dot) >= 1 - 1e-12
  )
}

// Compile once: samples have no dependence on rendering speed or previous samples.
export function create_camera_flight_sampler(
  flight: CameraFlight,
): (time: number) => CameraPose {
  validate_camera_flight(flight)
  // Smooth flights place the camera by its offset from the target in its own (slerped) frame,
  // so an orbit's offsets are one constant vector and the path is exactly circular at uniform
  // speed, however few waypoints it has. Cartesian splines cut inside the circle instead.
  const keyframes = flight.keyframes.map((frame) => ({
    ...copy_pose(frame),
    time: frame.time,
    offset: new Vector3(...frame.position)
      .sub(new Vector3(...frame.target))
      .applyQuaternion(new Quaternion(...frame.quaternion).invert())
      .toArray(),
  }))
  type CompiledKeyframe = (typeof keyframes)[number]
  const { interpolation } = flight
  const n_frames = keyframes.length
  const total = keyframes[n_frames - 1].time
  // A path ending where it starts (a 360° orbit) is a loop: its end tangents wrap around to
  // the other end. One-sided end tangents bend the first and last segments and kink the
  // camera's velocity where the video loops.
  const closed = n_frames > 2 && same_view(keyframes[0], keyframes[n_frames - 1])
  const neighbor = (idx: number, fallback: CompiledKeyframe): CompiledKeyframe => {
    if (idx >= 0 && idx < n_frames) return keyframes[idx]
    if (!closed) return fallback
    // Skip the duplicated end pose and shift time by one loop period
    const wrapped = idx < 0 ? keyframes[n_frames - 2] : keyframes[1]
    return { ...wrapped, time: wrapped.time + (idx < 0 ? -total : total) }
  }
  return (time) => {
    if (!Number.isFinite(time)) throw new Error(`Invalid camera flight time: ${time}`)
    const end_idx = keyframes.findIndex((frame) => frame.time > time)
    if (time <= 0) return copy_pose(keyframes[0])
    if (end_idx === -1) return copy_pose(keyframes[keyframes.length - 1])
    const from = keyframes[end_idx - 1]
    if (time === from.time) return copy_pose(from)
    const to = keyframes[end_idx]
    const before = neighbor(end_idx - 2, from)
    const after = neighbor(end_idx + 1, to)
    const duration = to.time - from.time
    const fraction = (time - from.time) / duration
    const squared = fraction * fraction
    const cubed = squared * fraction
    const blend = (key: 'position' | 'target' | 'offset'): Vec3 =>
      from[key].map((value, axis) => {
        if (interpolation === `linear`) return lerp(value, to[key][axis], fraction)
        // Time-aware cubic Hermite tangents pass through non-uniformly timed waypoints.
        const tangent_from = (to[key][axis] - before[key][axis]) / (to.time - before.time)
        const tangent_to = (after[key][axis] - value) / (after.time - from.time)
        return (
          (2 * cubed - 3 * squared + 1) * value +
          (cubed - 2 * squared + fraction) * duration * tangent_from +
          (-2 * cubed + 3 * squared) * to[key][axis] +
          (cubed - squared) * duration * tangent_to
        )
      }) as Vec3
    const quaternion = new Quaternion(...from.quaternion).slerp(
      new Quaternion(...to.quaternion),
      fraction,
    )
    const target = blend(`target`)
    return {
      // Linear flights keep straight segments between waypoints
      position:
        interpolation === `linear`
          ? blend(`position`)
          : new Vector3(...blend(`offset`))
              .applyQuaternion(quaternion)
              .add(new Vector3(...target))
              .toArray(),
      target,
      projection: from.projection,
      quaternion: quaternion.toArray(),
      zoom: Math.exp(lerp(Math.log(from.zoom), Math.log(to.zoom), fraction)),
      fov: lerp(from.fov, to.fov, fraction),
      pan: [lerp(from.pan[0], to.pan[0], fraction), lerp(from.pan[1], to.pan[1], fraction)],
    }
  }
}

// 45° steps: smooth flights orbit exactly (see create_camera_flight_sampler), so more
// waypoints would only add thumbnails and editable views to the planner.
const ORBIT_SEGMENTS = 8

export function orbit_camera_flight(pose: CameraPose, duration = 10): CameraFlight {
  const target = new Vector3(...pose.target)
  const offset = new Vector3(...pose.position).sub(target)
  if (offset.lengthSq() === 0)
    throw new Error(`Camera position coincides with its orbit target`)
  const up = new Vector3(0, 1, 0).applyQuaternion(new Quaternion(...pose.quaternion))
  const keyframes = Array.from(
    { length: ORBIT_SEGMENTS + 1 },
    (_unused, idx): CameraKeyframe => {
      const position = offset
        .clone()
        .applyAxisAngle(up, (2 * Math.PI * idx) / ORBIT_SEGMENTS)
        .add(target)
      return {
        ...copy_pose(pose),
        time: (duration * idx) / ORBIT_SEGMENTS,
        position: position.toArray(),
        quaternion: new Quaternion()
          .setFromRotationMatrix(new Matrix4().lookAt(position, target, up))
          .toArray(),
      }
    },
  )
  // The closing pose is exact, avoiding a visible seam when the video loops.
  keyframes[0] = { ...copy_pose(pose), time: 0 }
  keyframes[ORBIT_SEGMENTS] = { ...copy_pose(pose), time: duration }
  const flight: CameraFlight = { keyframes, interpolation: `smooth` }
  validate_camera_flight(flight)
  return flight
}

export const camera_flight_frame = (progress: number, start: number, end: number): number =>
  Math.round(lerp(start, end, clamp(progress, 0, 1)))

type FlightControls = {
  object: PerspectiveCamera | OrthographicCamera
  target: Vector3
}

// Owned by SceneCamera. A lease stops OrbitControls' update task as well as pointer input.
export function create_camera_flight_controller(
  controls: FlightControls,
  size: () => { width: number; height: number },
  set_active: (active: boolean) => void,
  invalidate: () => void,
) {
  let active = false
  let disposed = false
  const camera = controls.object
  const projection = camera instanceof PerspectiveCamera ? `perspective` : `orthographic`
  const capture = (): CameraPose => {
    const { width, height } = size()
    const pan = read_pan_offset(camera)
    return {
      position: camera.position.toArray(),
      target: controls.target.toArray(),
      quaternion: camera.quaternion.toArray(),
      zoom: camera.zoom,
      projection,
      fov: camera instanceof PerspectiveCamera ? camera.fov : 50,
      pan: [pan[0] / width, pan[1] / height],
    }
  }
  const apply = (pose: CameraPose): void => {
    if (disposed) throw new Error(`Camera was replaced during the flight`)
    if (pose.projection !== projection)
      throw new Error(`Select ${pose.projection} projection before playing this camera flight`)
    const { width, height } = size()
    camera.position.set(...pose.position)
    camera.quaternion.set(...pose.quaternion)
    controls.target.set(...pose.target)
    camera.zoom = pose.zoom
    if (camera instanceof PerspectiveCamera) camera.fov = pose.fov
    set_pan_offset(camera, [pose.pan[0] * width, pose.pan[1] * height], width, height)
    camera.updateMatrixWorld()
    invalidate()
  }
  return {
    capture,
    begin() {
      if (active || disposed) throw new Error(`Camera is unavailable or already flying`)
      const original = capture()
      active = true
      set_active(true)
      let released = false
      const release = (restore: boolean) => {
        if (released) return
        released = true
        try {
          if (restore && !disposed) apply(original)
        } finally {
          active = false
          set_active(false)
        }
      }
      return {
        apply: (pose: CameraPose) => {
          if (released) throw new Error(`Camera flight lease has ended`)
          apply(pose)
        },
        restore: () => release(true),
        // Inspection leaves the selected view in place and hands orbiting back to the user.
        commit: () => release(false),
      }
    },
    dispose() {
      disposed = true
      set_active(false)
    },
  }
}

export type CameraFlightController = ReturnType<typeof create_camera_flight_controller>
export const camera_flight_registry = new WeakMap<HTMLCanvasElement, CameraFlightController>()
