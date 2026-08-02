// Covers the worker plumbing of compute_vacf_async and the two UI components.
// happy-dom has no Worker, so a stub is installed before the module is imported and the
// real postMessage path runs; the components then exercise the synchronous fallback.
import type { Vec3 } from '$lib/math'
import type { TrajectoryFrame, TrajectoryType } from '$lib/trajectory'
import type { compute_vacf_async as ComputeVacfAsync } from '$lib/vacf/async-compute.svelte'
import { calc_vacf } from '$lib/vacf/calc-vacf'
import type { VacfInput, VacfOptions } from '$lib/vacf/index'
import TrajectoryVacfPane from '$lib/vacf/TrajectoryVacfPane.svelte'
import VacfPlot from '$lib/vacf/VacfPlot.svelte'
import { type Component, type ComponentProps, mount, tick } from 'svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { make_crystal } from '../setup'
import { build_vacf_input, circular_motion } from './helpers'

type WorkerMessage = { id: number; input: VacfInput; options: VacfOptions }
type Listener = (event: {
  data: unknown
  message?: string
  preventDefault: () => void
}) => void

let construction_count = 0
let last_worker_url: string | undefined
let last_worker_options: WorkerOptions | undefined
const posted: { message: WorkerMessage; transfer: Transferable[] }[] = []

class StubWorker {
  private readonly listeners = new Map<string, Listener[]>()

  constructor(url: URL | string, options?: WorkerOptions) {
    construction_count++
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

let compute_vacf_async: typeof ComputeVacfAsync

const orbit_input = (n_frames: number, with_velocities = true): VacfInput => {
  const { positions, velocities } = circular_motion(n_frames, 0.04, 1)
  return build_vacf_input(positions, with_velocities ? { velocity_frames: velocities } : {})
}

beforeAll(async () => {
  vi.stubGlobal(`Worker`, StubWorker)
  // Imported after the stub so the module-level singleton picks it up
  ;({ compute_vacf_async } = await import(`$lib/vacf/async-compute.svelte`))
})

afterEach(() => {
  posted.length = 0
})

describe(`worker code path`, () => {
  it(`round-trips a request and matches the synchronous result`, async () => {
    const input = orbit_input(60)
    const result = await compute_vacf_async(input)
    expect(posted).toHaveLength(1)
    expect(result.curves[0].vacf).toEqual(calc_vacf(input).curves[0].vacf)
    expect(result.curves[0].vdos).toEqual(calc_vacf(input).curves[0].vdos)
  })

  it(`builds the worker exactly once across many computes`, async () => {
    await compute_vacf_async(orbit_input(19))
    await Promise.all([
      compute_vacf_async(orbit_input(20)),
      compute_vacf_async(orbit_input(21)),
      compute_vacf_async(orbit_input(22)),
    ])
    expect(construction_count).toBe(1)
  })

  it(`points the worker at the vacf worker module as an ES module`, () => {
    // Vite only detects and rewrites the worker when the URL keeps the `./` prefix and the
    // `.js` extension. Detection turns the source `.js` spec into the real `.ts` module
    // tagged `?worker_file`; losing that means the app 404s on the worker at runtime.
    expect(last_worker_url).toMatch(/\/src\/lib\/vacf\/vacf-worker\.ts\?worker_file/)
    expect(last_worker_options).toEqual({ type: `module` })
  })

  it(`sends both buffers without transferring the caller's`, async () => {
    const input = orbit_input(15)
    await compute_vacf_async(input)
    const { input: payload } = posted[0].message
    expect(payload.positions).toHaveLength(15 * 3)
    expect(payload.velocities).toHaveLength(15 * 3)
    // Transferring would detach the caller's buffer, breaking the dedupe cache on a repeat
    // request for the same input, so the buffers are always copied
    expect(posted[0].transfer).toHaveLength(0)
    expect(input.positions).toHaveLength(15 * 3)
  })

  it(`sends a null velocity field when the input has none`, async () => {
    await compute_vacf_async(orbit_input(15, false))
    expect(posted[0].message.input.velocities).toBeNull()
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

  it(`renders both panels and the summary for a computed result`, async () => {
    const result = calc_vacf(orbit_input(120), { dt: 1, time_unit: `fs` })
    const text = await mount_plot({ result })
    expect(document.querySelectorAll(`.scatter`)).toHaveLength(2)
    expect(text).toContain(`Total`)
    expect(text).toContain(`velocities read from the file`)
    expect(text).toContain(`hann window`)
  })

  it.each([
    [`vacf` as const, 1],
    [`vdos` as const, 1],
    [`both` as const, 2],
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
    const button = document.querySelector<HTMLButtonElement>(`.vacf-controls button`)
    if (!button) throw new Error(`no compute button in the VACF pane`)
    button.click()
    for (let round = 0; round < 40; round++) {
      await settle()
      if (!button.disabled) return
    }
    throw new Error(`collect never finished: button still disabled`)
  }

  it(`shows the empty state before anything is collected`, async () => {
    const text = await mount_and_read(TrajectoryVacfPane, {
      trajectory: make_trajectory(40),
      pane_open: true,
    })
    expect(text).toContain(`No VACF data to display`)
    expect(text).toContain(`Compute VACF`)
  })

  it(`collects and plots on click`, async () => {
    await mount_and_read(TrajectoryVacfPane, {
      trajectory: make_trajectory(60),
      pane_open: true,
    })
    await run_collect()
    const text = document.body.textContent ?? ``
    expect(text).toContain(`velocities read from the file`)
    expect(text).toContain(`Recollect velocities`)
    expect(document.querySelectorAll(`.scatter`).length).toBeGreaterThan(0)
  })

  it(`surfaces a collect failure in the same message slot`, async () => {
    // total_frames without the frames in memory and without a loader is the indexed trap
    const trajectory = { ...make_trajectory(40), total_frames: 900, is_indexed: true }
    await mount_and_read(TrajectoryVacfPane, { trajectory, pane_open: true })
    await run_collect()
    expect(document.body.textContent).toContain(`only 40 are in memory`)
  })

  it(`reports no trajectory rather than an empty plot`, async () => {
    const text = await mount_and_read(TrajectoryVacfPane, { pane_open: true })
    expect(text).toContain(`No trajectory loaded`)
  })
})
