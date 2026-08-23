// Shared camera fly-to, used by the orientation gizmo (axis handles) and the zone-axis
// control (crystallographic directions). The camera's OFFSET from the orbit target is rotated
// about a fixed axis at constant radius, so the structure neither zooms nor drifts during the
// flight and the swing covers its angle at the eased rate. A lerp of the endpoints would cut
// the corner (dolly in and back out) and, between opposite handles, pass through the target.
import type { Vec3 } from '$lib/math'
import * as THREE from 'three/webgpu'

// Structural rather than the concrete OrbitControls class: Threlte's <OrbitControls> `ref` and
// three's own export are separate declarations of the same object, and only these three members
// are needed to orbit a camera around a target.
export type FlyToControls = {
  target: THREE.Vector3
  enabled: boolean
  update: () => unknown
}

type FlyToHooks = {
  // Read as getters, not values: the camera and controls are bound asynchronously and can be
  // swapped (camera projection toggle, canvas remount) between flights.
  camera: () => THREE.Camera | undefined
  controls: () => FlyToControls | undefined
  duration_ms: () => number
  invalidate: () => void
  on_start?: () => void
  on_change?: () => void
  on_end?: () => void
}

export const DEFAULT_FLY_TO_DURATION_MS = 400

// Quadratic ease so the swing starts and lands gently instead of snapping.
export const ease_in_out = (progress: number): number =>
  progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2

const ORIGIN = new THREE.Vector3()
// Below this, `dir` carries no usable direction (e.g. Miller indices 000)
const MIN_DIR_LENGTH = 1e-12
// sin of the angle between start and end direction below which they count as (anti)parallel
const MIN_SIN_ANGLE = 1e-6

// `start` takes a direction that need not be normalized; only its direction is used.
export function create_fly_to(hooks: FlyToHooks) {
  let animation: { angle: number; distance: number; elapsed: number } | null = null
  const from_dir = new THREE.Vector3()
  const to_dir = new THREE.Vector3()
  const axis = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  const offset = new THREE.Vector3()

  function start(dir: Vec3): void {
    const camera = hooks.camera()
    if (!camera) return
    const dir_length = Math.hypot(...dir)
    if (dir_length < MIN_DIR_LENGTH) return
    to_dir.set(...dir).divideScalar(dir_length)

    const controls = hooks.controls()
    const { up } = camera
    const target = controls?.target ?? ORIGIN
    const distance = camera.position.distanceTo(target) || 1
    // Looking straight down `up` is degenerate for OrbitControls (polar angle 0), so tilt off
    // the pole. `to_dir` is a unit vector, so the dot is its cosine to the up vector.
    if (Math.abs(to_dir.dot(up)) > 0.999) {
      if (Math.abs(up.z) > 0.5) to_dir.y += 1e-3
      else to_dir.z += 1e-3
      to_dir.normalize()
    }

    from_dir.copy(camera.position).sub(target).normalize()
    // A camera sitting on the target has no direction to swing from; land directly.
    if (from_dir.lengthSq() === 0) from_dir.copy(to_dir)
    axis.crossVectors(from_dir, to_dir)
    // Opposite handles share no unique great circle: orbit around the camera's up axis so
    // the flight stays level. (Parallel directions land here too; their angle is 0.)
    if (axis.length() < MIN_SIN_ANGLE)
      axis.copy(up).addScaledVector(from_dir, -up.dot(from_dir))
    axis.normalize()

    animation = { angle: from_dir.angleTo(to_dir), distance, elapsed: 0 }
    if (controls) controls.enabled = false
    hooks.on_start?.()
    hooks.invalidate()
  }

  function step(delta_seconds: number): void {
    if (!animation) return
    const camera = hooks.camera()
    if (!camera) return
    const controls = hooks.controls()
    animation.elapsed += delta_seconds * 1000
    const duration = hooks.duration_ms()
    const progress = duration > 0 ? Math.min(1, animation.elapsed / duration) : 1
    const target = controls?.target ?? ORIGIN
    rotation.setFromAxisAngle(axis, animation.angle * ease_in_out(progress))
    offset.copy(from_dir).applyQuaternion(rotation).multiplyScalar(animation.distance)
    camera.position.copy(target).add(offset)
    camera.lookAt(target)
    controls?.update()
    hooks.on_change?.()
    hooks.invalidate()
    if (progress >= 1) release()
  }

  // A flight disables orbiting until it lands. Hosts must call this when they unmount, else
  // tearing down mid-flight strands the caller's controls disabled for good.
  function release(): void {
    if (!animation) return
    animation = null
    const controls = hooks.controls()
    if (controls) controls.enabled = true
    hooks.on_end?.()
  }

  return {
    start,
    step,
    release,
    get active() {
      return animation !== null
    },
  }
}
