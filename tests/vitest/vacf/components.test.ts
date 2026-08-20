// Covers the worker plumbing of compute_vacf_async and the two UI components.
// happy-dom has no Worker, so a stub is installed before the module is imported and the
// real postMessage path runs; the components then exercise the synchronous fallback.
import type { Vec3 } from '$lib/math'
import type { TrajectoryFrame, TrajectoryType } from '$lib/trajectory'
import type * as VacfAsyncModule from '$lib/vacf/async-compute.svelte'
import { calc_vacf } from '$lib/vacf/calc-vacf'
import type { VacfInput, VacfOptions, VacfResult } from '$lib/vacf/index'
import TrajectoryVacfPane from '$lib/vacf/TrajectoryVacfPane.svelte'
import VacfPlot from '$lib/vacf/VacfPlot.svelte'
import { type Component, type ComponentProps, mount, tick, unmount } from 'svelte'
import { SvelteMap } from 'svelte/reactivity'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { bind_props, make_crystal } from '../setup'
import { build_vacf_input, circular_motion } from './helpers'

type WorkerMessage = { id: number; input: VacfInput; options: VacfOptions }
type Listener = (event: {
  data: unknown
  message?: string
  preventDefault: () => void
}) => void

let last_worker_url: string | undefined
let last_worker_options: WorkerOptions | undefined
const posted: { message: WorkerMessage; transfer: Transferable[] }[] = []

class StubWorker {
  private readonly listeners = new SvelteMap<string, Listener[]>()

  constructor(url: URL | string, options?: WorkerOptions) {
    last_worker_url = String(url)
    last_worker_options = options
  }

  addEventListener(type: string, handler: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler])
  }

  postMessage(message: WorkerMessage, transfer: Transferable[] = []): void {
    // The real worker receives a structured clone; if the payload still carried a Svelte
    // $state proxy this would throw, exactly as it would in a browser.
    const cloned = structuredClone(message)
    posted.push({ message: cloned, transfer })
    queueMicrotask(() => {
      // Mirrors vacf-worker.ts, which turns a thrown kernel error into an error reply
      // rather than letting it escape the worker
      let data: { id: number; result: unknown; error: string | null }
      try {
        data = { id: cloned.id, result: calc_vacf(cloned.input, cloned.options), error: null }
      } catch (err) {
        data = { id: cloned.id, result: null, error: (err as Error).message }
      }
      for (const handler of this.listeners.get(`message`) ?? []) {
        handler({ data, preventDefault: () => {} })
      }
    })
  }
}

let compute_vacf_async: typeof VacfAsyncModule.compute_vacf_async
let vacf_async_module: typeof VacfAsyncModule

const orbit_input = (n_frames: number, with_velocities = true): VacfInput => {
  const { positions, velocities } = circular_motion(n_frames, 0.04, 1)
  return build_vacf_input(positions, with_velocities ? { velocity_frames: velocities } : {})
}

beforeAll(async () => {
  vi.stubGlobal(`Worker`, StubWorker)
  // Imported after the stub so the module-level singleton picks it up
  vacf_async_module = await import(`$lib/vacf/async-compute.svelte`)
  ;({ compute_vacf_async } = vacf_async_module)
})

afterEach(() => {
  posted.length = 0
  vi.restoreAllMocks()
})

