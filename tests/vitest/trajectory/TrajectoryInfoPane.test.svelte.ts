import TrajectoryInfoPane from '$lib/trajectory/TrajectoryInfoPane.svelte'
import type { TrajectoryFrame, TrajectoryMetadata, TrajectoryType } from '$lib/trajectory'
import { mount, tick } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

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

const mount_pane = async (trajectory: TrajectoryType, current_step_idx: number) => {
  const props = $state({
    trajectory,
    current_step_idx,
    current_frame: null as TrajectoryFrame | null,
    pane_open: true,
  })
  mount(TrajectoryInfoPane, { target: document.body, props })
  await tick()
  return props
}

const make_plot_metadata = (
  length: number,
  properties: (frame_number: number) => Record<string, number>,
): TrajectoryMetadata[] =>
  Array.from({ length }, (_unused, frame_number) => ({
    frame_number,
    step: frame_number,
    properties: properties(frame_number),
  }))

// A sampled summary of a 1000-frame run: 3 of 1000 frames, spread across it
const plot_metadata: TrajectoryMetadata[] = [
  { frame_number: 0, step: 0, properties: { energy: -10, force_max: 0.5, volume: 100 } },
  { frame_number: 500, step: 500, properties: { energy: -12, force_max: 0.1, volume: 130 } },
  { frame_number: 999, step: 999, properties: { energy: -11, force_max: 0.05, volume: 120 } },
]
const indexed_trajectory = (extra: Partial<TrajectoryType> = {}) =>
  ({
    frames: [frame],
    total_frames: 1000,
    is_indexed: true,
    ...extra,
  }) as TrajectoryType

test(`replaces indexed loading details with the resolved frame`, async () => {
  // oxfmt-ignore
  const trajectory = {
    frames: Array.from({ length: 10 }, () => frame), total_frames: 11, is_indexed: true,
  } as TrajectoryType
  const props = await mount_pane(trajectory, 10)
  expect(pane_text()).toContain(`On-demand`)

  props.current_frame = frame
  await tick()
  const text = pane_text()
  expect(text).toContain(`Atoms`)
  expect(text).toContain(`2`)
  expect(text).toContain(`Si`)
  expect(text).not.toContain(`On-demand`)
})

// The large-file case is exactly where a summary is most useful, and `frames` there holds
// only the first handful of frames, so the ranges must come off the sampled plot_metadata.
test(`derives ranges from plot_metadata for an indexed trajectory, marked as sampled`, async () => {
  // step 500 is outside the in-memory window, i.e. the real large-file case
  await mount_pane(indexed_trajectory({ plot_metadata }), 500)
  const text = pane_text()
  // format_num renders a typographic minus, not a hyphen
  expect(text).toContain(`Energy Range −12 - −10 eV (3 sampled)`)
  expect(text).toContain(`Force Range 50m - 500m eV/Å (3 sampled)`)
  expect(text).toContain(`Volume Range 100 - 130 Å³ (3 sampled)`)
  expect(text).toContain(`30%`) // volume change over the sampled frames
  // the note names both counts, so 3-of-1000 is never read as the true extremum
  const range_title = document.body
    .querySelector(`[data-testid="energy-range"] [title]`)
    ?.getAttribute(`title`)
  expect(range_title).toBe(
    `Min/max over 3 sampled frames of 1k total, so the true extremum may lie outside this range`,
  )
  // composes with the on-demand structure placeholder rather than replacing it
  expect(text).toContain(`On-demand`)
})

// parse_with_unified_loader extracts plot_metadata at sample_rate 1, so a complete summary must
// not say "sampled". A fixed cell must not print a zero-width Volume Range under Structure.
test(`omits sampled and fixed-volume notes from complete plot_metadata`, async () => {
  const total_frames = 40
  await mount_pane(
    indexed_trajectory({
      plot_metadata: make_plot_metadata(total_frames, (frame_number) => ({
        energy: -10 - frame_number * 0.1,
        force_max: 0.5,
        volume: 100,
      })),
      total_frames,
    }),
    5,
  )
  const text = pane_text()
  expect(text).toContain(`Energy Range`)
  expect(text).not.toContain(`sampled`)
  expect(text).not.toContain(`Volume Range`)
})

test(`summarises a run without spreading every value into Math.min`, async () => {
  const total_frames = 20
  const native_min = Math.min
  vi.spyOn(Math, `min`).mockImplementation((...values) => {
    if (values.length === total_frames) throw new RangeError(`simulated argument limit`)
    return native_min(...values)
  })
  const large_plot_metadata = make_plot_metadata(total_frames, (frame_number) => ({
    energy: -10 - frame_number * 1e-4,
  }))
  await mount_pane(indexed_trajectory({ plot_metadata: large_plot_metadata, total_frames }), 5)
  expect(pane_text()).toContain(`Energy Range`)
})

// Without plot_metadata there is no honest source: a min/max over the in-memory window would
// describe the start of the run as the whole run.
test(`shows no ranges for an indexed trajectory lacking plot_metadata`, async () => {
  await mount_pane(indexed_trajectory(), 500)
  const text = pane_text()
  expect(text).toContain(`On-demand`)
  for (const label of [`Energy Range`, `Force Range`, `Volume Range`]) {
    expect(text).not.toContain(label)
  }
})

// Eager trajectories hold every frame, so their ranges are exact and carry no sampled note
test(`labels ranges over fully in-memory frames without a sampled note`, async () => {
  const frames = [-10, -12, -11].map((energy, idx) => ({
    ...frame,
    step: idx,
    metadata: { energy, force_max: 0.5 - idx * 0.2 },
  }))
  await mount_pane({ frames }, 0)
  const text = pane_text()
  expect(text).toContain(`Energy Range −12 - −10 eV`)
  expect(text).not.toContain(`sampled`)
})
