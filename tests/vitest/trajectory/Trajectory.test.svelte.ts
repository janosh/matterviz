// Rendering, props, panes and events of the pure <Trajectory> viewer over a TrajectoryRun.
// Playback mechanics live in sequence-player.test, frame loading/caching in session.test and
// file acquisition in TrajectoryFileViewer.test; none of that is re-tested here.
import type {
  TrajectoryController,
  TrajectoryRun,
  TrajectoryXQuantity,
  TrajHandlerData,
} from '$lib/trajectory'
import { Trajectory } from '$lib/trajectory'
import { summarize_run, TrajectoryProperties } from '$lib/trajectory/run'
import { host_run } from '$lib/trajectory/runs/host'
import { bind_props, doc_query, make_run as make_shared_run } from '../setup'
import { type ComponentProps, createRawSnippet, flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

type Props = ComponentProps<typeof Trajectory>
type Pane = Props[`active_pane`]

type RunOptions = {
  steps?: number[]
  filename?: string
  // null drops the time step (undefined would fall back to the default)
  time_step?: { value: number; unit: string } | null
  warnings?: string[]
  properties?: (frame_idx: number) => Record<string, number>
}
// Three frames with varying energy/force_max (plotted by default) and volume (hidden)
const make_run = ({
  steps = [0, 10, 20],
  filename = `movie.extxyz`,
  time_step = { value: 0.5, unit: `fs` },
  warnings = [],
  properties = (frame_idx) => ({
    energy: -3 + frame_idx,
    force_max: 0.3 - frame_idx / 10,
    volume: 10 + frame_idx,
  }),
}: RunOptions = {}): TrajectoryRun =>
  make_shared_run(steps, {
    frame_metadata: properties,
    provenance: { filename, format: `xyz`, source_bytes: 1234 },
    time_step: time_step ?? undefined,
    warnings,
  })

const mounted: ReturnType<typeof mount>[] = []
afterEach(async () => {
  for (const component of mounted.splice(0)) await unmount(component)
  vi.restoreAllMocks()
})

// No spread of `props`: bind_props objects carry getter/setter pairs and $state proxies
// must keep their identity for external updates to reach the component
const mount_trajectory = (props: Props): HTMLElement => {
  const target = document.createElement(`div`)
  document.body.append(target)
  mounted.push(mount(Trajectory, { target, props }))
  flushSync()
  return target
}
const default_props = (overrides: Partial<Props> = {}): Props => ({
  trajectory: make_run(),
  display_mode: `structure+scatter`,
  show_controls: `always`,
  ...overrides,
})

// Structure renders its own view-mode/fullscreen buttons, so control queries stay in the bar
const CONTROLS = `.trajectory-controls`
const menu_option = (target: ParentNode, text: string): HTMLButtonElement => {
  const option = [
    ...target.querySelectorAll<HTMLButtonElement>(`${CONTROLS} .view-mode-option`),
  ].find((button) => button.textContent?.includes(text))
  if (!option) throw new Error(`menu option ${text} not found`)
  return option
}
const open_analysis = async (target: ParentNode, label: string): Promise<void> => {
  target.querySelector<HTMLButtonElement>(`button[aria-label="Analysis"]`)?.click()
  await tick()
  menu_option(target, label).click()
  await tick()
}
const legend_state = (target: ParentNode): Record<string, boolean> =>
  Object.fromEntries(
    [...target.querySelectorAll<HTMLElement>(`.scatter .legend-item`)].map((item) => [
      item.getAttribute(`aria-label`)?.replace(`Toggle visibility for `, ``) ?? ``,
      item.getAttribute(`aria-pressed`) === `true`,
    ]),
  )
const axis_labels = (target: ParentNode): string[] =>
  [...target.querySelectorAll(`.scatter .axis-label`)].map(
    (el) => el.textContent?.trim() ?? ``,
  )

describe(`display modes`, () => {
  test.each([
    [`structure`, true, false, false],
    [`structure+scatter`, true, true, false],
    [`structure+histogram`, true, false, true],
    [`scatter`, false, true, false],
    [`histogram`, false, false, true],
  ] as const)(
    `%s renders structure=%s scatter=%s histogram=%s`,
    async (display_mode, structure, scatter, histogram) => {
      const target = mount_trajectory(default_props({ display_mode }))
      await tick()
      expect(target.querySelector(`.structure`) !== null).toBe(structure)
      expect(target.querySelector(`.scatter`) !== null).toBe(scatter)
      expect(target.querySelector(`.histogram`) !== null).toBe(histogram)
      // The divider only exists when both halves are on screen
      expect(target.querySelector(`.pane-divider`) !== null).toBe(
        structure && (scatter || histogram),
      )
    },
  )

  test.each([
    [`single-frame`, make_run({ steps: [0] })],
    [`constant-value`, make_run({ properties: () => ({ energy: -1 }) })],
  ])(`hides the plot of a %s run`, async (_kind, trajectory) => {
    const target = mount_trajectory(default_props({ trajectory }))
    await tick()
    expect(target.querySelector(`.scatter`)).toBeNull()
    expect(target.querySelector(`.structure`)).not.toBeNull()
  })

  test(`view-mode menu switches display_mode and reports the change`, async () => {
    const on_display_mode_change = vi.fn<(data: TrajHandlerData) => void>()
    const props = $state(default_props({ on_display_mode_change }))
    const target = mount_trajectory(props)
    await tick()
    const view_mode_button = doc_query<HTMLButtonElement>(`${CONTROLS} .view-mode-button`)
    view_mode_button.click()
    await tick()
    menu_option(target, `Histogram-only`).click()
    await tick()
    expect(props.display_mode).toBe(`histogram`)
    expect(on_display_mode_change).toHaveBeenCalledExactlyOnceWith({
      step_idx: 0,
      frame_count: 3,
      frame: expect.objectContaining({ step: 0 }),
    })
    expect(view_mode_button.title).toBe(`Histogram-only`)
    expect(target.querySelector(`.view-mode-dropdown`)).toBeNull()
    expect(target.querySelector(`.histogram`)).not.toBeNull()
    expect(target.querySelector(`.scatter`)).toBeNull()
    expect(target.querySelector(`.structure`)).toBeNull()
  })
})

describe(`controls`, () => {
  test(`show_controls='never' renders no control bar`, () => {
    const target = mount_trajectory(default_props({ show_controls: `never` }))
    expect(target.querySelector(`.trajectory-controls`)).toBeNull()
    expect(target.querySelector(`.filename`)).toBeNull()
    expect(target.querySelector(`.structure`)).not.toBeNull()
  })

  const HIDEABLE_CONTROLS = [
    [`filename`, `.filename`],
    [`nav`, `.play-button`],
    [`step`, `.step-slider`],
    [`fps`, `.fps-section`],
    [`info-pane`, `.trajectory-info-toggle`],
    [`export-pane`, `.trajectory-export-toggle`],
    [`x-axis`, `.x-quantity-select`],
    [`view-mode`, `.view-mode-button`],
    [`fullscreen`, `.fullscreen-button`],
  ] as const

  test(`every hideable control renders by default`, async () => {
    const target = mount_trajectory(default_props())
    await tick()
    for (const [hidden, selector] of HIDEABLE_CONTROLS) {
      expect(target.querySelector(`${CONTROLS} ${selector}`), hidden).not.toBeNull()
    }
  })

  test.each(HIDEABLE_CONTROLS)(`hidden: ['%s'] removes %s`, async (hidden, selector) => {
    const target = mount_trajectory(default_props({ show_controls: { hidden: [hidden] } }))
    await tick()
    expect(target.querySelector(`${CONTROLS} ${selector}`)).toBeNull()
  })

  test(`hidden analysis entries leave the menu; hiding all removes the menu`, async () => {
    const target = mount_trajectory(
      default_props({ show_controls: { hidden: [`msd-pane`, `spectroscopy-pane`] } }),
    )
    target.querySelector<HTMLButtonElement>(`button[aria-label="Analysis"]`)?.click()
    await tick()
    const labels = [
      ...target.querySelectorAll(`.analysis-dropdown .view-mode-option span`),
    ].map((span) => span.textContent)
    expect(labels).toEqual([
      `Velocity autocorrelation & VDOS`,
      `Radial distribution function`,
      `Structure identification`,
      `Data inspector`,
    ])

    const bare = mount_trajectory(
      default_props({
        show_controls: {
          hidden: [
            `msd-pane`,
            `vacf-pane`,
            `rdf-pane`,
            `spectroscopy-pane`,
            `structure-id-pane`,
            `data-inspector-pane`,
          ],
        },
      }),
    )
    expect(bare.querySelector(`button[aria-label="Analysis"]`)).toBeNull()
  })

  test(`a custom trajectory_controls snippet replaces the bar and drives the step`, async () => {
    type ControlsProps = {
      trajectory: TrajectoryRun
      current_step_idx: number
      total_frames: number
      on_step_change: (idx: number) => void
    }
    const trajectory_controls = createRawSnippet<[ControlsProps]>((get_props) => ({
      render: () =>
        `<div class="custom-controls"><span></span><button type="button">jump</button></div>`,
      setup: (element) => {
        const span = element.querySelector(`span`)
        const button = element.querySelector(`button`)
        if (!span || !button) throw new Error(`custom controls did not render`)
        $effect(() => {
          const { trajectory, current_step_idx, total_frames } = get_props()
          span.textContent = `${trajectory.provenance.filename} ${current_step_idx}/${total_frames}`
        })
        button.addEventListener(`click`, () => get_props().on_step_change(2))
      },
    }))
    const props = $state(default_props({ trajectory_controls, current_step_idx: 0 }))
    const target = mount_trajectory(props)
    expect(target.querySelector(`.step-slider`)).toBeNull()
    expect(target.querySelector(`.filename`)).toBeNull()
    expect(doc_query(`.custom-controls span`).textContent).toBe(`movie.extxyz 0/3`)
    doc_query<HTMLButtonElement>(`.custom-controls button`).click()
    flushSync()
    expect(props.current_step_idx).toBe(2)
    expect(doc_query(`.custom-controls span`).textContent).toBe(`movie.extxyz 2/3`)
  })

  test.each([
    [`count`, 3, [`0`, `5`, `10`]],
    [`count above frames`, 50, [`0`, `1`, `2`, `3`, `4`, `5`, `6`, `7`, `8`, `9`, `10`]],
    [`spacing`, -4, [`0`, `4`, `8`, `10`]],
    [`explicit (out of range dropped)`, [0, 7, 10, 99], [`0`, `7`, `10`]],
    [`disabled`, 0, []],
  ])(`step_labels %s`, (_kind, step_labels, expected) => {
    const steps = Array.from({ length: 11 }, (_unused, idx) => idx * 5)
    const target = mount_trajectory(
      default_props({ trajectory: make_run({ steps }), step_labels }),
    )
    const labels = [...target.querySelectorAll(`.step-label`)].map((el) =>
      el.textContent?.trim(),
    )
    expect(labels).toEqual(expected)
    // Ticks sit at the frame's fraction of the slider (1.5% inset, 98% span)
    const ticks = [...target.querySelectorAll<HTMLElement>(`.step-tick`)].map(
      (el) => el.style.left,
    )
    expect(ticks).toEqual(expected.map((label) => `${1.5 + (Number(label) / 10) * 98}%`))
  })

  test(`step_labels vanish for a single frame`, () => {
    const target = mount_trajectory(
      default_props({ trajectory: make_run({ steps: [0] }), step_labels: 5 }),
    )
    expect(target.querySelector(`.step-label`)).toBeNull()
  })
})

describe(`plot`, () => {
  test(`visible_properties syncs both ways with legend toggles`, async () => {
    const props = $state(default_props({ visible_properties: undefined }))
    const target = mount_trajectory(props)
    await tick()
    // Unset: the default selection is written back once the series exist
    expect(props.visible_properties).toEqual([`energy`, `force_max`])
    expect(legend_state(target)).toEqual({ Energy: true, Fmax: true, Volume: false })

    const energy_item = target.querySelector<HTMLElement>(
      `.scatter .legend-item[aria-label="Toggle visibility for Energy"]`,
    )
    energy_item?.click()
    await tick()
    expect(legend_state(target)).toEqual({ Energy: false, Fmax: true, Volume: false })
    expect(props.visible_properties).toEqual([`force_max`])
    energy_item?.click()
    await tick()
    expect(props.visible_properties).toEqual([`energy`, `force_max`])

    props.visible_properties = [`volume`]
    await tick()
    expect(legend_state(target)).toEqual({ Energy: false, Fmax: false, Volume: true })
  })

  test.each([
    [`time when steps and a time step exist`, make_run(), `time`, [`Frame`, `Step`, `Time`]],
    [`step without a time step`, make_run({ time_step: null }), `step`, [`Frame`, `Step`]],
    [
      `frame when steps equal frame numbers`,
      make_run({ steps: [0, 1, 2], time_step: null }),
      `frame`,
      [],
    ],
  ] as const)(
    `x_quantity auto-picks %s and writes it back`,
    async (_kind, run, expected, options) => {
      const props = $state(default_props({ trajectory: run, x_quantity: undefined }))
      const target = mount_trajectory(props)
      await tick()
      expect(props.x_quantity).toBe(expected)
      const select = target.querySelector<HTMLSelectElement>(`.x-quantity-select`)
      // The select only appears when there is a choice to make
      expect([...(select?.options ?? [])].map((option) => option.textContent)).toEqual(options)
      if (select) expect(select.value).toBe(expected)
    },
  )

  test(`an explicit x_quantity is honoured and survives runs that cannot show it`, async () => {
    const props = $state(
      default_props({ x_quantity: `step` as TrajectoryXQuantity | undefined }),
    )
    const target = mount_trajectory(props)
    await tick()
    expect(props.x_quantity).toBe(`step`)
    expect(axis_labels(target)[0]).toBe(`Step`)
    expect(doc_query<HTMLSelectElement>(`.x-quantity-select`).value).toBe(`step`)

    props.trajectory = make_run({ steps: [0, 1, 2], time_step: null })
    await tick()
    expect(props.x_quantity).toBe(`frame`)
    expect(axis_labels(target)[0]).toBe(`Frame`)
    props.trajectory = make_run()
    await tick()
    expect(props.x_quantity).toBe(`step`)

    // A host writing the prop is a new standing request (happy-dom cannot drive the
    // <select>: its :checked only matches inputs, which Svelte's select binding relies on)
    props.x_quantity = `time`
    await tick()
    expect(axis_labels(target)[0]).toBe(`Time (fs)`)
    expect(doc_query<HTMLSelectElement>(`.x-quantity-select`).value).toBe(`time`)
  })

  test(`property_labels relabel axes and legend entries`, async () => {
    const target = mount_trajectory(
      default_props({ property_labels: { energy: `Total E`, force_max: `Max |F|` } }),
    )
    await tick()
    expect(axis_labels(target)).toEqual([`Time (fs)`, `Total E (eV)`, `Max |F| (eV/Å)`])
    expect(Object.keys(legend_state(target))).toEqual([`Total E`, `Max |F|`, `Volume`])
  })
})

describe(`banners`, () => {
  test(`parse warnings render as a dismissible banner`, async () => {
    const target = mount_trajectory(
      default_props({ trajectory: make_run({ warnings: [`odd header`, `missing cell`] }) }),
    )
    // scoped by content: analysis panes render warnings of their own (an RDF pane tells a
    // lattice-less run why g(r) is unavailable) and those are not this banner
    const find_parse_banner = (root: ParentNode) =>
      [...root.querySelectorAll<HTMLElement>(`.status-message.warning`)].find((node) =>
        node.textContent?.includes(`parse warning`),
      )
    const banner = find_parse_banner(document) as HTMLElement
    expect(banner.textContent).toContain(`2 parse warnings: odd header; missing cell`)
    // bottom-anchored like the AtomLegend (z-index 2), so it must stack above it
    expect(Number(banner.style.zIndex)).toBeGreaterThan(2)
    banner.querySelector<HTMLButtonElement>(`button[aria-label="Dismiss message"]`)?.click()
    await tick()
    expect(find_parse_banner(target)).toBeUndefined()
    const fresh_viewer = mount_trajectory(default_props())
    expect(find_parse_banner(fresh_viewer)).toBeUndefined()
  })

  test.each([
    [`rejected`, () => Promise.reject(new Error(`disk on fire`))],
    [
      `thrown`,
      () => {
        throw new Error(`disk on fire`)
      },
    ],
  ])(
    `a %s frame read shows an error banner until the step changes`,
    async (_kind, request) => {
      vi.spyOn(console, `error`).mockImplementation(() => {})
      const run = host_run(summarize_run(make_run()), request)
      const props = $state(default_props({ trajectory: run, current_step_idx: 0 }))
      const target = mount_trajectory(props)
      props.current_step_idx = 1
      await vi.waitFor(() =>
        expect(target.querySelector(`.status-message.error`)?.textContent).toContain(
          `Failed to load frame 1: disk on fire`,
        ),
      )
      // Back on the preview frame (served synchronously) the banner goes away
      props.current_step_idx = 0
      await tick()
      expect(target.querySelector(`.status-message.error`)).toBeNull()
      props.current_step_idx = 2
      await vi.waitFor(() =>
        expect(target.querySelector(`.status-message.error`)?.textContent).toContain(
          `frame 2`,
        ),
      )
      doc_query<HTMLButtonElement>(`.status-message.error button`).click()
      await tick()
      expect(target.querySelector(`.status-message.error`)).toBeNull()
    },
  )

  test.each([
    [`rejected`, () => Promise.reject(new Error(`no full pass`))],
    [
      `thrown`,
      () => {
        throw new Error(`no full pass`)
      },
    ],
  ])(
    `a %s trail collection is logged and the viewer keeps rendering`,
    async (_kind, collect) => {
      // Trails are optional: a synchronous throw used to escape the effect instead of being
      // logged like a rejection
      const error = vi.spyOn(console, `error`).mockImplementation(() => {})
      const run: TrajectoryRun = { ...make_run(), collect_positions: collect }
      const target = mount_trajectory(
        default_props({
          trajectory: run,
          structure_props: { scene_props: { show_trajectory_lines: true } },
        }),
      )
      await vi.waitFor(() =>
        expect(error).toHaveBeenCalledWith(
          `Trajectory trails: position collection failed`,
          `no full pass`,
        ),
      )
      expect(target.querySelector(`.structure`)).not.toBeNull()
    },
  )
})

describe(`panes`, () => {
  test(`active_pane opens exactly one pane at a time`, async () => {
    const props = $state(default_props({ active_pane: null as Pane }))
    const target = mount_trajectory(props)
    const open_panes = () =>
      [...target.querySelectorAll(`.viewer-pane-open`)].map((pane) =>
        [...pane.classList].find((cls) => /^(?:trajectory-|export-).*pane$/.test(cls)),
      )

    props.active_pane = `info`
    await tick()
    expect(open_panes()).toEqual([`trajectory-info-pane`])
    props.active_pane = `export`
    await tick()
    expect(open_panes()).toEqual([`export-pane`])

    await open_analysis(target, `Mean squared displacement`)
    expect(props.active_pane).toBe(`msd`)
    expect(open_panes()).toEqual([`trajectory-msd-pane`])
    expect(target.querySelector(`.analysis-dropdown`)).toBeNull()
    await open_analysis(target, `Data inspector`)
    expect(props.active_pane).toBe(`data-inspector`)
    expect(open_panes()).toEqual([`trajectory-data-inspector-pane`])
    props.active_pane = null
    await tick()
    expect(open_panes()).toEqual([])

    // A pane's own toggle reports through active_pane too
    doc_query<HTMLButtonElement>(`.trajectory-info-toggle`).click()
    await tick()
    expect(props.active_pane).toBe(`info`)
    doc_query<HTMLButtonElement>(`.trajectory-info-toggle`).click()
    await tick()
    expect(props.active_pane).toBeNull()
  })

  test(`the spectroscopy pane pauses playback and takes over the plot region`, async () => {
    const on_pause = vi.fn()
    const props = $state(
      default_props({ auto_play: true, active_pane: null as Pane, on_pause }),
    )
    const target = mount_trajectory(props)
    await tick()
    expect(doc_query(`.play-button`).getAttribute(`aria-label`)).toBe(`Pause`)
    expect(target.querySelector(`.x-quantity-select`)).not.toBeNull()

    props.active_pane = `spectroscopy`
    await tick()
    expect(doc_query(`.play-button`).getAttribute(`aria-label`)).toBe(`Play`)
    expect(on_pause).toHaveBeenCalledOnce()
    expect(target.querySelector(`.trajectory.spectroscopy-mode`)).not.toBeNull()
    expect(target.querySelector(`.scatter`)).toBeNull()
    expect(target.querySelector(`.x-quantity-select`)).toBeNull()
    expect(doc_query(`.trajectory-spectroscopy-inline`).hidden).toBe(false)

    props.active_pane = null
    await tick()
    expect(target.querySelector(`.scatter`)).not.toBeNull()
    expect(doc_query(`.trajectory-spectroscopy-inline`).hidden).toBe(true)
    // auto_play is a standing request: playback resumes once the pane releases it
    expect(doc_query(`.play-button`).getAttribute(`aria-label`)).toBe(`Pause`)
  })
})

describe(`events`, () => {
  test(`the viewer is a focusable application whose arrow keys step frames`, () => {
    const state = $state({ current_step_idx: 0 })
    mount_trajectory(bind_props(default_props(), state))
    const viewer = doc_query(`.trajectory`)
    expect(viewer.getAttribute(`role`)).toBe(`application`)
    expect(viewer.getAttribute(`tabindex`)).toBe(`0`)
    viewer.dispatchEvent(new KeyboardEvent(`keydown`, { key: `ArrowRight`, bubbles: true }))
    flushSync()
    expect(state.current_step_idx).toBe(1)
  })

  const payload = (step_idx: number, step: number) => ({
    step_idx,
    frame_count: 3,
    frame: expect.objectContaining({ step }),
  })

  test(`playback events carry { step_idx, frame_count, frame }`, () => {
    const raf_callbacks: FrameRequestCallback[] = []
    vi.spyOn(globalThis, `requestAnimationFrame`).mockImplementation((callback) =>
      raf_callbacks.push(callback),
    )
    vi.spyOn(performance, `now`).mockReturnValue(0)
    const handlers = Object.fromEntries(
      [`on_play`, `on_pause`, `on_end`, `on_loop`, `on_step_change`].map((name) => [
        name,
        vi.fn<(data: TrajHandlerData) => void>(),
      ]),
    )
    let controller: TrajectoryController | null = null
    mount_trajectory(
      default_props({
        fps: 10,
        show_controls: `never`,
        ...handlers,
        on_controller: (next: TrajectoryController | null) => (controller = next),
      }),
    )
    if (!controller) throw new Error(`controller not registered`)
    const { set_step, play, pause } = controller as TrajectoryController
    set_step(1)
    flushSync()
    // Step events fire at commit time, before the new frame is resolved
    expect(handlers.on_step_change).toHaveBeenLastCalledWith({ step_idx: 1, frame_count: 3 })
    play()
    flushSync()
    expect(handlers.on_play).toHaveBeenCalledExactlyOnceWith(payload(1, 10))
    // One animation frame per 100 ms step at 10 fps: 1 -> 2 -> wrap
    const step_frame = (now: number) => {
      raf_callbacks.shift()?.(now)
      flushSync()
    }
    step_frame(100)
    expect(handlers.on_step_change).toHaveBeenLastCalledWith({ step_idx: 2, frame_count: 3 })
    expect(handlers.on_end).not.toHaveBeenCalled()
    step_frame(200)
    expect(handlers.on_end).toHaveBeenCalledExactlyOnceWith(payload(2, 20))
    expect(handlers.on_loop).toHaveBeenCalledExactlyOnceWith({ step_idx: 0, frame_count: 3 })
    pause()
    flushSync()
    expect(handlers.on_pause).toHaveBeenCalledExactlyOnceWith(payload(0, 0))
  })

  test(`fps is normalised to the range grid and reported through on_frame_rate_change`, async () => {
    const on_frame_rate_change = vi.fn<(data: TrajHandlerData) => void>()
    const props = $state(default_props({ fps: 7.26, on_frame_rate_change }))
    mount_trajectory(props)
    expect(props.fps).toBe(7.3)
    expect(on_frame_rate_change).toHaveBeenLastCalledWith(payload(0, 0))
    const calls_after_mount = on_frame_rate_change.mock.calls.length

    props.fps = 999
    await tick()
    expect(props.fps).toBe(300)
    expect(on_frame_rate_change.mock.calls.length).toBeGreaterThan(calls_after_mount)
    props.fps = -4
    await tick()
    expect(props.fps).toBe(0)
    expect(doc_query<HTMLInputElement>(`.fps-section input`).value).toBe(`0`)
  })

  test(`on_fullscreen_change fires with the toggled state`, async () => {
    const on_fullscreen_change = vi.fn<(data: TrajHandlerData) => void>()
    const props = $state(default_props({ fullscreen: false, on_fullscreen_change }))
    mount_trajectory(props)
    doc_query<HTMLButtonElement>(`.fullscreen-button`).click()
    await vi.waitFor(() => expect(props.fullscreen).toBe(true))
    expect(on_fullscreen_change).toHaveBeenCalledWith(payload(0, 0))
    expect(document.fullscreenElement).toBe(doc_query(`.trajectory`))
  })

  test(`Escape closes the open menu and leaves parent-owned fullscreen alone`, async () => {
    const target = mount_trajectory(default_props())
    await tick()
    // a host app (e.g. a slide deck) owns fullscreen while the viewer is embedded inside it
    await target.requestFullscreen()
    const exit_fullscreen = vi.spyOn(document, `exitFullscreen`)
    const toggle = doc_query<HTMLButtonElement>(`${CONTROLS} .analysis-button`)
    toggle.click()
    await tick()
    expect(toggle.getAttribute(`aria-expanded`)).toBe(`true`)

    doc_query(`.trajectory`).dispatchEvent(
      new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true }),
    )
    await tick()
    expect(exit_fullscreen).not.toHaveBeenCalled()
    expect(document.fullscreenElement).toBe(target)
    expect(toggle.getAttribute(`aria-expanded`)).toBe(`false`)
  })

  test(`on_controller hands out the controller and nulls it on unmount`, async () => {
    const on_controller = vi.fn<(controller: TrajectoryController | null) => void>()
    const target = document.createElement(`div`)
    document.body.append(target)
    const component = mount(Trajectory, {
      target,
      props: default_props({ show_controls: `never`, on_controller }),
    })
    flushSync()
    expect(on_controller).toHaveBeenCalledOnce()
    const controller = on_controller.mock.calls[0][0]
    expect(controller?.state()).toEqual({ current_step_idx: 0, total_frames: 3 })
    expect(controller?.set_step(99)).toBe(2)
    await unmount(component)
    expect(on_controller).toHaveBeenLastCalledWith(null)
  })
})

