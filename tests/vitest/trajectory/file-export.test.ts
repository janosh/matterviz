import type { Vec3 } from '$lib/math'
import { parse_poscar, parse_xyz } from '$lib/structure/parse'
import { download } from '$lib/io/fetch'
import type { TrajectoryFrame, TrajectoryMetadata } from '$lib/trajectory'
import { trajectory_from_frames, TrajectoryExportPane } from '$lib/trajectory'
import type { TrajectoryPropertyTable } from '$lib/trajectory/file-export'
import {
  collect_frame_property_rows,
  create_poscar_frame_range_zip,
  frame_rows_to_csv,
  frame_rows_to_json,
  poscar_frame_filename,
  serialize_extxyz_frame_range,
  trajectory_export_basename,
  trajectory_frame_to_extxyz_str,
} from '$lib/trajectory/file-export'
import { parse_xyz_trajectory } from '$lib/trajectory/parse/xyz'
import { create_warning_collector } from '$lib/trajectory/parse/shared'
import { unzipSync } from 'fflate'
import { mount, tick } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { doc_query, make_crystal, with_property_rows } from '../setup'

vi.mock(`$lib/io/fetch`, async (import_original) => ({
  ...(await import_original<Record<string, unknown>>()),
  download: vi.fn(),
}))

// Si + O in a 5 A cube at the given Cartesian positions
const make_frame = (
  step: number,
  positions: Vec3[],
  metadata: Record<string, unknown> = {},
): TrajectoryFrame => ({
  structure: make_crystal(
    5,
    positions.map((xyz, idx) => ({ element: idx === 0 ? `Si` : `O`, xyz })),
  ),
  step,
  metadata,
})

// oxfmt-ignore
const two_sites: Vec3[] = [[0, 0, 0], [1, 1, 1]]
// oxfmt-ignore
const frames = [
  make_frame(0, two_sites, { energy: -10.5, force_max: 0.25 }),
  make_frame(5, [[0.1, 0, 0], [1.1, 1, 1]], { energy: -11.25, force_max: 0.1 }),
  make_frame(9, [[0.2, 0, 0], [1.2, 1, 1]], { energy: -11.5, force_max: 0.01 }),
]
const resolver = (idx: number) => frames[idx] ?? null
const make_async_resolver = () => vi.fn((idx: number) => Promise.resolve(frames[idx] ?? null))
const parse_exported_frames = (text: string): TrajectoryFrame[] =>
  parse_xyz_trajectory(text, create_warning_collector()).frames

describe(`trajectory_export_basename`, () => {
  test.each([
    [`run.extxyz`, `run`],
    [`run.xyz.gz`, `run`],
    [`run.extxyz.zip`, `run`], // the hand-rolled list omitted .zip and carried a dead .zst
    [`/data/md/traj.h5`, `traj`],
    [`XDATCAR`, `XDATCAR`],
    [`weird name (1).traj`, `weird_name_1`],
    [`.gz`, `trajectory`],
  ])(`%s -> %s`, (input, expected) => {
    expect(trajectory_export_basename(input)).toBe(expected)
  })
})

describe(`poscar_frame_filename`, () => {
  test.each([
    [7, 10, `run_frame_0007.vasp`],
    [7, 100_000, `run_frame_00007.vasp`], // widens past the 4-digit floor (max index 99999)
  ])(`frame %i of %i`, (frame_idx, total, expected) => {
    expect(poscar_frame_filename(`run.extxyz`, frame_idx, total)).toBe(expected)
  })
})

