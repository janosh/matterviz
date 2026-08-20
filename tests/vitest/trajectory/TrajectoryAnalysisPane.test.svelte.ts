// The shared chrome every whole-trajectory analysis pane (MSD, VACF, ...) is built on: the
// timestep seeding, stride normalisation, indexed-trajectory warnings and stale-state rules
// are tested once here against a stub collector rather than once per analysis.
import type { TrajectoryType } from '$lib/trajectory'
import type { AnalysisCollectOptions } from '$lib/trajectory/analysis-pane'
import TrajectoryAnalysisPane from '$lib/trajectory/TrajectoryAnalysisPane.svelte'
import { type ComponentProps, createRawSnippet, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { bind_props, doc_query, make_crystal } from '../setup'

const structure = make_crystal(20, [
  [`H`, [0, 0, 0]],
  [`He`, [0.5, 0, 0]],
])
const make_trajectory = (n_frames: number): TrajectoryType => ({
  frames: Array.from({ length: n_frames }, (_unused, step) => ({ step, structure })),
})
const lazy = { ...make_trajectory(20), total_frames: 500, is_indexed: true }

type Collected = { frame_stride: number; n: number }
let mounted: ReturnType<typeof mount> | undefined
afterEach(async () => {
  if (mounted) await unmount(mounted)
  mounted = undefined
  document.body.replaceChildren()
})

const settle = async (): Promise<void> => {
  for (let round = 0; round < 3; round++) {
    await tick()
    await Promise.resolve()
    await tick()
  }
}

// Mount with a collector that records its options and resolves after one microtask; the
// `children` snippet is a no-op since only the chrome is under test
type Collect = (
  trajectory: TrajectoryType,
  options: AnalysisCollectOptions,
) => Promise<Collected>
const default_collect: Collect = async (_trajectory, { frame_stride }) => {
  await Promise.resolve()
  return { frame_stride, n: 1 }
}
const mount_pane = (props: Record<string, unknown>, collect = vi.fn(default_collect)) => {
  const base = {
    trajectory: make_trajectory(20),
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

  test(`folds the frame stride into the time per collected frame`, async () => {
    mount_pane({ default_dt: 0.5, default_time_unit: `ps`, time_unit_fallback: `fs` })
    await settle()
    const stride = doc_query(`.stub-controls input[min='1'][step='1']`, HTMLInputElement)
    stride.value = `4`
    stride.dispatchEvent(new Event(`input`))
    await settle()
    expect(pane_text()).toContain(`5 frames × 2 atoms`)
    expect(pane_text()).toContain(`2 ps per collected frame`)
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
      const input = doc_query(`.stub-controls input[min='1'][step='1']`, HTMLInputElement)
      input.value = raw
      input.dispatchEvent(new Event(`input`))
      await settle()
      expect(pane_text()).toContain(`${frames} frames × 2 atoms ≈ ${frames * 2 * 24} B`)
      expect(pane_text()).not.toContain(`NaN`)
      await click_collect()
      expect(collect).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ frame_stride: stride, raw_data: null }),
      )
    },
  )

  test(`advertises the suggested stride only while the typed one is below it`, async () => {
    mount_pane({ suggest_stride: () => 5 })
    await settle()
    expect(pane_text()).toContain(`needs ≥ 5`)
    const input = doc_query(`.stub-controls input[min='1'][step='1']`, HTMLInputElement)
    input.value = `5`
    input.dispatchEvent(new Event(`input`))
    await settle()
    expect(pane_text()).not.toContain(`needs ≥`)
  })

  test(`omits the stride control for analyses without a buffer to budget`, async () => {
    mount_pane({ suggest_stride: undefined })
    await settle()
    expect(document.querySelector(`.stub-controls input[min='1'][step='1']`)).toBeNull()
  })
})

