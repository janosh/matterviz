import { create_sequence_player } from '$lib/layout/sequence-player.svelte'
import { flushSync } from 'svelte'
import { describe, expect, onTestFinished, test, vi } from 'vitest'

type Host = {
  count: number
  index: number
  fps: number
  auto_play: boolean
  fps_range: readonly [number, number]
}

// Drive the rAF loop by hand: each frame callback is queued, run_frame pops and runs one
const stub_animation_frames = () => {
  const callbacks: FrameRequestCallback[] = []
  let next_id = 1
  const request_raf = vi
    .spyOn(globalThis, `requestAnimationFrame`)
    .mockImplementation((cb) => {
      callbacks.push(cb)
      return next_id++
    })
  const cancel_raf = vi.spyOn(globalThis, `cancelAnimationFrame`).mockImplementation(() => {})
  const performance_now = vi.spyOn(performance, `now`).mockReturnValue(0)
  onTestFinished(() => {
    request_raf.mockRestore()
    cancel_raf.mockRestore()
    performance_now.mockRestore()
  })
  const run_frame = (timestamp: number) => {
    const callback = callbacks.shift()
    if (!callback) throw new Error(`Missing animation frame callback`)
    callback(timestamp)
    flushSync()
  }
  return { callbacks, cancel_raf, performance_now, run_frame }
}

function make_player(overrides: Partial<Host> = {}) {
  const host = $state<Host>({
    count: 5,
    index: 0,
    fps: 10,
    auto_play: false,
    fps_range: [0, 300],
    ...overrides,
  })
  const events: string[] = []
  const set_index = vi.fn((index: number) => {
    host.index = index
  })
  let player!: ReturnType<typeof create_sequence_player>
  const destroy = $effect.root(() => {
    player = create_sequence_player({
      count: () => host.count,
      index: () => host.index,
      set_index,
      fps: () => host.fps,
      set_fps: (fps) => (host.fps = fps),
      fps_range: () => host.fps_range,
      should_auto_play: () => host.auto_play,
      on_play: () => events.push(`play:${host.index}`),
      on_pause: () => events.push(`pause:${host.index}`),
      on_end: () => events.push(`end:${host.index}`),
      on_loop: () => events.push(`loop`),
    })
  })
  onTestFinished(destroy)
  flushSync()
  return { host, events, player, set_index, destroy }
}

