// One animation clock for every marker of a 3D plot, so a data or encoding change glides
// markers to their new position, size and colour like the 2D ScatterPoint tween, without a
// Svelte Tween per point. Reading `current` is reactive, so anything drawn from it (instance
// buffers, the hover halo) follows the animation.

import { cubicOut } from 'svelte/easing'
import type { TweenOptions } from 'svelte/motion'
import { Color, SRGBColorSpace } from 'three/webgpu'

// Per instance: scene x, y, z, radius, then sRGB r, g, b in [0, 1]. Blending the gamma-encoded
// channels matches the 2D markers' d3-color RGB interpolation.
export const INSTANCE_STRIDE = 7

// Shares its timing fields with the 2D `point_tween`; `{ duration: 0 }` disables the animation
export type InstanceTween = Pick<TweenOptions<unknown>, `delay` | `easing`> & {
  duration?: number
}

const DEFAULTS = { delay: 0, duration: 600, easing: cubicOut }

// Packs marker specs into the flat layout above. Each distinct colour is parsed once; one three
// can't parse (e.g. a CSS variable) draws white, three's default, and warns once per pack.
export function pack_instances(
  items: readonly { position: readonly number[]; radius: number; color: string }[],
): Float32Array {
  const packed = new Float32Array(items.length * INSTANCE_STRIDE)
  const rgb_by_color = new Map<string, { r: number; g: number; b: number }>()
  items.forEach(({ position, radius, color }, idx) => {
    let rgb = rgb_by_color.get(color)
    if (!rgb) {
      rgb = new Color(color).getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace)
      rgb_by_color.set(color, rgb)
    }
    const offset = idx * INSTANCE_STRIDE
    packed.set(position, offset)
    packed[offset + 3] = radius
    packed[offset + 4] = rgb.r
    packed[offset + 5] = rgb.g
    packed[offset + 6] = rgb.b
  })
  return packed
}

const same_items = <T>(left: ArrayLike<T>, right: ArrayLike<T>): boolean => {
  if (left.length !== right.length) return false
  for (let idx = 0; idx < left.length; idx++) if (left[idx] !== right[idx]) return false
  return true
}

export interface InstanceTweenClock {
  // What to draw right now, in the packed layout
  readonly current: Float32Array
  retarget: (
    next_keys: readonly string[],
    next_target: Float32Array,
    now: number,
    options?: InstanceTween,
  ) => void
  // Advances `current` to `now`
  step: (now: number) => void
}

export function create_instance_tween(): InstanceTweenClock {
  let keys: readonly string[] = []
  let from: Float32Array = new Float32Array(0)
  let target: Float32Array = new Float32Array(0)
  // Plain, so the hot loops below don't pay for signal reads; `frame` tells readers it moved
  let current = new Float32Array(0)
  let frame = $state(0)
  let started_at = 0
  let { delay, duration, easing } = DEFAULTS
  let animating = false

  return {
    get current(): Float32Array {
      void frame
      return current
    },
    // Instances are matched by key: one already on screen starts from where it is drawn now
    // (mid-flight included), one without a previous counterpart appears at its target.
    // Retargeting to the current target keeps a running animation going.
    retarget(next_keys, next_target, now, options = {}) {
      const same_keys = same_items(next_keys, keys)
      if (same_keys && same_items(next_target, target)) return
      delay = options.delay ?? DEFAULTS.delay
      duration = options.duration ?? DEFAULTS.duration
      easing = options.easing ?? DEFAULTS.easing
      if (duration <= 0) from = next_target.slice()
      else if (same_keys) from = current.slice() // the common re-encoding case: no lookups
      else {
        from = next_target.slice()
        const prev_idx = new Map<string, number>()
        keys.forEach((key, idx) => prev_idx.set(key, idx))
        next_keys.forEach((key, idx) => {
          const prev = prev_idx.get(key)
          if (prev === undefined) return
          for (let field = 0; field < INSTANCE_STRIDE; field++) {
            from[idx * INSTANCE_STRIDE + field] = current[prev * INSTANCE_STRIDE + field]
          }
        })
      }
      keys = next_keys
      target = next_target
      current = from.slice()
      frame += 1
      started_at = now + delay
      animating = duration > 0
    },
    step(now) {
      if (!animating || now < started_at) return
      const frac = Math.min(1, (now - started_at) / duration)
      animating = frac < 1
      if (animating) {
        const eased = easing(frac)
        for (let idx = 0; idx < current.length; idx++) {
          current[idx] = from[idx] + (target[idx] - from[idx]) * eased
        }
      } else current.set(target) // exact end state, free of lerp round-off
      frame += 1
    },
  }
}
