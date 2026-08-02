import TrajectoryStructureIdPane from '$lib/structure-id/TrajectoryStructureIdPane.svelte'
import * as collect from '$lib/structure-id/collect'
import type { StructureIdSweep } from '$lib/structure-id/collect'
import type { TrajectoryType } from '$lib/trajectory'
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { bind_props, doc_query } from '../setup'
import { make_fcc } from './lattices'

const make_trajectory = (step: number): TrajectoryType => ({
  frames: [{ step, structure: make_fcc([1, 1, 1]) }],
})

const sweep_result: StructureIdSweep = {
  frame_numbers: [0],
  results: [],
  frame_stride: 1,
}

let mounted_component: ReturnType<typeof mount> | undefined
afterEach(async () => {
  if (mounted_component) await unmount(mounted_component)
  mounted_component = undefined
  vi.restoreAllMocks()
})

test.each([
  [`active success`, false, `resolve`, sweep_result, false],
  [`active failure`, false, `reject`, undefined, true],
  [`stale success`, true, `resolve`, undefined, false],
  [`stale failure`, true, `reject`, undefined, false],
] as const)(`%s`, async (_label, swap_trajectory, outcome, expected_result, expect_error) => {
  const pending_sweep = Promise.withResolvers<StructureIdSweep>()
  vi.spyOn(collect, `collect_structure_id_sweep`).mockReturnValue(pending_sweep.promise)

  const first_trajectory = make_trajectory(0)
  const state = $state({
    trajectory: first_trajectory,
    result: undefined as StructureIdSweep | undefined,
  })
  mounted_component = mount(TrajectoryStructureIdPane, {
    target: document.body,
    props: bind_props({ pane_open: true }, state),
  })
  const compute_button = doc_query<HTMLButtonElement>(`.structure-id-controls button`)
  compute_button.click()
  await vi.waitFor(() =>
    expect(collect.collect_structure_id_sweep).toHaveBeenCalledWith(
      first_trajectory,
      expect.any(Object),
    ),
  )

  if (swap_trajectory) {
    state.trajectory = make_trajectory(1)
    await tick()
  }
  if (outcome === `resolve`) pending_sweep.resolve(sweep_result)
  else pending_sweep.reject(new Error(`sweep failure`))

  await vi.waitFor(() => expect(compute_button.disabled).toBe(false))
  expect(state.result).toEqual(expected_result)
  expect(document.body.textContent?.includes(`sweep failure`)).toBe(expect_error)
})

test(`preserves a caller-supplied result on mount`, () => {
  const state: { trajectory: TrajectoryType; result?: StructureIdSweep } = $state({
    trajectory: make_trajectory(0),
    result: sweep_result,
  })
  mounted_component = mount(TrajectoryStructureIdPane, {
    target: document.body,
    props: bind_props({ pane_open: false }, state),
  })
  flushSync()
  expect(state.result).toEqual(sweep_result)
})