describe(`create_sequence_player`, () => {
  test.each([
    [`previous at the first item`, 0, (pl: Player) => pl.previous(), 0, 0],
    [`next at the last item`, 4, (pl: Player) => pl.next(), 4, 0],
    [`seek below zero`, 2, (pl: Player) => pl.seek(-5), 0, 1],
    [`seek past the end`, 2, (pl: Player) => pl.seek(99), 4, 1],
    [`seek rounds fractional indices`, 0, (pl: Player) => pl.seek(2.6), 3, 1],
    [`seek ignores NaN`, 2, (pl: Player) => pl.seek(Number.NaN), 2, 0],
    [`seek to the current index is a no-op`, 2, (pl: Player) => pl.seek(2), 2, 0],
    [`go_to seeks and pauses`, 1, (pl: Player) => pl.go_to(3), 3, 1],
  ])(`%s clamps within [0, count)`, (_name, start, act, expected, set_calls) => {
    const { host, player, set_index } = make_player({ index: start })
    act(player)
    expect(host.index).toBe(expected)
    expect(set_index).toHaveBeenCalledTimes(set_calls)
  })

  test(`stepping clamps to the shrunken range after the sequence loses items`, () => {
    const { host, player } = make_player({ index: 4 })
    host.count = 3
    flushSync()
    player.next()
    expect(host.index).toBe(2)
    player.seek(10)
    expect(host.index).toBe(2)
  })

  test(`empty or single-item sequences cannot play and ignore seeks`, () => {
    const { host, player, events } = make_player({ count: 1, index: 0 })
    player.play()
    player.toggle()
    player.seek(3)
    expect(player.is_playing).toBe(false)
    expect(host.index).toBe(0)
    expect(events).toEqual([])
    host.count = 0
    flushSync()
    player.next()
    expect(host.index).toBe(0)
  })

  test(`advances on the fps grid, catches up after long frames, loops at the end`, () => {
    const { callbacks, run_frame } = stub_animation_frames()
    const { host, player, events } = make_player({ fps: 10, index: 3 })
    player.play()
    flushSync()
    expect(player.is_playing).toBe(true)
    expect(callbacks).toHaveLength(1)

    run_frame(50) // below one 100 ms step: nothing moves yet
    expect(host.index).toBe(3)
    run_frame(100) // 4 -> last item
    expect(host.index).toBe(4)
    run_frame(200) // past the end: wraps to 0 and reports end + loop
    expect(host.index).toBe(0)
    expect(events).toEqual([`play:3`, `end:4`, `loop`])

    // One long frame catches up several steps, but a stall is capped at 250 ms (2 steps)
    run_frame(420) // 220 ms elapsed -> 2 steps
    expect(host.index).toBe(2)
    run_frame(5000) // 4580 ms elapsed, capped to 250 -> 2 steps
    expect(host.index).toBe(4)
  })

  test(`fps changes mid-play take effect on the next frame without restarting the loop`, () => {
    const { callbacks, cancel_raf, run_frame } = stub_animation_frames()
    const { host, player } = make_player({ fps: 10 })
    player.play()
    flushSync()
    run_frame(100)
    expect(host.index).toBe(1)

    host.fps = 100
    flushSync()
    expect(cancel_raf).not.toHaveBeenCalled()
    expect(callbacks).toHaveLength(1) // the same chained callback, no extra schedule
    run_frame(130) // 30 ms at 100 fps = 3 steps
    expect(host.index).toBe(4)

    player.fps = 20 // setter snaps through the same normalizer
    expect(host.fps).toBe(20)
    host.fps = 0 // unplayable: stops and drains the loop
    flushSync()
    expect(player.is_playing).toBe(false)
    expect(cancel_raf).toHaveBeenCalledTimes(1)
  })

  test(`play twice schedules one loop; pause and destroy cancel the pending frame`, () => {
    const { callbacks, cancel_raf } = stub_animation_frames()
    const { player, events, destroy } = make_player()
    player.play()
    player.play()
    player.toggle() // already playing -> pauses
    player.play()
    flushSync()
    expect(events).toEqual([`play:0`, `pause:0`, `play:0`])
    expect(callbacks).toHaveLength(1)

    player.pause()
    flushSync()
    expect(cancel_raf).toHaveBeenCalledWith(1)
    player.pause()
    flushSync()
    expect(events).toEqual([`play:0`, `pause:0`, `play:0`, `pause:0`])

    player.play()
    flushSync()
    expect(callbacks).toHaveLength(2)
    destroy()
    expect(cancel_raf).toHaveBeenLastCalledWith(2)
  })

  test(`stops with on_pause when the sequence shrinks below two items while playing`, () => {
    const { callbacks, cancel_raf } = stub_animation_frames()
    const { host, player, events } = make_player({ index: 2 })
    player.play()
    flushSync()
    host.count = 1
    flushSync()
    expect(player.is_playing).toBe(false)
    expect(events).toEqual([`play:2`, `pause:2`])
    expect(cancel_raf).toHaveBeenCalledTimes(1)
    expect(callbacks).toHaveLength(1) // stale frame: running it must not advance
    callbacks[0](500)
    flushSync()
    expect(host.index).toBe(2)
  })

  test(`auto-play starts when allowed and playable, but never resumes a user pause`, () => {
    stub_animation_frames()
    const { host, player, events } = make_player({ auto_play: true, count: 1 })
    expect(player.is_playing).toBe(false)
    host.count = 4
    flushSync()
    expect(events).toEqual([`play:0`])

    player.pause()
    flushSync()
    host.index = 2 // unrelated host changes do not re-trigger auto-play
    flushSync()
    expect(player.is_playing).toBe(false)

    host.auto_play = false
    flushSync()
    host.auto_play = true
    flushSync()
    expect(events).toEqual([`play:0`, `pause:0`, `play:2`])
  })

  test.each([
    [{ fps: 7.26, fps_range: [0, 300] }, 7.3, [0, 300]],
    [{ fps: 500, fps_range: [0, 300] }, 300, [0, 300]],
    [{ fps: Number.NaN, fps_range: [0.1, 300] }, 0.1, [0.1, 300]],
    [{ fps: 5, fps_range: [300, 2.04] }, 5, [2.1, 300]], // reversed + snapped inward
    [{ fps: 5, fps_range: [2.04, 2.06] }, 2.04, [2.04, 2.04]], // no grid point inside
  ] as const)(`normalizes host fps %j to %s with limits %j`, (overrides, fps, limits) => {
    const { host, player } = make_player({ ...overrides, fps_range: [...overrides.fps_range] })
    expect(player.fps).toBeCloseTo(fps, 10)
    expect(host.fps).toBeCloseTo(fps, 10) // written back so the bound value is valid
    expect(player.fps_limits.map((lim) => Number(lim.toFixed(10)))).toEqual(limits)
    expect(player.fps_step).toBe(0.1)
  })

  test.each([
    [{ key: ` ` }, { index: 2, fps: 10, playing: true }, true],
    [{ key: ` `, repeat: true }, { index: 2, fps: 10, playing: false }, true],
    [{ key: `ArrowRight` }, { index: 3, fps: 10, playing: false }, true],
    [{ key: `ArrowLeft` }, { index: 1, fps: 10, playing: false }, true],
    [{ key: `ArrowLeft`, metaKey: true }, { index: 0, fps: 10, playing: false }, true],
    [{ key: `ArrowRight`, ctrlKey: true }, { index: 9, fps: 10, playing: false }, true],
    [{ key: `Home` }, { index: 0, fps: 10, playing: false }, true],
    [{ key: `End` }, { index: 9, fps: 10, playing: false }, true],
    [{ key: `j` }, { index: 0, fps: 10, playing: false }, true],
    [{ key: `L` }, { index: 9, fps: 10, playing: false }, true],
    [{ key: `PageUp` }, { index: 0, fps: 10, playing: false }, true],
    [{ key: `PageDown` }, { index: 9, fps: 10, playing: false }, true],
    [{ key: `+` }, { index: 2, fps: 10.1, playing: false }, true],
    [{ key: `=` }, { index: 2, fps: 10.1, playing: false }, true],
    [{ key: `-` }, { index: 2, fps: 9.9, playing: false }, true],
    [{ key: `5` }, { index: 4, fps: 10, playing: false }, true],
    [{ key: `0` }, { index: 0, fps: 10, playing: false }, true],
    [{ key: `9` }, { index: 8, fps: 10, playing: false }, true],
    [{ key: `q` }, { index: 2, fps: 10, playing: false }, false],
    [{ key: `f`, ctrlKey: true }, { index: 2, fps: 10, playing: false }, false],
    [{ key: `j`, metaKey: true }, { index: 2, fps: 10, playing: false }, false],
  ])(`handle_keydown(%j) -> %j, handled=%s`, (init, expected, handled) => {
    stub_animation_frames()
    const { host, player } = make_player({ count: 10, index: 2 })
    expect(player.handle_keydown(new KeyboardEvent(`keydown`, init))).toBe(handled)
    flushSync()
    expect(host.index).toBe(expected.index)
    expect(host.fps).toBeCloseTo(expected.fps, 10)
    expect(player.is_playing).toBe(expected.playing)
  })
})

type Player = ReturnType<typeof create_sequence_player>
