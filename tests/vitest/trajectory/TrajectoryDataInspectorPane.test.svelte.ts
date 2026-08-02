import type { Vec3 } from '$lib/math'
import type { Site } from '$lib/structure'
import type { TrajectoryFrame, TrajectoryType } from '$lib/trajectory'
import { full_data_extractor } from '$lib/trajectory'
import TrajectoryDataInspectorPane from '$lib/trajectory/TrajectoryDataInspectorPane.svelte'
import { mount, tick, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { make_trajectory_frame } from '../setup'

let mounted_pane: ReturnType<typeof mount> | undefined
afterEach(async () => {
  if (mounted_pane) await unmount(mounted_pane)
  mounted_pane = undefined
  document.body.replaceChildren()
})

const CUBIC_LATTICE = { a: 3, b: 3, c: 3, alpha: 90, beta: 90, gamma: 90, volume: 27 }

// Eager trajectory: every frame lives in `frames`, energies and forces vary per frame
const make_eager_trajectory = (n_frames = 4): TrajectoryType => ({
  frames: Array.from({ length: n_frames }, (_, frame_idx) =>
    make_trajectory_frame(
      frame_idx * 10,
      3,
      { energy: -100 - frame_idx, force_max: 0.5 - frame_idx * 0.1 },
      CUBIC_LATTICE,
    ),
  ),
})

// Indexed trajectory trap: only a handful of frames are in memory
const make_indexed_trajectory = (overrides: Partial<TrajectoryType> = {}): TrajectoryType => ({
  frames: Array.from({ length: 10 }, (_, frame_idx) =>
    make_trajectory_frame(frame_idx, 3, { energy: -1 }, CUBIC_LATTICE),
  ),
  is_indexed: true,
  ...overrides,
})

const make_site = (site_idx: number, properties: Record<string, unknown>): Site => ({
  species: [{ element: `Fe`, occu: 1, oxidation_state: 0 }],
  abc: [site_idx / 10, 0.25, 0.5] as Vec3,
  xyz: [site_idx, 2.5, 5] as Vec3,
  label: `Fe${site_idx + 1}`,
  properties,
})

const make_sites_frame = (sites: Site[]): TrajectoryFrame => ({
  step: 0,
  metadata: {},
  structure: { sites },
})

const mount_pane = async (props: Record<string, unknown>) => {
  mounted_pane = mount(TrajectoryDataInspectorPane, {
    target: document.body,
    props: { pane_open: true, ...props },
  })
  await tick()
}

const header_texts = () =>
  [...document.querySelectorAll(`thead th`)].map((th) => th.textContent?.trim() ?? ``)

const body_rows = () => [
  ...document.querySelectorAll<HTMLTableRowElement>(
    `tbody tr:not(.virtual-spacer):not(.empty-row)`,
  ),
]

// d3-format writes negatives with the Unicode minus (U+2212); fold it back to ASCII
// so expectations stay readable
const cell_texts = (row: HTMLTableRowElement) =>
  [...row.querySelectorAll(`td`)].map((td) =>
    (td.textContent?.trim() ?? ``).replaceAll(`\u2212`, `-`),
  )

const open_tab = async (value: string) => {
  const tab = document.querySelector<HTMLButtonElement>(
    `button[role="tab"][data-value="${value}"]`,
  )
  if (!tab) throw new Error(`no tab button for ${value}`)
  tab.click()
  await tick()
}

const expect_headers_contain = (...expected: string[]) => {
  const joined = header_texts().join(` | `)
  for (const label of expected) expect(joined).toContain(label)
}

// HeatmapTable virtualizes above min_window (~60); assert the DOM stays bounded
const expect_virtualized = (max_rendered: number) => {
  const rows = body_rows()
  expect(rows.length).toBeGreaterThan(0)
  expect(rows.length).toBeLessThan(max_rendered)
  expect(document.querySelectorAll(`tbody tr.virtual-spacer`).length).toBeGreaterThan(0)
  return rows
}

test(`frames tab has one row per frame and one unit-labeled column per property`, async () => {
  const trajectory = make_eager_trajectory(4)
  await mount_pane({ trajectory })

  // measured against the extractor rather than a hardcoded count so the assertion
  // tracks whatever full_data_extractor yields for this frame
  const property_keys = Object.keys(
    full_data_extractor(trajectory.frames[0], trajectory),
  ).filter((key) => key !== `Step` && !key.startsWith(`constant_`))

  expect(body_rows()).toHaveLength(4)
  expect(header_texts()).toHaveLength(2 + property_keys.length)

  // headers render label HTML (F<sub>max</sub>), so compare on textContent
  expect_headers_contain(`Energy (eV)`, `Fmax (eV/Å)`, `Volume (Å³)`, `Density (g/cm³)`)

  // Frame index and step are distinct columns: step counts by 10 here
  expect(cell_texts(body_rows()[0]).slice(0, 2)).toEqual([`0`, `0`])
  expect(cell_texts(body_rows()[3]).slice(0, 2)).toEqual([`3`, `30`])

  // no sampling notice for a fully in-memory trajectory
  expect(document.body.textContent).not.toContain(`Sampled frames`)
})

test(`indexed trajectory reads sampled plot_metadata and says so`, async () => {
  const n_sampled = 100
  const trajectory = make_indexed_trajectory({
    total_frames: 100_000,
    plot_metadata: Array.from({ length: n_sampled }, (_, sample_idx) => ({
      frame_number: sample_idx * 200,
      step: sample_idx * 200,
      properties: { energy: -100 - sample_idx, temperature: 300 + sample_idx },
    })),
  })
  await mount_pane({ trajectory })

  expect(document.body.textContent).toContain(`Sampled frames: 100 of 100,000 frames`)
  // never presents the 10 in-memory frames as the run, nor the sample as all frames
  expect(document.body.textContent).not.toContain(`Sampled frames: 10 of`)

  // Virtualization keeps the DOM bounded while the sample stays 100 rows long.
  const rows = expect_virtualized(n_sampled)

  // columns come from plot_metadata properties, not from the in-memory frames' lattice
  expect_headers_contain(`Temperature (K)`)
  expect(header_texts().some((text) => text.includes(`Volume`))).toBe(false)

  // sampled rows keep their true frame numbers (0, 200, 400, …)
  expect(cell_texts(rows[0])[0]).toBe(`0`)
  expect(cell_texts(rows[1])[0]).toBe(`200`)
})

test.each([
  [100_000, `Partial view: 10 of 100,000 frames are in memory`],
  // frames.length is a lower bound here, never a total — it must not be printed as one
  [undefined, `Partial view: 10 of an unreported number of frames are in memory`],
])(
  `indexed trajectory without plot_metadata flags the partial view (total %s)`,
  async (total_frames, expected_notice) => {
    await mount_pane({ trajectory: make_indexed_trajectory({ total_frames }) })
    expect(document.body.textContent).toContain(expected_notice)
    expect(body_rows()).toHaveLength(10)
  },
)

test(`atoms tab enumerates arbitrary site property keys including vec3`, async () => {
  const frame = make_sites_frame([
    make_site(0, {
      force: [0.1, -0.2, 0.3],
      magmom: 1.5,
      selective_dynamics: [true, true, false],
      cluster_tag: `surface`,
    }),
    make_site(1, {
      force: [0.4, 0.5, -0.6],
      selective_dynamics: [false, false, false],
    }),
  ])
  await mount_pane({ trajectory: { frames: [frame] }, current_frame: frame })
  await open_tab(`atoms`)

  // vec3 properties become three columns, scalars one, unknown keys pass through verbatim
  expect_headers_contain(
    `Site`,
    `Element`,
    `afrac`,
    `x (Å)`,
    `magmom (μB)`,
    `cluster_tag`,
    `force x (eV/Å)`,
    `force y (eV/Å)`,
    `force z (eV/Å)`,
    `selective_dynamics x`,
  )
  // 2 identity + 3 fractional + 3 cartesian + 3 force + 1 magmom + 3 selective + 1 tag
  expect(header_texts()).toHaveLength(16)

  const rows = body_rows()
  expect(rows).toHaveLength(2)
  const cells = cell_texts(rows[0])
  expect(cells[0]).toBe(`0`)
  expect(cells[1]).toBe(`Fe`)
  // cartesian x of site 0, then the three force components
  expect(cells.slice(5, 8)).toEqual([`0`, `2.5`, `5`])
  expect(cells.slice(8, 11)).toEqual([`0.1`, `-0.2`, `0.3`])
  expect(cells[11]).toBe(`1.5`)
  expect(cells.slice(12, 15)).toEqual([`true`, `true`, `false`])
  expect(cells[15]).toBe(`surface`)

  // Missing scalar properties leave empty cells without shifting later vec3 components.
  const second_cells = cell_texts(rows[1])
  expect(second_cells.slice(8, 16)).toEqual([
    `0.4`,
    `0.5`,
    `-0.6`,
    `n/a`,
    `false`,
    `false`,
    `false`,
    `n/a`,
  ])
})

test(`atoms tab virtualizes a large site frame and formats the tab count`, async () => {
  // Enough to exceed HeatmapTable's min_window without building thousands of fixtures.
  const n_sites = 100
  const frame = make_sites_frame(
    Array.from({ length: n_sites }, (_, site_idx) => make_site(site_idx, {})),
  )
  await mount_pane({ trajectory: { frames: [frame] }, current_frame: frame })
  await open_tab(`atoms`)

  expect_virtualized(n_sites)
  expect(document.body.textContent).toContain(`Atoms (100)`)
})

test(`row clicks report the frame index and the site index`, async () => {
  const on_step_change = vi.fn()
  const on_site_select = vi.fn()
  const trajectory = make_eager_trajectory(5)
  const frame = trajectory.frames[0]
  await mount_pane({
    trajectory,
    current_frame: frame,
    on_step_change,
    on_site_select,
  })

  body_rows()[2].click()
  expect(on_step_change).toHaveBeenCalledExactlyOnceWith(2)

  // reversing the sort proves the callback reports the row's frame, not its DOM position
  const frame_header = [...document.querySelectorAll<HTMLElement>(`thead th`)].find((th) =>
    th.textContent?.includes(`Frame`),
  )
  if (!frame_header) throw new Error(`no Frame header`)
  frame_header.click()
  await tick()
  const first_row = body_rows()[0]
  expect(cell_texts(first_row)[0]).toBe(`4`)
  first_row.click()
  expect(on_step_change).toHaveBeenLastCalledWith(4)

  await open_tab(`atoms`)
  body_rows()[1].click()
  expect(on_site_select).toHaveBeenCalledExactlyOnceWith(1)
})

test(`closed pane builds no table`, async () => {
  await mount_pane({ trajectory: make_eager_trajectory(3), pane_open: false })
  expect(document.querySelector(`table`)).toBeNull()
})
