// open_trajectory: one entry point, one loading policy. The indexing threshold, progressive
// plot rows, progress/abort, JSON run metadata and HDF5 handle lifetime. The per-format
// parser behaviour (and the fixture table over every sample file) lives in parsers.test.ts.
import type { TrajectoryRun } from '$lib/trajectory'
import { open_trajectory, trajectory_from_json } from '$lib/trajectory/open'
import { DEFAULTS } from '$lib/settings'
import { describe, expect, it, onTestFinished, test } from 'vitest'
import { read_binary_test_file } from '../setup'
import { synthetic_extxyz } from './fixtures'

const open = async (
  source: string | ArrayBuffer | Blob,
  filename?: string,
  options: Parameters<typeof open_trajectory>[1] = {},
): Promise<TrajectoryRun> => {
  const run = await open_trajectory(source, { filename, ...options })
  onTestFinished(() => run.dispose())
  return run
}

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

describe(`JSON runs`, () => {
  const he_frame = (step: number, x_coord: number, energy: number) => ({
    step,
    structure: {
      sites: [{ species: [{ element: `He`, occu: 1 }], xyz: [x_coord, 0, 0], abc: [0, 0, 0] }],
    },
    metadata: { energy },
  })

  it(`keeps the frame metadata and run metadata of a { frames } payload`, async () => {
    const run = await open(
      JSON.stringify({
        frames: [he_frame(5, 0, -1), he_frame(6, 0.5, -2)],
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
    const run = trajectory_from_json([he_frame(0, 0, -1).structure], { filename: `mem.json` })
    expect(run.frame_count).toBe(1)
    expect(run.provenance).toEqual({ filename: `mem.json`, format: `json` })
  })

  test.each([
    [
      `.xyz that is not XYZ`,
      `not xyz at all`,
      `broken.xyz`,
      /Failed to parse broken.xyz as XYZ/,
    ],
    [
      `blob without an hdf5 name`,
      new Blob([`x`]),
      `data.xyz`,
      /Blob trajectory sources require an HDF5 filename/,
    ],
  ])(`rejects %s`, async (_label, content, filename, pattern) => {
    await expect(open_trajectory(content, { filename })).rejects.toThrow(pattern)
  })
})

describe(`HDF5`, () => {
  it(`rejects an unknown group path and a file with missing datasets`, async () => {
    await expect(
      open_trajectory(read_binary_test_file(`gold-nanoparticle-md.h5`), {
        filename: `gold.h5`,
        hdf5_group_path: `/nowhere`,
      }),
    ).rejects.toThrow(/Unknown HDF5 trajectory group \/nowhere/)
    await expect(
      open_trajectory(
        read_binary_test_file(
          `flame-water-cluster-bad-file.h5`,
          `tests/vitest/fixtures/trajectories`,
        ),
        { filename: `bad.h5` },
      ),
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
