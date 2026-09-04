// The shared chrome every whole-trajectory analysis pane (MSD, VACF, ...) is built on: the
// timestep seeding, stride normalisation, indexed-trajectory warnings and stale-state rules
// are tested once here against a stub collector rather than once per analysis.
import type { ParseProgress, TrajectoryFrame, TrajectoryRun } from '$lib/trajectory'
import type { AnalysisCollectOptions, AnalysisPaneContext } from '$lib/trajectory/analysis'
import TrajectoryAnalysisPane from '$lib/trajectory/TrajectoryAnalysisPane.svelte'
import { TrajectoryProperties, trajectory_from_frames } from '$lib/trajectory'
import { analysis_frame_times } from '$lib/trajectory/analysis'
import { to_error } from '$lib/utils'
import { type ComponentProps, createRawSnippet, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { bind_props, doc_query, make_frame, make_run, settle } from '../setup'

const frame_only_run = (n_frames: number): TrajectoryRun => {
  const { collect_positions: _collect_positions, ...run } = make_run(n_frames)
  return run
}

type Collected = { frame_stride: number; n: number }
let mounted: ReturnType<typeof mount> | undefined
afterEach(async () => {
  if (mounted) await unmount(mounted)
  mounted = undefined
  document.body.replaceChildren()
})

// Mount with a collector that records its options and resolves after one microtask; the
// `children` snippet is a no-op since only the chrome is under test
type Collect = (run: TrajectoryRun, options: AnalysisCollectOptions) => Promise<Collected>
const default_collect: Collect = async (_run, { frame_stride }) => {
  await Promise.resolve()
  return { frame_stride, n: 1 }
}
const mount_pane = (props: Record<string, unknown>, collect = vi.fn(default_collect)) => {
  const base = {
    run: make_run(20),
    pane_open: true,
    title: `Stub analysis`,
    pane_name: `stub analysis`,
    class_prefix: `stub`,
    analysis_name: `Stub`,
    collect,
    suggest_stride: () => 3,
    compute_label: `Compute stub`,
    recollect_label: `Recollect stub`,
    children: createRawSnippet(() => ({ render: () => `<span></span>` })),
  }
  // copy descriptors, not values: bind_props installs accessors that a spread would flatten
  const merged = Object.defineProperties(
    { ...base },
    Object.getOwnPropertyDescriptors(props),
  ) as ComponentProps<typeof TrajectoryAnalysisPane>
  mounted = mount(TrajectoryAnalysisPane, { target: document.body, props: merged })
  return collect
}

const pane_text = () => doc_query(`.stub-controls`).textContent ?? ``
const click_collect = async () => {
  const button = doc_query(`.stub-controls button`, HTMLButtonElement)
  button.click()
  for (let round = 0; round < 20; round++) {
    await settle()
    if (!button.disabled) return button
  }
  throw new Error(`collect never finished: button still disabled`)
}
const timestep_inputs = () => ({
  use_dt: doc_query(`.stub-controls input[type="checkbox"]`, HTMLInputElement),
  dt: doc_query(`.stub-controls input[type="number"][step="0.001"]`, HTMLInputElement),
  unit: doc_query(`input[aria-label="Time unit"]`, HTMLInputElement),
})

describe(`timestep seeding`, () => {
  test(`waits for a complete (dt, unit) pair before enabling physical time, and re-seeds late metadata`, async () => {
    // Both keys must exist at mount so bind_props installs accessors; adding
    // default_time_unit later would never reach the component.
    const defaults = $state<{ default_dt: number | null; default_time_unit?: string }>({
      default_dt: null,
      default_time_unit: undefined,
    })
    mount_pane(bind_props({ time_unit_fallback: `ps` }, defaults))
    defaults.default_dt = 2
    await settle()
    const { use_dt, dt, unit } = timestep_inputs()
    expect([use_dt.checked, dt.valueAsNumber, unit.value, unit.disabled]).toEqual([
      false,
      1,
      `ps`,
      true,
    ])
    expect(pane_text()).toContain(`no valid timestep is available: lag axis in frames`)

    defaults.default_time_unit = `fs`
    await settle()
    expect([use_dt.checked, dt.valueAsNumber, unit.value, unit.disabled]).toEqual([
      true,
      2,
      `fs`,
      false,
    ])
    expect(pane_text()).toContain(`2 fs per collected frame`)

    // clearing the number input writes null, which is "no timestep", not 0
    dt.value = ``
    dt.dispatchEvent(new Event(`input`))
    await settle()
    expect(pane_text()).toContain(`no valid timestep is available`)
  })

  test.each([
    [`zero timestep`, 0, `fs`],
    [`NaN timestep`, Number.NaN, `fs`],
    [`negative timestep`, -1, `fs`],
    [`empty time unit`, 2, ``],
    [`missing time unit`, 2, undefined],
  ])(
    `rejects a %s default and falls back to the unit the analysis names`,
    async (_label, default_dt, default_time_unit) => {
      mount_pane({ default_dt, default_time_unit, time_unit_fallback: `ps` })
      await settle()
      const { use_dt, dt, unit } = timestep_inputs()
      expect([use_dt.checked, dt.valueAsNumber, unit.value]).toEqual([false, 1, `ps`])
    },
  )

  test(`renders no timestep controls unless the analysis opts in`, async () => {
    mount_pane({ default_dt: 2, default_time_unit: `fs` })
    await settle()
    expect(document.querySelector(`input[aria-label="Time unit"]`)).toBeNull()
    expect(pane_text()).not.toContain(`per collected frame`)
  })

  test(`folds the frame stride into the time per collected frame and keeps the collected stride after a retype`, async () => {
    mount_pane({ default_dt: 0.5, default_time_unit: `ps`, time_unit_fallback: `fs` })
    await settle()
    const stride = doc_query(
      `.stub-controls input[aria-label="Frame stride"]`,
      HTMLInputElement,
    )
    stride.value = `4`
    stride.dispatchEvent(new Event(`input`))
    await settle()
    expect(pane_text()).toContain(`5 frames × 2 atoms`)
    expect(pane_text()).toContain(`2 ps per collected frame`)
    // Regression: retyping the stride without recollecting used to rescale dt for a buffer
    // that was still strided by 4, so the downstream analysis recomputed with the wrong dt
    await click_collect()
    stride.value = `10`
    stride.dispatchEvent(new Event(`input`))
    await settle()
    expect(pane_text()).toContain(`2 frames × 2 atoms`)
    expect(pane_text()).toContain(`2 ps per collected frame`)
    expect(pane_text()).not.toContain(`5 ps per collected frame`)
    // Recollecting at the new stride moves dt along with it
    await click_collect()
    expect(pane_text()).toContain(`5 ps per collected frame`)
  })
})

describe(`frame stride`, () => {
  // A fraction is the case that bit: `Math.max(1, stride)` passed 2.5 straight through to
  // accumulate_positions, which rejects any non-integer stride
  test.each([
    [``, 1, 20],
    [`0`, 1, 20],
    [`2.5`, 2, 10],
    [`1e999`, 1, 20],
  ])(
    `normalises a typed stride of %j to %i and collects with it`,
    async (raw, stride, frames) => {
      const collect = mount_pane({})
      const input = doc_query(
        `.stub-controls input[aria-label="Frame stride"]`,
        HTMLInputElement,
      )
      input.value = raw
      input.dispatchEvent(new Event(`input`))
      await settle()
      expect(pane_text()).toContain(`${frames} frames × 2 atoms ≈ ${frames * 2 * 24} B`)
      expect(pane_text()).not.toContain(`NaN`)
      await click_collect()
      expect(collect).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ frame_stride: stride }),
      )
    },
  )

  test(`advertises the suggested stride only while the typed one is below it`, async () => {
    mount_pane({ suggest_stride: () => 5 })
    await settle()
    expect(pane_text()).toContain(`needs ≥ 5`)
    const input = doc_query(
      `.stub-controls input[aria-label="Frame stride"]`,
      HTMLInputElement,
    )
    input.value = `5`
    input.dispatchEvent(new Event(`input`))
    await settle()
    expect(pane_text()).not.toContain(`needs ≥`)
  })

  test(`omits the stride control, size estimate and hint line for analyses without a buffer to budget`, async () => {
    mount_pane({ suggest_stride: undefined })
    await settle()
    expect(
      document.querySelector(`.stub-controls input[aria-label="Frame stride"]`),
    ).toBeNull()
    expect(pane_text()).not.toContain(`atoms ≈`)
    expect(document.querySelector(`.stub-controls p.hint`)).toBeNull()
  })
})