describe(`trajectory state`, () => {
  test.each([
    [`in-memory trajectory`, make_trajectory(20), false],
    [`indexed trajectory`, lazy, true],
  ])(`warns only for an %s`, async (_label, trajectory, expects_warning) => {
    mount_pane({ trajectory })
    await settle()
    const text = document.body.textContent ?? ``
    expect(text).toContain(`Stub analysis`)
    expect(
      text.includes(`20 of 500 frames are in memory. Stub streams the full payload`),
    ).toBe(expects_warning)
  })

  // trajectory_total_frames throws here, and is_lazy/the stride suggestion both route
  // through it, so an unguarded derived would take the whole pane down
  test(`renders with a setup error when the frame count cannot be determined`, async () => {
    mount_pane({ trajectory: { ...make_trajectory(20), is_indexed: true } })
    await settle()
    expect(document.body.textContent).toContain(`reports no total_frames`)
    expect(document.querySelector(`.stub-controls button`)).not.toBeNull()
  })

  test(`reports no trajectory rather than empty controls`, async () => {
    mount_pane({ trajectory: undefined })
    await settle()
    expect(document.body.textContent).toContain(`No trajectory loaded`)
    expect(document.querySelector(`.stub-controls`)).toBeNull()
  })

  test(`stores the collected input, relabels the button, and clears on trajectory swap`, async () => {
    const on_clear = vi.fn()
    const state = $state<{ trajectory: TrajectoryType; input?: Collected }>({
      trajectory: make_trajectory(20),
      input: undefined,
    })
    mount_pane(bind_props({ on_clear }, state))
    await settle()
    // mount itself counts as a swap from "no trajectory", so the module starts clean
    expect(on_clear).toHaveBeenCalledTimes(1)
    expect(doc_query(`.stub-controls button`).textContent).toContain(`Compute stub`)
    const button = await click_collect()
    expect(state.input).toEqual({ frame_stride: 1, n: 1 })
    expect(button.textContent).toContain(`Recollect stub`)

    state.trajectory = make_trajectory(30)
    await settle()
    expect(state.input).toBeUndefined()
    expect(on_clear).toHaveBeenCalledTimes(2)
    expect(doc_query(`.stub-controls button`).textContent).toContain(`Compute stub`)
  })

  test(`a collect that finishes after a trajectory swap is discarded, but re-enables the button`, async () => {
    const pending = Promise.withResolvers<Collected>()
    const state = $state<{ trajectory: TrajectoryType; input?: Collected }>({
      trajectory: make_trajectory(20),
      input: undefined,
    })
    mount_pane(
      bind_props({}, state),
      vi.fn<Collect>(() => pending.promise),
    )
    await settle()
    const button = doc_query(`.stub-controls button`, HTMLButtonElement)
    button.click()
    await settle()
    expect(button.disabled).toBe(true)
    state.trajectory = make_trajectory(30)
    await settle()
    pending.resolve({ frame_stride: 1, n: 99 })
    await settle()
    expect(state.input).toBeUndefined()
    expect(button.disabled).toBe(false)
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
    expect(on_clear).toHaveBeenCalledTimes(2)
  })

  test(`disables the button while the module's own compute is busy and shows progress`, async () => {
    const pending = Promise.withResolvers<Collected>()
    let report:
      | ((progress: { current: number; total: number; stage: string }) => void)
      | undefined
    const state = $state({ busy: true })
    mount_pane(
      bind_props({}, state),
      vi.fn<Collect>((_trajectory, { on_progress }) => {
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
    button.click()
    await settle()
    expect(button.textContent).toContain(`Reading frames…`)
    report?.({ current: 3, total: 20, stage: `frame 3 of 20` })
    await settle()
    expect(pane_text()).toContain(`frame 3 of 20`)
    pending.resolve({ frame_stride: 1, n: 1 })
    await settle()
    expect(pane_text()).not.toContain(`frame 3 of 20`)
    expect(button.disabled).toBe(false)
  })
})
