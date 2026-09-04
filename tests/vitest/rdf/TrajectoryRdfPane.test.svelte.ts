// The shared chrome is covered in tests/vitest/trajectory/TrajectoryAnalysisPane.test.svelte.ts;
// this pins what the RDF pane layers on top: its controls reach the sweep, the shell table and
// CSV download appear once it lands, and a lattice-less run is refused with a reason.
import { download } from '$lib/io/fetch'
import TrajectoryRdfPane from '$lib/rdf/TrajectoryRdfPane.svelte'
import type { TrajectoryRdf } from '$lib/rdf'
import { trajectory_from_frames, type TrajectoryRun } from '$lib/trajectory'
import { mount, tick, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { bind_props, doc_query } from '../setup'
import { FCC_LATTICE_CONST, make_fcc } from '../structure-id/lattices'

vi.mock(`$lib/io/fetch`, async (import_original) => ({
  ...(await import_original<Record<string, unknown>>()),
  download: vi.fn(),
}))

const make_run = (n_frames: number, with_time = true): TrajectoryRun =>
  trajectory_from_frames(
    Array.from({ length: n_frames }, (_unused, step) => ({
      step: 100 + step ** 2 * 25,
      structure: make_fcc([2, 2, 2]),
    })),
    {
      provenance: { filename: `original.xyz`, format: `extxyz` },
      ...(with_time && { time_step: { value: 0.5, unit: `fs` } }),
    },
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

test.each([
  { cutoff_value: 3.5, bin_width: `0.05`, coordination: 12, with_time: true },
  { cutoff_value: 2, bin_width: `0.0286`, coordination: null, with_time: false },
])(
  `exports the collected RDF snapshot at cutoff $cutoff_value`,
  async ({ cutoff_value, bin_width, coordination, with_time }) => {
    vi.mocked(download).mockClear()
    const stringify = vi.spyOn(JSON, `stringify`)
    const state = $state({
      run: make_run(20, with_time),
      result: undefined as TrajectoryRdf | undefined,
    })
    mounted_component = mount(TrajectoryRdfPane, {
      target: document.body,
      props: bind_props({ pane_open: true }, state),
    })
    await settle()
    const controls = doc_query(`.trajectory-rdf-controls`)
    const [max_frames, cutoff, bins] = [`Max RDF frames`, `RDF cutoff`, `RDF bins`].map(
      (label) => doc_query<HTMLInputElement>(`input[aria-label="${label}"]`),
    )
    expect(controls.textContent).toContain(`20 of 20 frames`)
    for (const [input, value] of [
      [max_frames, `4`],
      [cutoff, String(cutoff_value)],
      [bins, `70`],
    ] as const) {
      input.value = value
      input.dispatchEvent(new Event(`input`))
    }
    await settle()
    expect(controls.textContent).toContain(`4 of 20 frames (every 5)`)
    expect(controls.textContent).toContain(`${bin_width} Å per bin`)
    // the default 10 Å cutoff reaches past half of this 7.2 Å cell; 3.5 Å does not
    expect(controls.textContent).not.toContain(`beyond half the cell`)

    doc_query(`.trajectory-rdf-controls button`, HTMLButtonElement).click()
    await settle(20)
    expect(state.result).toMatchObject({
      frame_numbers: [0, 5, 10, 15],
      cutoff: cutoff_value,
      n_bins: 70,
    })
    if (!with_time) expect(state.result?.source).not.toHaveProperty(`time_step`)
    const summary = doc_query(`.analysis-summary`)
    expect(summary.textContent).toContain(`Cu-Cu`)
    // fcc's first shell has 12 neighbours; below that shell no peak or CN is fabricated.
    if (coordination === null) expect(state.result?.curves[0].shell.first_peak_r).toBeNull()
    else
      expect(state.result?.curves[0].shell.first_peak_r).toBeCloseTo(
        FCC_LATTICE_CONST / Math.SQRT2,
        1,
      )
    expect(doc_query(`.analysis-note`).textContent).toContain(
      `4 frames (every 5th) × 32 atoms`,
    )
    expect(download).not.toHaveBeenCalled()
    expect(stringify).not.toHaveBeenCalledWith(
      expect.objectContaining({ analysis: `rdf` }),
      null,
      2,
    )
    // Editing the next calculation cannot rewrite the provenance or parameters of this one.
    state.run.provenance.filename = `renamed.xyz`
    if (state.run.time_step) state.run.time_step.value = 2
    for (const input of [
      max_frames,
      cutoff,
      bins,
      doc_query<HTMLInputElement>(`input[aria-label="Start frame"]`),
    ]) {
      input.value = `2`
      input.dispatchEvent(new Event(`input`))
    }
    await settle()
    const [csv_button, json_button] = document.querySelectorAll<HTMLButtonElement>(
      `button.analysis-download`,
    )
    expect(csv_button.textContent).toContain(`g(r) CSV`)
    expect(json_button.textContent).toContain(`Analysis JSON`)
    csv_button.click()
    const csv = vi.mocked(download).mock.calls.at(-1)
    expect(csv?.slice(1)).toEqual([`rdf.csv`, `text/csv`])
    if (typeof csv?.[0] !== `string`) throw new Error(`Expected CSV text`)
    const csv_rows = csv[0].trim().split(`\n`)
    expect(csv_rows[0]).toBe(`r_A,g_Cu-Cu`)
    expect(csv_rows.slice(1).map((row) => row.split(`,`).map(Number))).toEqual(
      state.result?.r.map((radius, idx) => [radius, state.result?.curves[0].g_r[idx]]),
    )
    json_button.click()
    expect(stringify).toHaveBeenCalledWith(
      expect.objectContaining({ analysis: `rdf` }),
      null,
      2,
    )
    const json = vi.mocked(download).mock.calls.at(-1)
    expect(json?.slice(1)).toEqual([`rdf.json`, `application/json`])
    if (typeof json?.[0] !== `string`) throw new Error(`Expected JSON text`)
    const exported: unknown = JSON.parse(json[0])
    expect(exported).toEqual({
      schema_version: 1,
      analysis: `rdf`,
      units: { distance: `A`, volume: `A^3`, g_r: `dimensionless`, coordination: `neighbors` },
      ...state.result,
    })
    expect(exported).toMatchObject({
      max_frames: 4,
      cutoff: cutoff_value,
      n_bins: 70,
      start_frame: 0,
      end_frame: 20,
      frame_numbers: [0, 5, 10, 15],
      frame_steps: [100, 725, 2600, 5725],
      frame_stride: 5,
      source: {
        provenance: { filename: `original.xyz`, format: `extxyz` },
        frame_count: 20,
        ...(with_time && { time_step: { value: 0.5, unit: `fs` } }),
      },
      curves: [
        {
          shell: {
            coordination: coordination === null ? null : expect.closeTo(coordination, 6),
          },
          coordination_reverse: coordination === null ? null : expect.closeTo(coordination, 6),
        },
      ],
    })
  },
)

// Refused up front, not on click: g(r) has nothing to normalise against without a cell, and a
// button that takes the click and then throws reads as a broken feature rather than a
// mismatched file
test.each([
  undefined,
  [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 0],
  ],
  [
    [NaN, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
])(`refuses invalid lattice %s before the click`, async (matrix) => {
  const molecule = {
    sites: make_fcc([1, 1, 1]).sites,
    ...(matrix && { lattice: { matrix } }),
  } as ReturnType<typeof make_fcc>
  const state = $state<{ run: TrajectoryRun; result: TrajectoryRdf | undefined }>({
    run: { ...make_run(1), preview: { step: 0, structure: molecule } },
    result: undefined as TrajectoryRdf | undefined,
  })
  mounted_component = mount(TrajectoryRdfPane, {
    target: document.body,
    props: bind_props({ pane_open: true }, state),
  })
  await settle()
  const compute = doc_query(`.trajectory-rdf-controls button`, HTMLButtonElement)
  expect(compute.disabled).toBe(true)
  expect(compute.title).toContain(`unit cell`)
  const hint_id = compute.getAttribute(`aria-describedby`)
  expect(hint_id).toBeTypeOf(`string`)
  expect(document.querySelector(`[id="${hint_id}"]`)?.textContent).toContain(`unit cell`)
  expect(document.body.textContent).toContain(`unit cell`)
  compute.click()
  await settle()
  expect(state.result).toBeUndefined()
  state.run = { ...make_run(2), preview: { step: 0, structure: molecule } }
  await settle()
  expect(compute.disabled).toBe(true)
  const start = doc_query(`input[aria-label="Start frame"]`, HTMLInputElement)
  start.value = `1`
  start.dispatchEvent(new Event(`input`))
  await settle()
  expect(compute.disabled).toBe(false)
  compute.click()
  await settle(20)
  expect(state.result).toMatchObject({ frame_numbers: [1], n_atoms: 32 })
  state.run = make_run(2)
  await settle()
  expect(compute.disabled).toBe(false)
  expect(compute.hasAttribute(`aria-describedby`)).toBe(false)
  expect(document.querySelector(`[id="${hint_id}"]`)).toBeNull()
})
