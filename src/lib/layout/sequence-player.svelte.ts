import { FPS_STEP } from '$lib/constants'
import { clamp } from '$lib/math'
import { untrack } from 'svelte'

// Shared playback/navigation for ordered collections. Getter inputs preserve reactivity
// without taking ownership of bindable component state or domain callbacks.

type SequencePlayerInputs = {
  count: () => number
  index: () => number
  set_index: (index: number) => void
  fps: () => number
  set_fps: (fps: number) => void
  fps_range: () => readonly [number, number]
  should_auto_play: () => boolean
  on_play?: () => void
  on_pause?: () => void
  on_end?: () => void
  on_loop?: () => void
}

const FPS_SCALE = 1 / FPS_STEP
const snap_fps = (value: number, round = Math.round) => round(value * FPS_SCALE) / FPS_SCALE

export function create_sequence_player(inputs: SequencePlayerInputs) {
  let is_playing = $state(false)

  const fps_limits = $derived.by(() => {
    const [range_start, range_end] = inputs.fps_range()
    const lower = Math.min(range_start, range_end)
    const upper = Math.max(range_start, range_end)
    const min = snap_fps(lower, Math.ceil)
    const max = snap_fps(upper, Math.floor)
    return min > max ? ([lower, lower] as const) : ([min, max] as const)
  })

  const normalize_fps = (value: number): number => {
    const finite = Number.isFinite(value) ? value : fps_limits[0]
    const stepped = snap_fps(finite)
    return clamp(stepped, fps_limits[0], fps_limits[1])
  }
  const playback_fps = $derived(normalize_fps(inputs.fps()))

  // Keep externally-bound values within the control range and configured step grid.
  $effect(() => {
    if (playback_fps !== inputs.fps()) inputs.set_fps(playback_fps)
  })

  function seek(index: number): void {
    const count = inputs.count()
    if (count < 1 || !Number.isFinite(index)) return
    const next_index = clamp(Math.round(index), 0, count - 1)
    if (next_index !== inputs.index()) inputs.set_index(next_index)
  }
  const go_to = (index: number) => {
    set_playing(false)
    seek(index)
  }
  const previous = () => seek(inputs.index() - 1)
  const next = () => seek(inputs.index() + 1)
  const can_play = $derived(inputs.count() > 1 && playback_fps > 0)

  function set_playing(playing: boolean): void {
    if (playing === is_playing || (playing && !can_play)) return
    is_playing = playing
    if (playing) inputs.on_play?.()
    else inputs.on_pause?.()
  }

  const toggle = () => set_playing(!is_playing)

  // Stop immediately and notify the host when the sequence becomes unplayable.
  $effect(() => {
    if (!can_play) untrack(() => set_playing(false))
  })

  // Equivalent host object replacements must not resume user-paused playback.
  const can_auto_play = $derived(inputs.should_auto_play() && can_play)
  $effect(() => {
    if (can_auto_play) untrack(() => set_playing(true))
  })

  function advance(): void {
    if (inputs.index() < inputs.count() - 1) return next()
    inputs.on_end?.()
    seek(0)
    inputs.on_loop?.()
  }

  function handle_keydown(event: KeyboardEvent): boolean {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    const is_cmd_or_ctrl = event.metaKey || event.ctrlKey
    if (is_cmd_or_ctrl && key !== `ArrowLeft` && key !== `ArrowRight`) return false

    if (key === ` `) {
      if (!event.repeat) toggle()
    } else if (key === `ArrowLeft`) {
      if (is_cmd_or_ctrl) seek(0)
      else previous()
    } else if (key === `ArrowRight`) {
      if (is_cmd_or_ctrl) seek(inputs.count() - 1)
      else next()
    } else if (key === `Home`) seek(0)
    else if (key === `End`) seek(inputs.count() - 1)
    else if (key === `j`) seek(inputs.index() - 10)
    else if (key === `l`) seek(inputs.index() + 10)
    else if (key === `PageUp`) seek(inputs.index() - 25)
    else if (key === `PageDown`) seek(inputs.index() + 25)
    else if ([`=`, `+`, `-`].includes(key)) {
      inputs.set_fps(normalize_fps(playback_fps + (key === `-` ? -FPS_STEP : FPS_STEP)))
    } else if (key >= `0` && key <= `9`) {
      seek(Math.floor((Number(key) / 10) * (inputs.count() - 1)))
    } else return false
    return true
  }

  // rAF avoids background-tab queueing while reading FPS and index live without restarting.
  $effect(() => {
    if (!is_playing) return undefined
    let last_timestamp = performance.now()
    let accumulated_ms = 0
    let play_raf: number
    const tick = (now: number) => {
      if (!is_playing || !can_play) {
        set_playing(false)
        return
      }
      accumulated_ms += clamp(now - last_timestamp, 0, 250)
      last_timestamp = now
      const step_ms = 1000 / playback_fps
      while (accumulated_ms >= step_ms) {
        if (!is_playing || !can_play) break
        accumulated_ms -= step_ms
        advance()
      }
      if (!is_playing || !can_play) {
        set_playing(false)
        return
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
      return playback_fps
    },
    set fps(value: number) {
      inputs.set_fps(normalize_fps(value))
    },
    fps_step: FPS_STEP,
    go_to,
    play: () => set_playing(true),
    pause: () => set_playing(false),
    seek,
    previous,
    next,
    toggle,
    handle_keydown,
  }
}