describe(`bindings`, () => {
  test.each([
    [Number.MAX_SAFE_INTEGER, 2],
    [-5, 0],
    [1.7, 1],
  ])(`clamps an initial current_step_idx of %s to %s and notifies`, (initial, expected) => {
    const on_step_change = vi.fn<(data: TrajHandlerData) => void>()
    const props = $state(default_props({ current_step_idx: initial, on_step_change }))
    mount_trajectory(props)
    expect(props.current_step_idx).toBe(expected)
    expect(on_step_change).toHaveBeenCalledWith(
      expect.objectContaining({ step_idx: expected, frame_count: 3 }),
    )
    expect(doc_query<HTMLInputElement>(`.step-input`).value).toBe(String(expected))
  })

  test(`a run swap keeps the step index but clamps it to the new run`, async () => {
    const props = $state(default_props({ current_step_idx: 2 }))
    const target = mount_trajectory(props)
    props.trajectory = make_run({ steps: [0, 1], filename: `short.xyz` })
    await tick()
    expect(props.current_step_idx).toBe(1)
    expect(target.querySelector(`.filename`)?.textContent).toContain(`short.xyz`)
    props.trajectory = make_run({ steps: [0, 1, 2, 3, 4], filename: `long.xyz` })
    await tick()
    expect(props.current_step_idx).toBe(1)
    expect(doc_query(`.step-section span`).textContent).toBe(`/ 5`)
  })

  test(`hovered follows pointerenter/pointerleave and wrapper is the viewer element`, async () => {
    const state = { hovered: false, wrapper: undefined as HTMLDivElement | undefined }
    mount_trajectory(bind_props(default_props(), state))
    const wrapper = state.wrapper
    if (!wrapper) throw new Error(`wrapper not bound`)
    expect(wrapper.getAttribute(`role`)).toBe(`application`)
    expect(wrapper.getAttribute(`aria-label`)).toBe(`Trajectory viewer`)
    wrapper.dispatchEvent(new PointerEvent(`pointerenter`))
    await tick()
    expect(state.hovered).toBe(true)
    wrapper.dispatchEvent(new PointerEvent(`pointerleave`))
    await tick()
    expect(state.hovered).toBe(false)
  })

  test(`controller navigation updates the bound index and the rendered step`, async () => {
    const on_step_change = vi.fn<(data: TrajHandlerData) => void>()
    const controllers: TrajectoryController[] = []
    const props = $state(
      default_props({
        current_step_idx: 0,
        on_step_change,
        on_controller: (next: TrajectoryController | null) => {
          if (next) controllers.push(next)
        },
      }),
    )
    mount_trajectory(props)
    expect(controllers).toHaveLength(1)
    controllers[0].set_step(2)
    await tick()
    expect(props.current_step_idx).toBe(2)
    expect(on_step_change).toHaveBeenLastCalledWith({ step_idx: 2, frame_count: 3 })
    expect(doc_query<HTMLInputElement>(`.step-input`).value).toBe(`2`)
    expect(controllers[0].state()).toEqual({ current_step_idx: 2, total_frames: 3 })
  })

  test(`never disposes the caller's runs, replaced or unmounted`, async () => {
    const first = make_run({ filename: `first.xyz` })
    const second = make_run({ filename: `second.xyz` })
    const first_dispose = vi.spyOn(first, `dispose`)
    const second_dispose = vi.spyOn(second, `dispose`)
    const props = $state(default_props({ trajectory: first }))
    const target = document.createElement(`div`)
    document.body.append(target)
    const component = mount(Trajectory, { target, props })
    props.trajectory = second
    await tick()
    await unmount(component)
    expect(first_dispose).not.toHaveBeenCalled()
    expect(second_dispose).not.toHaveBeenCalled()
  })
})