describe(`trajectory_frame_to_extxyz_str`, () => {
  // Frame-level fields (step, energy, …) live outside the structure the single-structure
  // exporter sees; scalars/booleans join the comment, arrays/strings/non-finites do not.
  test(`merges frame scalars into the comment and skips the rest`, () => {
    const comment = trajectory_frame_to_extxyz_str(
      make_frame(5, two_sites, {
        energy: -11.25,
        force_max: 0.1,
        temperature: 300,
        converged: true,
        pressure: Number.POSITIVE_INFINITY,
        bad_energy: Number.NaN,
        stress: [1, 2, 3, 4, 5, 6],
        label: `some string`,
      }),
    ).split(`\n`)[1]
    expect(comment).toContain(`Properties=species:S:1:pos:R:3`)
    expect(comment).toContain(`step=5`)
    expect(comment).toContain(`energy=-11.25`)
    expect(comment).toContain(`force_max=0.1`)
    expect(comment).toContain(`temperature=300`)
    expect(comment).toContain(`converged=true`)
    expect(comment).not.toContain(`stress`)
    expect(comment).not.toContain(`some string`)
    expect(comment).not.toMatch(/NaN|Infinity/)
  })

  // XYZ parsing stores per-atom forces on frame.metadata, which the single-structure
  // exporter never sees; without folding them onto the sites they vanish on export.
  test(`recovers per-atom forces from frame metadata`, () => {
    // oxfmt-ignore
    const frame = make_frame(0, two_sites, { forces: [[0.1, 0.2, 0.3], [-0.1, -0.2, -0.3]] })
    const text = trajectory_frame_to_extxyz_str(frame)
    expect(text).toContain(`forces:R:3`)
    const reparsed = parse_xyz(text)
    expect(reparsed?.sites[0].properties.force).toEqual([0.1, 0.2, 0.3])
    expect(reparsed?.sites[1].properties.force).toEqual([-0.1, -0.2, -0.3])
  })

  // Anything less than a full set drops the column: exporting the usable ones and zeroing the
  // rest would report converged atoms on no evidence.
  // oxfmt-ignore
  test.each([
    [`a length mismatch`, [[0.1, 0.2, 0.3]]],
    [`a short entry`, [[0.1, 0.2, 0.3], [0.1, 0.2]]],
    [`a non-finite component`, [[0.1, 0.2, 0.3], [0.1, Number.NaN, 0.3]]],
    [`a null entry`, [[0.1, 0.2, 0.3], null]],
  ])(`ignores forces with %s`, (_name, forces) => {
    expect(trajectory_frame_to_extxyz_str(make_frame(0, two_sites, { forces })))
      .not.toContain(`forces:R:3`)
  })
})

// The old fixed allow-list of 7 comment keys dropped every other scalar on reopen. For
// coords_unwrapped that is corruption: MSD/VACF then re-applies the minimum image.
test(`extXYZ round trip preserves scalars outside the old allow-list`, () => {
  const props = { energy: -10.5, n_scf_steps: 7, density: 2.33, coords_unwrapped: true }
  const [reparsed] = parse_exported_frames(
    trajectory_frame_to_extxyz_str(make_frame(0, two_sites, props)),
  )
  expect(reparsed.metadata).toMatchObject(props)
})

describe(`serialize_extxyz_frame_range`, () => {
  // Uses an async resolver: indexed trajectories load frames from a loader, not a frames array.
  test(`round-trips through the trajectory parser`, async () => {
    const on_progress = vi.fn()
    const async_resolver = make_async_resolver()
    const text = await serialize_extxyz_frame_range(0, 2, async_resolver, on_progress)
    expect(async_resolver.mock.calls).toEqual([[0], [1], [2]])
    expect(on_progress.mock.calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ])
    const reparsed = parse_exported_frames(text)
    expect(reparsed).toHaveLength(3)
    expect(reparsed.map((frame) => frame.step)).toEqual([0, 5, 9])
    expect(reparsed.map((frame) => frame.metadata?.energy)).toEqual([-10.5, -11.25, -11.5])
    expect(reparsed[2].structure.sites[0].xyz[0]).toBeCloseTo(0.2, 6)
  })

  test(`exports only the requested sub-range`, async () => {
    const text = await serialize_extxyz_frame_range(1, 2, resolver)
    expect(parse_exported_frames(text).map((frame) => frame.step)).toEqual([5, 9])
  })

  test.each([
    [-1, 1],
    [2, 1],
    [0.5, 1],
    [0, Number.NaN],
  ])(`rejects the range %s-%s`, async (start, end) => {
    await expect(serialize_extxyz_frame_range(start, end, resolver)).rejects.toThrow(
      `Invalid trajectory frame range`,
    )
  })

  // Silently emitting a short file would look like a successful export of a shorter run
  test(`throws when a frame cannot be resolved`, async () => {
    await expect(serialize_extxyz_frame_range(0, 5, resolver)).rejects.toThrow(
      `Trajectory frame 3 is not available for export`,
    )
  })
})

