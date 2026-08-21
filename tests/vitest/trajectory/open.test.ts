// open_trajectory: one entry point, one loading policy. Fixture table over every checked-in
// sample file, dispatch by payload type, the indexing threshold, JSON shapes, warnings on the
// run, typed HDF5 errors, abort and disposal.
import type { ElementSymbol } from '$lib'
import type { TrajectoryFrame, TrajectoryRun } from '$lib/trajectory'
import {
  Hdf5GroupSelectionRequiredError,
  open_trajectory,
  trajectory_from_json,
  VaspoutElectronicOnlyError,
} from '$lib/trajectory/open'
import { DEFAULTS } from '$lib/settings'
import { join } from 'node:path'
import process from 'node:process'
import { describe, expect, it, onTestFinished, test } from 'vitest'
import { read_binary_test_file, read_maybe_gz } from '../setup'
import { make_reference_md_h5_buffer } from './hdf5-fixtures'
import { synthetic_extxyz } from './runs.test'

const TRAJECTORY_DIR = `src/site/trajectories`
const read_fixture = (filename: string): string | ArrayBuffer =>
  /\.(?:h5|hdf5|traj)$/.test(filename)
    ? read_binary_test_file(filename)
    : read_maybe_gz(join(process.cwd(), TRAJECTORY_DIR, filename))

const open = async (
  source: string | ArrayBuffer | Blob,
  filename?: string,
  options: Parameters<typeof open_trajectory>[1] = {},
): Promise<TrajectoryRun> => {
  const run = await open_trajectory(source, { filename, ...options })
  onTestFinished(() => run.dispose())
  return run
}

const elements_of = (frame: TrajectoryFrame): ElementSymbol[] =>
  frame.structure.sites.map((site) => site.species[0].element)
const count = (elements: readonly string[]): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const element of elements) counts[element] = (counts[element] ?? 0) + 1
  return counts
}

// Every checked-in sample: frame count, atom count, first/last step, species, warnings.
// oxfmt-ignore
const FIXTURES = [
  { file: `vasp-XDATCAR.MD.gz`, format: `xdatcar`, frame_count: 5, n_atoms: 80, steps: [1, 5], element_counts: { O: 48, Fe: 32 }, warnings: 0, collect: true },
  { file: `vasp-XDATCAR-traj.gz`, format: `xdatcar`, frame_count: 100, n_atoms: 76, steps: [1, 100], element_counts: { Li: 38, Si: 38 }, warnings: 0, collect: true },
  { file: `lammps-sample.lammpstrj.gz`, format: `lammps`, frame_count: 5, n_atoms: 864, steps: [0, 40000], element_counts: { H: 778, He: 86 }, warnings: 0, collect: true },
  { file: `mdanalysis-chain-dump.lammpstrj`, format: `lammps`, frame_count: 6, n_atoms: 22, steps: [0, 5], element_counts: { H: 2, He: 20 }, warnings: 0, collect: true },
  { file: `mdanalysis-additional-columns.lammpstrj`, format: `lammps`, frame_count: 1, n_atoms: 10, steps: [0, 0], element_counts: { H: 1, He: 1, Li: 1, Be: 1, B: 1, C: 1, N: 1, O: 1, F: 1, Ne: 1 }, warnings: 0, collect: true },
  { file: `ase-images-Ag-0-to-97.xyz.gz`, format: `xyz`, frame_count: 51, n_atoms: 119, steps: [0, 50], element_counts: { Ag: 1, Al: 46, O: 72 }, warnings: 0, collect: true },
  { file: `Cr0.25Fe0.25Co0.25Ni0.25-mace-omat-qha.xyz.gz`, format: `xyz`, frame_count: 9, n_atoms: 108, steps: [0, 8], element_counts: { Fe: 27, Ni: 27, Cr: 27, Co: 27 }, warnings: 0, collect: true },
  { file: `V8Ta12W71Re8-mace-omat.xyz`, format: `xyz`, frame_count: 7, n_atoms: 99, steps: [0, 6], element_counts: { Re: 8, W: 71, Ta: 12, V: 8 }, warnings: 0, collect: true },
  // Steps come from the file's own ionic_step= tags (frames from several MP tasks)
  { file: `mp-1184225.extxyz`, format: `xyz`, frame_count: 6, n_atoms: 4, steps: [2, 0], element_counts: { Fe: 3, W: 1 }, warnings: 0, collect: true },
  { file: `pymatgen-LiMnO2-chgnet-relax.json.gz`, format: `pymatgen-json`, frame_count: 2, n_atoms: 8, steps: [0, 1], element_counts: { Li: 2, Mn: 2, O: 4 }, warnings: 0, collect: true },
  { file: `ase-LiMnO2-chgnet-relax.traj`, format: `ase`, frame_count: 2, n_atoms: 8, steps: [0, 1], element_counts: { Li: 2, Mn: 2, O: 4 }, warnings: 0, collect: true },
  { file: `gold-nanoparticle-md.h5`, format: `hdf5`, frame_count: 100, n_atoms: 55, steps: [1, 991], element_counts: { Au: 55 }, warnings: 0, collect: true },
  { file: `flame-gold-cluster-55-atoms.h5`, format: `hdf5`, frame_count: 20, n_atoms: 55, steps: [25, 500], element_counts: { Au: 55 }, warnings: 0, collect: true },
]

