// The shared chrome is covered in tests/vitest/trajectory/TrajectoryAnalysisPane.test.svelte.ts;
// this pins what the RDF pane layers on top: its controls reach the sweep, the shell table and
// CSV download appear once it lands, and a lattice-less run is refused with a reason.
import TrajectoryRdfPane from '$lib/rdf/TrajectoryRdfPane.svelte'
import type { TrajectoryRdf } from '$lib/rdf'
import { trajectory_from_frames, type TrajectoryRun } from '$lib/trajectory'
import { mount, tick, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { bind_props, doc_query } from '../setup'
import { FCC_LATTICE_CONST, make_fcc } from '../structure-id/lattices'

const make_run = (n_frames: number): TrajectoryRun =>
  trajectory_from_frames(
    Array.from({ length: n_frames }, (_unused, step) => ({
      step,
      structure: make_fcc([2, 2, 2]),
    })),
  )

let mounted_component: ReturnType<typeof mount> | undefined
afterEach(async () => {
  if (mounted_component) await unmount(mounted_component)
  mounted_component = undefined
  vi.restoreAllMocks()
})

const settle = async (rounds = 6) => {
  for (let round = 0; round < rounds; round++) {
    await tick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

test(`sweeps the capped frame sample with the typed cutoff and bins, then tabulates the shells`, async () => {
  const state = $state({ run: make_run(20), result: undefined as TrajectoryRdf | undefined })
  mounted_component = mount(TrajectoryRdfPane, {
    target: document.body,
    props: bind_props({ pane_open: true }, state),
  })
  await settle()
  const controls = doc_query(`.trajectory-rdf-controls`)
  const [max_frames, cutoff, bins] =
    controls.querySelectorAll<HTMLInputElement>(`input[type=number]`)
  expect(controls.textContent).toContain(`20 of 20 frames`)
  for (const [input, value] of [
    [max_frames, `4`],
    [cutoff, `3.5`],
    [bins, `70`],
  ] as const) {
    input.value = value
    input.dispatchEvent(new Event(`input`))
  }
  await settle()
  expect(controls.textContent).toContain(`4 of 20 frames (every 5)`)
  expect(controls.textContent).toContain(`0.05 Å per bin`)
  // the default 10 Å cutoff reaches past half of this 7.2 Å cell; 3.5 Å does not
  expect(controls.textContent).not.toContain(`beyond half the cell`)

  doc_query(`.trajectory-rdf-controls button`, HTMLButtonElement).click()
  await settle(20)
  expect(state.result).toMatchObject({
    frame_numbers: [0, 5, 10, 15],
    cutoff: 3.5,
    n_bins: 70,
  })
  const summary = doc_query(`.analysis-summary`)
  expect(summary.textContent).toContain(`Cu-Cu`)
  // fcc: first shell at a/√2 holds 12 neighbours
  expect(state.result?.curves[0].shell.first_peak_r).toBeCloseTo(
    FCC_LATTICE_CONST / Math.SQRT2,
    1,
  )
  expect(summary.textContent).toContain(`12`)
  expect(doc_query(`.analysis-note`).textContent).toContain(`4 frames (every 5th) × 32 atoms`)
  expect(doc_query(`button.analysis-download`).textContent).toContain(`g(r) CSV`)
})

// Refused up front, not on click: g(r) has nothing to normalise against without a cell, and a
// button that takes the click and then throws reads as a broken feature rather than a
// mismatched file
test(`refuses a run without a lattice before the click`, async () => {
  const molecule = { sites: make_fcc([1, 1, 1]).sites }
  const state = $state({
    run: trajectory_from_frames([{ step: 0, structure: molecule }]),
    result: undefined as TrajectoryRdf | undefined,
  })
  mounted_component = mount(TrajectoryRdfPane, {
    target: document.body,
    props: bind_props({ pane_open: true }, state),
  })
  await settle()
  const compute = doc_query(`.trajectory-rdf-controls button`, HTMLButtonElement)
  expect(compute.disabled).toBe(true)
  expect(compute.title).toContain(`needs a periodic cell`)
  const hint_id = compute.getAttribute(`aria-describedby`)
  expect(hint_id).toBeTypeOf(`string`)
  expect(document.querySelector(`[id="${hint_id}"]`)?.textContent).toContain(
    `needs a periodic cell`,
  )
  expect(document.body.textContent).toContain(`needs a periodic cell`)
  compute.click()
  await settle()
  expect(state.result).toBeUndefined()
  state.run = make_run(2)
  await settle()
  expect(compute.disabled).toBe(false)
  expect(compute.hasAttribute(`aria-describedby`)).toBe(false)
  expect(document.querySelector(`[id="${hint_id}"]`)).toBeNull()
})
