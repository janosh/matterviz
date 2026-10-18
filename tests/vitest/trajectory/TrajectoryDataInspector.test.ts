import type { Vec3 } from '#lib/math.js'
import type { Site } from '#lib/structure/index.js'
import type { TrajectoryFrame } from '#lib/trajectory/index.js'
import { trajectory_from_frames } from '#lib/trajectory/runs/memory.js'
import TrajectoryDataInspector from '#lib/trajectory/TrajectoryDataInspector.svelte'
import { mount, tick, unmount } from 'svelte'
import { derived, fromStore, writable } from 'svelte/store'
import { create_numeric_md_frame, FrameView } from '#lib/trajectory/frame.js'
import { afterEach, expect, test, vi } from 'vitest'
import { doc_query, query } from '../setup'
import { make_run as make_shared_run, with_property_rows } from '../test-fixtures'

let mounted_inspector: ReturnType<typeof mount> | undefined
afterEach(async () => {
  if (mounted_inspector) await unmount(mounted_inspector)
  mounted_inspector = undefined
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
const mount_inspector = async (props: Record<string, unknown>) => {
  mounted_inspector = mount(TrajectoryDataInspector, {
    target: document.body,
    props,
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
const open_tab = async (value: `global` | `frames` | `atoms` | `info`) => {
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

const attributes = () =>
  Object.fromEntries(
    body_rows()
      .map((row) => cell_texts(row))
      .map(([name, ...rest]) => [name, rest]),
  )

// OVITO's global attributes: the displayed frame's recorded scalars, then what its structure
// implies, as attribute/value/unit rows that follow the displayed frame.
test(`global tab lists the displayed frame's recorded and derived attributes`, async () => {
  const run = make_run(4)
  await mount_inspector({ run, current_frame: run.preview })
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
  if (mounted_inspector) await unmount(mounted_inspector)
  await mount_inspector({ run, current_step_idx: 2, current_frame: run.preview })
  rows = attributes()
  expect(rows.Frame).toEqual([`3`, ``])
  expect(rows.Energy).toEqual([`-102`, `eV`])
})

// Math.max(...norms) overflowed the call stack past ~125k atoms and took every tab down
test(`global tab derives Fmax from 200k sites carrying forces`, async () => {
  const force_of = (site_idx: number) => (site_idx === 7 ? [0, 3, 4] : [0.1, 0, 0])
  const sites = Array.from({ length: 200_000 }, (_unused, site_idx) =>
    make_site(site_idx, { force: force_of(site_idx) }),
  )
  const run = trajectory_from_frames([make_sites_frame(sites.slice(0, 2))])
  await mount_inspector({ run, current_frame: make_sites_frame(sites) })
  const { Fmax, Atoms } = attributes()
  expect(Fmax).toEqual([`5`, `eV/Å`])
  expect(Atoms).toEqual([`200000`, ``])
})

// A render sample previews every n-th atom: counts and per-atom values come from the whole
// frame, and what only the sample could tell (formula, density, a derived Fmax) is left out
test(`global tab of a render-sampled frame reports the whole frame`, async () => {
  const run = make_run(2)
  const current_frame = {
    ...run.preview,
    metadata: { render_sample: true, total_atoms: 3000, source_atom_indices: [0, 1000, 2000] },
    structure: {
      ...run.preview.structure,
      sites: run.preview.structure.sites.map((site) => ({
        ...site,
        properties: { force: [1, 0, 0] },
      })),
    },
  }
  await mount_inspector({
    run: with_property_rows(
      run,
      [{ frame_number: 0, step: 0, properties: { energy: -3000 } }],
      2,
    ),
    current_frame,
  })
  const rows = attributes()
  expect(rows.Atoms).toEqual([`3000`, ``])
  expect(rows[`Energy per atom`]).toEqual([`-1`, `eV/atom`])
  expect(rows[`Volume per atom`]).toEqual([`0.009`, `Å³/atom`])
  expect(rows.Volume).toEqual([`27`, `Å³`])
  for (const sample_only of [`Formula`, `Density`, `Fmax`])
    expect(rows[sample_only]).toBeUndefined()
})

// Without a recorded row the frame's own metadata stands in, minus frame bookkeeping
test(`global tab skips bookkeeping keys of the frame metadata`, async () => {
  const run = make_run(2)
  const current_frame = {
    ...run.preview,
    metadata: { total_atoms: 3, frame_number: 7, energy: -5 },
  }
  await mount_inspector({ run, current_frame, current_step_idx: 7, property_rows: [] })
  const rows = attributes()
  expect(rows.Energy).toEqual([`-5`, `eV`])
  expect(Object.keys(rows)).not.toContain(`total_atoms`)
  expect(Object.keys(rows)).not.toContain(`frame_number`)
})

test.each([
  [`total_atoms`, { render_sample: true, source_atom_indices: [0, 1000, 2000] }],
  [`source_atom_indices`, { render_sample: true, total_atoms: 3000 }],
])(`a render sample without %s fails loudly`, (missing, metadata) => {
  const run = make_run(2)
  expect(() =>
    mount(TrajectoryDataInspector, {
      target: document.body,
      props: { run, current_frame: { ...run.preview, metadata } },
    }),
  ).toThrow(missing)
})

test(`frames tab renders every property row with units`, async () => {
  const run = make_run(4)
  await mount_inspector({ run })
  await open_tab(`frames`)
  expect(body_rows()).toHaveLength(4)
  expect_headers(`Energy (eV)`, `Fmax (eV/Å)`, `Volume (Å³)`, `Density (g/cm³)`)
  // the recorded `Step` property duplicates the Step column
  expect(header_texts().filter((text) => text.startsWith(`Step`))).toEqual([`Step`])
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
  await mount_inspector({ run, current_frame })
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
  mounted_inspector = mount(TrajectoryDataInspector, {
    target: document.body,
    props: {
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
  expect(after[2]).toBe(`9`) // x (Å), after Site and Element
})

test(`sampled property rows keep their real frame numbers and disclose sampling`, async () => {
  const rows = Array.from({ length: 100 }, (_unused, sample_idx) => ({
    frame_number: sample_idx * 200,
    step: sample_idx * 200,
    properties: { energy: -100 - sample_idx, temperature: 300 + sample_idx },
  }))
  await mount_inspector({ run: with_property_rows(make_run(1), rows, 100_000) })
  await open_tab(`frames`)
  expect(document.body.textContent).toContain(`Sampled frames: 100 of 100,000`)
  // the notice above the table keeps the table toolbar out of the tab row
  expect(doc_query(`.inspector-tabs`).dataset.toolbar).toBe(`row`)
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
  await mount_inspector({ run: trajectory_from_frames([frame]), current_frame: frame })
  await open_atoms()
  expect_headers(
    `Site`,
    `Element`,
    `x (Å)`,
    `magmom (μB)`,
    `cluster_tag`,
    `force x (eV/Å)`,
    `selective_dynamics x`,
  )
  expect(header_texts()).toContain(`velocity x`) // no unit: Å/fs from ASE, Å/ps from LAMMPS
  // fractional coordinates start hidden so the properties follow the Cartesian ones
  expect(header_texts().some((text) => text.includes(`frac`))).toBe(false)
  // Numeric vectors also get their magnitude; a boolean one like selective_dynamics does not
  expect_headers(`|force| (eV/Å)`, `|velocity|`)
  expect(header_texts().some((text) => text.includes(`|selective_dynamics|`))).toBe(false)
  const rows = body_rows()
  expect(rows).toHaveLength(2)
  expect(cell_texts(rows[0]).slice(5, 14)).toEqual([
    `0.1`,
    `-0.2`,
    `0.3`,
    `0.3742`,
    `1.5`,
    `true`,
    `true`,
    `false`,
    `surface`,
  ])
  expect(cell_texts(rows[1]).slice(5, 14)).toEqual([
    `0.4`,
    `0.5`,
    `-0.6`,
    `0.8775`,
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
  await mount_inspector({ run: trajectory_from_frames([frame]), current_frame: frame })
  await open_atoms()
  expect_virtualized(100)
  expect(document.body.textContent).toContain(`Atoms (100)`)
})

test.each([false, true])(
  `row navigation and atom selection need a host=%s`,
  async (linked) => {
    const on_step_change = vi.fn()
    const run = make_run(5)
    await mount_inspector({
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
    if (!linked) return
    // a checkbox toggles its own row once: the row click it bubbles into must not undo it
    const checkbox = () =>
      body_rows()[0].querySelector<HTMLInputElement>(`input[type="checkbox"]`)
    checkbox()?.click()
    await tick()
    expect(selected()).toEqual([0, 2])
    checkbox()?.click()
    await tick()
    expect(selected()).toEqual([2])
  },
)

// The info pane's cards, so a host can hide its info button while the sidebar shows
test(`info tab carries the info pane's file, timing and property statistics`, async () => {
  const run = make_shared_run([0, 10, 20, 30], {
    frame_metadata: (frame_idx) => ({ energy: -100 - frame_idx }),
    provenance: { filename: `md.extxyz`, format: `xyz`, source_bytes: 2048 },
    time_step: { value: 2, unit: `fs` },
  })
  await mount_inspector({ run, current_step_idx: 1, current_frame: run.preview })
  expect(document.querySelector(`.info-row`)).toBeNull() // built only once the tab opens
  await open_tab(`info`)
  const rows = Object.fromEntries(
    [...document.querySelectorAll(`.info-row`)].map((row) => {
      const [label, value] = [...row.querySelectorAll(`span`)].map((span) =>
        span.textContent?.trim(),
      )
      return [label, value]
    }),
  )
  expect(rows).toMatchObject({
    Name: `md.extxyz`,
    'File Size': `2.00 KiB`,
    Format: `xyz`,
    'Total Frames': `4 (current: 2)`,
    'Time Step': `2 fs`,
    Duration: `60 fs`,
    'Energy Range': `−103 - −100 eV`,
  })
  // neither a table toolbar nor a card filter: the cards start right under the tabs
  const sidebar = doc_query(`.trajectory-data-inspector-sidebar`)
  for (const selector of [`.control-buttons`, `.filter-toggle`, `.info-filter`])
    expect(sidebar.querySelector(selector), selector).toBeNull()
  expect(
    sidebar.querySelector(`.tabs-panel:not([hidden]) > :first-child`)?.classList,
  ).toContain(`info-cards`)
})

test(`the inspector is a sidebar whose table fills its height, with no dock button`, async () => {
  await mount_inspector({ run: make_run(3) })
  const sidebar = doc_query(`.trajectory-data-inspector-sidebar`)
  expect(sidebar.querySelector(`h4`)?.textContent?.trim()).toBe(`Data Inspector`)
  expect(sidebar.querySelector(`h4 button`)).toBeNull()
  // jsdom lays nothing out, so no label is cut and the toolbar joins the tab row
  expect(query(sidebar, `.inspector-tabs`).dataset.toolbar).toBe(`inline`)
  // the table fills the sidebar instead of a viewport-tied height
  const { style } = query(sidebar, `.table-scroll`)
  expect([style.flexGrow, style.minHeight, style.maxHeight]).toEqual([`1`, `0`, ``])
})