describe(`worker code path`, () => {
  it.each([
    [`stored`, true],
    [`central-difference`, false],
  ])(`round-trips a %s request and matches the synchronous result`, async (_label, stored) => {
    const input = orbit_input(60, stored)
    const sync = calc_vacf(input)
    const result = await compute_vacf_async(input)
    expect(posted).toHaveLength(1)
    expect(result).toEqual(sync)
    expect(posted[0].message.input.velocities === null).toBe(!stored)
  })

  it(`points the worker at the vacf worker module as an ES module`, () => {
    // Vite only detects and rewrites the worker when the URL keeps the `./` prefix and the
    // `.js` extension. Detection turns the source `.js` spec into the real `.ts` module
    // tagged `?worker_file`; losing that means the app 404s on the worker at runtime.
    expect(last_worker_url).toMatch(/\/src\/lib\/vacf\/vacf-worker\.ts\?worker_file/)
    expect(last_worker_options).toEqual({ type: `module` })
  })

  // Transferring would detach the caller's buffer, breaking the dedupe cache on a repeat
  // request for the same input, so the buffers are always copied
  it(`copies position and velocity buffers without transferring`, async () => {
    const input = orbit_input(15)
    await compute_vacf_async(input)
    const { input: payload } = posted[0].message
    expect(posted[0].transfer).toHaveLength(0)
    expect(input.positions).toHaveLength(15 * 3)
    expect(payload.positions).toHaveLength(15 * 3)
    expect(payload.velocities).toHaveLength(15 * 3)
  })
})

// Ticks and microtasks enough for the $effect to run, the compute promise to settle and
// the result to render
const settle = async () => {
  for (let round = 0; round < 3; round++) {
    await tick()
    await Promise.resolve()
    await tick()
  }
}

const mount_and_read = async <Props extends Record<string, unknown>>(
  component: Component<Props>,
  props: Props,
): Promise<string> => {
  mount(component, { target: document.body, props })
  await settle()
  return document.body.textContent ?? ``
}

describe(`VacfPlot`, () => {
  const mount_plot = (props: ComponentProps<typeof VacfPlot>): Promise<string> =>
    mount_and_read(VacfPlot, { style: `width: 400px; height: 300px`, ...props })

  // Default panel is `both`; covers the two-plot case that the panel it.each below omits
  it(`renders both panels and the summary for a computed result`, async () => {
    const result = calc_vacf(orbit_input(120), { dt: 1, time_unit: `fs` })
    const text = await mount_plot({ result })
    expect(document.querySelectorAll(`.scatter`)).toHaveLength(2)
    expect(text).toContain(`Total`)
    expect(text).toContain(`velocities read from the file`)
    expect(text).toContain(`hann window`)
  })

  it(`keeps VACF and VDOS control panes independent`, async () => {
    await mount_plot({
      result: calc_vacf(orbit_input(80)),
      vacf_controls_open: true,
      vdos_controls_open: false,
    })
    const toggles = document.querySelectorAll<HTMLButtonElement>(`.pane-toggle`)
    const expanded_states = () =>
      [...toggles].map((toggle) => toggle.getAttribute(`aria-expanded`))
    expect(expanded_states()).toEqual([`true`, `false`])
    const first_toggle = toggles[0]
    if (!first_toggle) throw new Error(`VACF controls toggle not found`)
    first_toggle.click()
    await tick()
    expect(expanded_states()).toEqual([`false`, `false`])
  })

  it.each([
    [`vacf` as const, 1],
    [`vdos` as const, 1],
  ])(`renders %s as %i plot(s)`, async (panel, expected) => {
    await mount_plot({ result: calc_vacf(orbit_input(80)), panel })
    expect(document.querySelectorAll(`.scatter`)).toHaveLength(expected)
  })

  it(`says the axis is in inverse frames when no timestep was supplied`, async () => {
    const text = await mount_plot({ result: calc_vacf(orbit_input(80)) })
    expect(text).toContain(`no timestep supplied, so frequencies are per frame`)
    expect(text).toContain(`Frequency (1/frame)`)
  })

  it(`replaces stale curves with the error when a compute fails`, async () => {
    const text = await mount_plot({
      result: calc_vacf(orbit_input(40)),
      input: orbit_input(40),
      // outside (0, 1], so calc_vacf (and the worker) reject
      vacf_options: { max_lag_fraction: 5 },
    })
    expect(text).toContain(`max_lag_fraction must be in (0, 1]`)
    expect(text).not.toContain(`VACF(0)`)
  })

  it(`discards a pending compute when input is cleared`, async () => {
    const pending_compute = Promise.withResolvers<VacfResult>()
    vi.spyOn(vacf_async_module, `compute_vacf_async`).mockReturnValue(pending_compute.promise)
    const input = orbit_input(40)
    const state = new SvelteMap<string, VacfInput | VacfResult | boolean | undefined>([
      [`input`, input],
      [`result`, undefined],
      [`loading`, false],
    ])
    const component = mount(VacfPlot, {
      target: document.body,
      props: {
        get input() {
          return state.get(`input`) as VacfInput | undefined
        },
        get result() {
          return state.get(`result`) as VacfResult | undefined
        },
        set result(value: VacfResult | undefined) {
          state.set(`result`, value)
        },
        get loading() {
          return state.get(`loading`) as boolean
        },
        set loading(value: boolean) {
          state.set(`loading`, value)
        },
      },
    })
    try {
      await tick()
      expect(state.get(`loading`)).toBe(true)
      state.set(`input`, undefined)
      await tick()
      expect(state.get(`loading`)).toBe(false)

      pending_compute.resolve(calc_vacf(input))
      await settle()
      expect(state.get(`result`)).toBeUndefined()
    } finally {
      await unmount(component)
    }
  })
})

