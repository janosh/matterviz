import {
  Trajectory,
  type TrajectoryController,
  type FrameLoader,
  type TrajectoryType,
  type TrajectoryXQuantity,
  type TrajHandlerData,
} from '$lib/trajectory'
import * as trajectory_parse from '$lib/trajectory/parse'
import { flushSync, mount, tick, unmount } from 'svelte'
import { describe, expect, onTestFinished, test, vi } from 'vitest'
import {
  deferred_fetch_responses,
  doc_query,
  flush_render,
  make_trajectory_frame,
  resize_element,
} from '../setup'

const make_traj = (metadatas: Record<string, number>[]) => ({
  frames: metadatas.map((metadata, idx) => make_trajectory_frame(idx, 1, metadata)),
  metadata: {},
})
const energy_traj = (...energies: number[]) =>
  make_traj(energies.map((energy) => ({ energy })))
const make_stepped_traj = (time_step?: number) => ({
  frames: [0, 500, 1000].map((step, frame_idx) =>
    make_trajectory_frame(step, 1, { energy: -frame_idx }),
  ),
  metadata: {},
  time_step,
  time_unit: `fs` as const,
})
const xyz = (element: string) => `1\n${element} frame\n${element} 0 0 0\n`
const request_url = (url: string | URL | Request) =>
  typeof url === `string` ? url : url instanceof URL ? url.href : url.url
const loaded_element = (data: TrajHandlerData) =>
  data.trajectory?.frames[0]?.structure.sites[0]?.species[0]?.element ?? ``
const make_indexed_traj = (frame_count: number, metadata: TrajectoryType[`metadata`] = {}) => {
  const frames = Array.from({ length: frame_count }, (_, frame_idx) =>
    make_trajectory_frame(frame_idx, 1),
  )
  const frame_loader: FrameLoader = {
    get_total_frames: vi.fn(async () => frame_count),
    build_frame_index: vi.fn(async () => []),
    load_frame: vi.fn(async (_data, frame_idx) => frames[frame_idx] ?? null),
    extract_plot_metadata: vi.fn(async () => []),
  }
  return {
    frame_loader,
    trajectory: {
      frames: [frames[0]],
      total_frames: frame_count,
      frame_loader,
      metadata,
      plot_metadata: [],
    } satisfies TrajectoryType,
  }
}

const mount_traj = (props: Record<string, unknown>) => {
  const target = document.createElement(`div`)
  document.body.append(target)
  const component = mount(Trajectory, { target, props })
  onTestFinished(() => unmount(component).finally(() => target.remove()))
  return target
}
const selected_x_quantity = (target: ParentNode) =>
  target.querySelector<HTMLSelectElement>(`.x-quantity-select`)?.value

const menu_option = (target: ParentNode, option_text: string): HTMLButtonElement => {
  const option = [...target.querySelectorAll<HTMLButtonElement>(`.view-mode-option`)].find(
    (button) => button.textContent?.includes(option_text),
  )
  if (!option) throw new Error(`${option_text} menu option not found`)
  return option
}

const stub_fetch = (fetch_impl: unknown) => {
  vi.stubGlobal(`fetch`, fetch_impl)
  onTestFinished(() => void vi.unstubAllGlobals())
}

const stub_animation_frames = () => {
  const callbacks: FrameRequestCallback[] = []
  const request_raf = vi
    .spyOn(globalThis, `requestAnimationFrame`)
    .mockImplementation((callback) => callbacks.push(callback))
  const performance_now = vi.spyOn(performance, `now`)
  onTestFinished(() => {
    request_raf.mockRestore()
    performance_now.mockRestore()
  })
  const run_frame = (timestamp: number) => {
    const callback = callbacks.shift()
    if (!callback) throw new Error(`Missing animation frame callback`)
    callback(timestamp)
    flushSync()
  }
  return { callbacks, performance_now, run_frame }
}

