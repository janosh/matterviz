import type { Vec3 } from '$lib/math'
import type { Site } from '$lib/structure'
import { trajectory_from_frames, type TrajectoryFrame } from '$lib/trajectory'
import TrajectoryDataInspectorPane from '$lib/trajectory/TrajectoryDataInspectorPane.svelte'
import { mount, tick, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { make_run as make_shared_run, with_property_rows } from '../setup'

let mounted_pane: ReturnType<typeof mount> | undefined
afterEach(async () => {
  if (mounted_pane) await unmount(mounted_pane)
  mounted_pane = undefined
  document.body.replaceChildren()
})

const make_run = (n_frames = 4) =>
  make_shared_run(
    Array.from({ length: n_frames }, (_unused, frame_idx) => frame_idx * 10),
    {
      site_count: 3,
      lattice_params: { a: 3, b: 3, c: 3, volume: 27 },
      frame_metadata: (frame_idx) => ({
        energy: -100 - frame_idx,
        force_max: 0.5 - frame_idx * 0.1,
      }),
    },
  )
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
  [...document.querySelectorAll(`thead th`)].map((header) => header.textContent?.trim() ?? ``)
const body_rows = () => [
  ...document.querySelectorAll<HTMLTableRowElement>(
    `tbody tr:not(.virtual-spacer):not(.empty-row)`,
  ),
]
const cell_texts = (row: HTMLTableRowElement) =>
  [...row.querySelectorAll(`td`)].map((cell) =>
    (cell.textContent?.trim() ?? ``).replaceAll(`\u2212`, `-`),
  )
const open_atoms = async () => {
  const tab = document.querySelector<HTMLButtonElement>(
    `button[role="tab"][data-value="atoms"]`,
  )
  if (!tab) throw new Error(`No atoms tab`)
  tab.click()
  await tick()
}
const expect_headers = (...expected: string[]) => {
  const joined = header_texts().join(` | `)
  for (const label of expected) expect(joined).toContain(label)
}
const expect_virtualized = (max_rendered: number) => {
  const rows = body_rows()
  expect(rows.length).toBeGreaterThan(0)
  expect(rows.length).toBeLessThan(max_rendered)
  expect(document.querySelectorAll(`tbody tr.virtual-spacer`).length).toBeGreaterThan(0)
  return rows
}

test(`frames tab renders every property row with units`, async () => {
  const run = make_run(4)
  await mount_pane({ run })
  expect(body_rows()).toHaveLength(4)
  expect_headers(`Energy (eV)`, `Fmax (eV/Å)`, `Volume (Å³)`, `Density (g/cm³)`)
  expect(cell_texts(body_rows()[0]).slice(0, 2)).toEqual([`0`, `0`])
  expect(cell_texts(body_rows()[3]).slice(0, 2)).toEqual([`3`, `30`])
  expect(document.body.textContent).not.toContain(`Sampled frames`)
})

test(`sampled property rows keep their real frame numbers and disclose sampling`, async () => {
  const rows = Array.from({ length: 100 }, (_unused, sample_idx) => ({
    frame_number: sample_idx * 200,
    step: sample_idx * 200,
    properties: { energy: -100 - sample_idx, temperature: 300 + sample_idx },
  }))
  await mount_pane({ run: with_property_rows(make_run(1), rows, 100_000) })
  expect(document.body.textContent).toContain(`Sampled frames: 100 of 100,000`)
  const rendered = expect_virtualized(100)
  expect_headers(`Temperature (K)`)
  expect(header_texts().some((text) => text.includes(`Volume`))).toBe(false)
  expect(cell_texts(rendered[0])[0]).toBe(`0`)
  expect(cell_texts(rendered[1])[0]).toBe(`200`)
})

test(`atoms tab expands arbitrary scalar and vec3 site properties`, async () => {
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
  await mount_pane({ run: trajectory_from_frames([frame]), current_frame: frame })
  await open_atoms()
  expect_headers(
    `Site`,
    `Element`,
    `afrac`,
    `x (Å)`,
    `magmom (μB)`,
    `cluster_tag`,
    `force x (eV/Å)`,
    `selective_dynamics x`,
  )
  const rows = body_rows()
  expect(rows).toHaveLength(2)
  expect(cell_texts(rows[0]).slice(8, 16)).toEqual([
    `0.1`,
    `-0.2`,
    `0.3`,
    `1.5`,
    `true`,
    `true`,
    `false`,
    `surface`,
  ])
  expect(cell_texts(rows[1]).slice(8, 16)).toEqual([
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

test(`atoms tab virtualizes a large frame`, async () => {
  const frame = make_sites_frame(
    Array.from({ length: 100 }, (_unused, site_idx) => make_site(site_idx, {})),
  )
  await mount_pane({ run: trajectory_from_frames([frame]), current_frame: frame })
  await open_atoms()
  expect_virtualized(100)
  expect(document.body.textContent).toContain(`Atoms (100)`)
})

test(`row clicks report frame and site indices`, async () => {
  const on_step_change = vi.fn()
  const on_site_select = vi.fn()
  const run = make_run(5)
  await mount_pane({
    run,
    current_frame: run.preview,
    on_step_change,
    on_site_select,
  })
  body_rows()[2].click()
  expect(on_step_change).toHaveBeenCalledExactlyOnceWith(2)
  await open_atoms()
  body_rows()[1].click()
  expect(on_site_select).toHaveBeenCalledExactlyOnceWith(1)
})

test(`closed pane builds no table`, async () => {
  await mount_pane({ run: make_run(3), pane_open: false })
  expect(document.querySelector(`table`)).toBeNull()
})