describe(`frame window`, () => {
  test(`maps recorded times to source frames, rejects empty windows, and snapshots collection options`, async () => {
    const run = trajectory_from_frames(
      [10, 20, 50, 90].map((step) => make_frame(step, [[0, 0, 0]])),
      {
        time_step: { value: 0.5, unit: `fs` },
      },
    )
    const properties = new TrajectoryProperties()
    const collect = mount_pane({ run: { ...run, properties } })
    await settle()
    expect(document.querySelector(`input[aria-label="Start time"]`)).toBeNull()
    properties.push(run.properties.rows)
    properties.finish()
    await settle()
    expect(analysis_frame_times(run)?.values).toEqual([5, 10, 25, 45])
    const set = async (label: string, value: string) => {
      const input = doc_query(`input[aria-label="${label}"]`, HTMLInputElement)
      input.value = value
      input.dispatchEvent(new Event(`input`, { bubbles: true }))
      await settle()
      if (label.includes(`time`)) {
        // Typing must not snap the field after the first digit; commit only on change.
        expect(input.value).toBe(value)
        input.dispatchEvent(new Event(`change`, { bubbles: true }))
        await settle()
      }
    }
    await set(`Start time`, `11`)
    await set(`End time (inclusive)`, `30`)
    expect(pane_text()).toContain(`1 frames × 1 atoms`)
    await click_collect()
    const options = collect.mock.calls[0][1]
    expect(options).toMatchObject({ start_frame: 2, end_frame: 3 })
    const button = doc_query(`.stub-controls button`, HTMLButtonElement)
    await set(`Start time`, ``)
    expect(button.disabled).toBe(true)
    await set(`Start time`, `11`)
    expect(button.disabled).toBe(false)
    await set(`Start frame`, `3`)
    expect(button.disabled).toBe(true)
    expect(
      document.querySelector(`[id="${button.getAttribute(`aria-describedby`)}"]`)?.textContent,
    ).toContain(`must be nonempty`)
    expect(options).toMatchObject({ start_frame: 2, end_frame: 3 })
    expect(analysis_frame_times({ ...run, properties: make_run(1).properties })).toBeNull()
    expect(analysis_frame_times({ ...run, time_step: undefined })).toBeNull()
  })
})

