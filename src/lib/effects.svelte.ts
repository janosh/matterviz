type PulseAnimationOptions = {
  step?: number
  frequency?: number
  on_tick?: () => void
  reset_when_inactive?: boolean
}

type PulseAnimation = { readonly time: number; readonly unit: number }

export function create_pulse_animation(
  active: () => boolean,
  options: PulseAnimationOptions = {},
): PulseAnimation {
  let time = $state(0)
  let frame_id: number | null = null
  const { step = 0.02, frequency = 4, on_tick, reset_when_inactive = true } = options
  const cancel_frame = () => {
    if (frame_id == null) return
    cancelAnimationFrame(frame_id)
    frame_id = null
  }
  const stop = () => {
    cancel_frame()
    if (reset_when_inactive) time = 0
  }

  $effect(() => {
    if (!active()) return stop()

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
