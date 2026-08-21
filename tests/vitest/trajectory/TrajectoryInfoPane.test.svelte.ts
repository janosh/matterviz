import TrajectoryInfoPane from '$lib/trajectory/TrajectoryInfoPane.svelte'
import {
  trajectory_from_frames,
  TrajectoryProperties,
  type TrajectoryFrame,
  type TrajectoryMetadata,
  type TrajectoryRun,
} from '$lib/trajectory'
import { mount, tick } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

// oxfmt-ignore
const frame: TrajectoryFrame = {
  structure: {
    sites: [
      { species: [{ element: `Si`, occu: 1, oxidation_state: 0 }], abc: [0, 0, 0],
        xyz: [0, 0, 0], label: `Si1`, properties: {} },
      { species: [{ element: `Si`, occu: 1, oxidation_state: 0 }], abc: [0.25, 0.25, 0.25],
        xyz: [0.25, 0.25, 0.25], label: `Si2`, properties: {} },
    ],
  },
  step: 10,
  metadata: { energy: -1 },
}

const pane_text = () => document.body.textContent ?? ``
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
const sampled_run = (frame_count: number, rows: TrajectoryMetadata[] = []): TrajectoryRun => ({
  ...make_run([frame]),
  frame_count,
  properties: new TrajectoryProperties(rows, true),
})

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
  filter_input.value = `energy`
  filter_input.dispatchEvent(new Event(`input`, { bubbles: true }))
  await tick()
  expect(document.querySelectorAll(`.info-card`)).toHaveLength(1)
  expect(pane_text()).toContain(`Energy Range`)

  props.run = make_run([{ ...frame, metadata: {} }])
  await tick()
  expect(document.querySelector<HTMLInputElement>(`.info-filter`)?.value).toBe(`energy`)
  expect(document.querySelectorAll(`.info-card`)).toHaveLength(0)
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
  const text = pane_text()
  expect(text).toContain(`Energy Range −12 - −10 eV (3 sampled)`)
  expect(text).toContain(`Force Range 50m - 500m eV/Å (3 sampled)`)
  expect(text).toContain(`Volume Range 100 - 130 Å³ (3 sampled)`)
  expect(text).toContain(`30%`)
  expect(
    document.body.querySelector(`[data-testid="energy-range"] [title]`)?.getAttribute(`title`),
  ).toBe(
    `Min/max over 3 sampled frames of 1k total, so the true extremum may lie outside this range`,
  )
})

test(`omits sampled and fixed-volume notes from complete property rows`, async () => {
  const rows = make_metadata(40, (frame_number) => ({
    energy: -10 - frame_number * 0.1,
    force_max: 0.5,
    volume: 100,
  }))
  const run = { ...sampled_run(40, rows), properties: new TrajectoryProperties(rows, true) }
  await mount_pane(run, 5)
  const text = pane_text()
  expect(text).toContain(`Energy Range`)
  expect(text).not.toContain(`sampled`)
  expect(text).not.toContain(`Volume Range`)
})

test(`summarises many property rows without spreading them into Math.min`, async () => {
  const total_frames = 20
  const native_min = Math.min
  vi.spyOn(Math, `min`).mockImplementation((...values) => {
    if (values.length === total_frames) throw new RangeError(`simulated argument limit`)
    return native_min(...values)
  })
  await mount_pane(
    sampled_run(
      total_frames,
      make_metadata(total_frames, (frame_number) => ({ energy: -10 - frame_number * 1e-4 })),
    ),
    5,
  )
  expect(pane_text()).toContain(`Energy Range`)
})

test(`shows no ranges when a run has no property rows`, async () => {
  await mount_pane(sampled_run(1000), 500)
  for (const label of [`Energy Range`, `Force Range`, `Volume Range`]) {
    expect(pane_text()).not.toContain(label)
  }
})