test(`selected-frame checks cancel stale reads, explain failures, and stop on unmount`, async () => {
  const pending = [
    Promise.withResolvers<TrajectoryFrame>(),
    Promise.withResolvers<TrajectoryFrame>(),
  ]
  const signals: AbortSignal[] = []
  const run = make_run(3)
  const read_frame = vi.fn((_idx: number, signal?: AbortSignal) => {
    if (signal) signals.push(signal)
    return pending[signals.length - 1].promise
  })
  mount_pane({ run: { ...run, read_frame }, frame_unavailable_reason: () => null })
  await settle()
  const start = doc_query(`input[aria-label="Start frame"]`, HTMLInputElement)
  const compute = doc_query(`.stub-controls button`, HTMLButtonElement)
  for (const value of [`1`, `2`]) {
    start.value = value
    start.dispatchEvent(new Event(`input`))
    await settle()
    expect(compute.disabled).toBe(true)
    expect(compute.title).toContain(`Checking selected frame`)
  }
  expect(signals.map((signal) => signal.aborted)).toEqual([true, false])
  pending[0].resolve(run.preview)
  await settle()
  expect(compute.disabled).toBe(true)
  pending[1].reject(new Error(`Cannot read frame 2`))
  await settle()
  expect(compute.title).toBe(`Cannot read frame 2`)
  expect(
    document.querySelector(`[id="${compute.getAttribute(`aria-describedby`)}"]`)?.textContent,
  ).toBe(`Cannot read frame 2`)
  if (mounted) await unmount(mounted)
  mounted = undefined
  expect(signals[1].aborted).toBe(true)
})

