// Shared camera fly-to, used by the orientation gizmo (axis handles) and the zone-axis
// control (crystallographic directions). Interpolating the camera's OFFSET from the orbit
// target rather than its absolute position keeps the viewing distance constant while the
// direction swings around, so the structure neither zooms nor drifts during the flight.
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

export type FlyToHooks = {
  // Read as getters, not values: the camera and controls are bound asynchronously and can be
  // swapped (camera projection toggle, canvas remount) between flights.
  camera: () => THREE.Camera | undefined
  controls: () => FlyToControls | undefined
  duration_ms: () => number
  invalidate: () => void
  onstart?: () => void
  onchange?: () => void
  onend?: () => void
}

// Matches the orientation gizmo's default so gizmo clicks and zone-axis jumps feel identical.
export const DEFAULT_FLY_TO_DURATION_MS = 400

// Quadratic ease so the swing starts and lands gently instead of snapping.
export const ease_in_out = (progress: number): number =>
  progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2

const FLY_TO_ORIGIN = new THREE.Vector3()
// Below this, `dir` carries no usable direction (e.g. Miller indices 000)
const MIN_DIR_LENGTH = 1e-12

// `start` takes a direction that need not be normalized; only its direction is used.
export function create_fly_to(hooks: FlyToHooks) {
  let animation: {
    from: THREE.Vector3
    to: THREE.Vector3
    distance: number
    elapsed: number
  } | null = null
  const lerped = new THREE.Vector3()

  function start(dir: Vec3): void {
    const camera = hooks.camera()
    if (!camera) return
    const dir_length = Math.hypot(...dir)
    if (dir_length < MIN_DIR_LENGTH) return
    const unit: Vec3 = [dir[0] / dir_length, dir[1] / dir_length, dir[2] / dir_length]

    const controls = hooks.controls()
    const { up } = camera
    const target = controls?.target ?? FLY_TO_ORIGIN
    const distance = camera.position.distanceTo(target) || 1
    const to = new THREE.Vector3(...unit).multiplyScalar(distance)
    // `unit` is normalized, so this dot is its cosine to the camera's up vector. Looking
    // straight down `up` is degenerate for OrbitControls (polar angle 0), so tilt off the pole.
    if (Math.abs(unit[0] * up.x + unit[1] * up.y + unit[2] * up.z) > 0.999) {
      if (Math.abs(up.z) > 0.5) to.y += 1e-3 * distance
      else to.z += 1e-3 * distance
    }

    animation = { from: camera.position.clone().sub(target), to, distance, elapsed: 0 }
    if (controls) controls.enabled = false
    hooks.onstart?.()
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
    const target = controls?.target ?? FLY_TO_ORIGIN
    // setLength, because a straight lerp between two equally long offsets cuts the corner:
    // halfway through a 90-degree swing the camera would sit at cos(45) = 0.707 of the
    // starting radius, a 29% dolly-in and back out. Renormalizing makes the flight the pure
    // rotation this module promises.
    lerped
      .copy(animation.from)
      .lerp(animation.to, ease_in_out(progress))
      .setLength(animation.distance)
    camera.position.copy(target).add(lerped)
    camera.lookAt(target)
    controls?.update()
    hooks.onchange?.()
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
    hooks.onend?.()
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
