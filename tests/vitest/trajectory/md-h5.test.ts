import assert from 'node:assert/strict'
import { FrameView, materialize_frame, materialize_frame_result } from '$lib/trajectory/frame'
import { get_structure_vector_keys } from '$lib/structure/vectors'
// Committed-prefix MD trajectories retain explicit units and static topology.
import { open_trajectory } from '$lib/trajectory/open'
import { open_h5_source } from '$lib/trajectory/parse/h5-utils'
import { open_hdf5_trajectory } from '$lib/trajectory/parse/hdf5'
import { create_warning_collector } from '$lib/trajectory/parse/shared'
import { hdf5_run } from '$lib/trajectory/runs/hdf5'
import { summarize_run } from '$lib/trajectory/run'
import { Dataset, type File as H5File, type Group } from 'h5wasm'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { h5_bytes } from './fixtures'

const VELOCITY_FACTOR = 1 / 10.180505710759414
const ATOMIC = { positions: 3, velocities: 3, forces: 3, charges: 1, spins: 1 }
const units: Record<string, string> = {
  positions: `A; unwrapped Cartesian`,
  velocities: `sqrt(eV/amu)`,
  forces: `eV/A`,
  charges: `e`,
  spins: `mu_B`,
  energy: `eV`,
  energy_above_reference: `eV`,
  kinetic_energy: `eV`,
  total_energy: `eV`,
  total_energy_above_reference: `eV`,
  temperature: `K; center-of-mass motion removed`,
  time_fs: `fs`,
  md_step: `absolute MD step`,
  local_step: `zero-based frame index`,
}
const cell = [
  [10, 0, 0],
  [1, 11, 0],
  [2, 3, 12],
]
const fixture = (
  options: {
    atoms?: number
    frames?: number
    timestep_fs?: number
    committed?: number
    successful?: boolean
    float32?: boolean
    mutate?: (file: H5File) => void
  } = {},
) =>
  h5_bytes(
    `md`,
    (file) => {
      const atoms = options.atoms ?? 4
      const frame_count = options.frames ?? 3
      const committed = options.committed ?? frame_count
      for (const [key, value] of Object.entries({
        schema: `md-trajectory-v1`,
        expected_frames: frame_count,
        initial_step: 2300,
        timestep_fs: options.timestep_fs ?? 1,
        velocity_to_A_per_fs: VELOCITY_FACTOR,
        ensemble: `NVE`,
        active_thermostat: `none`,
        metadata_json: JSON.stringify({ worker_sha256: `test-producer` }),
      }))
        file.create_attribute(key, value)
      file.create_dataset({
        name: `committed_frames`,
        data: new BigInt64Array([BigInt(committed)]),
        shape: [],
      })
      file.create_hard_link(
        (options.successful ?? committed === frame_count) ? `/true` : `/false`,
        `successful`,
      )
      const topology = file.get(`static`) as Group
      for (const [name, values] of Object.entries({
        atomic_numbers: Array.from({ length: atoms }, (_unused, idx) => (idx % 2 ? 32 : 14)),
        masses: Array.from({ length: atoms }, (_unused, idx) => (idx % 2 ? 72.6308 : 28.085)),
        global_atom_ids: Array.from({ length: atoms }, (_unused, idx) => idx),
        region_labels: Array.from({ length: atoms }, (_unused, idx) => idx % 3),
        period_id: Array.from({ length: atoms }, (_unused, idx) => Math.floor(idx / 3)),
      }))
        topology.create_dataset({ name, data: values, shape: [atoms] })
      topology.create_dataset({ name: `cell`, data: cell.flat(), shape: [3, 3] })
      const frames = file.create_group(`frames`)
      for (const [name, width] of Object.entries(ATOMIC)) {
        const values = Float64Array.from(
          { length: frame_count * atoms * width },
          (_unused, idx) => Math.floor(idx / (atoms * width)) + (idx % (atoms * width)) / 100,
        )
        const dataset = frames.create_dataset({
          name,
          data: options.float32 ? Float32Array.from(values) : values,
          shape: width === 3 ? [frame_count, atoms, 3] : [frame_count, atoms],
          chunks: width === 3 ? [1, Math.min(atoms, 8192), 3] : [1, Math.min(atoms, 8192)],
        })
        dataset.create_attribute(`units`, units[name])
      }
      const scalar_start: Record<string, number> = {
        time_fs: 2300,
        md_step: 2300,
        local_step: 0,
        temperature: 400,
      }
      for (const name of Object.keys(units).filter((key) => !(key in ATOMIC))) {
        const values = Float64Array.from(
          { length: frame_count },
          (_unused, idx) =>
            ((scalar_start[name] ?? -10) + idx) *
            (name === `time_fs` ? (options.timestep_fs ?? 1) : 1),
        )
        const dataset = frames.create_dataset({
          name,
          data:
            name === `md_step` || name === `local_step`
              ? BigInt64Array.from(values, BigInt)
              : values,
          shape: [frame_count],
          chunks: [1],
        })
        dataset.create_attribute(`units`, units[name])
      }
      options.mutate?.(file)
    },
    // h5wasm reads boolean enums but cannot create them. Seed the three boolean datasets.
    readFileSync(`${process.cwd()}/tests/vitest/trajectory/fixtures/md-booleans.h5`),
  )