describe(`Trajectory`, () => {
  // StructureControls owns trail-chrome visibility; this only guards Trajectory's
  // lazy collect_msd_positions gate (Trail length appears once the stream lands).
  test(`collects trail positions lazily when trails are enabled`, async () => {
    mount_traj({
      trajectory: make_traj([{}, {}, {}]),
      display_mode: `structure`,
      show_controls: false,
      controls_open: true,
      structure_props: { show_controls: `always` },
    })
    await flush_render()

    const trail_toggle = Array.from(document.querySelectorAll(`label`))
      .find((label) => label.textContent?.includes(`Show trajectory trails`))
      ?.querySelector<HTMLInputElement>(`input[type="checkbox"]`)
    if (!trail_toggle) throw new Error(`trajectory trail toggle not found`)
    expect(document.body.textContent).not.toContain(`Trail length`)

    trail_toggle.click()
    await vi.waitFor(() => expect(document.body.textContent).toContain(`Trail length`))
  })

  test(`forwards the initial scatter controls-open state`, async () => {
    mount_traj({
      trajectory: energy_traj(-1, -2),
      display_mode: `scatter`,
      show_controls: false,
      scatter_props: { controls_open: true },
    })
    await flush_render()
    const plot = doc_query(`.scatter`)
    await resize_element(plot, 600, 400)
    expect(plot.querySelector(`.pane-open`)).not.toBeNull()
  })

  test(`does not reserve y2 padding for a streamed series without finite values`, async () => {
    const clip_width = async (include_invalid_y2: boolean): Promise<number> => {
      const trajectory: TrajectoryType = {
        ...make_traj([{}, {}, {}]),
        plot_metadata: [0, 1, 2].map((frame_number) => ({
          frame_number,
          step: frame_number,
          properties: {
            energy: -frame_number,
            ...(include_invalid_y2 ? { volume: NaN } : {}),
          },
        })),
      }
      const target = mount_traj({
        trajectory,
        display_mode: `scatter`,
        show_controls: false,
      })
      await flush_render()
      const plot = target.querySelector<HTMLElement>(`.scatter`)
      if (!plot) throw new Error(`Trajectory scatter plot not found`)
      await resize_element(plot, 600, 400)
      const width = Number(plot.querySelector(`clipPath rect`)?.getAttribute(`width`))
      if (!Number.isFinite(width))
        throw new Error(`missing or invalid scatter clip width: ${width}`)
      return width
    }

    expect(await clip_width(true)).toBe(await clip_width(false))
  })

  test(`keeps the active indexed frame across streamed metadata batches`, async () => {
    const { frame_loader, trajectory } = make_indexed_traj(2, {
      streaming_file_path: `/indexed.xyz`,
      plot_metadata_loading: true,
    })
    const props = $state({
      trajectory,
      current_step_idx: 1,
      x_quantity: undefined as TrajectoryXQuantity | undefined,
      display_mode: `structure`,
      show_controls: false,
    })
    mount_traj(props)
    await vi.waitFor(() => expect(frame_loader.load_frame).toHaveBeenCalledOnce())

    for (const frame_number of [0, 1]) {
      globalThis.dispatchEvent(
        new MessageEvent(`message`, {
          data: {
            command: `plot_metadata_stream`,
            file_path: `/indexed.xyz`,
            plot_metadata: [
              {
                frame_number,
                step: 10 * (frame_number + 1),
                properties: { energy: -frame_number },
              },
            ],
          },
        }),
      )
      await flush_render()
    }

    expect(props.trajectory.plot_metadata.map(({ frame_number }) => frame_number)).toEqual([
      0, 1,
    ])
    expect(props.x_quantity).toBe(`step`)
    expect(frame_loader.load_frame).toHaveBeenCalledOnce()
  })

  // Regression: the series-regeneration effect must survive the visible_properties
  // write-back from the legend-sync effect. That write re-runs the regeneration
  // effect while the syncing flag is set; returning before reading any reactive dep
  // leaves the effect dep-less, and Svelte permanently unlinks dep-less effects -
  // after which loading a new trajectory kept showing the previous one's series.
  test(`swapping the trajectory regenerates plot series and axis ticks`, async () => {
    const props = $state({
      trajectory: energy_traj(-1.5, -2.5),
      display_mode: `scatter` as const,
      show_controls: false,
      step_labels: [0, 1, 2],
    })
    mount_traj(props)
    await flush_render()
    let plot = doc_query(`.scatter`)
    await resize_element(plot, 600, 400)
    expect(plot.textContent).toContain(`Energy`)

    props.trajectory = {
      frames: [0, 1500, 10_000].map((step, frame_idx) =>
        make_trajectory_frame(step, 1, { volume: frame_idx * 5000 }),
      ),
      metadata: {},
    }
    await flush_render()
    plot = doc_query(`.scatter`)
    await resize_element(plot, 600, 400)
    expect(plot.textContent).toContain(`Volume`)
    expect(plot.textContent).not.toContain(`Energy`)
    const tick_labels = (axis: `x` | `y`) =>
      Array.from(plot.querySelectorAll(`.${axis}-axis .tick text`), (tick_label) =>
        tick_label.textContent?.trim(),
      )
    expect(tick_labels(`x`)).toEqual(expect.arrayContaining([`1.5k`, `10k`]))
    expect(tick_labels(`y`)).toContain(`10k`)
  })

  // Bindable x_quantity starts unset; after auto-pick it must write back the
  // effective axis so hosts can read which quantity is in effect. Empty mounts
  // must not write `frame` early or time-capable data can never auto-pick.
  test.each([
    [
      `time on first paint when POTIM is present`,
      make_stepped_traj(2),
      undefined,
      `time`,
      `time`,
    ],
    [`step on first paint without POTIM`, make_stepped_traj(), undefined, `step`, `step`],
    [`deferred until samples exist`, undefined, make_stepped_traj(2), undefined, `time`],
  ] as const)(
    `x_quantity %s`,
    async (_description, trajectory, later, expect_initial, expect_final) => {
      const props = $state({
        trajectory,
        x_quantity: undefined as TrajectoryXQuantity | undefined,
        display_mode: `scatter` as const,
        show_controls: `always` as const,
      })
      const target = mount_traj(props)
      await flush_render()
      expect(props.x_quantity).toBe(expect_initial)
      if (expect_initial !== undefined)
        expect(selected_x_quantity(target)).toBe(expect_initial)

      if (!later) return
      props.trajectory = later
      await flush_render()
      expect(props.x_quantity).toBe(expect_final)
      expect(selected_x_quantity(target)).toBe(expect_final)
    },
  )

  test.each([
    [`auto-pick update`, undefined, `time`],
    [`explicit preservation`, `frame`, `frame`],
    [`coerced time restoration`, `time`, `time`],
    [`coerced step restoration`, `step`, `step`],
  ] as const)(
    `%s when trajectory capabilities change`,
    async (_kind, initial_quantity, expected) => {
      const props = $state({
        trajectory: energy_traj(-1, -2, -3),
        x_quantity: initial_quantity,
        display_mode: `scatter` as const,
        show_controls: `always` as const,
      })
      const target = mount_traj(props)
      await flush_render()
      expect(props.x_quantity).toBe(`frame`)

      props.trajectory = make_stepped_traj(2)
      await flush_render()
      expect(props.x_quantity).toBe(expected)
      expect(selected_x_quantity(target)).toBe(expected)
    },
  )

  test(`keeps fullscreen state aligned while the browser request is pending`, async () => {
    const props = $state({
      trajectory: energy_traj(-1, -2),
      fullscreen: false,
    })
    mount_traj(props)
    await flush_render()
    const wrapper = doc_query(`.trajectory`)
    const fullscreen_button = doc_query(`.fullscreen-button`)
    wrapper.requestFullscreen = vi.fn(() => Promise.withResolvers<undefined>().promise)

    fullscreen_button.click()
    expect(wrapper.requestFullscreen).toHaveBeenCalledOnce()
    expect(props.fullscreen).toBe(false)
    expect(fullscreen_button.getAttribute(`aria-pressed`)).toBe(`false`)
  })

  test(`handles high-FPS looping, pauses, and playability changes`, async () => {
    const events: string[] = []
    const props = $state({
      trajectory: energy_traj(-1, -2, -3, -4),
      current_step_idx: 0,
      fps: 300,
      auto_play: false,
      show_controls: `always` as const,
      on_play: ({ step_idx }: TrajHandlerData) => events.push(`play:${step_idx}`),
      on_pause: ({ step_idx }: TrajHandlerData) => events.push(`pause:${step_idx}`),
      on_end: ({ step_idx }: TrajHandlerData) => events.push(`end:${step_idx}`),
      on_loop: () => events.push(`loop`),
    })
    mount_traj(props)
    await flush_render()
    const play = doc_query(`.play-button`)
    const { callbacks, performance_now, run_frame } = stub_animation_frames()
    const toggle_play = () => {
      play.click()
      flushSync()
    }
    // A player that refuses to run stays silent rather than emitting play/pause churn
    const expect_no_events_from = (act: () => void) => {
      const event_count = events.length
      act()
      flushSync()
      expect(events).toHaveLength(event_count)
    }

    // One long frame at 300 fps catches up across several steps
    performance_now.mockReturnValue(1000)
    toggle_play()
    run_frame(1011)
    expect(props.current_step_idx).toBe(3)

    // Pause, resume, then run past the last frame to loop back to the first
    toggle_play()
    callbacks.length = 0
    performance_now.mockReturnValue(1200)
    toggle_play()
    run_frame(1100)
    run_frame(1104)
    expect(props.current_step_idx).toBe(0)
    expect(events).toEqual([`play:0`, `pause:3`, `play:3`, `end:3`, `loop`])

    // 0 fps pauses and leaves the play button inert
    props.fps = 0
    flushSync()
    expect(events.at(-1)).toBe(`pause:0`)
    expect_no_events_from(toggle_play)

    // Auto-play re-arms once the sequence is playable again.
    callbacks.length = 0
    expect_no_events_from(() => {
      props.auto_play = true
    })
    props.fps = 300
    flushSync()
    expect(events.at(-1)).toBe(`play:0`)

    // Replacing the trajectory with an equivalent object must not resume a user pause.
    toggle_play()
    const replacement = { ...props.trajectory, metadata: { plot_metadata_loading: false } }
    expect_no_events_from(() => {
      props.trajectory = replacement
    })

    // Shrinking below two frames stops the player and reports it through on_pause
    callbacks.length = 0
    toggle_play()
    props.trajectory = energy_traj(-1)
    flushSync()
    run_frame(1300)
    expect(events.at(-1)).toBe(`pause:0`)
  })

  test(`pauses auto-play before committing a dragged frame`, async () => {
    const { performance_now, run_frame } = stub_animation_frames()
    performance_now.mockReturnValue(1000)
    const on_pause = vi.fn()
    const props = $state({
      trajectory: energy_traj(-1, -2, -3, -4),
      current_step_idx: 0,
      fps: 10,
      auto_play: true,
      show_controls: `always` as const,
      on_pause,
    })
    mount_traj(props)
    await flush_render()
    const slider = doc_query(`.step-slider`, HTMLInputElement)

    slider.dispatchEvent(new Event(`pointerdown`, { bubbles: true }))
    slider.value = `2`
    slider.dispatchEvent(new Event(`input`, { bubbles: true }))
    slider.dispatchEvent(new Event(`change`, { bubbles: true }))
    flushSync()

    expect(props.current_step_idx).toBe(2)
    expect(doc_query(`.play-button`).getAttribute(`aria-label`)).toBe(`Play`)
    expect(on_pause).toHaveBeenCalledOnce()
    run_frame(1100)
    expect(props.current_step_idx).toBe(2)
  })

  test(`stops frame catch-up when an end callback makes playback unplayable`, async () => {
    const on_end = vi.fn()
    const on_loop = vi.fn()
    const on_pause = vi.fn()
    const props = $state({
      trajectory: energy_traj(-1, -2),
      current_step_idx: 1,
      fps: 300,
      show_controls: `always` as const,
      on_end,
      on_loop,
      on_pause,
    })
    on_end.mockImplementation(() => {
      props.fps = 0
    })
    mount_traj(props)
    await flush_render()

    const { callbacks, performance_now, run_frame } = stub_animation_frames()
    performance_now.mockReturnValue(1000)

    doc_query(`.play-button`).click()
    flushSync()
    run_frame(1011)

    expect(on_end).toHaveBeenCalledOnce()
    expect(on_loop).toHaveBeenCalledOnce()
    expect(on_pause).toHaveBeenCalledOnce()
    expect(callbacks).toHaveLength(0)
  })

  test(`updates frame rate from keyboard shortcuts`, async () => {
    const on_frame_rate_change = vi.fn()
    const props = $state({
      trajectory: energy_traj(-1, -2, -3),
      fps: 5,
      show_controls: `always` as const,
      on_frame_rate_change,
    })
    mount_traj(props)
    await flush_render()
    const viewer = doc_query(`.trajectory`)
    expect(doc_query(`.fps-section input[type="number"]`, HTMLInputElement).value).toBe(`5`)

    on_frame_rate_change.mockClear()
    for (const [key, expected_fps] of [
      [` `, 5],
      [`+`, 5.1],
      [`-`, 5],
      [` `, 5],
    ] as const) {
      viewer.dispatchEvent(new KeyboardEvent(`keydown`, { key, bubbles: true }))
      await flush_render()
      expect(props.fps).toBe(expected_fps)
    }
    expect(on_frame_rate_change).toHaveBeenCalledTimes(2)

    viewer.dispatchEvent(new KeyboardEvent(`keydown`, { key: ` `, bubbles: true }))
    await flush_render()
    props.fps = Number.NaN
    viewer.dispatchEvent(new KeyboardEvent(`keydown`, { key: `+`, bubbles: true }))
    await flush_render()
    expect(props.fps).toBe(0.1)
  })

  // Regression: hosts restore viewer position by passing an out-of-range
  // current_step_idx (MAX_SAFE_INTEGER = "last frame"); the clamp must both
  // write back the corrected index and notify on_step_change. Slider bursts
  // commit only their latest event-target value on the next animation frame.
  test(`clamps steps, coalesces slider input, and settles after callback errors`, async () => {
    let throw_on_change = false
    const step_events: Pick<TrajHandlerData, `step_idx` | `frame_count`>[] = []
    const props = $state({
      trajectory: energy_traj(-1, -2, -3),
      current_step_idx: Number.MAX_SAFE_INTEGER,
      show_controls: `always` as const,
      on_step_change: ({ step_idx, frame_count }: TrajHandlerData) => {
        step_events.push({ step_idx, frame_count })
        if (throw_on_change) throw new Error(`host callback failed`)
      },
    })
    mount_traj(props)
    await flush_render()

    expect(props.current_step_idx).toBe(2)
    expect(step_events.at(-1)).toEqual({ step_idx: 2, frame_count: 3 })

    const step_input = doc_query(`.step-input`, HTMLInputElement)
    for (const rejected_value of [``, `99`]) {
      step_input.value = rejected_value
      step_input.dispatchEvent(new Event(`input`, { bubbles: true }))
      step_input.dispatchEvent(new Event(`change`, { bubbles: true }))
      await flush_render()
      expect(props.current_step_idx).toBe(2)
      expect(step_input.value).toBe(`2`)
    }

    const slider = doc_query(`.step-slider`, HTMLInputElement)
    const trajectory_element = doc_query(`.trajectory`)
    const commit_events: number[] = []
    trajectory_element.addEventListener(`matterviz:trajectory-step-commit`, (event) => {
      commit_events.push((event as CustomEvent<{ step_idx: number }>).detail.step_idx)
    })
    const events_before_scrub = step_events.length
    for (const value of [`0`, `1`, `0`, `1`]) {
      slider.value = value
      slider.dispatchEvent(new Event(`input`, { bubbles: true }))
    }
    flushSync()
    expect(step_events).toHaveLength(events_before_scrub)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    expect(step_events.at(-1)).toEqual({ step_idx: 1, frame_count: 3 })
    expect(step_events).toHaveLength(events_before_scrub + 1)
    expect(commit_events).toEqual([1])

    slider.value = `2`
    slider.dispatchEvent(new Event(`input`, { bubbles: true }))
    slider.value = `0`
    slider.dispatchEvent(new Event(`input`, { bubbles: true }))
    slider.dispatchEvent(new Event(`change`, { bubbles: true }))
    expect(step_events.at(-1)).toEqual({ step_idx: 0, frame_count: 3 })
    expect(step_events).toHaveLength(events_before_scrub + 2)
    expect(commit_events).toEqual([1, 0])

    vi.useFakeTimers()
    onTestFinished(() => void vi.useRealTimers())
    throw_on_change = true
    slider.value = `2`
    slider.dispatchEvent(new Event(`input`, { bubbles: true }))
    flushSync()
    expect(trajectory_element.dataset.scrubbing).toBe(`true`)
    expect(() => vi.advanceTimersToNextFrame()).toThrow(`host callback failed`)

    vi.advanceTimersByTime(81)
    flushSync()
    expect(trajectory_element.dataset.scrubbing).toBe(`false`)
  })

  // Every finished analysis pane is reachable from the one menu, and each menu entry drives
  // its own bindable open flag rather than all of them sharing one. MSD also must not
  // reappear as a top-level toggle outside the menu.
  test(`analysis menu opens each pane`, async () => {
    const options = [
      [`Mean squared displacement`, `msd_pane_open`],
      [`Velocity autocorrelation & VDOS`, `vacf_pane_open`],
      [`Structure identification`, `structure_id_pane_open`],
      [`Data inspector`, `data_inspector_open`],
    ] as const
    const props: Record<string, unknown> = $state({
      trajectory: energy_traj(-1.5, -2.5),
      show_controls: `always` as const,
      msd_pane_open: false,
      vacf_pane_open: false,
      structure_id_pane_open: false,
      data_inspector_open: false,
    })
    const target = mount_traj(props)
    await flush_render()

    expect(
      target.querySelector(`.trajectory-msd-toggle:not(.analysis-toggle-anchor)`),
    ).toBeNull()

    for (const [label, open_prop] of options) {
      doc_query(`.analysis-button`).click()
      await tick()
      menu_option(target, label).click()
      await tick()
      expect(props[open_prop]).toBe(true)
      expect(target.querySelector(`.analysis-dropdown`)).toBeNull()
    }
  })

  // setup.ts ResizeObserver reports 600; old code used calc(wrapper - 50px).
  test(`info pane max-height follows content-area height`, async () => {
    mount_traj({
      trajectory: energy_traj(-1.5),
      show_controls: `always` as const,
      info_pane_open: true,
    })
    await flush_render()
    expect(doc_query(`.trajectory-info-pane`).style.maxHeight).toBe(`600px`)
  })

  test(`show_controls.style overrides control bar styles`, async () => {
    mount_traj({
      trajectory: energy_traj(-1.5),
      show_controls: { mode: `always`, style: `z-index: 5; color: rgb(255, 0, 0)` },
    })
    await flush_render()

    const style = getComputedStyle(doc_query(`.trajectory-controls`))
    expect([style.zIndex, style.color]).toEqual([`5`, `rgb(255, 0, 0)`])
  })

  test(`controller navigates without mounted controls`, async () => {
    const on_controller = vi.fn<(controller: TrajectoryController | null) => void>()
    const on_step_change = vi.fn()
    const on_pause = vi.fn()
    const target = mount_traj({
      trajectory: energy_traj(-1.5, -2.5, -3.5),
      show_controls: false,
      auto_play: true,
      on_pause,
      on_step_change,
      on_controller,
    })
    await flush_render()

    const controller = on_controller.mock.calls[0]?.[0]
    if (!controller) throw new Error(`Trajectory controller was not registered`)
    expect(target.querySelector(`.trajectory-controls`)).toBeNull()
    expect(controller.set_step(2)).toBe(2)
    expect(controller.state()).toEqual({ current_step_idx: 2, total_frames: 3 })
    expect(on_step_change).toHaveBeenCalledWith(
      expect.objectContaining({ step_idx: 2, frame_count: 3 }),
    )
    expect(on_pause).toHaveBeenCalledOnce()
  })

  test(`view mode menu is layered and selectable`, async () => {
    const props = $state({
      trajectory: energy_traj(-1.5, -2.5),
      display_mode: `structure+scatter` as const,
      show_controls: `always` as const,
    })
    const target = mount_traj(props)
    await flush_render()

    expect(
      target.querySelector(`[aria-label="Resize structure and plot panes"]`),
    ).not.toBeNull()
    expect(
      target
        .querySelector<HTMLElement>(`.content-area`)
        ?.style.getPropertyValue(`--split-pane-size`),
    ).toBe(`50%`)
    const view_mode_button = doc_query(`.view-mode-button`)
    view_mode_button.click()
    await tick()

    const dropdown = doc_query(`.view-mode-dropdown`)
    // Inline stacking: jsdom applies no scoped styles; menu must stay above
    // content-area siblings rather than under the scatter.
    const dropdown_style = getComputedStyle(dropdown)
    expect(dropdown_style.pointerEvents).toBe(`auto`)
    expect(Number(dropdown_style.zIndex)).toBeGreaterThan(0)

    menu_option(dropdown, `Scatter-only`).click()
    await tick()

    expect(props.display_mode).toBe(`scatter`)
    expect(view_mode_button.title).toBe(`Scatter-only`)
    expect(target.querySelector(`[aria-label="Resize structure and plot panes"]`)).toBeNull()
    expect(target.querySelector(`.view-mode-dropdown`)).toBeNull()
  })

  test(`data_url reloads on change; trajectory prop wins over data_url`, async () => {
    const fetch_mock = vi.fn(
      async (url: string | URL | Request) =>
        new Response(xyz(request_url(url).includes(`b.xyz`) ? `He` : `H`)),
    )
    const loaded_elements: string[] = []
    stub_fetch(fetch_mock)
    mount_traj({
      data_url: `/ignored.xyz`,
      trajectory: energy_traj(-1),
      show_controls: `never`,
    })
    await tick()
    expect(fetch_mock).not.toHaveBeenCalled()
    const props = $state({
      data_url: `/a.xyz`,
      display_mode: `structure` as const,
      show_controls: `never` as const,
      on_file_load: (data: TrajHandlerData) => loaded_elements.push(loaded_element(data)),
    })
    mount_traj(props)
    await vi.waitFor(() => expect(loaded_elements).toEqual([`H`]))

    props.data_url = `/b.xyz`
    await vi.waitFor(() => expect(loaded_elements).toEqual([`H`, `He`]))
  })

  test(`ignores a stale trajectory URL completion`, async () => {
    const responses = deferred_fetch_responses()
    const on_file_load = vi.fn()
    const props = $state({
      data_url: `/a.xyz`,
      display_mode: `structure` as const,
      show_controls: `never` as const,
      on_file_load,
    })
    mount_traj(props)
    await vi.waitFor(() => expect(responses.has(`/a.xyz`)).toBe(true))

    props.data_url = `/b.xyz`
    await vi.waitFor(() => expect(responses.has(`/b.xyz`)).toBe(true))
    const current_response = responses.get(`/b.xyz`)?.shift()
    current_response?.resolve(new Response(xyz(`He`)))
    await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledTimes(1))

    const stale_response = responses.get(`/a.xyz`)?.shift()
    stale_response?.resolve(new Response(xyz(`H`)))
    await tick()
    expect(on_file_load).toHaveBeenCalledTimes(1)
    expect(loaded_element(on_file_load.mock.calls[0][0])).toBe(`He`)
  })

  test(`keeps indexed source bytes when a later URL parse becomes stale`, async () => {
    const responses = deferred_fetch_responses()
    const { frame_loader, trajectory: indexed_trajectory } = make_indexed_traj(3)
    const stale_parse = Promise.withResolvers<TrajectoryType>()
    const original_parse = trajectory_parse.parse_trajectory_async
    const parse_spy = vi
      .spyOn(trajectory_parse, `parse_trajectory_async`)
      .mockImplementation((data, filename, on_progress, options) => {
        if (filename === `indexed.xyz`) return Promise.resolve(indexed_trajectory)
        if (filename === `stale.xyz`) return stale_parse.promise
        return original_parse(data, filename, on_progress, options)
      })
    const props = $state({
      data_url: `/indexed.xyz`,
      current_step_idx: 0,
      display_mode: `structure` as const,
      show_controls: `never` as const,
    })
    // resolve the pending parse so nothing is left hanging, whatever the test does
    onTestFinished(() => {
      stale_parse.resolve(energy_traj(-1))
      parse_spy.mockRestore()
    })

    mount_traj(props)
    await vi.waitFor(() => expect(responses.has(`/indexed.xyz`)).toBe(true))
    responses.get(`/indexed.xyz`)?.shift()?.resolve(new Response(`indexed source bytes`))
    await vi.waitFor(() => expect(frame_loader.load_frame).toHaveBeenCalled())
    vi.mocked(frame_loader.load_frame).mockClear()

    props.data_url = `/stale.xyz`
    await vi.waitFor(() => expect(responses.has(`/stale.xyz`)).toBe(true))
    responses.get(`/stale.xyz`)?.shift()?.resolve(new Response(`stale source bytes`))
    await vi.waitFor(() =>
      expect(parse_spy.mock.calls.map(([, filename]) => filename)).toContain(`stale.xyz`),
    )

    props.data_url = `/newer.xyz`
    await vi.waitFor(() => expect(responses.has(`/newer.xyz`)).toBe(true))
    props.current_step_idx = 2
    await vi.waitFor(() =>
      expect(frame_loader.load_frame).toHaveBeenCalledWith(`indexed source bytes`, 2),
    )
  })

  // oxfmt-ignore
  test.each([
    { label: `parse failures include file_size`, data_url: `/bad.xyz`,
      fetch_impl: () => new Response(`not a valid trajectory`),
      expected: { filename: `bad.xyz`, file_size: new Blob([`not a valid trajectory`]).size,
        error_msg: expect.stringMatching(/Failed to parse|unsupported/i) } },
    { label: `fetch failures use basename`, data_url: `/missing/traj.xyz`,
      fetch_impl: () => Promise.reject(new Error(`network down`)),
      expected: { filename: `traj.xyz`, error_msg: expect.stringContaining(`network down`) } },
  ])(`on_error reports $label`, async ({ data_url, fetch_impl, expected }) => {
    const on_error = vi.fn()
    stub_fetch(vi.fn(fetch_impl))
    mount_traj({ data_url, display_mode: `structure`, show_controls: `never`, on_error })
    await vi.waitFor(() => expect(on_error).toHaveBeenCalledTimes(1))
    expect(on_error.mock.calls[0][0]).toEqual(expect.objectContaining(expected))
  })
})