describe(`create_poscar_frame_range_zip`, () => {
  const read_zip = async (blob: Blob) => unzipSync(new Uint8Array(await blob.arrayBuffer()))

  test(`writes one numbered POSCAR per frame, each holding that frame's geometry`, async () => {
    const blob = await create_poscar_frame_range_zip(0, 2, resolver, `run.extxyz`, 3)
    expect(blob.type).toBe(`application/zip`)
    const files = await read_zip(blob)
    expect(Object.keys(files).toSorted()).toEqual([
      `run_frame_0000.vasp`,
      `run_frame_0001.vasp`,
      `run_frame_0002.vasp`,
    ])
    const first = new TextDecoder().decode(files[`run_frame_0000.vasp`])
    expect(first.split(`\n`)[1]).toBe(`1.0`) // POSCAR scale line
    expect(first).toContain(`Si O`)
    expect(first.endsWith(`\n`)).toBe(true)
    // filenames alone can't catch frames written in the wrong order or with stale coordinates
    for (const [frame_idx, expected_x] of [
      [0, 0],
      [1, 0.1],
      [2, 0.2],
    ] as const) {
      const text = new TextDecoder().decode(files[`run_frame_000${frame_idx}.vasp`])
      const parsed = parse_poscar(text)
      expect(parsed?.sites[0].xyz[0]).toBeCloseTo(expected_x, 6)
    }
    // names by absolute frame index, not position in the exported range
    const sub = await create_poscar_frame_range_zip(1, 2, resolver, `run.extxyz`, 3)
    expect(Object.keys(await read_zip(sub)).toSorted()).toEqual([
      `run_frame_0001.vasp`,
      `run_frame_0002.vasp`,
    ])
  })

  test(`names the frame a serializer choked on`, async () => {
    // POSCAR needs a lattice; the raw error would name neither the frame nor the range
    const lattice_less = { structure: { sites: frames[0].structure.sites }, step: 0 }
    await expect(
      create_poscar_frame_range_zip(0, 0, () => lattice_less as TrajectoryFrame, `run`, 1),
    ).rejects.toThrow(`Failed to serialize trajectory frame 0`)
  })
})

const trajectory = trajectory_from_frames(frames)
const plot_metadata: TrajectoryMetadata[] = [
  { frame_number: 0, step: 0, properties: { energy: -10.5, force_max: 0.25 } },
  { frame_number: 1, step: 5, properties: { energy: -11.25, force_max: 0.1 } },
  { frame_number: 2, step: 9, properties: { energy: -11.5, force_max: 0.01 } },
]

const run_with_properties = trajectory_from_frames(frames, { properties: plot_metadata })
const run_without_properties = with_property_rows(trajectory, [])

describe(`collect_frame_property_rows`, () => {
  test(`one row per frame carrying the extractor's numbers`, async () => {
    const on_progress = vi.fn()
    const table = await collect_frame_property_rows(0, 2, resolver, trajectory, on_progress)
    expect(table.source).toBe(`properties`)
    expect(table.rows.map(({ frame, step }) => [frame, step])).toEqual([
      [0, 0],
      [1, 5],
      [2, 9],
    ])
    expect(on_progress.mock.calls).toEqual([[3, 3]])
    expect(table.rows[0].properties).toMatchObject({
      energy: -10.5,
      force_max: 0.25,
      a: 5,
      b: 5,
      c: 5,
      alpha: 90,
      volume: 125,
    })
  })

  // An indexed trajectory holds only its first frames in memory; reading `frames` directly
  // would export a 1-row table for a 3-frame range.
  test(`resolves the full range of an indexed trajectory, not the in-memory window`, async () => {
    const async_resolver = make_async_resolver()
    const { rows, source } = await collect_frame_property_rows(
      0,
      2,
      async_resolver,
      run_without_properties,
    )
    expect(source).toBe(`frames`)
    expect(async_resolver.mock.calls).toEqual([[0], [1], [2]])
    expect(rows.map(({ properties }) => properties.energy)).toEqual([-10.5, -11.25, -11.5])
  })

  test(`reads run properties instead of frames when they cover the range`, async () => {
    const spy_resolver = vi.fn(resolver)
    const on_progress = vi.fn()
    const { rows, source } = await collect_frame_property_rows(
      0,
      2,
      spy_resolver,
      run_with_properties,
      on_progress,
    )
    expect(source).toBe(`properties`)
    expect(spy_resolver).not.toHaveBeenCalled()
    expect(on_progress.mock.calls).toEqual([[3, 3]])
    expect(rows.map(({ frame, step }) => [frame, step])).toEqual([
      [0, 0],
      [1, 5],
      [2, 9],
    ])
    expect(rows[2].properties).toEqual({ energy: -11.5, force_max: 0.01 })
  })

  // Sampled property rows usually skip frames; using them would export fewer rows than frames
  test(`falls back to the resolver when properties miss a frame in the range`, async () => {
    const sparse = with_property_rows(trajectory, [plot_metadata[0], plot_metadata[2]])
    const spy_resolver = vi.fn(resolver)
    const { rows, source } = await collect_frame_property_rows(0, 2, spy_resolver, sparse)
    expect(source).toBe(`frames`)
    expect(spy_resolver).toHaveBeenCalledTimes(3)
    expect(rows).toHaveLength(3)
  })

  // the property-row shortcut must not skip the range check the resolver path applies
  // (serialize_extxyz_frame_range above covers the full set of rejected ranges)
  test(`rejects a reversed range even when properties cover it`, async () => {
    await expect(
      collect_frame_property_rows(2, 1, resolver, run_with_properties),
    ).rejects.toThrow(`Invalid trajectory frame range`)
  })
})

