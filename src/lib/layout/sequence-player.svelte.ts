import { FPS_STEP } from '$lib/constants'
import { untrack } from 'svelte'

// Shared playback/navigation for ordered collections. Getter inputs preserve reactivity
// without taking ownership of bindable component state or domain callbacks.

type SequencePlayerInputs = {
  count: () => number
  index: () => number
  set_index: (index: number) => void
  set_step_index?: (index: number) => void
  fps: () => number
  set_fps: (fps: number) => void
  fps_range: () => readonly [number, number]
  should_auto_play: () => boolean
  on_play?: () => void
  on_pause?: () => void
  on_end?: () => void
  on_loop?: () => void
}

export function create_sequence_player(inputs: SequencePlayerInputs) {
  let is_playing = $state(false)

  const fps_limits = $derived.by(() => {
    const [range_start, range_end] = inputs.fps_range()
    const lower = Math.min(range_start, range_end)
    const upper = Math.max(range_start, range_end)
    const min = Math.ceil(lower / FPS_STEP) * FPS_STEP
    const max = Math.floor(upper / FPS_STEP) * FPS_STEP
    return min > max ? ([lower, lower] as const) : ([min, max] as const)
  })

  const normalize_fps = (value: number): number => {
    const finite = Number.isFinite(value) ? value : fps_limits[0]
    const stepped = Math.round(finite / FPS_STEP) * FPS_STEP
    return Math.max(fps_limits[0], Math.min(fps_limits[1], stepped))
  }

  // Keep externally-bound values within the control range and configured step grid.
  $effect(() => {
    const current = inputs.fps()
    const normalized = normalize_fps(current)
    if (normalized !== current) inputs.set_fps(normalized)
  })

  function set_valid_index(index: number, setter: (index: number) => void): void {
    const count = inputs.count()
    if (count < 1 || !Number.isFinite(index)) return
    const next_index = Math.min(Math.max(Math.round(index), 0), count - 1)
    if (next_index !== inputs.index()) setter(next_index)
  }

  const go_to = (index: number) => set_valid_index(index, inputs.set_index)
  const set_step_index = inputs.set_step_index ?? inputs.set_index
  const previous = () => set_valid_index(inputs.index() - 1, set_step_index)
  const next = () => set_valid_index(inputs.index() + 1, set_step_index)

  function set_playing(playing: boolean): void {
    if (playing === is_playing || (playing && inputs.count() <= 1)) return
    is_playing = playing
    if (playing) inputs.on_play?.()
    else inputs.on_pause?.()
  }

  const toggle = () => set_playing(!is_playing)

  $effect(() => {
    if (inputs.should_auto_play() && inputs.count() > 1) untrack(() => set_playing(true))
  })

  function advance(): void {
    if (inputs.index() < inputs.count() - 1) return next()
    inputs.on_end?.()
    go_to(0)
    inputs.on_loop?.()
  }

  // rAF avoids background-tab queueing while reading FPS and index live without restarting.
  $effect(() => {
    if (!is_playing) return undefined
    let last_timestamp = performance.now()
    let accumulated_ms = 0
    let play_raf: number
    const tick = (now: number) => {
      if (!is_playing || inputs.count() <= 1) {
        is_playing = false
        return
      }
      accumulated_ms += Math.min(Math.max(now - last_timestamp, 0), 250)
      last_timestamp = now
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
    get fps_limits() {
      return fps_limits
    },
    get fps() {
      return inputs.fps()
    },
    set fps(value: number) {
      inputs.set_fps(normalize_fps(value))
    },
    fps_step: FPS_STEP,
    go_to,
    previous,
    next,
    toggle,
  }
}