describe(`site fixtures`, () => {
  it.each(FIXTURES)(`$file opens as $frame_count x $n_atoms ($format)`, async (fixture) => {
    const run = await open(read_fixture(fixture.file), fixture.file)
    expect(run.frame_count).toBe(fixture.frame_count)
    expect(run.provenance).toMatchObject({ filename: fixture.file, format: fixture.format })
    expect(run.provenance.source_bytes).toBeGreaterThan(0)
    expect(run.preview.structure.sites).toHaveLength(fixture.n_atoms)
    expect(count(elements_of(run.preview))).toEqual(fixture.element_counts)
    const first = await run.read_frame(0)
    const last = await run.read_frame(run.frame_count - 1)
    expect(first).toBe(run.preview)
    expect([first.step, last.step]).toEqual(fixture.steps)
    expect(last.structure.sites).toHaveLength(fixture.n_atoms)
    expect(run.warnings).toHaveLength(fixture.warnings)
    expect(run.collect_positions !== undefined).toBe(fixture.collect)
    await run.properties.done
    expect(run.properties.rows.length).toBeGreaterThan(0)
    expect(run.properties.rows[0]).toMatchObject({ frame_number: 0, step: fixture.steps[0] })
  })
})

describe(`loading policy`, () => {
  const text = synthetic_extxyz(30, 20)

  it(`materialises text below index_above_bytes and indexes above it`, async () => {
    const eager = await open(text, `run.extxyz`, { index_above_bytes: text.length * 2 })
    const lazy = await open(text, `run.extxyz`, { index_above_bytes: 0 })
    expect(eager.properties.complete).toBe(true) // memory run: rows at construction
    await lazy.properties.done
    expect(lazy.properties.rows.map((row) => row.properties.energy)).toEqual(
      eager.properties.rows.map((row) => row.properties.energy),
    )
    for (const idx of [0, 7, 29]) {
      const from_eager = await eager.read_frame(idx)
      const from_lazy = await lazy.read_frame(idx)
      expect(from_lazy.step).toBe(from_eager.step)
      expect(from_lazy.structure.sites.map((site) => site.xyz)).toEqual(
        from_eager.structure.sites.map((site) => site.xyz),
      )
    }
    expect(eager.provenance.format).toBe(`xyz`)
    expect(lazy.provenance.format).toBe(`xyz`)
  })

  it(`extracts the plot rows of an indexed run progressively in batches`, async () => {
    const long = synthetic_extxyz(2100, 3)
    const lazy = await open(long, `long.extxyz`, { index_above_bytes: 0 })
    expect(lazy.properties.complete).toBe(false)
    const seen: [number, boolean][] = []
    lazy.properties.subscribe((batch, complete) => seen.push([batch.length, complete]))
    await lazy.properties.done
    // the first 2000 rows were extracted during open; the tail and the completion follow
    expect(seen).toEqual([
      [100, false],
      [0, true],
    ])
    expect(lazy.properties.rows).toHaveLength(2100)
    expect(lazy.properties.rows.at(-1)).toMatchObject({ frame_number: 2099, step: 20990 })
  })

  it(`reads the threshold from DEFAULTS.trajectory when not given`, async () => {
    expect(DEFAULTS.trajectory.index_above_bytes).toBeGreaterThan(1_000_000)
    const run = await open(text, `run.extxyz`)
    expect(run.properties.complete).toBe(true)
  })

  it(`indexes a large ASE buffer too`, async () => {
    const buffer = read_binary_test_file(`ase-LiMnO2-chgnet-relax.traj`)
    const lazy = await open(buffer.slice(0), `relax.traj`, { index_above_bytes: 0 })
    const eager = await open(buffer.slice(0), `relax.traj`)
    expect(lazy.frame_count).toBe(2)
    await lazy.properties.done
    expect(lazy.properties.rows.map((row) => row.properties.energy)).toEqual(
      eager.properties.rows.map((row) => row.properties.energy),
    )
    expect((await lazy.read_frame(1)).structure.sites[0].xyz).toEqual(
      (await eager.read_frame(1)).structure.sites[0].xyz,
    )
  })

  it(`reports progress and the final stage`, async () => {
    const stages: string[] = []
    await open(text, `run.extxyz`, {
      on_progress: ({ stage, current }) => stages.push(`${Math.round(current)}:${stage}`),
    })
    expect(stages[0]).toMatch(/^0:Detecting/)
    expect(stages.at(-1)).toBe(`100:Complete`)
  })

  it(`honours an already-aborted signal and an abort during HDF5 parsing`, async () => {
    const aborted = new AbortController()
    aborted.abort(new Error(`gone`))
    await expect(
      open_trajectory(text, { filename: `run.extxyz`, signal: aborted.signal }),
    ).rejects.toThrow(`gone`)
    const controller = new AbortController()
    const pending = open_trajectory(read_binary_test_file(`gold-nanoparticle-md.h5`), {
      filename: `gold.h5`,
      signal: controller.signal,
      on_progress: () => controller.abort(new Error(`cancelled mid-parse`)),
    })
    await expect(pending).rejects.toThrow(`cancelled mid-parse`)
  })
})

