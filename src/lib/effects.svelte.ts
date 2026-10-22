import { in_view } from 'svelte-widgets/attachments'
import type { Attachment } from 'svelte/attachments'
import { prefersReducedMotion } from 'svelte/motion'

// Animation length honoring the OS "reduce motion" setting: 0 (snap) while it is on. Reactive
// when read in an effect or template, so flipping the setting applies without a reload.
export const motion_duration = (ms: number): number => (prefersReducedMotion.current ? 0 : ms)

type PulseAnimationOptions = {
  step?: number // phase advance per frame
  on_tick?: () => void
  // Element the pulse decorates. When given, the loop pauses while it is off screen, since
  // on_tick callers repaint a whole canvas or invalidate a 3D scene on every frame.
  element?: () => Element | null | undefined
}

type PulseAnimation = { readonly time: number; readonly unit: number }

// `show` restarts the window rather than stacking a timer; `reset` drops it and reverts now
type Flash<T> = { readonly value: T; show: (value: T) => void; reset: () => void }

// `unit` swings through one full cycle every 2π/PULSE_FREQUENCY units of `time`
const PULSE_FREQUENCY = 4

export const pulsing_highlight_opacity = (pulse_unit: number): number => 0.1 + 0.1 * pulse_unit

// Whether a node is on screen, with `attach` as its attachment. Optimistic until an observer
// says otherwise: waiting for the first callback would delay whatever this gates, and stall
// forever under test DOMs whose stub IntersectionObserver never fires (happy-dom). A gated
// animation wastes at most a frame off screen.
export function create_on_screen(): { readonly current: boolean; attach: Attachment } {
  let on_screen = $state(true)
  return {
    get current() {
      return on_screen
    },
    attach: (node) => {
      if (typeof IntersectionObserver === `undefined`) return undefined
      const stop_observing = in_view((visible) => (on_screen = visible))(node)
      return () => {
        stop_observing()
        on_screen = true // nothing gates it until a new observer reports
      }
    },
  }
}

export function create_pulse_animation(
  active: () => boolean,
  { step = 0.02, on_tick, element }: PulseAnimationOptions = {},
): PulseAnimation {
  let time = $state(0)
  let frame_id: number | null = null
  const cancel_frame = () => {
    if (frame_id == null) return
    cancelAnimationFrame(frame_id)
    frame_id = null
  }
  // Inactive pulses restart from phase zero when they next light up
  const stop = () => {
    cancel_frame()
    time = 0
  }

  const visibility = create_on_screen()
  $effect(() => {
    const node = element?.()
    return node ? visibility.attach(node) : undefined
  })

  // Reduced motion holds the pulse at its resting phase: highlights stay visible, just still
  $effect(() => {
    if (!active() || prefersReducedMotion.current) return stop()
    // Pause, don't stop: `time` survives so the pulse resumes mid-phase, and resetting it
    // would republish `unit` to every consumer — the repaints this gate exists to avoid.
    if (!visibility.current) return cancel_frame()

    const animate = () => {
      time += step
      on_tick?.()
      if (!active()) return stop()
      frame_id = requestAnimationFrame(animate)
    }
    frame_id = requestAnimationFrame(animate)
    return cancel_frame
  })

  return {
    get time() {
      return time
    },
    get unit() {
      return 0.5 + 0.5 * Math.sin(time * PULSE_FREQUENCY)
    },
  }
}

// A value that falls back to `resting` once `duration_ms` has passed since the last `show`
// (the "Copied!" indicators). The stored handle stops an earlier timer clearing a later show;
// the teardown stops a timer writing to an unmounted component, so call during component init.
export function create_flash<T>(resting: T, duration_ms: number): Flash<T> {
  let value = $state(resting)
  let timer: ReturnType<typeof setTimeout> | undefined
  $effect(() => () => clearTimeout(timer))

  return {
    get value() {
      return value
    },
    show: (next: T) => {
      clearTimeout(timer)
      value = next
      timer = setTimeout(() => (value = resting), duration_ms)
    },
    reset: () => {
      clearTimeout(timer)
      value = resting
    },
  }
}

// Inline styles reach controls inside child components without changing their icon or hit area.
export function create_shortcut_flash<T extends string>() {
  const flash = create_flash<T | undefined>(undefined, 400)
  const color = `color-mix(in srgb, var(--accent-color, #4a9eff) 35%, transparent)`
  return {
    show: flash.show,
    style: (control: T): string =>
      flash.value === control
        ? `background: ${color}; box-shadow: 0 0 0 1px ${color}; transition: none`
        : `transition: background-color 0.2s ease-out, box-shadow 0.2s ease-out`,
  }
}
