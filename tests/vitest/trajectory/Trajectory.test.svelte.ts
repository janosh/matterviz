import type { TrajectoryType, TrajectoryXQuantity, TrajHandlerData } from '$lib/trajectory'
import { Trajectory } from '$lib/trajectory'
import { flushSync, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { make_trajectory_frame, resize_element } from '../setup'

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

const mount_traj = (props: Record<string, unknown>) => {
  const target = document.createElement(`div`)
  document.body.append(target)
  mount(Trajectory, { target, props })
  return target
}
const flush_render = async () => {
  flushSync()
  await tick()
}
const selected_x_quantity = (target: ParentNode) =>
  target.querySelector<HTMLSelectElement>(`.x-quantity-select`)?.value

type ElementConstructor<T extends Element> = abstract new (...args: never[]) => T
const query = <T extends Element>(
  target: ParentNode,
  selector: string,
  element_constructor: ElementConstructor<T>,
): T => {
  const element = target.querySelector(selector)
  if (!element) throw new Error(`No element found for selector: ${selector}`)
  if (!(element instanceof element_constructor)) {
    throw new Error(`Element found for selector ${selector} has the wrong type`)
  }
  return element
}

const with_fetch = async (fetch_impl: unknown, run: () => Promise<void>) => {
  vi.stubGlobal(`fetch`, fetch_impl)
  try {
    await run()
  } finally {
    vi.unstubAllGlobals()
  }
}

const click_menu_option = async (
  target: ParentNode,
  menu_button: string,
  option_text: string,
): Promise<void> => {
  target.querySelector<HTMLButtonElement>(menu_button)?.click()
  await tick()
  const option = [...target.querySelectorAll<HTMLButtonElement>(`.view-mode-option`)].find(
    (button) => button.textContent?.includes(option_text),
  )
  if (!option) throw new Error(`${option_text} menu option not found`)
  option.click()
  await tick()
}

describe(`Trajectory`, () => {
  // StructureControls owns trail-chrome visibility; this only guards Trajectory's
  // lazy collect_msd_positions gate (Trail length appears once the stream lands).
  test(`collects trail positions lazily when trails are enabled`, async () => {
    const target = mount_traj({
      trajectory: make_traj([{}, {}, {}]),
      display_mode: `structure`,
      show_controls: false,
      controls_open: true,
      structure_props: { show_controls: `always` },
    })
    await flush_render()

    const trail_toggle = Array.from(target.querySelectorAll(`label`))
      .find((label) => label.textContent?.includes(`Show trajectory trails`))
      ?.querySelector<HTMLInputElement>(`input[type="checkbox"]`)
    if (!trail_toggle) throw new Error(`trajectory trail toggle not found`)
    expect(target.textContent).not.toContain(`Trail length`)

    trail_toggle.click()
    await vi.waitFor(() => expect(target.textContent).toContain(`Trail length`))
  })

  test(`forwards the initial scatter controls-open state`, async () => {
    const target = mount_traj({
      trajectory: energy_traj(-1, -2),
      display_mode: `scatter`,
      show_controls: false,
      scatter_props: { controls_open: true },
    })
    await flush_render()
    const plot = query(target, `.scatter`, HTMLElement)
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
      const plot = query(target, `.scatter`, HTMLElement)
      await resize_element(plot, 600, 400)
      const width = Number(plot.querySelector(`clipPath rect`)?.getAttribute(`width`))
      if (!Number.isFinite(width))
        throw new Error(`missing or invalid scatter clip width: ${width}`)
      return width
    }

    expect(await clip_width(true)).toBe(await clip_width(false))
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
    const target = mount_traj(props)
    await flush_render()
    let plot = query(target, `.scatter`, HTMLElement)
    await resize_element(plot, 600, 400)
    expect(plot.textContent).toContain(`Energy`)

    props.trajectory = {
      frames: [0, 1500, 10_000].map((step, frame_idx) =>
        make_trajectory_frame(step, 1, { volume: frame_idx * 5000 }),
      ),
      metadata: {},
    }
    await flush_render()
    plot = query(target, `.scatter`, HTMLElement)
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
    {
      desc: `time on first paint when POTIM is present`,
      trajectory: make_stepped_traj(2) as TrajectoryType | undefined,
      later: undefined as ReturnType<typeof make_stepped_traj> | undefined,
      expect_initial: `time` as TrajectoryXQuantity | undefined,
      expect_final: `time` as TrajectoryXQuantity,
    },
    {
      desc: `step on first paint without POTIM`,
      trajectory: make_stepped_traj(undefined),
      later: undefined,
      expect_initial: `step`,
      expect_final: `step`,
    },
    {
      desc: `deferred until samples exist`,
      trajectory: undefined,
      later: make_stepped_traj(2),
      expect_initial: undefined,
      expect_final: `time`,
    },
  ])(`x_quantity $desc`, async ({ trajectory, later, expect_initial, expect_final }) => {
    const props = $state({
      trajectory,
      x_quantity: undefined as TrajectoryXQuantity | undefined,
      display_mode: `scatter` as const,
      show_controls: `always` as const,
    })
    const target = mount_traj(props)
    await flush_render()
    expect(props.x_quantity).toBe(expect_initial)
    if (expect_initial !== undefined) expect(selected_x_quantity(target)).toBe(expect_initial)

    if (!later) return
    props.trajectory = later
    await flush_render()
    expect(props.x_quantity).toBe(expect_final)
    expect(selected_x_quantity(target)).toBe(expect_final)
  })

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

  test(`defaults to five FPS and restricts values to half-integers`, async () => {
    const default_target = mount_traj({ trajectory: energy_traj(-1, -2) })
    await flush_render()
    expect(
      default_target.querySelector<HTMLInputElement>(`.fps-section input[type="number"]`)
        ?.value,
    ).toBe(`5`)

    const props = $state({
      trajectory: energy_traj(-1, -2),
      fps: 0.2,
      show_controls: `always` as const,
    })
    const target = mount_traj(props)
    await flush_render()

    const fps_input = target.querySelector<HTMLInputElement>(
      `.fps-section input[type="number"]`,
    )
    const fps_slider = target.querySelector<HTMLInputElement>(
      `.fps-section input[type="range"]`,
    )
    if (!fps_input || !fps_slider) throw new Error(`FPS controls not found`)
    expect(props.fps).toBe(0.5)
    expect(fps_input.min).toBe(`0.5`)
    expect(fps_input.step).toBe(`0.5`)
    expect(fps_slider.min).toBe(`0.5`)
    expect(fps_slider.step).toBe(`0.5`)

    fps_input.value = `12.3`
    fps_input.dispatchEvent(new Event(`input`, { bubbles: true }))
    await flush_render()
    expect(props.fps).toBe(12.5)
    expect(fps_input.value).toBe(`12.5`)
    expect(fps_slider.value).toBe(`12.5`)
  })

  test(`preserves playback callback order and payloads through a loop`, async () => {
    const events: string[] = []
    const props = $state({
      trajectory: energy_traj(-1, -2),
      current_step_idx: 0,
      fps: 10,
      show_controls: `always` as const,
      on_play: ({ step_idx }: TrajHandlerData) => events.push(`play:${step_idx}`),
      on_pause: ({ step_idx }: TrajHandlerData) => events.push(`pause:${step_idx}`),
      on_end: ({ step_idx }: TrajHandlerData) => events.push(`end:${step_idx}`),
      on_loop: () => events.push(`loop`),
    })
    const target = mount_traj(props)
    await flush_render()
    const play = query(target, `.play-button`, HTMLButtonElement)

    vi.useFakeTimers()
    try {
      play.click()
      flushSync()
      vi.advanceTimersByTime(120)
      flushSync()
      expect(props.current_step_idx).toBe(1)

      play.click()
      flushSync()
      play.click()
      flushSync()
      vi.advanceTimersByTime(120)
      flushSync()
      expect(props.current_step_idx).toBe(0)
      expect(events).toEqual([`play:0`, `pause:1`, `play:1`, `end:1`, `loop`])
    } finally {
      vi.useRealTimers()
    }
  })

  test(`keeps sequence keyboard navigation and handled-event suppression`, async () => {
    const on_frame_rate_change = vi.fn()
    const props = $state({
      trajectory: energy_traj(-1, -2, -3),
      current_step_idx: 0,
      fps: 5,
      show_controls: `always` as const,
      on_frame_rate_change,
    })
    const target = mount_traj(props)
    await flush_render()
    const viewer = query(target, `.trajectory`, HTMLElement)

    const press_key = async (key: string, init: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent(`keydown`, {
        ...init,
        key,
        bubbles: true,
        cancelable: true,
      })
      viewer.dispatchEvent(event)
      await flush_render()
      return event
    }
    const next = await press_key(`ArrowRight`)
    expect(props.current_step_idx).toBe(1)
    expect(next.defaultPrevented).toBe(true)

    const last = await press_key(`ArrowRight`, { metaKey: true })
    expect(props.current_step_idx).toBe(2)
    expect(last.defaultPrevented).toBe(true)

    const calls_before_speed_change = on_frame_rate_change.mock.calls.length
    for (const key of [` `, `+`, ` `]) await press_key(key)
    expect(props.fps).toBe(5.5)
    expect(on_frame_rate_change).toHaveBeenCalledTimes(calls_before_speed_change + 1)
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
    const target = mount_traj(props)
    await flush_render()

    expect(props.current_step_idx).toBe(2)
    expect(step_events.at(-1)).toEqual({ step_idx: 2, frame_count: 3 })

    const step_input = query(target, `.step-input`, HTMLInputElement)
    for (const rejected_value of [``, `99`]) {
      step_input.value = rejected_value
      step_input.dispatchEvent(new Event(`input`, { bubbles: true }))
      step_input.dispatchEvent(new Event(`change`, { bubbles: true }))
      await flush_render()
      expect(props.current_step_idx).toBe(2)
      expect(step_input.value).toBe(`2`)
    }

    const slider = query(target, `.step-slider`, HTMLInputElement)
    const trajectory_element = query(target, `.trajectory`, HTMLElement)
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
    try {
      throw_on_change = true
      slider.value = `2`
      slider.dispatchEvent(new Event(`input`, { bubbles: true }))
      flushSync()
      expect(trajectory_element.dataset.scrubbing).toBe(`true`)
      expect(() => vi.advanceTimersToNextFrame()).toThrow(`host callback failed`)

      vi.advanceTimersByTime(81)
      flushSync()
      expect(trajectory_element.dataset.scrubbing).toBe(`false`)
    } finally {
      vi.useRealTimers()
    }
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
      await click_menu_option(target, `.analysis-button`, label)
      expect(props[open_prop]).toBe(true)
      expect(target.querySelector(`.analysis-dropdown`)).toBeNull()
    }
  })

  // setup.ts ResizeObserver reports 600; old code used calc(wrapper - 50px).
  test(`info pane max-height follows content-area height`, async () => {
    const target = mount_traj({
      trajectory: energy_traj(-1.5),
      show_controls: `always` as const,
      info_pane_open: true,
    })
    await flush_render()
    expect(target.querySelector<HTMLElement>(`.trajectory-info-pane`)?.style.maxHeight).toBe(
      `600px`,
    )
  })

  // show_controls.style is appended after the z-index the controls bar sets on itself, so
  // both have to survive; a caller that names z-index deliberately wins, being last.
  // Trailing-semicolon variants of the color style are not distinct: the template already
  // supplies the join semicolon before the caller string.
  test.each([
    { style: `color: rgb(255, 0, 0)`, z_index: `10`, color: `rgb(255, 0, 0)` },
    { style: `z-index: 5`, z_index: `5`, color: `` },
  ])(`show_controls.style keeps z-index=$z_index`, async ({ style, z_index, color }) => {
    const target = mount_traj({
      trajectory: energy_traj(-1.5),
      show_controls: { mode: `always`, style },
    })
    await flush_render()

    const controls = query(target, `.trajectory-controls`, HTMLElement)
    // jsdom preserves unresolved var() expressions; browsers resolve the fallback to 10.
    expect(getComputedStyle(controls).zIndex).toContain(z_index)
    expect(getComputedStyle(controls).color).toBe(color)
  })

  test(`view mode menu is layered and selectable`, async () => {
    const props = $state({
      trajectory: energy_traj(-1.5, -2.5),
      display_mode: `structure+scatter` as const,
      show_controls: `always` as const,
    })
    const target = mount_traj(props)
    await flush_render()

    const view_mode_button = query(target, `.view-mode-button`, HTMLButtonElement)
    view_mode_button.click()
    await tick()

    const dropdown = query(target, `.view-mode-dropdown`, HTMLElement)
    // Inline stacking: jsdom applies no scoped styles; menu must stay above
    // content-area siblings rather than under the scatter.
    const dropdown_style = getComputedStyle(dropdown)
    expect(dropdown_style.pointerEvents).toBe(`auto`)
    expect(Number(dropdown_style.zIndex)).toBeGreaterThan(0)

    const scatter_only = [
      ...dropdown.querySelectorAll<HTMLButtonElement>(`.view-mode-option`),
    ].find((button) => button.textContent?.includes(`Scatter-only`))
    if (!scatter_only) throw new Error(`scatter-only option not found`)
    scatter_only.click()
    await tick()

    expect(props.display_mode).toBe(`scatter`)
    expect(view_mode_button.title).toBe(`Scatter-only`)
    expect(target.querySelector(`.view-mode-dropdown`)).toBeNull()
  })

  test(`data_url reloads on change; trajectory prop wins over data_url`, async () => {
    const fetch_mock = vi.fn(
      async (url: string | URL | Request) =>
        new Response(xyz(request_url(url).includes(`b.xyz`) ? `He` : `H`)),
    )
    await with_fetch(fetch_mock, async () => {
      mount_traj({
        data_url: `/ignored.xyz`,
        trajectory: energy_traj(-1),
        show_controls: `never`,
      })
      await tick()
      expect(fetch_mock).not.toHaveBeenCalled()
    })

    const loaded_elements: string[] = []
    await with_fetch(fetch_mock, async () => {
      fetch_mock.mockClear()
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
  })

  test(`ignores a stale trajectory URL completion`, async () => {
    const responses = new Map<string, (response: Response) => void>()
    await with_fetch(
      vi.fn(
        (url: string | URL | Request) =>
          new Promise<Response>((resolve) => responses.set(request_url(url), resolve)),
      ),
      async () => {
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
        responses.get(`/b.xyz`)?.(new Response(xyz(`He`)))
        await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledTimes(1))

        responses.get(`/a.xyz`)?.(new Response(xyz(`H`)))
        await tick()
        expect(on_file_load).toHaveBeenCalledTimes(1)
        expect(loaded_element(on_file_load.mock.calls[0][0])).toBe(`He`)
      },
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
    await with_fetch(vi.fn(fetch_impl), async () => {
      mount_traj({ data_url, display_mode: `structure`, show_controls: `never`, on_error })
      await vi.waitFor(() => expect(on_error).toHaveBeenCalledTimes(1))
      expect(on_error.mock.calls[0][0]).toEqual(expect.objectContaining(expected))
    })
  })
})