const open = async (buffer: ArrayBuffer) => {
  const run = await open_trajectory(buffer, { filename: `md.h5` })
  onTestFinished(() => run.dispose())
  return run
}

describe(`MD HDF5`, () => {
  it.each([undefined, [], [`velocity`], [`force`]])(
    `reads only requested dense vector channels: %j`,
    async (vectors) => {
      const run = await open(await fixture())
      const full = await materialize_frame_result(run.read_frame(1))
      const slices = vi.spyOn(Dataset.prototype, `slice`)
      onTestFinished(() => slices.mockRestore())
      const frame = await run.read_frame(1, undefined, { vectors })
      const expected = vectors ?? [`force`, `velocity`]
      expect(frame.vector_keys).toEqual(expected)
      const paths = new Set(
        slices.mock.instances.map((dataset) =>
          dataset instanceof Dataset ? dataset.path : undefined,
        ),
      )
      expect(paths.has(`/frames/forces`)).toBe(expected.includes(`force`))
      expect(paths.has(`/frames/velocities`)).toBe(expected.includes(`velocity`))
      const result = materialize_frame(frame)
      for (const [idx, site] of result.structure.sites.entries()) {
        const reference = full.structure.sites[idx]
        expect(site.xyz).toEqual(reference.xyz)
        expect(site.abc).toEqual(reference.abc)
        expect(site.properties.spin).toBe(reference.properties.spin)
        for (const key of expected)
          expect(site.properties[key]).toEqual(reference.properties[key])
        for (const key of [`force`, `velocity`].filter((name) => !expected.includes(name)))
          expect(site.properties).not.toHaveProperty(key)
      }
      // Keep loaded scalar spins and hidden dense channels discoverable in the controls.
      expect(get_structure_vector_keys(new FrameView().update(frame).structure)).toEqual([
        `force`,
        `spin`,
        `velocity`,
      ])
      expect(() => run.read_frame(1, undefined, { vectors: [`unknown`] })).toThrow(
        /Unknown trajectory vector channel: unknown/,
      )
    },
  )
  it.each([`md-interrupted-committed.h5`, `md-interrupted-partial.h5`])(
    `opens the committed prefix after actual writer SIGKILL: %s`,
    async (filename) => {
      const bytes = readFileSync(
        `${process.cwd()}/tests/vitest/trajectory/fixtures/${filename}`,
      )
      const run = await open(Uint8Array.from(bytes).buffer)
      expect(run.frame_count).toBe(1)
      expect(run.metadata).toMatchObject({ successful: false, committed_frames: 1 })
      const frame = await materialize_frame_result(run.read_frame(0))
      expect(frame.structure.sites[0].xyz).toEqual([-0, 0, 1])
      expect(() => materialize_frame_result(run.read_frame(1))).toThrow(/outside/)
    },
  )

  it(`accepts single atoms, fractional timesteps, nonperiodic axes and thermostats`, async () => {
    const run = await open(
      await fixture({
        atoms: 1,
        timestep_fs: 0.5,
        mutate: (file) => {
          ;(file.get(`/static/global_atom_ids`) as Dataset).write_slice([[0, 1]], [-0])
          file.delete_attribute(`ensemble`)
          file.create_attribute(`ensemble`, `NVT`)
          file.delete_attribute(`active_thermostat`)
          file.create_attribute(`active_thermostat`, `Langevin`)
        },
      }),
    )
    expect(run.atom_count).toBe(1)
    expect(run.time_step).toEqual({ value: 0.5, unit: `fs` })
    expect(run.metadata).toMatchObject({ ensemble: `NVT`, active_thermostat: `Langevin` })
    const numeric = await run.read_frame(2)
    const frame = materialize_frame_result(numeric)
    expect(numeric.sites).toEqual(Uint8Array.of(14))
    expect(numeric.topology).toEqual({ kind: `fixed-order`, revision: 0 })
    expect(frame.structure.sites[0].properties.id).toBe(0)
    expect(frame.metadata?.time).toBe(1151)
    expect(`lattice` in frame.structure && frame.structure.lattice.pbc).toEqual([
      true,
      false,
      true,
    ])
  })

  it(`retains ordinary earliest-format HDF5 reads with SWMR read access`, async () => {
    const bytes = readFileSync(
      `${process.cwd()}/tests/vitest/trajectory/fixtures/hdf5-earliest.h5`,
    )
    const opened = await open_h5_source(Uint8Array.from(bytes).buffer, `earliest.h5`)
    try {
      const dataset = opened.h5_file.get(`values`) as Dataset
      expect(dataset.to_array()).toEqual([1, 2, 3])
    } finally {
      opened.close()
    }
  })

  it(`maps every scientific channel, row-vector cell, units and static identities`, async () => {
    const run = await open(await fixture())
    expect(run.provenance.format).toBe(`md-hdf5`)
    expect(run.frame_count).toBe(3)
    expect(run.atom_masses).toEqual([28.085, 72.6308, 28.085, 72.6308])
    expect(run.metadata).toMatchObject({
      schema: `md-trajectory-v1`,
      successful: true,
      mass_unit: `amu`,
      committed_frames: 3,
    })
    const frame = await materialize_frame_result(run.read_frame(2))
    expect(frame.step).toBe(2302)
    expect(frame.metadata).toMatchObject({
      energy: -8,
      energy_above_reference: -8,
      temperature: 402,
      time: 2302,
      coords_unwrapped: true,
    })
    expect(`lattice` in frame.structure && frame.structure.lattice.matrix).toEqual(cell)
    expect(frame.structure.sites.map((site) => site.species[0].element)).toEqual([
      `Si`,
      `Ge`,
      `Si`,
      `Ge`,
    ])
    expect(frame.structure.sites[1].xyz).toEqual([2.03, 2.04, 2.05])
    expect(frame.structure.sites[1].properties).toMatchObject({
      id: 1,
      mass: 72.6308,
      region_label: 1,
      period_id: 0,
      force: [2.03, 2.04, 2.05],
      velocity: [2.03, 2.04, 2.05].map((value) => value * VELOCITY_FACTOR),
      charge: 2.01,
      spin: 2.01,
    })
    const numeric = await run.read_frame(2)
    expect(numeric.sites).toEqual(Uint8Array.of(14, 32, 14, 32))
    expect(numeric.scalar_columns?.charge).toEqual(Float64Array.of(2, 2.01, 2.02, 2.03))
    const view = new FrameView()
    view.update(numeric)
    const previous = await run.read_frame(1)
    expect(view.update(previous).structure.sites[1].properties).toEqual({
      id: 1,
      mass: 72.6308,
      region_label: 1,
      period_id: 0,
      force: [1.03, 1.04, 1.05],
      velocity: [1.03, 1.04, 1.05].map((value) => value * VELOCITY_FACTOR),
      charge: 1.01,
      spin: 1.01,
    })
    expect(numeric.scalar_columns?.charge).toEqual(Float64Array.of(2, 2.01, 2.02, 2.03))
    expect(run.signals?.velocity).toEqual({
      sample_count: 3,
      sample_shape: [4, 3],
      frame_aligned: true,
      unit: `A/fs`,
    })
    if (!run.read_atoms) throw new Error(`missing read_atoms`)
    const batch = await run.read_atoms({
      frame_idx: 1,
      start: 1,
      count: 2,
      velocity_key: `velocity`,
      mass_source: `recorded`,
    })
    expect(Array.from(batch.positions)).toEqual([1.03, 1.04, 1.05, 1.06, 1.07, 1.08])
    expect(Array.from(batch.velocities ?? [])).toEqual(
      [1.03, 1.04, 1.05, 1.06, 1.07, 1.08].map((value) => value * VELOCITY_FACTOR),
    )
    expect(Array.from(batch.masses ?? [])).toEqual([72.6308, 28.085])
    // Returned static columns belong to the caller; editing them must not poison later reads.
    batch.atomic_numbers.fill(1)
    batch.masses?.fill(1)
    const repeated = await run.read_atoms({
      frame_idx: 1,
      start: 1,
      count: 2,
      mass_source: `recorded`,
    })
    expect(repeated.atomic_numbers).toEqual(Uint8Array.of(32, 14))
    expect(repeated.masses).toEqual(Float64Array.of(72.6308, 28.085))
    if (!run.collect_positions) throw new Error(`missing collect_positions`)
    const stream = await run.collect_positions({
      start_frame: 1,
      end_frame: 3,
      vector_keys: [`velocity`, `force`],
      signal_keys: [`charge`, `temperature`],
    })
    expect(stream.steps).toEqual([2301, 2302])
    expect(stream.coords_unwrapped).toBe(true)
    expect(Array.from(stream.positions.slice(0, 6))).toEqual([1, 1.01, 1.02, 1.03, 1.04, 1.05])
    expect(Array.from(stream.signals?.charge.values ?? [])).toEqual([
      1, 1.01, 1.02, 1.03, 2, 2.01, 2.02, 2.03,
    ])
    expect(stream.signals?.temperature).toMatchObject({
      sample_shape: [],
      steps: [2301, 2302],
    })
    expect(Array.from(stream.vectors?.velocity.slice(0, 3) ?? [])).toEqual(
      [1, 1.01, 1.02].map((value) => value * VELOCITY_FACTOR),
    )
    await expect(run.collect_positions({ max_bytes: 1 })).rejects.toThrow(/budget/)
  })

  it(`exposes only committed frames and ignores a nonfinite uncommitted tail`, async () => {
    const run = await open(
      await fixture({
        committed: 2,
        mutate: (file) =>
          (file.get(`/frames/positions`) as Dataset).write_slice(
            [
              [2, 3],
              [0, 1],
            ],
            [NaN, NaN, NaN],
          ),
      }),
    )
    expect(run.frame_count).toBe(2)
    expect(run.metadata?.successful).toBe(false)
    expect((await materialize_frame_result(run.read_frame(1))).step).toBe(2301)
    expect(() => materialize_frame_result(run.read_frame(2))).toThrow(/outside/)
  })

  it.each([
    [4, 1, 1, 3],
    [70_003, 100, 3, 3],
    [4, 1, 1, 2003],
  ])(`bounds frame/atom reads for %i atoms`, async (atoms, start, stride, frames) => {
    const buffer = await fixture({ atoms, frames, timestep_fs: 0.5 })
    const original_to_array = Dataset.prototype.to_array
    const whole_reads: string[] = []
    const slices: { path: string; ranges: Parameters<Dataset[`slice`]>[0] }[] = []
    vi.spyOn(Dataset.prototype, `to_array`).mockImplementation(function (this: Dataset) {
      whole_reads.push(this.path)
      return original_to_array.call(this)
    })
    const original_slice = Dataset.prototype.slice
    vi.spyOn(Dataset.prototype, `slice`).mockImplementation(function (this: Dataset, ranges) {
      slices.push({ path: this.path, ranges })
      return original_slice.call(this, ranges)
    })
    onTestFinished(() => {
      vi.restoreAllMocks()
    })
    const run = await open(buffer)
    // One scalar read for the preview and one batched read for the entire sampled plot.
    expect(slices.filter(({ path }) => path === `/frames/energy`)).toHaveLength(2)
    const plot_stride = Math.ceil(frames / 1000)
    expect(
      run.properties.rows.map(({ frame_number, step, properties }) => [
        frame_number,
        step,
        properties.energy,
        properties.time,
      ]),
    ).toEqual(
      Array.from({ length: Math.ceil(frames / plot_stride) }, (_unused, idx) => [
        idx * plot_stride,
        2300 + idx * plot_stride,
        -10 + idx * plot_stride,
        (2300 + idx * plot_stride) * 0.5,
      ]),
    )
    expect(run.preview.structure.sites.length).toBeLessThanOrEqual(2000)
    const sample_stride = Math.ceil(atoms / 2000)
    expect(
      run.preview.structure.sites.map(({ xyz, species }) => [xyz, species[0].element]),
    ).toEqual(
      Array.from({ length: Math.ceil(atoms / sample_stride) }, (_unused, idx) => [
        [0, 1, 2].map((axis) => (idx * sample_stride * 3 + axis) / 100),
        (idx * sample_stride) % 2 ? `Ge` : `Si`,
      ]),
    )
    expect(
      whole_reads.every((path) =>
        [`/committed_frames`, `/successful`, `/static/pbc`].includes(path),
      ),
    ).toBe(true)
    const atomic_reads = slices.filter(({ path }) =>
      Object.keys(ATOMIC).some((key) => path === `/frames/${key}`),
    )
    expect(run.atom_count).toBe(atoms)
    expect(atomic_reads.map(({ path }) => path)).toEqual(
      (atoms > 2000 ? [`positions`] : Object.keys(ATOMIC)).map((name) => `/frames/${name}`),
    )
    if (atoms > 2000)
      expect(atomic_reads[0].ranges).toEqual([
        [0, 1],
        [0, atoms, sample_stride],
      ])
    slices.length = 0
    if (!run.read_atoms) throw new Error(`missing read_atoms`)
    await run.read_atoms({
      frame_idx: 2,
      start,
      count: 2,
      stride,
      velocity_key: `velocity`,
      mass_source: `recorded`,
    })
    expect(slices).toEqual(
      [`positions`, `velocities`].map((name) => ({
        path: `/frames/${name}`,
        ranges: [
          [2, 3],
          [start, start + 2 * stride, stride],
        ],
      })),
    )
    slices.length = 0
    const summary = summarize_run(run)
    const opened = await open_hdf5_trajectory(
      buffer,
      create_warning_collector(),
      `md.h5`,
      undefined,
      summary,
    )
    if (opened.kind !== `lazy`) throw new Error(`Expected lazy replica`)
    const replica = hdf5_run(opened.lazy, run.provenance, run.warnings)
    onTestFinished(() => replica.dispose())
    // Replicas reuse validated axes, plot rows and preview without reading frame data.
    expect(slices.every(({ path }) => !path.startsWith(`/frames/`))).toBe(true)
    expect(summarize_run(replica)).toEqual(summary)
    let max_absolute_error = 0
    let max_relative_error = 0
    for (const frame_idx of [0, 1, frames - 1]) {
      const expected = await run.read_frame(frame_idx)
      const actual = await replica.read_frame(frame_idx)
      assert.deepStrictEqual(actual, expected)
      for (const [idx, value] of expected.coordinates.entries()) {
        const error = Math.abs(actual.coordinates[idx] - value)
        max_absolute_error = Math.max(max_absolute_error, error)
        max_relative_error = Math.max(
          max_relative_error,
          value === 0 ? error : error / Math.abs(value),
        )
      }
    }
    expect([max_absolute_error, max_relative_error]).toEqual([0, 0])
    await expect(
      open_hdf5_trajectory(buffer, create_warning_collector(), `md.h5`, undefined, {
        ...summary,
        frame_count: frames + 1,
      }),
    ).rejects.toThrow(/replica metadata does not match/)
  })

  it.each<readonly [string, Parameters<typeof fixture>[0]]>([
    [
      `nonconsecutive step`,
      {
        mutate: (file) =>
          (file.get(`/frames/md_step`) as Dataset).write_slice(
            [[1, 2]],
            new BigInt64Array([2310n]),
          ),
      },
    ],
    [
      `wrong units`,
      {
        mutate: (file) => {
          const dataset = file.get(`/frames/velocities`) as Dataset
          dataset.delete_attribute(`units`)
          dataset.create_attribute(`units`, `A/fs`)
        },
      },
    ],
    ...[0, -1, NaN].map(
      (value) => [`invalid timestep ${value}`, { timestep_fs: value }] as const,
    ),
    [`invalid success count`, { committed: 2, successful: true }],
    [`incorrect float32 dtype`, { float32: true }],
    [
      `short committed channel`,
      { mutate: (file) => (file.get(`/frames/positions`) as Dataset).resize([2, 4, 3]) },
    ],
    [
      `unknown schema`,
      {
        mutate: (file) => {
          file.delete_attribute(`schema`)
          file.create_attribute(`schema`, `md-trajectory-v9`)
        },
      },
    ],
    [
      `reordered IDs`,
      {
        mutate: (file) =>
          (file.get(`/static/global_atom_ids`) as Dataset).write_slice([[0, 2]], [1, 0]),
      },
    ],
    [
      `nonfinite committed frame`,
      {
        mutate: (file) =>
          (file.get(`/frames/positions`) as Dataset).write_slice(
            [
              [0, 1],
              [0, 1],
            ],
            [NaN, NaN, NaN],
          ),
      },
    ],
  ])(`rejects %s`, async (_label, options) => {
    await expect(open(await fixture(options))).rejects.toThrow(/MD|finite/)
  })
})
