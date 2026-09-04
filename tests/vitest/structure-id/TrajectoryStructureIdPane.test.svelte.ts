// The shared chrome (stale-state rules, indexed warnings, button states) is covered in
// tests/vitest/trajectory/TrajectoryAnalysisPane.test.svelte.ts; this pins what structure-id
// layers on top: the max-frames cap and CSP skip it hands the sweep, its progress relay, and
// the sweep landing in the bound `result`.
import TrajectoryStructureIdPane from '$lib/structure-id/TrajectoryStructureIdPane.svelte'
import * as collect from '$lib/structure-id/collect'
import type { StructureIdSweep } from '$lib/structure-id/collect'
import { trajectory_from_frames, type TrajectoryRun } from '$lib/trajectory'
import { mount, tick, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { bind_props, doc_query } from '../setup'
import { make_fcc } from './lattices'

const make_run = (n_frames: number): TrajectoryRun =>
  trajectory_from_frames(
    Array.from({ length: n_frames }, (_unused, step) => ({
      step,
      structure: make_fcc([1, 1, 1]),
    })),
  )

const sweep_result: StructureIdSweep = {
  frame_numbers: [2, 8, 14],
  results: [],
  frame_stride: 6,
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

test(`passes the frame window, cap and skip_csp to the sweep, relays progress, stores the result`, async () => {
  const pending_sweep = Promise.withResolvers<StructureIdSweep>()
  const sweep = vi
    .spyOn(collect, `collect_structure_id_sweep`)
    .mockReturnValue(pending_sweep.promise)
  const state = $state({
    run: make_run(20),
    result: undefined as StructureIdSweep | undefined,
  })
  mounted_component = mount(TrajectoryStructureIdPane, {
    target: document.body,
    props: bind_props({ pane_open: true }, state),
  })
  await settle()
  const controls = doc_query(`.trajectory-structure-id-controls`)
  // No position buffer: sampling uses the max-frames cap, without a stride or byte estimate.
  expect(controls.querySelector(`input[aria-label="Frame stride"]`)).toBeNull()
  expect(controls.textContent).toContain(`20 of 20 frames`)
  expect(controls.textContent).not.toContain(`≈ `.concat(`0 B`))

  const max_frames = doc_query(
    `.trajectory-structure-id-controls input[type=number]`,
    HTMLInputElement,
  )
  expect(max_frames.closest(`label`)?.textContent).toContain(`Max frames`)
  max_frames.value = `3`
  max_frames.dispatchEvent(new Event(`input`))
  for (const [label, value] of [
    [`Start frame`, `2`],
    [`End frame (exclusive)`, `18`],
  ]) {
    const input = doc_query(`input[aria-label="${label}"]`, HTMLInputElement)
    input.value = value
    input.dispatchEvent(new Event(`input`))
  }
  await settle()
  expect(controls.textContent).toContain(`3 of 16 frames (every 6)`)

  const button = doc_query(`.trajectory-structure-id-controls button`, HTMLButtonElement)
  expect(document.body.textContent).toContain(`No structure-type data to display`)
  button.click()
  await settle()
  expect(sweep).toHaveBeenCalledWith(
    state.run,
    expect.objectContaining({
      start_frame: 2,
      end_frame: 18,
      max_frames: 3,
      options: { skip_csp: true },
    }),
  )
  // the sweep is the identification itself, so both the button and the plot slot say so
  expect(button.textContent).toContain(`Identifying…`)
  expect(document.body.textContent).toContain(`Identifying structure types…`)
  sweep.mock.calls[0][1]?.on_progress?.(2, 3)
  await settle()
  expect(controls.textContent).toContain(`frame 2 of 3`)

  pending_sweep.resolve(sweep_result)
  await vi.waitFor(() => expect(button.disabled).toBe(false))
  expect(state.result).toEqual(sweep_result)
  expect(button.textContent).toContain(`Recompute`)
  expect(document.body.textContent).not.toContain(`Identifying structure types…`)
})

test(`keeps a caller-supplied result across mount; a failed sweep surfaces in the plot slot and drops it`, async () => {
  vi.spyOn(collect, `collect_structure_id_sweep`).mockRejectedValue(new Error(`sweep failure`))
  const state = $state<{ run: TrajectoryRun; result?: StructureIdSweep }>({
    run: make_run(2),
    result: sweep_result,
  })
  mounted_component = mount(TrajectoryStructureIdPane, {
    target: document.body,
    props: bind_props({ pane_open: true }, state),
  })
  await settle()
  expect(state.result).toEqual(sweep_result)
  const button = doc_query(`.trajectory-structure-id-controls button`, HTMLButtonElement)
  expect(button.textContent).toContain(`Recompute`)
  button.click()
  await vi.waitFor(() => expect(document.body.textContent).toContain(`sweep failure`))
  expect(state.result).toBeUndefined()
})
