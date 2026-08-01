import type { Matrix3x3, Vec3 } from '$lib/math'
import { calc_lattice_params } from '$lib/math'
import type { AnyStructure } from '$lib/structure'
import { parse_poscar, parse_xyz } from '$lib/structure/parse'
import { download } from '$lib/io/fetch'
import type { TrajectoryFrame, TrajectoryMetadata, TrajectoryType } from '$lib/trajectory'
import { TrajectoryExportPane } from '$lib/trajectory'
import { full_data_extractor } from '$lib/trajectory/extract'
import {
  collect_frame_property_rows,
  create_poscar_frame_range_zip,
  frame_rows_to_csv,
  frame_rows_to_json,
  poscar_frame_filename,
  serialize_extxyz_frame_range,
  trajectory_export_basename,
  trajectory_frame_to_extxyz_str,
  type TrajectoryPropertyTable,
} from '$lib/trajectory/file-export'
import { parse_xyz_trajectory } from '$lib/trajectory/parse/xyz'
import { unzipSync } from 'fflate'
import { mount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock(`$lib/io/fetch`, async (import_original) => ({
  ...(await import_original<Record<string, unknown>>()),
  download: vi.fn(),
}))

// oxfmt-ignore
const cube = (len: number): Matrix3x3 => [[len, 0, 0], [0, len, 0], [0, 0, len]]

const make_frame = (
  step: number,
  positions: Vec3[],
  metadata: Record<string, unknown> = {},
): TrajectoryFrame => {
  const matrix = cube(5)
  const structure = {
    sites: positions.map((xyz, idx) => ({
      species: [{ element: idx === 0 ? `Si` : `O`, occu: 1, oxidation_state: 0 }],
      xyz,
      abc: xyz.map((coord) => coord / 5) as Vec3,
      label: `${idx === 0 ? `Si` : `O`}${idx + 1}`,
      properties: {},
    })),
    lattice: { matrix, pbc: [true, true, true], ...calc_lattice_params(matrix) },
  } as AnyStructure
  return { structure, step, metadata }
}

// oxfmt-ignore
const two_sites: Vec3[] = [[0, 0, 0], [1, 1, 1]]
// oxfmt-ignore
const frames = [
  make_frame(0, two_sites, { energy: -10.5, force_max: 0.25 }),
  make_frame(5, [[0.1, 0, 0], [1.1, 1, 1]], { energy: -11.25, force_max: 0.1 }),
  make_frame(9, [[0.2, 0, 0], [1.2, 1, 1]], { energy: -11.5, force_max: 0.01 }),
]
const resolver = (idx: number) => frames[idx] ?? null

describe(`trajectory_export_basename`, () => {
  test.each([
    [`run.extxyz`, `run`],
    [`run.xyz.gz`, `run`],
    [`/data/md/traj.h5`, `traj`],
    [`XDATCAR`, `XDATCAR`],
    [`weird name (1).traj`, `weird_name_1`],
    [``, `trajectory`],
    [`.gz`, `trajectory`],
  ])(`%s -> %s`, (input, expected) => {
    expect(trajectory_export_basename(input)).toBe(expected)
  })
})

describe(`poscar_frame_filename`, () => {
  test.each([
    [7, 10, `run_frame_0007.vasp`],
    [7, 100_000, `run_frame_00007.vasp`], // widens past the 4-digit floor (max index 99999)
    [0, 1, `run_frame_0000.vasp`],
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

describe(`serialize_extxyz_frame_range`, () => {
  test(`round-trips through the trajectory parser`, async () => {
    const on_progress = vi.fn()
    const text = await serialize_extxyz_frame_range(0, 2, resolver, on_progress)
    expect(on_progress.mock.calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ])
    const reparsed = parse_xyz_trajectory(text)
    expect(reparsed.frames).toHaveLength(3)
    expect(reparsed.frames.map((frame) => frame.step)).toEqual([0, 5, 9])
    expect(reparsed.frames.map((frame) => frame.metadata?.energy)).toEqual([
      -10.5, -11.25, -11.5,
    ])
    expect(reparsed.frames[2].structure.sites[0].xyz[0]).toBeCloseTo(0.2, 6)
  })

  test(`exports only the requested sub-range`, async () => {
    const text = await serialize_extxyz_frame_range(1, 2, resolver)
    expect(parse_xyz_trajectory(text).frames.map((frame) => frame.step)).toEqual([5, 9])
  })

  // An indexed trajectory holds only a few frames in memory; the rest arrive from a loader.
  test(`awaits an async resolver rather than reading a frames array`, async () => {
    const async_resolver = vi.fn((idx: number) => Promise.resolve(frames[idx] ?? null))
    await serialize_extxyz_frame_range(0, 2, async_resolver)
    expect(async_resolver).toHaveBeenCalledTimes(3)
    expect(async_resolver.mock.calls).toEqual([[0], [1], [2]])
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
  })

  test(`names the frame a serializer choked on`, async () => {
    // POSCAR needs a lattice; the raw error would name neither the frame nor the range
    const lattice_less = { structure: { sites: frames[0].structure.sites }, step: 0 }
    await expect(
      create_poscar_frame_range_zip(0, 0, () => lattice_less as TrajectoryFrame, `run`, 1),
    ).rejects.toThrow(`Failed to serialize trajectory frame 0`)
  })

  test(`names files by absolute frame index, not position in the range`, async () => {
    const blob = await create_poscar_frame_range_zip(1, 2, resolver, `run.extxyz`, 3)
    expect(Object.keys(await read_zip(blob)).toSorted()).toEqual([
      `run_frame_0001.vasp`,
      `run_frame_0002.vasp`,
    ])
  })
})

const trajectory = { frames } as TrajectoryType
const plot_metadata: TrajectoryMetadata[] = [
  { frame_number: 0, step: 0, properties: { energy: -10.5, force_max: 0.25 } },
  { frame_number: 1, step: 5, properties: { energy: -11.25, force_max: 0.1 } },
  { frame_number: 2, step: 9, properties: { energy: -11.5, force_max: 0.01 } },
]

describe(`collect_frame_property_rows`, () => {
  test(`one row per frame carrying the extractor's numbers`, async () => {
    const on_progress = vi.fn()
    const table = await collect_frame_property_rows(0, 2, resolver, trajectory, on_progress)
    expect(table.source).toBe(`frames`)
    expect(table.rows.map(({ frame, step }) => [frame, step])).toEqual([
      [0, 0],
      [1, 5],
      [2, 9],
    ])
    expect(on_progress.mock.calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ])
    // every property the extractor yields, minus `Step` (already the row's own column) and
    // the `constant_*` plot hints
    const extracted = full_data_extractor(frames[1], trajectory)
    expect(table.rows[1].properties).toEqual(
      Object.fromEntries(
        Object.entries(extracted).filter(
          ([key]) => key !== `Step` && !key.startsWith(`constant_`),
        ),
      ),
    )
  })

  // The cube(5) cell never changes, so the plot drops a/b/c/α/β/γ as flat series and
  // full_data_extractor flags them `constant_*`. A data export wants the values anyway.
  test(`keeps constant lattice params but drops the constant_* hints`, async () => {
    const { rows } = await collect_frame_property_rows(0, 2, resolver, trajectory)
    expect(full_data_extractor(frames[0], trajectory).constant_a).toBe(1)
    expect(
      Object.keys(rows[0].properties).filter((key) => key.startsWith(`constant_`)),
    ).toEqual([])
    expect(rows[0].properties).toMatchObject({ a: 5, b: 5, c: 5, alpha: 90, volume: 125 })
  })

  test(`covers only the requested sub-range`, async () => {
    const { rows } = await collect_frame_property_rows(1, 2, resolver, trajectory)
    expect(rows.map(({ frame }) => frame)).toEqual([1, 2])
    expect(rows.map(({ properties }) => properties.energy)).toEqual([-11.25, -11.5])
  })

  // An indexed trajectory holds only its first frames in memory; reading `frames` directly
  // would export a 1-row table for a 3-frame range.
  test(`resolves the full range of an indexed trajectory, not the in-memory window`, async () => {
    const indexed = {
      frames: frames.slice(0, 1),
      total_frames: 3,
      is_indexed: true,
    } as TrajectoryType
    const async_resolver = vi.fn((idx: number) => Promise.resolve(frames[idx] ?? null))
    const { rows, source } = await collect_frame_property_rows(0, 2, async_resolver, indexed)
    expect(source).toBe(`frames`)
    expect(async_resolver.mock.calls).toEqual([[0], [1], [2]])
    expect(rows.map(({ properties }) => properties.energy)).toEqual([-10.5, -11.25, -11.5])
  })

  test(`reads plot_metadata instead of frames when it covers the range`, async () => {
    const spy_resolver = vi.fn(resolver)
    const indexed = {
      frames: [],
      is_indexed: true,
      plot_metadata,
    } as unknown as TrajectoryType
    const on_progress = vi.fn()
    const { rows, source } = await collect_frame_property_rows(
      0,
      2,
      spy_resolver,
      indexed,
      on_progress,
    )
    expect(source).toBe(`plot_metadata`)
    expect(spy_resolver).not.toHaveBeenCalled()
    expect(on_progress.mock.calls).toEqual([[3, 3]])
    expect(rows.map(({ frame, step }) => [frame, step])).toEqual([
      [0, 0],
      [1, 5],
      [2, 9],
    ])
    expect(rows[2].properties).toEqual({ energy: -11.5, force_max: 0.01 })
  })

  // Sampled metadata usually skips frames; using it then would export fewer rows than frames
  test(`falls back to the resolver when plot_metadata misses a frame in the range`, async () => {
    const sparse = {
      frames: [],
      plot_metadata: [plot_metadata[0], plot_metadata[2]],
    } as unknown as TrajectoryType
    const spy_resolver = vi.fn(resolver)
    const { rows, source } = await collect_frame_property_rows(0, 2, spy_resolver, sparse)
    expect(source).toBe(`frames`)
    expect(spy_resolver).toHaveBeenCalledTimes(3)
    expect(rows).toHaveLength(3)
  })

  // the plot_metadata shortcut must not skip the range check the resolver path applies
  // (serialize_extxyz_frame_range above covers the full set of rejected ranges)
  test(`rejects a reversed range even when plot_metadata covers it`, async () => {
    const indexed = { frames: [], plot_metadata } as unknown as TrajectoryType
    await expect(collect_frame_property_rows(2, 1, resolver, indexed)).rejects.toThrow(
      `Invalid trajectory frame range`,
    )
  })
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
  test(`keeps a column the first frame lacks and leaves its cell empty`, () => {
    const table: TrajectoryPropertyTable = {
      start_frame: 0,
      end_frame: 1,
      source: `frames`,
      rows: [
        { frame: 0, step: 0, properties: { energy: -1 } },
        { frame: 1, step: 1, properties: { energy: -2, temperature: 300 } },
      ],
    }
    expect(frame_rows_to_csv(table).split(`\n`)).toEqual([
      `frame,step,energy (eV),temperature (K)`,
      `0,0,-1,`,
      `1,1,-2,300`,
    ])
  })

  // an unconfigured key has no unit to append, and must not gain an empty `()`
  test(`omits the unit for a property with no configured one`, () => {
    const table: TrajectoryPropertyTable = {
      start_frame: 0,
      end_frame: 0,
      source: `frames`,
      rows: [{ frame: 0, step: 0, properties: { some_custom_prop: 1.5 } }],
    }
    expect(frame_rows_to_csv(table).split(`\n`)[0]).toBe(`frame,step,some_custom_prop`)
  })
})

describe(`frame_rows_to_json`, () => {
  test(`pairs bare per-frame numbers with a units map and the range's provenance`, async () => {
    const table = await collect_frame_property_rows(1, 2, resolver, trajectory)
    const parsed = JSON.parse(frame_rows_to_json(table))
    expect(parsed.frame_range).toEqual([1, 2])
    expect(parsed.n_frames).toBe(2)
    expect(parsed.source).toBe(`frames`)
    expect(parsed.units).toMatchObject({
      energy: `eV`,
      force_max: `eV/Å`,
      volume: `Å³`,
      alpha: `°`,
    })
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.rows[0]).toMatchObject({ frame: 1, step: 5, energy: -11.25, volume: 125 })
  })

  test(`records plot_metadata as the source when the table came from it`, async () => {
    const indexed = {
      frames: [],
      is_indexed: true,
      plot_metadata,
    } as unknown as TrajectoryType
    const parsed = JSON.parse(
      frame_rows_to_json(await collect_frame_property_rows(0, 2, resolver, indexed)),
    )
    expect(parsed.source).toBe(`plot_metadata`)
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

  test(`downloads the whole frame range as CSV`, async () => {
    open_pane({ trajectory })
    await click(`Download CSV`)
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    const [, name, mime] = vi.mocked(download).mock.calls[0]
    expect(name).toBe(`run_frames_0-2.csv`)
    expect(mime).toBe(`text/csv`)
    const lines = downloaded_text()
    expect(lines).toHaveLength(4)
    expect(lines[0]).toContain(`energy (eV)`)
  })

  test(`copies JSON to the clipboard`, async () => {
    open_pane({ trajectory })
    await click(`Copy JSON to clipboard`)
    await vi.waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1))
    const parsed = JSON.parse(vi.mocked(navigator.clipboard.writeText).mock.calls[0][0])
    expect(parsed).toMatchObject({ frame_range: [0, 2], n_frames: 3, source: `frames` })
    expect(parsed.rows.map(({ energy }: { energy: number }) => energy)).toEqual([
      -10.5, -11.25, -11.5,
    ])
    expect(download).not.toHaveBeenCalled()
  })

  // The pane must route through resolve_frame, not `trajectory.frames`, or a streamed
  // trajectory would export a 1-row CSV for a 3-frame run
  test(`exports every frame of an indexed trajectory, not its in-memory window`, async () => {
    const resolve_frame = vi.fn((idx: number) => Promise.resolve(frames[idx] ?? null))
    open_pane({
      trajectory: { frames: frames.slice(0, 1), total_frames: 3, is_indexed: true },
      resolve_frame,
    })
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
