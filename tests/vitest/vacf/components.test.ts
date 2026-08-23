// Covers the worker plumbing of compute_vacf_async and the two UI components.
// happy-dom has no Worker, so a stub is installed before the module is imported and the
// real postMessage path runs; the components then exercise the synchronous fallback.
import type * as VacfAsyncModule from '$lib/vacf/async-compute.svelte'
import { calc_vacf } from '$lib/vacf/calc-vacf'
import type { VacfInput, VacfOptions, VacfResult } from '$lib/vacf/index'
import TrajectoryVacfPane from '$lib/vacf/TrajectoryVacfPane.svelte'
import VacfPlot from '$lib/vacf/VacfPlot.svelte'
import { type Component, type ComponentProps, mount, tick, unmount } from 'svelte'
import { SvelteMap } from 'svelte/reactivity'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { bind_props, expect_module_worker, install_stub_worker, settle } from '../setup'
import { build_vacf_input, circular_motion, orbit_run } from './helpers'

// Mirrors vacf-worker.ts: a thrown kernel error becomes an error reply instead of escaping
const stub = install_stub_worker<{ id: number; input: VacfInput; options: VacfOptions }>(
  ({ input, options }) => calc_vacf(input, options),
)

let compute_vacf_async: typeof VacfAsyncModule.compute_vacf_async
let vacf_async_module: typeof VacfAsyncModule

const orbit_input = (n_frames: number, with_velocities = true): VacfInput => {
  const { positions, velocities } = circular_motion(n_frames, 0.04, 1)
  return build_vacf_input(positions, with_velocities ? { velocity_frames: velocities } : {})
}

beforeAll(async () => {
  // Imported after the stub so the module-level singleton picks it up
  vacf_async_module = await import(`$lib/vacf/async-compute.svelte`)
  ;({ compute_vacf_async } = vacf_async_module)
})

afterEach(() => {
  stub.reset()
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
    expect(stub.posted).toHaveLength(1)
    expect(result).toEqual(sync)
    expect(stub.posted[0].message.input.velocities === null).toBe(!stored)
    expect_module_worker(stub.instances, `src/lib/vacf/vacf-worker.ts`)
  })

  // Transferring would detach the caller's buffer, breaking the dedupe cache on a repeat
  // request for the same input, so the buffers are always copied
  it(`copies position and velocity buffers without transferring`, async () => {
    const input = orbit_input(15)
    await compute_vacf_async(input)
    const { input: payload } = stub.posted[0].message
    expect(stub.posted[0].transfer).toHaveLength(0)
    expect(input.positions).toHaveLength(15 * 3)
    expect(payload.positions).toHaveLength(15 * 3)
    expect(payload.velocities).toHaveLength(15 * 3)
  })
})

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
    expect(text).toContain(`no timestep supplied, so frequencies are per collected frame`)
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
      run: orbit_run(60, 0.04, 1),
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
          run: orbit_run(40, 0.04, 1),
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

  // Without a timestep the options do not depend on the stride, so editing it must not
  // hand VacfPlot a fresh options object and send the buffer back through the worker
  it(`does not recompute the VACF when the stride changes without a timestep`, async () => {
    const compute = vi.spyOn(vacf_async_module, `compute_vacf_async`)
    await mount_and_read(TrajectoryVacfPane, {
      run: orbit_run(40, 0.04, 1),
      pane_open: true,
    })
    await run_collect()
    expect(compute).toHaveBeenCalledTimes(1)
    const stride_input = document.querySelector<HTMLInputElement>(
      `.trajectory-vacf-controls input[min='1'][step='1']`,
    )
    if (!stride_input) throw new Error(`no frame-stride input in the VACF pane`)
    stride_input.value = `3`
    stride_input.dispatchEvent(new Event(`input`))
    await settle()
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it(`disables collection for a frame-only run`, async () => {
    const { collect_positions: _collect_positions, ...run } = orbit_run(40, 0.04, 1)
    await mount_and_read(TrajectoryVacfPane, { run, pane_open: true })
    expect(document.body.textContent).toContain(`only serves frames one at a time`)
    expect(
      document.querySelector<HTMLButtonElement>(`.trajectory-vacf-controls button`)?.disabled,
    ).toBe(true)
    expect(document.body.textContent).not.toContain(`velocities read from the file`)
  })
})
