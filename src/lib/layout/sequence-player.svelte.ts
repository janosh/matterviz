import { untrack } from 'svelte'

// Shared playback/navigation state for ordered collections such as trajectory frames and
// reaction-path images. Reactive values are supplied as getters so one controller can drive
// bindable component props without taking ownership of their domain-specific callbacks.

type SequencePlayerInputs = {
  count: () => number
  index: () => number
  set_index: (index: number) => void
  set_step_index?: (index: number) => void
  fps: () => number
  set_fps: (fps: number) => void
  fps_range: () => readonly [number, number]
  snap_fps?: boolean
  should_auto_play?: () => boolean
  on_play?: () => void
  on_pause?: () => void
  on_end?: () => void
  on_loop?: () => void
}

export function create_sequence_player(inputs: SequencePlayerInputs) {
  let is_playing = $state(false)

  const fps_step = 0.5
  const snap_fps = inputs.snap_fps ?? true
  const fps_limits = $derived.by(() => {
    const [range_start, range_end] = inputs.fps_range()
    const lower = Math.min(range_start, range_end)
    const upper = Math.max(range_start, range_end)
    if (!snap_fps) return [lower, upper] as const
    const min = Math.ceil(lower / fps_step) * fps_step
    const max = Math.floor(upper / fps_step) * fps_step
    return min > max ? ([lower, lower] as const) : ([min, max] as const)
  })

  // Keep externally-bound values within the control range. Trajectories also snap to
  // half-integer FPS, while viewers that historically accepted arbitrary rates can opt out.
  $effect(() => {
    const current = inputs.fps()
    const finite = Number.isFinite(current) ? current : fps_limits[0]
    const stepped = snap_fps ? Math.round(finite / fps_step) * fps_step : finite
    const normalized = Math.max(fps_limits[0], Math.min(fps_limits[1], stepped))
    if (normalized !== current) inputs.set_fps(normalized)
  })

  function set_valid_index(index: number, setter: (index: number) => void): void {
    const count = inputs.count()
    if (count < 1 || !Number.isFinite(index)) return
    const next = Math.min(Math.max(Math.round(index), 0), count - 1)
    if (next !== inputs.index()) setter(next)
  }

  const go_to = (index: number) => set_valid_index(index, inputs.set_index)
  const step_to = (index: number) =>
    set_valid_index(index, inputs.set_step_index ?? inputs.set_index)
  const previous = () => step_to(inputs.index() - 1)
  const next = () => step_to(inputs.index() + 1)

  function start(): void {
    if (is_playing || inputs.count() <= 1) return
    is_playing = true
    inputs.on_play?.()
  }

  function toggle(): void {
    if (!is_playing) return start()
    is_playing = false
    inputs.on_pause?.()
  }

  $effect(() => {
    if (inputs.should_auto_play?.() && inputs.count() > 1 && !untrack(() => is_playing))
      untrack(start)
  })

  function advance(): void {
    if (inputs.index() >= inputs.count() - 1) {
      inputs.on_end?.()
      go_to(0)
      inputs.on_loop?.()
    } else {
      next()
    }
  }

  // rAF pauses in background tabs and avoids setInterval queueing when rendering overruns.
  // FPS and index are read live inside the callback so changing either does not restart it.
  $effect(() => {
    if (!is_playing) return undefined
    let last = performance.now()
    let accumulated_ms = 0
    let play_raf: number
    const tick = (now: number) => {
      if (!is_playing || inputs.count() <= 1) {
        is_playing = false
        return
      }
      accumulated_ms += Math.min(now - last, 250)
      last = now
      const step_ms = 1000 / Math.max(0.1, inputs.fps())
      if (accumulated_ms >= step_ms) {
        accumulated_ms = Math.min(accumulated_ms - step_ms, step_ms)
        advance()
      }
      play_raf = requestAnimationFrame(tick)
    }
    play_raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(play_raf)
  })

  return {
    get is_playing() {
      return is_playing
    },
    get fps_min() {
      return fps_limits[0]
    },
    get fps_max() {
      return fps_limits[1]
    },
    get fps() {
      return inputs.fps()
    },
    set fps(value: number) {
      inputs.set_fps(value)
    },
    fps_input_step: snap_fps ? fps_step : (`any` as const),
    fps_step,
    go_to,
    previous,
    next,
    toggle,
  }
}