describe(`trajectory state`, () => {
  test.each([
    [`full-pass run`, make_run(20), false],
    [`frame-only run`, frame_only_run(20), true],
  ])(`warns only for a %s`, async (_label, run, expects_warning) => {
    mount_pane({ run })
    await settle()
    const text = document.body.textContent ?? ``
    expect(text).toContain(`Stub analysis`)
    expect(
      text.includes(
        `Stub needs a pass over all 20 frames, but this host-served trajectory only serves frames one at a time`,
      ),
    ).toBe(expects_warning)
  })

  test(`reports no trajectory rather than empty controls`, async () => {
    mount_pane({ run: undefined })
    await settle()
    expect(document.body.textContent).toContain(`No trajectory loaded`)
    expect(document.querySelector(`.stub-controls`)).toBeNull()
  })

  test(`keeps a caller-supplied input across mount, stores the collected one, relabels the button, and clears on trajectory swap`, async () => {
    const on_clear = vi.fn()
    const state = $state<{ run: TrajectoryRun; input?: Collected }>({
      run: make_run(20),
      input: { frame_stride: 1, n: 0 },
    })
    mount_pane(bind_props({ on_clear }, state))
    await settle()
    // mount is not a swap: a precomputed input passed in with the trajectory survives it
    expect(on_clear).not.toHaveBeenCalled()
    expect(state.input).toEqual({ frame_stride: 1, n: 0 })
    expect(doc_query(`.stub-controls button`).textContent).toContain(`Recollect stub`)
    const button = await click_collect()
    expect(state.input).toEqual({ frame_stride: 1, n: 1 })
    expect(button.textContent).toContain(`Recollect stub`)

    state.run = make_run(30)
    await settle()
    expect(state.input).toBeUndefined()
    expect(on_clear).toHaveBeenCalledTimes(1)
    expect(doc_query(`.stub-controls button`).textContent).toContain(`Compute stub`)
  })

  test(`a collect that finishes after a trajectory swap is discarded, but re-enables the button`, async () => {
    const pending = Promise.withResolvers<Collected>()
    let report: ((progress: ParseProgress) => void) | undefined
    let signal: AbortSignal | undefined
    const state = $state<{ run: TrajectoryRun; input?: Collected }>({
      run: make_run(20),
      input: undefined,
    })
    mount_pane(
      bind_props({}, state),
      vi.fn<Collect>((_run, options) => {
        report = options.on_progress
        signal = options.signal
        return pending.promise
      }),
    )
    await settle()
    const button = doc_query(`.stub-controls button`, HTMLButtonElement)
    button.click()
    await settle()
    expect(button.disabled).toBe(true)
    expect(signal?.aborted).toBe(false)
    report?.({ current: 3, total: 20, stage: `frame 3 of 20` })
    await settle()
    expect(pane_text()).toContain(`frame 3 of 20`)
    state.run = make_run(30)
    await settle()
    // the old run's progress is dropped with its trajectory, its collector is told to stop,
    // and later reports are ignored
    expect(signal?.aborted).toBe(true)
    expect(pane_text()).not.toContain(`frame 3 of 20`)
    report?.({ current: 4, total: 20, stage: `frame 4 of 20` })
    await settle()
    expect(pane_text()).not.toContain(`frame 4 of 20`)
    pending.resolve({ frame_stride: 1, n: 99 })
    await settle()
    expect(state.input).toBeUndefined()
    expect(button.disabled).toBe(false)
  })

  test(`a superseding collect and unmount abort the collect in flight; its abort rejection is not reported`, async () => {
    const signals: AbortSignal[] = []
    const state = $state<{ input?: Collected; error_msg?: string }>({
      input: undefined,
      error_msg: undefined,
    })
    mount_pane(
      bind_props({}, state),
      vi.fn<Collect>(
        (_run, { signal }) =>
          new Promise((_resolve, reject) => {
            signals.push(signal)
            signal.addEventListener(`abort`, () => reject(to_error(signal.reason)))
          }),
      ),
    )
    await settle()
    const button = doc_query(`.stub-controls button`, HTMLButtonElement)
    button.click()
    await settle()
    // the button is disabled while collecting, so a second run only starts programmatically
    button.disabled = false
    button.click()
    await settle()
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false])
    expect(state.error_msg).toBeUndefined()

    if (mounted) await unmount(mounted)
    mounted = undefined
    await settle()
    expect(signals[1].aborted).toBe(true)
    expect(state.error_msg).toBeUndefined()
  })

  test(`a failed collect drops the input and shows the error in the bound slot`, async () => {
    const on_clear = vi.fn()
    const state = $state<{ input?: Collected; error_msg?: string }>({
      input: { frame_stride: 1, n: 0 },
      error_msg: undefined,
    })
    mount_pane(
      bind_props({ on_clear }, state),
      vi.fn<Collect>(() => Promise.reject(new Error(`stream exploded`))),
    )
    await settle()
    await click_collect()
    expect(state.input).toBeUndefined()
    expect(state.error_msg).toBe(`stream exploded`)
    expect(on_clear).toHaveBeenCalledTimes(1)
  })

  test(`disables the button while the module's own compute is busy and shows progress`, async () => {
    const pending = Promise.withResolvers<Collected>()
    let report: ((progress: ParseProgress) => void) | undefined
    const state = $state({ busy: true })
    mount_pane(
      bind_props(
        {
          collecting_label: `Sweeping…`,
          // the plot snippet sees `collecting` so it can show its own in-progress state
          children: createRawSnippet((ctx: () => AnalysisPaneContext<Collected>) => ({
            render: () => `<span class="plot"></span>`,
            setup: (plot) => {
              $effect(() => {
                plot.textContent = ctx().collecting ? `busy` : `idle`
              })
            },
          })),
        },
        state,
      ),
      vi.fn<Collect>((_run, { on_progress }) => {
        report = on_progress
        return pending.promise
      }),
    )
    await settle()
    const button = doc_query(`.stub-controls button`, HTMLButtonElement)
    expect(button.disabled).toBe(true)
    state.busy = false
    await settle()
    expect(button.disabled).toBe(false)
    expect(doc_query(`.plot`).textContent).toBe(`idle`)
    button.click()
    await settle()
    expect(button.textContent).toContain(`Sweeping…`)
    expect(doc_query(`.plot`).textContent).toBe(`busy`)
    report?.({ current: 3, total: 20, stage: `frame 3 of 20` })
    await settle()
    expect(pane_text()).toContain(`frame 3 of 20`)
    pending.resolve({ frame_stride: 1, n: 1 })
    await settle()
    expect(pane_text()).not.toContain(`frame 3 of 20`)
    expect(button.disabled).toBe(false)
    expect(doc_query(`.plot`).textContent).toBe(`idle`)
  })
})
