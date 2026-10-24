import TrajectoryInfoPane from '#lib/trajectory/TrajectoryInfoPane.svelte'
import type {
  TrajectoryFrame,
  TrajectoryMetadata,
  TrajectoryRun,
} from '#lib/trajectory/index.js'
import { trajectory_from_frames } from '#lib/trajectory/runs/memory.js'
import { mount, tick } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { doc_query, set_input } from '../setup'
import { make_crystal, with_property_rows } from '../test-fixtures'

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

const frame: TrajectoryFrame = {
  structure: make_crystal(1, [
    [`Si`, [0, 0, 0]],
    [`Si`, [0.25, 0.25, 0.25]],
  ]),
  step: 10,
  metadata: { energy: -1 },
}

const pane_text = () => document.body.textContent ?? ``
// [mean, σ, drift] per property key of the statistics table
const stat_cells = () =>
  Object.fromEntries(
    [...document.querySelectorAll<HTMLElement>(`tbody tr`)].map((row) => [
      row.dataset.testid,
      [...row.querySelectorAll(`td`)].map((cell) => cell.textContent),
    ]),
  )
const make_run = (frames: TrajectoryFrame[], time_step?: TrajectoryRun[`time_step`]) =>
  trajectory_from_frames(frames, { time_step })
const make_metadata = (
  length: number,
  properties: (frame_number: number) => Record<string, number>,
): TrajectoryMetadata[] =>
  Array.from({ length }, (_unused, frame_number) => ({
    frame_number,
    step: frame_number,
    properties: properties(frame_number),
  }))
const sampled_run = (frame_count: number, rows: TrajectoryMetadata[] = []): TrajectoryRun =>
  with_property_rows(make_run([frame]), rows, frame_count)

const mount_pane = async (run: TrajectoryRun, current_step_idx: number) => {
  const props = $state({
    run,
    current_step_idx,
    current_frame: null as TrajectoryFrame | null,
    pane_open: true,
  })
  mount(TrajectoryInfoPane, { target: document.body, props })
  await tick()
  return props
}

test(`shows trajectory step and timing from the resolved frame`, async () => {
  const frames = Array.from({ length: 11 }, (_unused, step) => ({ ...frame, step }))
  const props = await mount_pane(make_run(frames, { value: 2, unit: `fs` }), 10)
  props.current_frame = frames[10]
  await tick()
  const text = pane_text()
  expect(text).toContain(`Current Step 10`)
  expect(text).toContain(`Step Span 0 - 10`)
  expect(text).toContain(`Time Step 2 fs`)
  expect(text).toContain(`Current Time 20 fs`)
  expect(text).toContain(`Duration 20 fs`)
})

// 3 significant figures showed frame 1234 of 12345 as `1.23k` and step 100001 as `100k`
test(`shows frame numbers and steps exactly`, async () => {
  const props = await mount_pane(sampled_run(12_345), 1233)
  props.current_frame = { ...frame, step: 100_001 }
  await tick()
  const text = pane_text()
  expect(text).toContain(`Total Frames 12,345 (current: 1,234)`)
  expect(text).toContain(`Current Step 100,001`)
})

test(`uses a compact filter trigger and omits copy buttons`, async () => {
  const frames = [-1, -2].map((energy, frame_idx) => ({
    ...frame,
    step: frame_idx,
    metadata: { energy, force_max: 0.2 + frame_idx * 0.1 },
  }))
  const props = await mount_pane(make_run(frames), 0)

  expect(document.querySelector(`.info-filter`)).toBeNull()
  expect(document.querySelectorAll(`.copy-button`)).toHaveLength(0)
  const filter_toggle = doc_query<HTMLButtonElement>(
    `button[aria-label="Filter trajectory info"]`,
  )
  filter_toggle.click()
  await tick()
  const filter_input = doc_query<HTMLInputElement>(`.info-filter`)
  set_input(filter_input, `energy`)
  await tick()
  expect(document.querySelectorAll(`.info-card`)).toHaveLength(1)
  expect(Object.keys(stat_cells())).toEqual([`energy`])

  props.run = make_run([{ ...frame, metadata: {} }])
  await tick()
  expect(document.querySelector<HTMLInputElement>(`.info-filter`)?.value).toBe(`energy`)
  expect(document.querySelectorAll(`.info-card`)).toHaveLength(0)
})

// A fixed atom's force or a vacuum density is ~1e-17 rather than 0; an SI-prefixed range end
// read "10a" (atto) instead of 0
test(`range ends at floating noise read 0`, async () => {
  const rows = make_metadata(2, (frame_number) => ({ force_max: frame_number ? 0.5 : 1e-17 }))
  await mount_pane(sampled_run(2, rows), 0)
  expect(doc_query(`[data-testid="force_max"] th`).getAttribute(`aria-label`)).toBe(
    `Fmax eV/Å: Range 0 to 500m eV/Å`,
  )
})

test(`labels ranges from sampled property rows honestly`, async () => {
  const rows: TrajectoryMetadata[] = [
    { frame_number: 0, step: 0, properties: { energy: -10, force_max: 0.5, volume: 100 } },
    { frame_number: 500, step: 500, properties: { energy: -12, force_max: 0.1, volume: 130 } },
    {
      frame_number: 999,
      step: 999,
      properties: { energy: -11, force_max: 0.05, volume: 120 },
    },
  ]
  await mount_pane(sampled_run(1000, rows), 500)
  expect(pane_text()).toContain(`Statistics 3 of 1k frames sampled`)
  // energy leads, then volume; force comes last. Units sit on the labels, not the values,
  // and a drift is the least-squares slope over steps 0..999 times the span
  expect(stat_cells()).toEqual({
    energy: [`−11`, `1`, `−1`],
    volume: [`116.7`, `15`, `+20`],
    force_max: [`216.7m`, `250m`, `−450m`],
  })
  expect(doc_query(`tbody th`).innerHTML.trim()).toBe(`Energy <small>eV</small>`)
  const energy_label = doc_query(`[data-testid="energy"] th`)
  energy_label.dispatchEvent(new MouseEvent(`pointerenter`))
  await tick()
  expect(doc_query(`[role="tooltip"]`).textContent).toBe(
    `Range −12 to −10 eV over the 3 of 1k frames sampled`,
  )
})

test(`omits sampled and fixed-volume notes from complete property rows`, async () => {
  // summaries must not spread every row into Math.min (argument-count limits on long runs)
  const native_min = Math.min
  vi.spyOn(Math, `min`).mockImplementation((...values) => {
    if (values.length === 40) throw new RangeError(`simulated argument limit`)
    return native_min(...values)
  })
  const rows = make_metadata(40, (frame_number) => ({
    energy: -10 - frame_number * 0.1,
    force_max: 0.5,
    volume: 100,
  }))
  await mount_pane(sampled_run(40, rows), 5)
  expect(pane_text()).not.toContain(`sampled`)
  // constant volume and force carry no statistics worth a row
  expect(Object.keys(stat_cells())).toEqual([`energy`])
  expect(stat_cells().energy?.[2]).toBe(`−3.9`)
})

test(`shows no ranges when a run has no property rows`, async () => {
  await mount_pane(sampled_run(1000), 500)
  expect(document.querySelector(`table`)).toBeNull()
})