describe(`TrajectoryVacfPane`, () => {
  const make_trajectory = (n_frames: number): TrajectoryType => {
    const { positions, velocities } = circular_motion(n_frames, 0.04, 1)
    const frames: TrajectoryFrame[] = positions.map((frame, frame_idx) => {
      const crystal = make_crystal(
        20,
        frame.map((xyz, atom_idx) => ({
          element: `H`,
          xyz: xyz as Vec3,
          properties: { velocity: velocities[frame_idx][atom_idx] as Vec3 },
        })),
        { charge: 0 },
      )
      return { step: frame_idx, structure: { charge: 0, sites: crystal.sites } }
    })
    return { frames }
  }

  const run_collect = async () => {
    const button = document.querySelector<HTMLButtonElement>(
      `.trajectory-vacf-controls button`,
    )
    if (!button) throw new Error(`no compute button in the VACF pane`)
    button.click()
    for (let round = 0; round < 40; round++) {
      await settle()
      if (!button.disabled) return
    }
    throw new Error(`collect never finished: button still disabled`)
  }

  it(`starts empty, then collects and plots on click`, async () => {
    const initial_text = await mount_and_read(TrajectoryVacfPane, {
      trajectory: make_trajectory(60),
      pane_open: true,
    })
    expect(initial_text).toContain(`No VACF data to display`)
    expect(initial_text).toContain(`Compute VACF`)
    await run_collect()
    const text = document.body.textContent ?? ``
    expect(text).toContain(`velocities read from the file`)
    expect(text).toContain(`Recollect velocities`)
    expect(document.querySelectorAll(`.scatter`).length).toBeGreaterThan(0)
  })

  it(`keeps an unrecognized time unit for lag while using inverse-frame VDOS`, async () => {
    const state = { result: undefined as VacfResult | undefined }
    const text = await mount_and_read(
      TrajectoryVacfPane,
      bind_props(
        {
          trajectory: make_trajectory(40),
          pane_open: true,
          default_dt: 2,
          default_time_unit: `steps`,
        },
        state,
      ),
    )
    expect(text).toMatch(/2\s+steps per collected frame/)
    expect(text).toMatch(/lag time\s+keeps steps/)
    expect(text).toContain(`1/frame`)

    await run_collect()
    expect(state.result?.time_unit).toBe(`steps`)
    expect(state.result?.x_label).toBe(`Lag time (steps)`)
    expect(state.result?.frequency_unit).toBe(`1/frame`)
    expect(state.result?.times[1]).toBe(2)
  })

  it(`surfaces a collect failure in the same message slot`, async () => {
    // total_frames without the frames in memory and without a loader is the indexed trap
    const trajectory = { ...make_trajectory(40), total_frames: 900, is_indexed: true }
    await mount_and_read(TrajectoryVacfPane, { trajectory, pane_open: true })
    await run_collect()
    expect(document.body.textContent).toContain(`only 40 are in memory`)
    expect(document.body.textContent).not.toContain(`velocities read from the file`)
  })
})