describe(`text and JSON dispatch`, () => {
  const h2 = (step: number, dz: number): string => `2\nstep=${step}\nH 0 0 0\nH 0 0 ${dz}`

  test.each([
    [
      `multi-frame xyz without a filename`,
      `${h2(0, 0.74)}\n${h2(1, 0.78)}`,
      undefined,
      2,
      `xyz`,
    ],
    [`single xyz structure`, h2(0, 0.74), `water.xyz`, 1, `xyz`],
    [
      `json array of structures`,
      JSON.stringify([
        { sites: [{ species: [{ element: `H`, occu: 1 }], xyz: [0, 0, 0], abc: [0, 0, 0] }] },
        { sites: [{ species: [{ element: `H`, occu: 1 }], xyz: [1, 0, 0], abc: [0, 0, 0] }] },
      ]),
      `frames.json`,
      2,
      `json`,
    ],
    [
      `object with frames`,
      JSON.stringify({
        frames: [
          {
            step: 5,
            structure: {
              sites: [
                { species: [{ element: `He`, occu: 1 }], xyz: [0, 0, 0], abc: [0, 0, 0] },
              ],
            },
            metadata: { energy: -1 },
          },
        ],
        metadata: { note: `x` },
      }),
      `run.json`,
      1,
      `json`,
    ],
    [
      `single structure object`,
      JSON.stringify({
        sites: [{ species: [{ element: `Li`, occu: 1 }], xyz: [0, 0, 0], abc: [0, 0, 0] }],
      }),
      `one.json`,
      1,
      `json`,
    ],
  ])(`%s`, async (_label, content, filename, frame_count, format) => {
    const run = await open(content, filename)
    expect(run.frame_count).toBe(frame_count)
    expect(run.provenance.format).toBe(format)
    expect(run.preview.structure.sites.length).toBeGreaterThan(0)
  })

  it(`keeps the frame metadata and run metadata of a { frames } payload`, async () => {
    const run = await open(
      JSON.stringify({
        frames: [
          {
            step: 5,
            structure: {
              sites: [
                { species: [{ element: `He`, occu: 1 }], xyz: [0, 0, 0], abc: [0, 0, 0] },
              ],
            },
            metadata: { energy: -1 },
          },
          {
            step: 6,
            structure: {
              sites: [
                { species: [{ element: `He`, occu: 1 }], xyz: [0.5, 0, 0], abc: [0, 0, 0] },
              ],
            },
            metadata: { energy: -2 },
          },
        ],
        metadata: { note: `x` },
      }),
      `run.json`,
    )
    expect(run.metadata).toEqual({ note: `x` })
    expect(run.properties.rows.map((row) => [row.step, row.properties.energy])).toEqual([
      [5, -1],
      [6, -2],
    ])
  })

  it(`trajectory_from_json builds the same run synchronously from a parsed value`, () => {
    const run = trajectory_from_json(
      [{ sites: [{ species: [{ element: `H`, occu: 1 }], xyz: [0, 0, 0], abc: [0, 0, 0] }] }],
      { filename: `mem.json` },
    )
    expect(run.frame_count).toBe(1)
    expect(run.provenance).toEqual({ filename: `mem.json`, format: `json` })
    expect(() => trajectory_from_json({ nope: 1 })).toThrow(/Unrecognized/)
    expect(() => trajectory_from_json(42)).toThrow(/Invalid data format/)
  })

  test.each([
    [
      `.xyz that is not XYZ`,
      `not xyz at all`,
      `broken.xyz`,
      /Failed to parse broken.xyz as XYZ/,
    ],
    [`unknown text`, `hello world`, `notes.txt`, /Unsupported text format/],
    [`unknown binary`, new ArrayBuffer(16), `blob.bin`, /Unsupported binary format: blob.bin/],
    [
      `blob without an hdf5 name`,
      new Blob([`x`]),
      `data.xyz`,
      /Blob trajectory sources require an HDF5 filename/,
    ],
    [
      `XDATCAR with no frame`,
      `title\n1.0\n1 0 0\n0 1 0\n0 0 1\nH\n1\nDirect\n0 0 0\n`,
      `XDATCAR`,
      /./,
    ],
  ])(`rejects %s`, async (_label, content, filename, pattern) => {
    await expect(open_trajectory(content, { filename })).rejects.toThrow(pattern)
  })

  it(`returns non-fatal parse warnings on the run`, async () => {
    const with_ghost = `2\nstep=0\nH 0 0 0\nX 0 0 1\n2\nstep=1\nH 0 0 0.1\nX 0 0 1\n`
    const run = await open(with_ghost, `ghost.xyz`)
    expect(run.frame_count).toBe(2)
    expect(run.preview.structure.sites).toHaveLength(1)
    expect(run.warnings).toHaveLength(2)
    expect(run.warnings[0]).toMatch(/unknown element symbol "X"/)
    // a second open starts from a clean slate: warnings are per call, not global
    const clean = await open(`${h2(0, 0.74)}\n${h2(1, 0.78)}`, `clean.xyz`)
    expect(clean.warnings).toEqual([])
  })

  it(`maps LAMMPS atom types through atom_type_mapping`, async () => {
    const dump = [
      `ITEM: TIMESTEP`,
      `0`,
      `ITEM: NUMBER OF ATOMS`,
      `2`,
      `ITEM: BOX BOUNDS pp pp pp`,
      `0 10`,
      `0 10`,
      `0 10`,
      `ITEM: ATOMS id type x y z`,
      `1 1 1 1 1`,
      `2 2 2 2 2`,
      ``,
    ].join(`\n`)
    const run = await open(dump, `dump.lammpstrj`, { atom_type_mapping: { 1: `Na`, 2: `Cl` } })
    expect(elements_of(run.preview)).toEqual([`Na`, `Cl`])
    expect(run.provenance.format).toBe(`lammps`)
  })
})