const make_property_table = (
  rows: TrajectoryPropertyTable[`rows`],
): TrajectoryPropertyTable => ({
  start_frame: rows[0]?.frame ?? 0,
  end_frame: rows.at(-1)?.frame ?? 0,
  source: `frames`,
  rows,
})

describe(`frame_rows_to_csv`, () => {
  test(`heads every property column with its unit and writes one row per frame`, async () => {
    const table = await collect_frame_property_rows(0, 2, resolver, trajectory)
    const lines = frame_rows_to_csv(table).split(`\n`)
    expect(lines[0]).toBe(
      `frame,step,energy (eV),force_max (eV/Å),volume (Å³),a (Å),b (Å),c (Å),` +
        `alpha (°),beta (°),gamma (°),density (g/cm³)`,
    )
    expect(lines).toHaveLength(4) // header + 3 frames
    expect(lines[1].startsWith(`0,0,-10.5,0.25,125,5,5,5,90,90,90,`)).toBe(true)
    expect(lines[3].startsWith(`2,9,-11.5,0.01,`)).toBe(true)
  })

  // rows_to_csv keys off the first row alone, so a property only later frames carry would
  // otherwise vanish from the file entirely
  test(`aligns missing and unitless property columns across frames`, () => {
    const table = make_property_table([
      { frame: 0, step: 0, properties: { frame: 999, step: 999, energy: -1 } },
      {
        frame: 1,
        step: 1,
        properties: { energy: -2, temperature: 300, some_custom_prop: 1.5 },
      },
    ])
    expect(frame_rows_to_csv(table).split(`\n`)).toEqual([
      `frame,step,energy (eV),temperature (K),some_custom_prop`,
      `0,0,-1,,`,
      `1,1,-2,300,1.5`,
    ])
  })
})

describe(`frame_rows_to_json`, () => {
  test(`pairs bare per-frame numbers with a units map and the range's provenance`, async () => {
    const table = await collect_frame_property_rows(1, 2, resolver, trajectory)
    const parsed = JSON.parse(frame_rows_to_json(table))
    expect(parsed.frame_range).toEqual([1, 2])
    expect(parsed.n_frames).toBe(2)
    expect(parsed.source).toBe(`properties`)
    expect(parsed.units).toMatchObject({
      energy: `eV`,
      force_max: `eV/Å`,
      volume: `Å³`,
      alpha: `°`,
    })
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.rows[0]).toMatchObject({ frame: 1, step: 5, energy: -11.25, volume: 125 })
  })

  // frame/step keys inside properties must not leak into the JSON rows (row identity wins)
  test(`records properties as the source when the table came from them`, async () => {
    const colliding = with_property_rows(
      trajectory,
      plot_metadata.map((row) => ({
        ...row,
        properties: { ...row.properties, frame: 999, step: 999 },
      })),
    )
    const parsed = JSON.parse(
      frame_rows_to_json(await collect_frame_property_rows(0, 2, resolver, colliding)),
    )
    expect(parsed.source).toBe(`properties`)
    expect(parsed.rows).toEqual([
      { frame: 0, step: 0, energy: -10.5, force_max: 0.25 },
      { frame: 1, step: 5, energy: -11.25, force_max: 0.1 },
      { frame: 2, step: 9, energy: -11.5, force_max: 0.01 },
    ])
  })
})

