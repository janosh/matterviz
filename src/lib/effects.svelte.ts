type PulseAnimationOptions = {
  step?: number
  frequency?: number
  on_tick?: () => void
  reset_when_inactive?: boolean
  // Element the pulse decorates. When given, the loop pauses while it is off screen, since
  // on_tick callers repaint a whole canvas or invalidate a 3D scene on every frame.
  element?: () => Element | null | undefined
}

type PulseAnimation = { readonly time: number; readonly unit: number }

export const pulsing_highlight_opacity = (pulse_unit: number): number =>
  0.2 + 0.15 * pulse_unit

export function create_pulse_animation(
  active: () => boolean,
  options: PulseAnimationOptions = {},
): PulseAnimation {
  let time = $state(0)
  let frame_id: number | null = null
  const { step = 0.02, frequency = 4, on_tick, reset_when_inactive = true, element } = options
  const cancel_frame = () => {
    if (frame_id == null) return
    cancelAnimationFrame(frame_id)
    frame_id = null
  }
  const stop = () => {
    cancel_frame()
    if (reset_when_inactive) time = 0
  }

  // Optimistic until an observer says otherwise: a pulse with no `element` (or no
  // IntersectionObserver) runs unconditionally, a gated one wastes at most a frame off screen.
  // Waiting for the first callback would delay every pulse, and stall forever under test DOMs
  // that stub IntersectionObserver without ever invoking it (happy-dom does exactly that).
  let on_screen = $state(true)
  $effect(() => {
    const node = element?.()
    if (!node || typeof IntersectionObserver === `undefined`) return undefined
    const observer = new IntersectionObserver((entries) => {
      on_screen = entries.some((entry) => entry.isIntersecting)
    })
    observer.observe(node)
    return () => {
      observer.disconnect()
      on_screen = true // nothing gates the pulse until a new observer reports
    }
  })

  $effect(() => {
    if (!active()) return stop()
    // Pause, don't stop: `time` survives so the pulse resumes mid-phase, and resetting it
    // would republish `unit` to every consumer — the repaints this gate exists to avoid.
    if (!on_screen) return cancel_frame()

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
      return 0.5 + 0.5 * Math.sin(time * frequency)
    },
  }
}
