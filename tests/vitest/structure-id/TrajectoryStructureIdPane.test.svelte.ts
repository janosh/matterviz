// The shared chrome (stale-state rules, indexed warnings, button states) is covered in
// tests/vitest/trajectory/TrajectoryAnalysisPane.test.svelte.ts; this pins what structure-id
// layers on top: the max-frames cap and CSP skip it hands the sweep, its progress relay, and
// the sweep landing in the bound `result`.
import TrajectoryStructureIdPane from '$lib/structure-id/TrajectoryStructureIdPane.svelte'
import * as collect from '$lib/structure-id/collect'
import type { StructureIdSweep } from '$lib/structure-id/collect'
import type { TrajectoryType } from '$lib/trajectory'
import { mount, tick, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { bind_props, doc_query } from '../setup'
import { make_fcc } from './lattices'

const make_trajectory = (n_frames: number): TrajectoryType => ({
  frames: Array.from({ length: n_frames }, (_unused, step) => ({
    step,
    structure: make_fcc([1, 1, 1]),
  })),
})

const sweep_result: StructureIdSweep = {
  frame_numbers: [0, 7, 14],
  results: [],
  frame_stride: 7,
}

let mounted_component: ReturnType<typeof mount> | undefined
afterEach(async () => {
  if (mounted_component) await unmount(mounted_component)
  mounted_component = undefined
  vi.restoreAllMocks()
})

const settle = async () => {
  for (let round = 0; round < 3; round++) {
    await tick()
    await Promise.resolve()
  }
}

test(`passes the typed max-frames cap and skip_csp to the sweep, relays progress, stores the result`, async () => {
  const pending_sweep = Promise.withResolvers<StructureIdSweep>()
  const sweep = vi
    .spyOn(collect, `collect_structure_id_sweep`)
    .mockReturnValue(pending_sweep.promise)
  const state = $state({
    trajectory: make_trajectory(20),
    result: undefined as StructureIdSweep | undefined,
  })
  mounted_component = mount(TrajectoryStructureIdPane, {
    target: document.body,
    props: bind_props({ pane_open: true }, state),
  })
  await settle()
  const controls = doc_query(`.trajectory-structure-id-controls`)
  // no position buffer: neither the stride control nor the byte estimate is offered
  expect(
    controls.querySelector(`input[min='1'][step='1']:not([type=checkbox])`),
  ).not.toBeNull()
  expect(controls.textContent).toContain(`20 of 20 frames`)
  expect(controls.textContent).not.toContain(`≈ `.concat(`0 B`))

  const max_frames = doc_query(
    `.trajectory-structure-id-controls input[type=number]`,
    HTMLInputElement,
  )
  max_frames.value = `3`
  max_frames.dispatchEvent(new Event(`input`))
  await settle()
  expect(controls.textContent).toContain(`3 of 20 frames (every 7)`)

  const button = doc_query(`.trajectory-structure-id-controls button`, HTMLButtonElement)
  button.click()
  await settle()
  expect(sweep).toHaveBeenCalledWith(
    state.trajectory,
    expect.objectContaining({ max_frames: 3, options: { skip_csp: true }, raw_data: null }),
  )
  sweep.mock.calls[0][1]?.on_progress?.(2, 3)
  await settle()
  expect(controls.textContent).toContain(`frame 2 of 3`)

  pending_sweep.resolve(sweep_result)
  await vi.waitFor(() => expect(button.disabled).toBe(false))
  expect(state.result).toEqual(sweep_result)
  expect(button.textContent).toContain(`Recompute`)
})

test(`a failed sweep surfaces in the plot slot and drops the result`, async () => {
  vi.spyOn(collect, `collect_structure_id_sweep`).mockRejectedValue(new Error(`sweep failure`))
  const state = $state({
    trajectory: make_trajectory(2),
    result: undefined as StructureIdSweep | undefined,
  })
  mounted_component = mount(TrajectoryStructureIdPane, {
    target: document.body,
    props: bind_props({ pane_open: true }, state),
  })
  await settle()
  const button = doc_query(`.trajectory-structure-id-controls button`, HTMLButtonElement)
  button.click()
  await vi.waitFor(() => expect(document.body.textContent).toContain(`sweep failure`))
  expect(state.result).toBeUndefined()
})