describe(`TrajectoryExportPane property export`, () => {
  afterEach(() => {
    document.body.replaceChildren()
    vi.mocked(download).mockClear()
    vi.mocked(navigator.clipboard.writeText).mockClear()
    vi.unstubAllGlobals()
  })

  const open_pane = (props: Record<string, unknown>) =>
    mount(TrajectoryExportPane, {
      target: document.body,
      props: { export_pane_open: true, filename: `run.extxyz`, ...props },
    })

  const click = async (aria_label: string) => {
    const button = await vi.waitFor(() => {
      const found = document.querySelector<HTMLButtonElement>(
        `button[aria-label="${aria_label}"]`,
      )
      if (!found || found.disabled) throw new Error(`${aria_label} button not ready`)
      return found
    })
    button.dispatchEvent(new Event(`click`, { bubbles: true }))
  }

  // download() also takes Blobs (the POSCAR zip); a CSV/JSON export handing one over would
  // stringify to `[object Blob]` in the saved file
  const downloaded_text = (): string[] => {
    const content = vi.mocked(download).mock.calls[0][0]
    if (typeof content !== `string`) throw new Error(`expected text, got ${typeof content}`)
    return content.split(`\n`)
  }

  test(`names every download action`, () => {
    vi.stubGlobal(`MediaRecorder`, { isTypeSupported: () => true })
    open_pane({ run: trajectory })
    for (const label of [`extXYZ`, `POSCAR ZIP`, `CSV`, `JSON`, `WebM`, `MP4`]) {
      expect(document.querySelector(`button[aria-label="Download ${label}"]`)).not.toBeNull()
    }
  })

  test(`downloads the whole frame range as CSV`, async () => {
    open_pane({ run: trajectory })
    await tick()
    const reset_selector = `button[aria-label="Reset frame range to defaults"]`
    expect(document.querySelector(reset_selector)).toBeNull()

    const start_input = doc_query<HTMLInputElement>(`.settings-section input[type="number"]`)
    start_input.value = `1`
    start_input.dispatchEvent(new Event(`input`, { bubbles: true }))
    await tick()
    doc_query<HTMLButtonElement>(reset_selector).click()
    await tick()
    expect(document.querySelector(reset_selector)).toBeNull()

    await click(`Download CSV`)
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    const [, name, mime] = vi.mocked(download).mock.calls[0]
    expect(name).toBe(`run_frames_0-2.csv`)
    expect(mime).toBe(`text/csv`)
    const lines = downloaded_text()
    expect(lines).toHaveLength(4)
    expect(lines[0]).toContain(`energy (eV)`)
  })

  // The phonon explorer E2E drives this exact path (End Frame → Download extXYZ) to compare
  // frames, so the button name and the range it honours are a contract, not a detail
  test(`downloads only the selected frame range as extXYZ`, async () => {
    open_pane({ run: trajectory })
    await tick()
    const [, end_input] = document.querySelectorAll<HTMLInputElement>(
      `.settings-section input[type="number"]`,
    )
    end_input.value = `1`
    end_input.dispatchEvent(new Event(`input`, { bubbles: true }))
    await tick()

    await click(`Download extXYZ`)
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    const [, name, mime] = vi.mocked(download).mock.calls[0]
    expect(name).toBe(`run.extxyz`)
    expect(mime).toBe(`chemical/x-xyz`)
    const exported = parse_exported_frames(downloaded_text().join(`\n`))
    expect(exported.map(({ step }) => step)).toEqual([0, 5])
  })

  test(`copies JSON to the clipboard`, async () => {
    open_pane({ run: trajectory })
    await click(`Copy JSON to clipboard`)
    await vi.waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1))
    const parsed = JSON.parse(vi.mocked(navigator.clipboard.writeText).mock.calls[0][0])
    expect(parsed).toMatchObject({ frame_range: [0, 2], n_frames: 3, source: `properties` })
    expect(parsed.rows.map(({ energy }: { energy: number }) => energy)).toEqual([
      -10.5, -11.25, -11.5,
    ])
    expect(download).not.toHaveBeenCalled()
  })

  // The pane must route through resolve_frame, not `trajectory.frames`, or a streamed
  // trajectory would export a 1-row CSV for a 3-frame run
  test(`exports every frame of an indexed trajectory, not its in-memory window`, async () => {
    const resolve_frame = make_async_resolver()
    open_pane({ run: run_without_properties, resolve_frame })
    await click(`Download CSV`)
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    expect(resolve_frame.mock.calls).toEqual([[0], [1], [2]])
    expect(vi.mocked(download).mock.calls[0][1]).toBe(`run_frames_0-2.csv`)
    expect(
      downloaded_text()
        .slice(1)
        .map((line) => line.split(`,`)[0]),
    ).toEqual([`0`, `1`, `2`])
  })
})
