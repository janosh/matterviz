import type { Vec3 } from '#lib/math.js'
import type { Site } from '#lib/structure/index.js'
import type { TrajectoryFrame } from '#lib/trajectory/index.js'
import { trajectory_from_frames } from '#lib/trajectory/runs/memory.js'
import TrajectoryDataInspectorPane from '#lib/trajectory/TrajectoryDataInspectorPane.svelte'
import { mount, tick, unmount } from 'svelte'
import { derived, fromStore, writable } from 'svelte/store'
import { create_numeric_md_frame, FrameView } from '#lib/trajectory/frame.js'
import { afterEach, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'
import { make_run as make_shared_run, with_property_rows } from '../test-fixtures'

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
const open_tab = async (value: `global` | `frames` | `atoms`) => {
  doc_query<HTMLButtonElement>(`button[role="tab"][data-value="${value}"]`).click()
  await tick()
}
const open_atoms = () => open_tab(`atoms`)
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

// OVITO's global attributes: the displayed frame's recorded scalars, then what its structure
// implies, as attribute/value/unit rows that follow the displayed frame.
test(`global tab lists the displayed frame's recorded and derived attributes`, async () => {
  const run = make_run(4)
  const attributes = () =>
    Object.fromEntries(
      body_rows()
        .map((row) => cell_texts(row))
        .map(([name, ...rest]) => [name, rest]),
    )
  await mount_pane({ run, current_frame: run.preview })
  // The default tab
  expect(
    doc_query(`button[role="tab"][data-value="global"]`).getAttribute(`aria-selected`),
  ).toBe(`true`)
  let rows = attributes()
  expect(rows.Frame).toEqual([`1`, ``])
  expect(rows.Energy).toEqual([`-100`, `eV`])
  expect(rows[`Energy per atom`]).toEqual([`-33.3333`, `eV/atom`])
  // Recorded, so it wins over the structure's own (absent) forces
  expect(rows.Fmax).toEqual([`0.5`, `eV/Å`])
  expect(rows.Atoms).toEqual([`3`, ``])
  expect(rows.Volume).toEqual([`27`, `Å³`])
  expect(rows[`Volume per atom`]).toEqual([`9`, `Å³/atom`])
  expect(rows[`α`]?.[1]).toBe(`°`)
  expect(rows.Density?.[1]).toBe(`g/cm³`)
  // A later frame's recorded values replace the first frame's
  if (mounted_pane) await unmount(mounted_pane)
  await mount_pane({ run, current_step_idx: 2, current_frame: run.preview })
  rows = attributes()
  expect(rows.Frame).toEqual([`3`, ``])
  expect(rows.Energy).toEqual([`-102`, `eV`])
})

test(`frames tab renders every property row with units`, async () => {
  const run = make_run(4)
  await mount_pane({ run })
  await open_tab(`frames`)
  expect(body_rows()).toHaveLength(4)
  expect_headers(`Energy (eV)`, `Fmax (eV/Å)`, `Volume (Å³)`, `Density (g/cm³)`)
  // Frame column numbers from 1 like the step input; Step is the recorded MD step
  expect(cell_texts(body_rows()[0]).slice(0, 2)).toEqual([`1`, `0`])
  expect(cell_texts(body_rows()[3]).slice(0, 2)).toEqual([`4`, `30`])
  expect(document.body.textContent).not.toContain(`Sampled frames`)
})

test(`sampled atom rows retain source indices and identify exported samples`, async () => {
  const run = make_run()
  const current_frame = {
    ...run.preview,
    metadata: { render_sample: true, total_atoms: 1500, source_atom_indices: [0, 500, 1000] },
  }
  await mount_pane({ run, current_frame })
  await open_atoms()
  expect(document.body.textContent).toContain(`Sampled atoms: 3 of 1500`)
  // source atom index 500 is site 501, numbered like the structure's site labels
  expect(cell_texts(body_rows()[1])[0]).toBe(`501`)
})

test(`atom rows refresh coordinates and scalar values during fixed-topology playback`, async () => {
  const make_frame = (value: number) => ({
    ...create_numeric_md_frame(
      Float64Array.of(value, 2, 3),
      Uint8Array.of(14),
      undefined,
      undefined,
      value,
      {},
      [],
    ),
    scalar_columns: { charge: Float64Array.of(value * 10) },
  })
  const view = new FrameView()
  const frames = writable(make_frame(1))
  const display = fromStore(derived(frames, (frame) => view.update(frame)))
  mounted_pane = mount(TrajectoryDataInspectorPane, {
    target: document.body,
    props: {
      pane_open: true,
      run: make_run(),
      get current_frame() {
        return display.current
      },
    },
  })
  await tick()
  await open_atoms()
  const before = cell_texts(body_rows()[0])
  expect(before).toContain(`10`)
  frames.set(make_frame(9))
  await tick()
  const after = cell_texts(body_rows()[0])
  expect(after).toContain(`90`)
  expect(after).not.toEqual(before)
  expect(after[5]).toBe(`9`)
})

test(`sampled property rows keep their real frame numbers and disclose sampling`, async () => {
  const rows = Array.from({ length: 100 }, (_unused, sample_idx) => ({
    frame_number: sample_idx * 200,
    step: sample_idx * 200,
    properties: { energy: -100 - sample_idx, temperature: 300 + sample_idx },
  }))
  await mount_pane({ run: with_property_rows(make_run(1), rows, 100_000) })
  await open_tab(`frames`)
  expect(document.body.textContent).toContain(`Sampled frames: 100 of 100,000`)
  const rendered = expect_virtualized(100)
  expect_headers(`Temperature (K)`)
  expect(header_texts().some((text) => text.includes(`Volume`))).toBe(false)
  expect(cell_texts(rendered[0])[0]).toBe(`1`)
  expect(cell_texts(rendered[1])[0]).toBe(`201`)
})

test(`atoms tab expands arbitrary scalar and vec3 site properties`, async () => {
  const frame = make_sites_frame([
    make_site(0, {
      force: [0.1, -0.2, 0.3],
      magmom: 1.5,
      selective_dynamics: [true, true, false],
      cluster_tag: `surface`,
      velocity: [1, 0, 0],
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
  expect(header_texts()).toContain(`velocity x`) // no unit: Å/fs from ASE, Å/ps from LAMMPS
  // Numeric vectors also get their magnitude; a boolean one like selective_dynamics does not
  expect_headers(`|force| (eV/Å)`, `|velocity|`)
  expect(header_texts().some((text) => text.includes(`|selective_dynamics|`))).toBe(false)
  const rows = body_rows()
  expect(rows).toHaveLength(2)
  expect(cell_texts(rows[0]).slice(8, 17)).toEqual([
    `0.1`,
    `-0.2`,
    `0.3`,
    `0.374166`,
    `1.5`,
    `true`,
    `true`,
    `false`,
    `surface`,
  ])
  expect(cell_texts(rows[1]).slice(8, 17)).toEqual([
    `0.4`,
    `0.5`,
    `-0.6`,
    `0.877496`,
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

test.each([false, true])(
  `row navigation and atom selection need a host=%s`,
  async (linked) => {
    const on_step_change = vi.fn()
    const run = make_run(5)
    await mount_pane({
      run,
      current_frame: run.preview,
      on_step_change: linked ? on_step_change : undefined,
      selected_atoms: linked ? [] : undefined,
    })
    await open_tab(`frames`)
    expect(body_rows()[2].getAttribute(`tabindex`)).toBe(linked ? `0` : null)
    body_rows()[2].click()
    if (linked) expect(on_step_change).toHaveBeenCalledExactlyOnceWith(2)
    else expect(on_step_change).not.toHaveBeenCalled()
    await open_atoms()
    const selected = () =>
      body_rows().flatMap((row, row_idx) =>
        row.classList.contains(`selected`) ? [row_idx] : [],
      )
    expect(document.querySelectorAll(`tbody input[type="checkbox"]`)).toHaveLength(
      linked ? 3 : 0,
    )
    // A row click toggles its atom, so several rows select several atoms
    for (const row_idx of [1, 2, 1]) {
      body_rows()[row_idx].click()
      await tick()
    }
    expect(selected()).toEqual(linked ? [2] : [])
  },
)

// Hovering an atom row points at its atom in 3D before any click, and leaving the table clears it
test(`hovering atom rows reports their atoms, once per row change`, async () => {
  const on_atoms_hover = vi.fn()
  const run = make_run(3)
  await mount_pane({ run, current_frame: run.preview, on_atoms_hover })
  await open_atoms()
  const over = (target: Element) =>
    target.dispatchEvent(new PointerEvent(`pointerover`, { bubbles: true }))
  over(body_rows()[2].querySelector(`td`) ?? body_rows()[2])
  over(body_rows()[2])
  over(body_rows()[0])
  doc_query(`tbody`).dispatchEvent(new PointerEvent(`pointerleave`))
  expect(on_atoms_hover.mock.calls).toEqual([[[2]], [[0]], [[]]])
})

test(`docked, the inspector renders in place with its tables, and undocks`, async () => {
  await mount_pane({ run: make_run(3), pane_open: false, docked: true, dockable: true })
  const sidebar = doc_query(`.trajectory-data-inspector-sidebar`)
  expect(sidebar.querySelector(`table`)).not.toBeNull()
  doc_query<HTMLButtonElement>(`button[aria-label="Undock data inspector"]`).click()
  await tick()
  expect(document.querySelector(`.trajectory-data-inspector-sidebar`)).toBeNull()
})

test(`closed pane builds no table`, async () => {
  await mount_pane({ run: make_run(3), pane_open: false })
  expect(document.querySelector(`table`)).toBeNull()
})