describe(`HDF5`, () => {
  it(`throws the typed group-selection error for a file with several trajectories`, async () => {
    const buffer = await make_reference_md_h5_buffer()
    const error = await open_trajectory(buffer, { filename: `reference-md.h5` }).then(
      () => undefined,
      (reason: unknown) => reason,
    )
    expect(error).toBeInstanceOf(Hdf5GroupSelectionRequiredError)
    expect((error as Hdf5GroupSelectionRequiredError).groups).toEqual([
      `/molecules/h2o/replicas/0`,
      `/molecules/h2o/replicas/1`,
    ])
    const run = await open(buffer.slice(0), `reference-md.h5`, {
      hdf5_group_path: `/molecules/h2o/replicas/1`,
    })
    expect(run.provenance).toMatchObject({
      format: `reference-md-hdf5`,
      hdf5_group: `/molecules/h2o/replicas/1`,
    })
    expect(run.frame_count).toBeGreaterThan(1)
    expect(run.time_step).toEqual({ value: expect.any(Number), unit: `ps` })
    expect(run.signal_descriptors?.velocity).toMatchObject({
      sample_shape: [run.preview.structure.sites.length, 3],
    })
  })

  it(`throws the typed electronic-only error for a vaspout.h5 without structure data`, async () => {
    const buffer = read_binary_test_file(
      `vaspout-tinisn-bands-only.h5`,
      `tests/vitest/fixtures/vasp-hdf5`,
    )
    const error = await open_trajectory(buffer, { filename: `vaspout.h5` }).then(
      () => undefined,
      (reason: unknown) => reason,
    )
    expect(error).toBeInstanceOf(VaspoutElectronicOnlyError)
    expect(Boolean((error as VaspoutElectronicOnlyError).electronic.bands)).toBe(true)
  })

  it(`rejects an unknown group path and a file with missing datasets`, async () => {
    await expect(
      open_trajectory(read_binary_test_file(`gold-nanoparticle-md.h5`), {
        filename: `gold.h5`,
        hdf5_group_path: `/nowhere`,
      }),
    ).rejects.toThrow(/Unknown HDF5 trajectory group \/nowhere/)
    await expect(
      open_trajectory(read_binary_test_file(`flame-water-cluster-bad-file.h5`), {
        filename: `bad.h5`,
      }),
    ).rejects.toThrow(/Missing required dataset/i)
  })

  it(`keeps the h5wasm handle open for lazy reads until dispose`, async () => {
    const run = await open_trajectory(read_binary_test_file(`gold-nanoparticle-md.h5`), {
      filename: `gold.h5`,
    })
    expect((await run.read_frame(99)).step).toBe(991)
    run.dispose()
    expect(() => run.read_frame(5)).toThrow(/disposed/)
    expect(run.read_frame(0)).toBe(run.preview) // the preview needs no handle
  })
})