// Runs are deliberately rune-free, so `run.properties` is a plain class instance and its `rows`
// are invisible to the reactivity graph. The session mirrors them into $state for exactly this
// reason, but the info and data-inspector panes read the run directly and so froze at whatever
// had arrived when they first rendered - for a progressively indexed file, the first batch.
describe(`panes track progressively loaded property rows`, () => {
  const rows_for = (idxs: number[]) =>
    idxs.map((idx) => ({
      frame_number: idx,
      step: idx * 10,
      properties: { energy: -1 - idx },
    }))

  test(`the info pane follows rows pushed and finished after mount`, async () => {
    const properties = new TrajectoryProperties(rows_for([0, 1]), false)
    const trajectory = { ...make_shared_run([0, 10, 20, 30, 40]), frame_count: 5, properties }
    const target = mount_trajectory(default_props({ trajectory, active_pane: `info` }))
    await tick()
    const row_count = () =>
      /Property Rows\s*(?<count>\d+(?: loaded)?)/.exec(target.textContent ?? ``)?.groups?.count

    expect(row_count()).toBe(`2 loaded`)
    properties.push(rows_for([2, 3, 4]))
    flushSync()
    await tick()
    expect(row_count()).toBe(`5 loaded`) // used to stay at 2 for the life of the run

    // finish() flips completeness, which the pane reports by dropping the `loaded` suffix
    properties.finish()
    flushSync()
    await tick()
    expect(row_count()).toBe(`5`)
  })

  test(`the data inspector follows them too`, async () => {
    const properties = new TrajectoryProperties(rows_for([0, 1]), false)
    const trajectory = { ...make_shared_run([0, 10, 20, 30, 40]), frame_count: 5, properties }
    const target = mount_trajectory(
      default_props({ trajectory, active_pane: `data-inspector` }),
    )
    await tick()
    const frames_tab = () =>
      /Frames \((?<count>\d+)\)/.exec(target.textContent ?? ``)?.groups?.count

    expect(frames_tab()).toBe(`2`)
    properties.push(rows_for([2, 3, 4]))
    flushSync()
    await tick()
    expect(frames_tab()).toBe(`5`) // used to stay at 2
  })
})
