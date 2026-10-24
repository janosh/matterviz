// The shared chrome (stale-state rules, indexed warnings, button states) is covered in
// tests/vitest/trajectory/TrajectoryAnalysisPane.test.svelte.ts; this pins what structure-id
// layers on top: the max-frames cap and CSP skip it hands the sweep, its progress relay, and
// the sweep landing in the bound `result`.
import { calc_structure_id } from '#lib/structure-id/calc-structure-id.js'
import TrajectoryStructureIdPane from '#lib/structure-id/TrajectoryStructureIdPane.svelte'
import * as collect from '#lib/structure-id/collect.js'
import type { StructureIdSweep } from '#lib/structure-id/collect.js'
import type { TrajectoryRun } from '#lib/trajectory/index.js'
import { trajectory_from_frames } from '#lib/trajectory/runs/memory.js'
import { type ComponentProps, mount, tick, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { bind_props, doc_query, set_input } from '../setup'
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

// Passthrough that records the props the pane hands its plot
const plot_props = vi.hoisted(() => ({
  current: undefined as Record<string, unknown> | undefined,
}))
vi.mock(`#lib/structure-id/StructureTypePlot.svelte`, async (import_original) => {
  const original = await import_original<{ default: (...args: unknown[]) => unknown }>()
  return {
    default: (anchor: unknown, props: Record<string, unknown>) => {
      plot_props.current = props
      return original.default(anchor, props)
    },
  }
})

let mounted_component: ReturnType<typeof mount> | undefined
const mount_pane = (props: ComponentProps<typeof TrajectoryStructureIdPane>) =>
  (mounted_component = mount(TrajectoryStructureIdPane, { target: document.body, props }))
// two analysed frames (0 and 10) of the all-fcc conventional cell
const fcc_sweep = (): StructureIdSweep => {
  const fcc_result = calc_structure_id(make_fcc([1, 1, 1]), { skip_csp: true })
  return { frame_numbers: [0, 10], results: [fcc_result, fcc_result], frame_stride: 10 }
}
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
  mount_pane(bind_props({ pane_open: true }, state))
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
  set_input(max_frames, `3`)
  // 1-based inclusive frames 3-18 are the 0-based window [2, 18)
  set_input(doc_query(`input[aria-label="Start frame"]`, HTMLInputElement), `3`)
  set_input(doc_query(`input[aria-label="End frame"]`, HTMLInputElement), `18`)
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
  mount_pane(bind_props({ pane_open: true }, state))
  await settle()
  expect(state.result).toEqual(sweep_result)
  const button = doc_query(`.trajectory-structure-id-controls button`, HTMLButtonElement)
  expect(button.textContent).toContain(`Recompute`)
  button.click()
  await vi.waitFor(() => expect(document.body.textContent).toContain(`sweep failure`))
  expect(state.result).toBeUndefined()
})

test(`hovering a structure type reports its atoms from the analysed frame nearest the one shown`, async () => {
  const on_atoms_hover = vi.fn()
  const state = $state({ current_frame_idx: 3 })
  const result = fcc_sweep()
  mount_pane(bind_props({ pane_open: true, run: make_run(20), result, on_atoms_hover }, state))
  await settle()
  const fcc_item = [...document.querySelectorAll(`.legend-item`)].find((item) =>
    item.textContent?.includes(`FCC`),
  )
  const hover = async (type: string) => {
    fcc_item?.dispatchEvent(new MouseEvent(type))
    await tick()
  }
  const hint = `Highlighted atoms are classified in frame`
  // every atom of the conventional fcc cell is fcc; frame 3 was not analysed, so say which was
  for (const [shown, analysed] of [
    [3, 0],
    [10, 10],
  ]) {
    state.current_frame_idx = shown
    await hover(`mouseenter`)
    const atoms = { frame_number: analysed, atom_indices: [0, 1, 2, 3] }
    expect(on_atoms_hover).toHaveBeenLastCalledWith(atoms)
    // the hint numbers frames from 1 like the step input
    expect(document.body.textContent?.includes(`${hint} ${analysed + 1},`)).toBe(
      shown !== analysed,
    )
    await hover(`mouseleave`)
    expect(on_atoms_hover).toHaveBeenLastCalledWith(null)
    expect(document.body.textContent).not.toContain(hint)
  }
})

// The plot's Frame axis counts from 1 like the step input; clicks hand back 0-based indices
test(`numbers plotted frames from 1 and seeks clicked frames 0-based`, async () => {
  const on_frame_select = vi.fn()
  const result = fcc_sweep()
  mount_pane({
    pane_open: true,
    run: make_run(20),
    result,
    current_frame_idx: 3,
    on_frame_select,
  })
  await settle()
  const { frame_labels, current_frame, on_frame_click } = plot_props.current ?? {}
  expect([frame_labels, current_frame]).toEqual([[1, 11], 4])
  if (typeof on_frame_click !== `function`) throw new Error(`plot got no on_frame_click`)
  on_frame_click(11)
  expect(on_frame_select).toHaveBeenCalledWith(10)
})
