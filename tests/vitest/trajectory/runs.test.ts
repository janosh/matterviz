import { BondFrame, prepare_bond_placements } from '$lib/structure/bond-rendering'
import {
  create_numeric_md_frame,
  encode_frame,
  FrameView,
  materialize_frame,
  materialize_frame_result,
  select_frame_channels,
  wrap_frame_coordinates,
} from '$lib/trajectory/frame'
import { normalize_fractional_coords } from '$lib/structure/parse'
import { snapshot_topologies, numeric_sites, site_count, get_site } from '$lib/structure/site'
import { characteristic_atom_spacing, get_element_counts } from '$lib/structure/density'
import { has_usable_lattice, is_crystal } from '$lib/structure/validation'
import {
  get_colorable_property_keys,
  structure_has_selective_dynamics,
} from '$lib/structure/atom-properties'
import { get_structure_vector_keys, prepare_vector_geometry } from '$lib/structure/vectors'
import { compute_bonds } from '$lib/structure/bonding'
import {
  display_frame_bytes,
  display_frame_transfers,
  FramePreparer,
} from '$lib/trajectory/prepare'
import { DEFAULTS } from '$lib/settings'
import { frame_atom_batch } from '$lib/trajectory/atom-batches'
// Every TrajectoryRun implementation against one contract table: frame_count, preview,
// read_frame (sync vs async, range, abort), collect_positions parity with the memory run on
// identical data, progressive properties and dispose semantics.
import type { ParseProgress, TrajectoryFrame } from '$lib/trajectory'
import { open_trajectory, trajectory_from_frames } from '$lib/trajectory/open'
import {
  summarize_run,
  sync_run,
  TrajectoryProperties,
  type TrajectoryRun,
} from '$lib/trajectory/run'
import { parse_xyz_trajectory } from '$lib/trajectory/parse/xyz'
import { create_warning_collector } from '$lib/trajectory/parse/shared'
import { host_run } from '$lib/trajectory/runs/host'
import { indexed_text_run } from '$lib/trajectory/runs/indexed-text'
import { serve_run_over_port, worker_run } from '$lib/trajectory/runs/worker'
import { describe, expect, it, test, vi } from 'vitest'
import { max_abs_error, max_rel_error } from '../numeric-helpers'
import { make_trajectory_frame, read_binary_test_file } from '../test-fixtures'
import { synthetic_extxyz } from './fixtures'

const N_FRAMES = 40
const N_ATOMS = 27
const XYZ_TEXT = synthetic_extxyz(N_FRAMES, N_ATOMS)
const collector = create_warning_collector()
const reference_frames = parse_xyz_trajectory(XYZ_TEXT, collector).frames

describe(`numeric frames`, () => {
  it(`counts shared backing buffers once, including their unused capacity`, () => {
    const frame = encode_frame(make_trajectory_frame(0, 2))
    const storage = new Float64Array(128)
    frame.coordinates = storage.subarray(0, frame.coordinates.length)
    frame.scalar_columns = { charge: storage.subarray(100, 102) }
    const atom_bytes = frame.sites instanceof Uint8Array ? frame.sites.byteLength : 0
    expect(display_frame_bytes({ frame })).toBe(storage.byteLength + atom_bytes)
    const bonds = {
      indices: new Uint32Array(2),
      lengths: storage.subarray(110, 111),
      orders: new Uint8Array(1),
      images: new Float64Array(0),
    }
    expect(display_frame_bytes({ frame, bonds })).toBe(storage.byteLength + atom_bytes + 9)
    const placements = new Float32Array(32)
    const bond_placements = {
      centers: placements.subarray(0, 3),
      deltas: placements.subarray(3, 6),
      sizes: placements.subarray(6, 9),
      instance_count: 1,
      max_site_idx: 1,
    }
    const metrics = {
      vector_magnitudes: { force: { values: storage.subarray(120, 122), max: 0 } },
      characteristic_atom_spacing: 1,
    }
    expect(display_frame_bytes({ frame, bonds, bond_placements, metrics })).toBe(
      storage.byteLength + atom_bytes + 9 + placements.byteLength,
    )
    const display = { frame, bonds, bond_placements, metrics }
    expect(
      display_frame_bytes({
        ...display,
        polyhedra: [
          {
            center_site_idx: 0,
            center_orig_idx: 0,
            center_element: `Si`,
            vertices: [[0, 0, 0]],
            vertex_site_idxs: [1],
            faces: [],
            volume: 0,
          },
        ],
      }),
    ).toBeGreaterThan(display_frame_bytes(display) + 24)
    const expected = structuredClone(display)
    const transfer = display_frame_transfers(display)
    expect(new Set(transfer).size).toBe(transfer.length)
    expect(structuredClone(display, { transfer })).toEqual(expected)
    expect(transfer.every((buffer) => buffer.byteLength === 0)).toBe(true)
  })
  it.each([0, 1, 2])(`aligns loaded atom channels at source step %i`, (frame_idx) => {
    const numeric = encode_frame(make_trajectory_frame(frame_idx * 10, 2))
    const signals = {
      velocity: {
        steps: [0, 10],
        sample_shape: [2, 3],
        values: Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
      },
      energy: {
        steps: [0, 10],
        sample_shape: [2],
        values: Float64Array.from([13, 14, 15, 16]),
      },
      selected: { steps: [0, 10], sample_shape: [2], values: Float64Array.from([0, 1, 1, 0]) },
    }
    const read = () =>
      frame_atom_batch(
        numeric,
        {
          frame_idx,
          start: 1,
          count: 1,
          velocity_key: `velocity`,
          energy_key: `energy`,
          selection_key: `selected`,
          mass_source: `recorded`,
        },
        [28, 72],
        signals,
      )
    if (frame_idx === 2) {
      expect(read).toThrow(`Signal velocity has no sample at step 20`)
      return
    }
    expect(read()).toMatchObject({
      velocities: signals.velocity.values.slice(frame_idx * 6 + 3, frame_idx * 6 + 6),
      energies: signals.energy.values.slice(frame_idx * 2 + 1, frame_idx * 2 + 2),
      selected: Uint8Array.of(frame_idx === 0 ? 1 : 0),
      masses: Float64Array.of(72),
    })
  })
  it.each([NaN, 0, -2])(`honors scalar velocity overrides (%s) in atom batches`, (value) => {
    const frame = create_numeric_md_frame(
      new Float64Array(3),
      Uint8Array.of(14),
      undefined,
      undefined,
      0,
      {},
      [`velocity`],
    )
    frame.coordinates.set([1, 2, 3], 6)
    const options = { frame_idx: 0, velocity_key: `velocity` }
    expect(frame_atom_batch(frame, options).velocities).toEqual(Float64Array.of(1, 2, 3))
    frame.scalar_columns = { velocity: Float64Array.of(value) }
    for (const source of [frame, encode_frame(materialize_frame(frame))])
      expect(() => frame_atom_batch(source, options)).toThrow(`Missing or invalid velocity`)
    // Explicit run signals still take precedence over frame properties.
    const velocity = { steps: [0], sample_shape: [1, 3], values: Float64Array.of(4, 5, 6) }
    expect(frame_atom_batch(frame, options, undefined, { velocity }).velocities).toEqual(
      velocity.values,
    )
  })

  it(`owns source metadata and independently materializes editable snapshots`, () => {
    const source = make_trajectory_frame(0, 2, { energy: 1 })
    source.structure.sites[0].properties.charge = 2
    const expected = structuredClone(source)
    const numeric = encode_frame(source)
    ;(source.metadata ??= {}).energy = 9
    source.structure.sites[0].properties.charge = 9
    source.structure.sites[0].species[0].element = `Og`
    if (`lattice` in source.structure) source.structure.lattice.matrix[0][0] = 9
    expect(materialize_frame(numeric)).toStrictEqual(expected)
    const editable = materialize_frame(numeric)
    ;(editable.metadata ??= {}).energy = 8
    editable.structure.sites[0].properties.charge = 8
    if (`lattice` in editable.structure) editable.structure.lattice.matrix[0][0] = 8
    expect(materialize_frame(numeric)).toStrictEqual(expected)
  })

  it.each([0, 2])(`discovers numeric properties without materializing %i sites`, (count) => {
    const frame = create_numeric_md_frame(
      new Float64Array(count * 3),
      new Uint8Array(count).fill(14),
      undefined,
      undefined,
      0,
      {},
      [`force`, `selective_dynamics`],
    )
    frame.scalar_columns = {
      force: new Float64Array(count).fill(NaN),
      charge: new Float64Array(count).fill(1),
      magmom: new Float64Array(count).fill(-2),
      orig_site_idx: new Float64Array(count),
    }
    const structure = new FrameView().update(frame).structure
    const columns = numeric_sites.get(structure)
    if (!columns) throw new Error(`Expected numeric display columns`)
    const materialize = vi.spyOn(columns, `materialize`)
    expect(get_colorable_property_keys(structure)).toEqual(
      count ? [`charge`, `magmom`, `selective_dynamics`] : [],
    )
    expect(get_structure_vector_keys(structure)).toEqual(count ? [`magmom`] : [])
    expect(structure_has_selective_dynamics(structure)).toBe(count > 0)
    expect(get_site(structure, NaN)).toBeUndefined()
    expect(get_site(structure, 0.5)).toBeUndefined()
    expect(materialize).not.toHaveBeenCalled()
    const reference = materialize_frame(frame).structure
    expect(get_colorable_property_keys(structure)).toEqual(
      get_colorable_property_keys(reference),
    )
  })

  it.each([false, true])(
    `keeps scalar vectors discoverable when dense channels are hidden (numeric: %s)`,
    (numeric) => {
      const source = make_trajectory_frame(0, 2)
      for (const site of source.structure.sites) {
        site.properties.force = [1, 2, 3]
        if (!numeric) site.properties.magmom = -2
      }
      const frame = encode_frame(source)
      if (numeric) frame.scalar_columns = { magmom: Float64Array.of(-2, -2) }
      const filtered = select_frame_channels(frame, { vectors: [] })
      const { structure } = new FrameView().update(filtered)
      const columns = numeric_sites.get(structure)
      const materialize = columns && vi.spyOn(columns, `materialize`)
      expect(filtered.vector_keys).toEqual([])
      expect(get_structure_vector_keys(structure)).toEqual([`force`, `magmom`])
      expect(get_colorable_property_keys(structure)).toEqual([`force`, `magmom`])
      if (materialize) expect(materialize).not.toHaveBeenCalled()
    },
  )

  it.each([
    [true, true, true],
    [true, false, true],
    [false, false, false],
  ] as const)(`publishes fresh coordinates with shared topology and PBC %j`, (...pbc) => {
    const view = new FrameView()
    const first = create_numeric_md_frame(
      new Float64Array([1, 2, 3, 4, 5, 6]),
      new Uint8Array([14, 32]),
      [
        [3, 0, 0],
        [1, 4, 0],
        [0, 1, 5],
      ],
      pbc,
      0,
      {},
      [`force`],
    )
    const next = create_numeric_md_frame(
      new Float64Array([-2, 3, 9, 5, -6, 7]),
      first.sites as Uint8Array,
      [
        [4, 0, 0],
        [1, 5, 0],
        [0, 1, 6],
      ],
      pbc,
      1,
      {},
      [`force`],
    )
    next.coordinates.set([1, 2, 3], 6)
    const snapshot = structuredClone(next)
    const first_structure = view.update(first).structure
    const atoms = first_structure.sites
    const first_snapshot = structuredClone(atoms)
    const result = view.update(next)
    const wrapped = wrap_frame_coordinates(next)
    expect(wrap_frame_coordinates(wrapped)).toBe(wrapped)
    expect(new FrameView().update(wrapped)).toEqual(result)
    const columns = numeric_sites.get(result.structure)
    if (!columns) throw new Error(`Expected numeric display columns`)
    const materialize = vi.spyOn(columns, `materialize`)
    expect(site_count(result.structure)).toBe(2)
    expect(get_site(result.structure, 0)?.label).toBe(`Si1`)
    expect(get_site(result.structure, -1)).toBeUndefined()
    expect(get_site(result.structure, 2)).toBeUndefined()
    expect(has_usable_lattice(result.structure)).toBe(true)
    expect(is_crystal(result.structure)).toBe(true)
    expect(normalize_fractional_coords(result.structure)).toBe(result.structure)
    const numeric_spacing = characteristic_atom_spacing(result.structure)
    const counts = get_element_counts(result.structure)
    counts.Si = 100 // callers cannot mutate the cached composition
    expect(get_element_counts(result.structure)).toEqual({ Si: 1, Ge: 1 })
    expect(materialize).not.toHaveBeenCalled()
    const identity = snapshot_topologies.get(first_structure)
    expect(identity).toBeDefined()
    expect(snapshot_topologies.get(result.structure)).toBe(identity)
    expect(result.structure.sites).not.toBe(atoms)
    expect(result.structure.sites[0].species).toBe(atoms[0].species)
    expect(atoms).toStrictEqual(first_snapshot)
    const reference = normalize_fractional_coords(materialize_frame(next).structure)
    expect(numeric_spacing).toBe(characteristic_atom_spacing(reference))
    expect(result.structure).toStrictEqual(reference)
    expect(next).toStrictEqual(snapshot)
    const observed = result.structure.sites.flatMap(({ xyz, abc }) => [...xyz, ...abc])
    const expected = reference.sites.flatMap(({ xyz, abc }) => [...xyz, ...abc])
    expect(max_abs_error(observed, expected)).toBe(0)
    expect(max_rel_error(observed, expected)).toBe(0)
    const changed = { ...next, topology: { kind: `fixed-order`, revision: 1 } as const }
    const changed_structure = view.update(changed).structure
    expect(changed_structure.sites[0].species).not.toBe(atoms[0].species)
    expect(snapshot_topologies.get(changed_structure)).not.toBe(identity)
    expect(snapshot_topologies.has(materialize_frame(changed).structure)).toBe(false)
    for (const interrupt of [
      { ...changed, topology: undefined },
      { ...changed, sites: materialize_frame(changed).structure.sites },
      { ...changed, sites: Uint8Array.of(14) },
    ]) {
      const before = snapshot_topologies.get(view.update(changed).structure)
      view.update(interrupt)
      expect(snapshot_topologies.get(view.update(changed).structure)).not.toBe(before)
    }
    view.clear()
    expect(snapshot_topologies.get(view.update(first).structure)).not.toBe(identity)
  })

  it.each([0, 1, 2, 3, 4, 5, 6, 7])(
    `preserves wrapping boundaries for PBC mask %i`,
    (mask) => {
      const pbc: [boolean, boolean, boolean] = [
        Boolean(mask & 1),
        Boolean(mask & 2),
        Boolean(mask & 4),
      ]
      for (const outside of [false, true]) {
        const values = [
          0,
          -0,
          Number.EPSILON,
          1 - 1e-10,
          1 - 1e-10 - Number.EPSILON,
          1 - 1e-10 + Number.EPSILON,
          0.1234567890123445,
          0.1234567890123455,
          0.5000000000000006,
          ...(outside ? [-1, 1, 2, -2, -Number.EPSILON, -0.0000000000000006] : []),
        ]
        const frame = create_numeric_md_frame(
          new Float64Array(values.length * 3),
          new Uint8Array(values.length).fill(14),
          [
            [4, 1, -0.5],
            [-2, 5, 0.3],
            [0.2, -0.7, 6],
          ],
          pbc,
          0,
          {},
          [`velocity`],
        )
        for (let idx = 0; idx < values.length; idx++)
          frame.coordinates.set(
            [
              19,
              -7,
              23,
              values[idx],
              values[(idx + 3) % values.length],
              values[(idx + 7) % values.length],
              idx,
              -idx,
              0.123,
            ],
            idx * 9,
          )
        const original = frame.coordinates.slice()
        const materialized = materialize_frame(frame)
        const reference = encode_frame({
          ...materialized,
          structure: normalize_fractional_coords(materialized.structure),
        })
        const wrapped = wrap_frame_coordinates(frame)
        expect(wrapped.coordinates).toStrictEqual(reference.coordinates)
        expect(max_abs_error(wrapped.coordinates, reference.coordinates)).toBe(0)
        expect(max_rel_error(wrapped.coordinates, reference.coordinates)).toBe(0)
        expect(wrapped.coordinates === frame.coordinates).toBe(!outside || mask === 0)
        expect(frame.coordinates).toStrictEqual(original)
        expect(wrap_frame_coordinates(wrapped)).toBe(wrapped)
      }
    },
  )
})

const next_tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const ase_buffer = read_binary_test_file(`ase-LiMnO2-chgnet-relax.traj`)

// A port pair in-process: worker side serves a memory run, client side is a worker_run
const make_worker_run = (): TrajectoryRun => {
  const served = trajectory_from_frames(reference_frames)
  return worker_run(serve_run_over_port(served), summarize_run(served))
}

const expect_listener_errors = (notify: () => void, failures: Error[]): void => {
  const attempt = vi.fn(notify)
  expect(attempt).toThrow(Error)
  const error: unknown = attempt.mock.results[0].value
  if (failures.length === 1) expect(error).toBe(failures[0])
  else {
    expect(error).toBeInstanceOf(AggregateError)
    expect(error).toHaveProperty(`errors`, failures)
  }
}

const make_host_run = (): TrajectoryRun => {
  const backing = trajectory_from_frames(reference_frames)
  return host_run(summarize_run(backing), async (frame_idx, signal) => {
    await next_tick()
    signal?.throwIfAborted()
    return materialize_frame_result(backing.read_frame(frame_idx))
  })
}

type RunCase = {
  name: string
  make: () => Promise<TrajectoryRun> | TrajectoryRun
  sync_reads: boolean
  has_collect: boolean
  n_frames: number
  n_atoms: number
}

const RUN_CASES: RunCase[] = [
  {
    name: `memory`,
    make: () => trajectory_from_frames(reference_frames),
    sync_reads: true,
    has_collect: true,
    n_frames: N_FRAMES,
    n_atoms: N_ATOMS,
  },
  {
    name: `indexed xyz`,
    make: () =>
      indexed_text_run(
        XYZ_TEXT,
        `xyz`,
        { filename: `synthetic.extxyz` },
        create_warning_collector(),
      ),
    sync_reads: true,
    has_collect: true,
    n_frames: N_FRAMES,
    n_atoms: N_ATOMS,
  },
  {
    name: `indexed ase`,
    make: () =>
      indexed_text_run(
        ase_buffer.slice(0),
        `ase`,
        { filename: `relax.traj` },
        create_warning_collector(),
      ),
    sync_reads: true,
    has_collect: true,
    n_frames: 2,
    n_atoms: 8,
  },
  {
    name: `hdf5`,
    make: () =>
      open_trajectory(read_binary_test_file(`gold-nanoparticle-md.h5`), {
        filename: `gold.h5`,
      }),
    sync_reads: true,
    has_collect: true,
    n_frames: 100,
    n_atoms: 55,
  },
  {
    name: `worker port`,
    make: make_worker_run,
    sync_reads: false,
    has_collect: true,
    n_frames: N_FRAMES,
    n_atoms: N_ATOMS,
  },
  {
    name: `host`,
    make: make_host_run,
    sync_reads: false,
    has_collect: false,
    n_frames: N_FRAMES,
    n_atoms: N_ATOMS,
  },
]

it.each([27, 100_000])(
  `uses the full %i atom count to gate frame-backed analysis`,
  (atom_count) => {
    const run = sync_run({
      label: `sampled preview`,
      atom_count,
      frame_count: 1,
      preview: reference_frames[0],
      read: () => encode_frame(reference_frames[0]),
      properties: new TrajectoryProperties(),
      provenance: {},
      metadata: {},
      warnings: [],
    })
    expect(run.atom_count).toBe(atom_count)
    expect(run.read_atoms !== undefined).toBe(atom_count === 27)
    run.dispose()
  },
)

describe.each(RUN_CASES)(
  `$name run`,
  ({ make, sync_reads, has_collect, n_frames, n_atoms }) => {
    it(`exposes frame_count, a frame-0 preview and range-checked frame reads`, async () => {
      const run = await make()
      expect(run.frame_count).toBe(n_frames)
      expect(run.atom_count).toBe(n_atoms)
      expect(run.preview.structure.sites).toHaveLength(n_atoms)
      expect(await materialize_frame_result(run.read_frame(0))).toEqual(run.preview)
      const last = materialize_frame_result(run.read_frame(n_frames - 1))
      if (sync_reads) expect(last).not.toBeInstanceOf(Promise)
      else expect(last).toBeInstanceOf(Promise)
      const last_frame = await last
      expect(last_frame.structure.sites).toHaveLength(n_atoms)
      expect(last_frame.step).toBeGreaterThanOrEqual(run.preview.step)
      for (const bad_idx of [-1, n_frames, 1.5, NaN]) {
        expect(() => materialize_frame_result(run.read_frame(bad_idx))).toThrow(RangeError)
      }
      expect(run.collect_positions !== undefined).toBe(has_collect)
      run.dispose()
    })

    it(`read_frame rejects with the abort reason`, async () => {
      const run = await make()
      const controller = new AbortController()
      const reason = new Error(`stale scrub`)
      const pending = materialize_frame_result(run.read_frame(n_frames - 1, controller.signal))
      controller.abort(reason)
      if (pending instanceof Promise) await expect(pending).rejects.toBe(reason)
      else expect(pending.structure.sites).toHaveLength(n_atoms) // sync reads cannot be aborted
      for (const frame_idx of [0, n_frames - 1]) {
        await expect(
          (async () =>
            materialize_frame_result(run.read_frame(frame_idx, controller.signal)))(),
        ).rejects.toBe(reason)
      }
      run.dispose()
    })

    it(`dispose is idempotent and later reads fail`, async () => {
      const run = await make()
      run.dispose()
      run.dispose()
      for (const frame_idx of [0, n_frames - 1]) {
        await expect(
          (async () => materialize_frame_result(run.read_frame(frame_idx)))(),
        ).rejects.toThrow(/disposed/)
      }
      if (run.collect_positions)
        await expect(run.collect_positions()).rejects.toThrow(/disposed/)
      expect(run.properties.complete).toBe(true)
    })

    it(`properties rows cover the run in frame order`, async () => {
      const run = await make()
      await run.properties.done
      const { rows } = run.properties
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.length).toBeLessThanOrEqual(n_frames)
      expect(rows[0].frame_number).toBe(0)
      expect(
        rows.every((row, idx) => idx === 0 || row.frame_number > rows[idx - 1].frame_number),
      ).toBe(true)
      const last_row = rows.at(-1)
      expect(last_row?.step).toBe(
        (await materialize_frame_result(run.read_frame(last_row?.frame_number ?? 0))).step,
      )
      run.dispose()
    })
  },
)

describe(`collect_positions parity with the memory run`, () => {
  test.each(
    RUN_CASES.filter(
      ({ name, has_collect }) => has_collect && name !== `hdf5` && name !== `indexed ase`,
    ),
  )(`$name matches to max |Δ| = 0`, async ({ make }) => {
    const reference = await trajectory_from_frames(reference_frames).collect_positions?.({
      frame_stride: 3,
      vector_keys: [`force`],
    })
    const run = await make()
    const stream = await run.collect_positions?.({ frame_stride: 3, vector_keys: [`force`] })
    const window = await run.collect_positions?.({
      start_frame: 2,
      end_frame: 8,
      frame_stride: 3,
      vector_keys: [`force`],
    })
    expect(window?.steps).toEqual([reference_frames[2].step, reference_frames[5].step])
    expect(window?.positions).toEqual(
      Float64Array.from(
        [2, 5].flatMap((idx) =>
          reference_frames[idx].structure.sites.flatMap((site) => site.xyz),
        ),
      ),
    )
    if (!reference || !stream) throw new Error(`collect_positions missing`)
    expect(stream.n_frames).toBe(reference.n_frames)
    expect(stream.n_atoms).toBe(N_ATOMS)
    expect(stream.steps).toEqual(reference.steps)
    expect(stream.elements).toEqual(reference.elements)
    expect(max_abs_error(stream.positions, reference.positions)).toBe(0)
    expect(max_abs_error(stream.vectors?.force ?? [], reference.vectors?.force ?? [])).toBe(0)
    expect(stream.lattice_matrices?.map((matrix) => matrix?.flat())).toEqual(
      reference.lattice_matrices?.map((matrix) => matrix?.flat()),
    )
    run.dispose()
  })

  it(`skips preparation when a source read finishes after cancellation`, async () => {
    const served = trajectory_from_frames([make_trajectory_frame(0, 1)])
    const frame = await served.read_frame(0)
    const deferred = Promise.withResolvers<typeof frame>()
    let read_signal: AbortSignal | undefined
    served.read_frame = (_idx, signal) => {
      read_signal = signal
      return deferred.promise
    }
    const prepare = vi.spyOn(FramePreparer.prototype, `prepare`)
    const run = worker_run(serve_run_over_port(served), summarize_run(served))
    try {
      if (!run.prepare_frame) throw new Error(`Missing worker preparation`)
      const controller = new AbortController()
      const outcome = run
        .prepare_frame(
          0,
          {
            bonding_strategy: `electroneg_ratio`,
            bonding_options: {},
            bonds: false,
          },
          controller.signal,
        )
        .catch((error: unknown) => error)
      await vi.waitFor(() => expect(read_signal).toBeDefined())
      controller.abort()
      expect(await outcome).toMatchObject({ name: `AbortError` })
      await vi.waitFor(() => expect(read_signal?.aborted).toBe(true))
      deferred.resolve(frame)
      // A subsequent request is a barrier: the canceled worker task has now finished.
      expect(await run.read_frame(0)).toEqual(frame)
      expect(prepare).not.toHaveBeenCalled()
    } finally {
      run.dispose()
      prepare.mockRestore()
    }
  })

  it(`worker port collect forwards progress and honours abort`, async () => {
    const run = make_worker_run()
    const controller = new AbortController()
    controller.abort()
    await expect(run.collect_positions?.({ signal: controller.signal })).rejects.toThrow(
      /abort/i,
    )
    run.dispose()

    // accumulate_positions reports once per 500 collected frames, so a 1000-frame run must
    // deliver exactly two progress messages across the port, at frames 499 and 999
    const n_frames = 1000
    const served = trajectory_from_frames(
      Array.from({ length: n_frames }, (_unused, frame_idx) =>
        make_trajectory_frame(frame_idx, 1),
      ),
    )
    const long_run = worker_run(serve_run_over_port(served), summarize_run(served), () => {})
    const progress: ParseProgress[] = []
    const stream = await long_run.collect_positions?.({
      on_progress: (step) => progress.push(step),
    })
    expect(stream?.n_frames).toBe(n_frames)
    expect(progress.map(({ current }) => current)).toEqual([49.9, 99.9])
    expect(progress.map(({ total, stage }) => [total, stage])).toEqual([
      [100, `Reading positions: 499/1000`],
      [100, `Reading positions: 999/1000`],
    ])
    long_run.dispose()
  })

  it(`hdf5 collect_positions matches its own read_frame positions`, async () => {
    const run = await open_trajectory(read_binary_test_file(`gold-nanoparticle-md.h5`), {
      filename: `gold.h5`,
    })
    const stream = await run.collect_positions?.({
      frame_stride: 5,
      start_frame: 2,
      end_frame: 15,
    })
    if (!stream) throw new Error(`no stream`)
    expect(stream.n_frames).toBe(3)
    for (const [sample_idx, frame_idx] of [2, 7, 12].entries()) {
      const frame = await materialize_frame_result(run.read_frame(frame_idx))
      const from_frame = frame.structure.sites.flatMap((site) => site.xyz)
      const offset = sample_idx * stream.n_atoms * 3
      expect(
        max_abs_error(
          from_frame,
          stream.positions.subarray(offset, offset + from_frame.length),
        ),
      ).toBe(0)
    }
    run.dispose()
  })
})

describe(`worker-served run lifecycle`, () => {
  it.each([false, true])(
    `retains frame-zero channel metadata (sparse: %s)`,
    async (sparse) => {
      const frame = create_numeric_md_frame(
        Float64Array.of(1, 2, 3),
        Uint8Array.of(1),
        undefined,
        undefined,
        0,
        {},
        sparse ? [] : [`force`],
      )
      frame.available_vector_keys = [`force`]
      frame.scalar_columns = { charge: Float64Array.of(0.5) }
      const served = sync_run({
        label: `numeric metadata`,
        frame_count: 1,
        read: () => frame,
        properties: new TrajectoryProperties([], true),
        provenance: {},
        metadata: {},
        warnings: [],
      })
      const run = worker_run(serve_run_over_port(served), summarize_run(served))
      try {
        const channels = { vectors: [`force`] }
        const expected = await served.read_frame(0, undefined, channels)
        expect(expected.topology).toEqual({ kind: `fixed-order`, revision: 0 })
        const actual = await run.read_frame(0, undefined, channels)
        expect(actual).toEqual(expected)
        expect(actual.coordinates).not.toBe(expected.coordinates)
      } finally {
        run.dispose()
      }
    },
  )

  it.each(
    [false, true].flatMap((periodic) =>
      [false, true].map((records) => ({ periodic, records })),
    ),
  )(
    `prepares immutable frame/bond packets (periodic: $periodic, records: $records)`,
    async ({ periodic, records }) => {
      const source = [0, 1, 2].map((step) => {
        const frame = create_numeric_md_frame(
          Float64Array.of(-0.3 + step / 10, 0, 0, 1, 0, 0, 3.9, 0, 0),
          Uint8Array.of(14, 14, 14),
          [
            [4, 0, 0],
            [0, 4, 0],
            [0, 0, 4],
          ],
          [periodic, periodic, periodic],
          step,
          {},
          [`force`, `velocity`],
        )
        frame.scalar_columns = {
          orig_site_idx: Float64Array.of(0, 1, 0),
          orig_unit_cell_idx: Float64Array.of(0, 1, 0),
          charge: Float64Array.of(step, step + 0.5, step),
        }
        for (let idx = 0; idx < 3; idx++)
          frame.coordinates.set([step, idx, -1, step + 1, idx, 2], idx * 12 + 6)
        frame.structure.properties = {
          bonds: [{ site_idx_1: 0, site_idx_2: 1, order: 2 }],
        }
        return records ? encode_frame(materialize_frame(frame)) : frame
      })
      const served = sync_run({
        label: `prepared MD`,
        frame_count: source.length,
        atom_count: 3,
        preview: materialize_frame(source[0]),
        read: (idx) => source[idx],
        properties: new TrajectoryProperties(),
        provenance: {},
        metadata: {},
        warnings: [],
      })
      const run = worker_run(serve_run_over_port(served), summarize_run(served))
      try {
        if (!run.prepare_frame) throw new Error(`Missing worker preparation`)
        const preparation = {
          bonding_strategy: `electroneg_ratio`,
          bonding_options: {},
          vector_geometry: { ...DEFAULTS.structure, vector_configs: {} },
        } as const
        const first = await run.prepare_frame(0, preparation)
        const retained = structuredClone(first)
        for (const [idx, original] of source.entries()) {
          const received = await run.prepare_frame(idx, preparation)
          const expected = new FrameView().update(original)
          expect(received.frame).toEqual(wrap_frame_coordinates(original))
          expect(await materialize_frame_result(run.read_frame(idx))).toEqual(
            materialize_frame(original),
          )
          if (!received.bonds) throw new Error(`Missing prepared bonds`)
          const bonds = new BondFrame(
            new FrameView().update(received.frame).structure,
            received.bonds,
          ).materialize()
          const reference = compute_bonds(expected.structure, preparation.bonding_strategy, {})
          expect(bonds).toEqual(reference)
          expect(received.bond_placements).toEqual(prepare_bond_placements(reference))
          expect(received.vector_geometry).toEqual(
            records
              ? undefined
              : prepare_vector_geometry(expected.structure, preparation.vector_geometry),
          )
          expect(received.metrics?.vector_magnitudes.force.values).toEqual(
            Float64Array.from({ length: 3 }, (_unused, atom_idx) =>
              Math.hypot(idx, atom_idx, -1),
            ),
          )
          const numeric = (items: typeof bonds) =>
            items.flatMap(({ pos_1, pos_2, bond_length }) => [...pos_1, ...pos_2, bond_length])
          expect(max_abs_error(numeric(bonds), numeric(reference))).toBe(0)
          expect(max_rel_error(numeric(bonds), numeric(reference))).toBe(0)
          const explicit = await run.prepare_frame(idx, {
            ...preparation,
            bonding_strategy: `explicit_only`,
          })
          if (!explicit.bonds) throw new Error(`Missing explicit bonds`)
          expect(new BondFrame(expected.structure, explicit.bonds).materialize()).toEqual(
            compute_bonds(expected.structure, `explicit_only`, {}),
          )
        }
        expect(first).toEqual(retained)
      } finally {
        run.dispose()
      }
    },
  )
  it.each([
    { label: `custom label` },
    { species: [{ element: `H`, occu: 0.5, oxidation_state: 0 }] },
    { species: [{ element: `H`, occu: 1, oxidation_state: -0 }] },
    { species: [{ element: `H`, occu: 1, oxidation_state: 0, isotope: 2 }] },
    {
      species: Object.assign([{ element: `H`, occu: 1, oxidation_state: 0 }], {
        source: `test`,
      }),
    },
    { properties: { force: Object.assign([1, 2, 3], { unit: `eV/A` }) } },
    { properties: { empty: undefined } },
    { magnetic_order: `up` },
  ])(`preserves nonstandard atom metadata %j`, async (metadata) => {
    const frame = make_trajectory_frame(0, 1)
    Object.assign(frame.structure.sites[0], metadata)
    const source = structuredClone(frame)
    const served = trajectory_from_frames([frame])
    const run = worker_run(serve_run_over_port(served), summarize_run(served))
    try {
      expect(await materialize_frame_result(run.read_frame(0))).toStrictEqual(source)
      expect(frame).toStrictEqual(source)
    } finally {
      run.dispose()
    }
  })

  it.each([
    [1, false],
    [65_537, false],
    [65_537, true],
  ] as const)(
    `transfers %i sites exactly without changing source frames (compact: %s)`,
    async (count, compact) => {
      const frame = make_trajectory_frame(1, count)
      for (const [idx, site] of frame.structure.sites.entries()) {
        site.xyz = [idx + 1 / 3, -0, Number.MIN_VALUE]
        site.abc = [-idx - 1 / 7, Number.MAX_VALUE, -Number.MIN_VALUE]
        site.properties = {
          velocity: [0, NaN, Infinity],
          force: [idx, 1 / 3, -0],
          ...(!compact && { flag: undefined, nested: { idx } }),
        }
        if (compact) site.label = `${site.species[0].element}${idx + 1}`
      }
      if (!compact)
        frame.structure.sites[0].properties.named = Object.assign([0, 1, 2], { unit: `eV/A` })
      const source = structuredClone(frame)
      const served = trajectory_from_frames([reference_frames[0], frame])
      const port = serve_run_over_port(served)
      const packets: unknown[] = []
      port.addEventListener(`message`, (event) => packets.push(event.data))
      const run = worker_run(port, summarize_run(served))
      try {
        const received = await materialize_frame_result(run.read_frame(1))
        expect(packets).toMatchObject([
          {
            result: {
              coordinates: expect.any(Float64Array),
              vector_keys: [`velocity`, `force`],
              sites: expect.any(compact ? Uint8Array : Array),
            },
          },
        ])
        expect(received).toStrictEqual(source)
        if (!compact)
          expect(received.structure.sites[0].properties.named).toHaveProperty(`unit`, `eV/A`)
        const original_coords = source.structure.sites.flatMap(({ xyz, abc }) => [
          ...xyz,
          ...abc,
        ])
        const received_coords = received.structure.sites.flatMap(({ xyz, abc }) => [
          ...xyz,
          ...abc,
        ])
        expect(max_abs_error(original_coords, received_coords)).toBe(0)
        expect(max_rel_error(received_coords, original_coords)).toBe(0)
        const first = received.structure.sites[0]
        if (first) {
          first.xyz[0] = 99
          first.properties.velocity = [99, 99, 99]
          first.species[0].element = `Og`
        }
        if (count > 1) expect(received.structure.sites[1]).toEqual(source.structure.sites[1])
        expect(frame).toEqual(source)
        expect(await materialize_frame_result(run.read_frame(1))).toEqual(source)
      } finally {
        run.dispose()
      }
    },
  )

  it(`rejects a throwing progress callback, aborts its work and preserves other requests`, async () => {
    const served = trajectory_from_frames(reference_frames)
    let collect_signal: AbortSignal | undefined
    served.collect_positions = ({ signal, on_progress } = {}) =>
      new Promise((_resolve, reject) => {
        collect_signal = signal
        signal?.addEventListener(`abort`, () => reject(new Error(`Collection aborted`)), {
          once: true,
        })
        on_progress?.({ current: 0, total: 1, stage: `read` })
      })
    const run = worker_run(serve_run_over_port(served), summarize_run(served))
    const controller = new AbortController()
    const remove_listener = vi.spyOn(controller.signal, `removeEventListener`)
    const failure = new Error(`Progress observer failed`)
    const collecting = run.collect_positions?.({
      signal: controller.signal,
      on_progress: () => {
        throw failure
      },
    })
    const reading = materialize_frame_result(run.read_frame(1))
    await expect(collecting).rejects.toBe(failure)
    await expect(reading).resolves.toEqual(reference_frames[1])
    expect(collect_signal?.aborted).toBe(true)
    expect(remove_listener).toHaveBeenCalledWith(`abort`, expect.any(Function))
    await expect(materialize_frame_result(run.read_frame(2))).resolves.toEqual(
      reference_frames[2],
    )
    run.dispose()
  })

  it.each([
    [false, 0],
    [true, 0],
    [false, 1],
    [false, 2],
  ] as const)(
    `streams properties (nested completion: %s, listener failures: %s)`,
    async (finish_during_batch, error_count) => {
      const served = trajectory_from_frames(reference_frames)
      // Progressive source: replace the static properties with a streaming one
      const progressive = new TrajectoryProperties()
      Object.defineProperty(served, `properties`, { value: progressive })
      if (finish_during_batch) {
        progressive.subscribe((_batch, complete) => {
          if (!complete) progressive.finish()
        })
      }
      const release = vi.fn()
      const port = serve_run_over_port(served)
      const add_listener = vi.spyOn(port, `addEventListener`)
      const run = worker_run(port, summarize_run(served), release)
      expect(run.properties.rows).toHaveLength(0)
      const batch = [
        { frame_number: 0, step: 0, properties: { energy: -1 } },
        { frame_number: 1, step: 10, properties: { energy: -2 } },
      ]
      if (error_count) {
        const failures = [
          new Error(`Batch observer failed`),
          new Error(`Finish observer failed`),
        ]
        run.properties.subscribe((_batch, complete) => {
          if (!complete) throw failures[0]
          if (error_count === 2) throw failures[1]
        })
        const observer = vi.fn()
        run.properties.subscribe(observer)
        const handler = add_listener.mock.calls.find(([type]) => type === `message`)?.[1]
        if (typeof handler !== `function`) throw new Error(`Missing worker message handler`)
        // Invoke directly so the test can assert errors normally reported by the event loop.
        expect_listener_errors(
          () =>
            handler.call(
              port,
              new MessageEvent(`message`, {
                data: { properties: batch, complete: true },
              }),
            ),
          failures.slice(0, error_count),
        )
        expect(observer.mock.calls).toEqual([
          [batch, false],
          [[], true],
        ])
        expect(run.properties.complete).toBe(true)
      } else {
        progressive.push(batch)
        progressive.finish()
      }
      await run.properties.done
      expect(run.properties.rows.map((row) => row.properties.energy)).toEqual([-1, -2])
      run.dispose()
      run.dispose()
      expect(release).toHaveBeenCalledOnce()
      await expect(Promise.resolve(run.read_frame(2))).rejects.toThrow(/disposed/)
    },
  )

  it.each([`dispose`, `messageerror`, `close failure`])(
    `rejects pending reads and releases the worker despite observer/port failure during %s`,
    async (phase) => {
      const served = trajectory_from_frames(reference_frames)
      Object.defineProperty(served, `properties`, { value: new TrajectoryProperties() })
      const port = serve_run_over_port(served)
      const close_port = port.close.bind(port)
      const close = vi.spyOn(port, `close`)
      const add_listener = vi.spyOn(port, `addEventListener`)
      const release = vi.fn()
      const run = worker_run(port, summarize_run(served), release)
      const pending = Promise.resolve(run.read_frame(3))
      const failure = new Error(`${phase} callback failed`)
      if (phase === `close failure`)
        close.mockImplementationOnce(() => {
          close_port()
          throw failure
        })
      else
        run.properties.subscribe(() => {
          throw failure
        })
      const dispose = () => {
        if (phase !== `messageerror`) return run.dispose()
        const handler = add_listener.mock.calls.find(([type]) => type === `messageerror`)?.[1]
        if (typeof handler !== `function`) throw new Error(`Missing messageerror handler`)
        handler.call(port, new MessageEvent(`messageerror`))
      }
      expect(dispose).toThrow(failure)
      const reason = phase === `messageerror` ? /deserialize/ : /disposed/
      await expect(pending).rejects.toThrow(reason)
      await run.properties.done
      run.dispose()
      expect(close).toHaveBeenCalledOnce()
      expect(release).toHaveBeenCalledOnce()
      await expect(Promise.resolve(run.read_frame(0))).rejects.toThrow(reason)
    },
  )
})

describe(`TrajectoryProperties`, () => {
  it.each([`synchronous`, `host`])(
    `releases a %s source even when its completion subscriber throws`,
    async (kind) => {
      const release = vi.fn()
      const source = sync_run({
        label: `test trajectory`,
        frame_count: 1,
        read: () => encode_frame(reference_frames[0]),
        properties: new TrajectoryProperties(),
        release: kind === `synchronous` ? release : undefined,
        provenance: {},
        metadata: {},
        warnings: [],
      })
      const run =
        kind === `host`
          ? host_run(summarize_run(source), async () => reference_frames[0], release)
          : source
      const failure = new Error(`Completion observer failed`)
      run.properties.subscribe(() => {
        throw failure
      })
      expect(() => run.dispose()).toThrow(failure)
      await run.properties.done
      run.dispose()
      expect(release).toHaveBeenCalledOnce()
      await expect(
        (async () => materialize_frame_result(run.read_frame(0)))(),
      ).rejects.toThrow(/disposed/)
    },
  )

  it(`delivers nested batches before completion and snapshots queued rows`, () => {
    const properties = new TrajectoryProperties()
    properties.subscribe((batch) => {
      if (batch[0]?.frame_number !== 0) return
      const nested = [{ frame_number: 1, step: 1, properties: {} }]
      properties.push(nested)
      nested[0] = { frame_number: 99, step: 99, properties: {} }
      properties.finish()
    })
    const seen: [number[], boolean][] = []
    properties.subscribe((batch, complete) =>
      seen.push([batch.map(({ frame_number }) => frame_number), complete]),
    )
    properties.push([{ frame_number: 0, step: 0, properties: {} }])
    expect(seen).toEqual([
      [[0], false],
      [[1], false],
      [[], true],
    ])
    expect(properties.rows.map(({ frame_number }) => frame_number)).toEqual([0, 1])
  })

  it.each([
    [false, 1],
    [true, 1],
    [true, 2],
  ] as const)(
    `drains notifications after listener errors (finish: %s, errors: %s)`,
    (finish_before_throw, error_count) => {
      const properties = new TrajectoryProperties()
      const failures = Array.from(
        { length: error_count },
        (_, idx) => new Error(`listener ${idx} failed`),
      )
      for (const failure of failures) {
        const unsubscribe = properties.subscribe(() => {
          unsubscribe()
          if (finish_before_throw) properties.finish()
          throw failure
        })
      }
      const listener = vi.fn()
      properties.subscribe(listener)
      const first_batch = [{ frame_number: 0, step: 0, properties: {} }]
      const next_batch = [{ frame_number: 1, step: 1, properties: {} }]
      expect_listener_errors(() => properties.push(first_batch), failures)
      if (finish_before_throw) properties.finish()
      else properties.push(next_batch)
      expect(listener.mock.calls).toEqual([
        [first_batch, false],
        [finish_before_throw ? [] : next_batch, finish_before_throw],
      ])
    },
  )

  it.each([`push`, `finish`] as const)(
    `%s notifies later subscribers when a listener unsubscribes itself`,
    (method) => {
      const properties = new TrajectoryProperties()
      const first = vi.fn(() => unsubscribe())
      const unsubscribe = properties.subscribe(first)
      const second = vi.fn()
      properties.subscribe(second)
      const notify = () =>
        method === `push`
          ? properties.push([{ frame_number: 0, step: 0, properties: {} }])
          : properties.finish()
      notify()
      expect(second).toHaveBeenCalledTimes(1)
      notify()
      expect(first).toHaveBeenCalledTimes(1)
      expect(second).toHaveBeenCalledTimes(method === `push` ? 2 : 1)
    },
  )

  it(`keeps rows sorted and deduplicated across out-of-order batches`, () => {
    const properties = new TrajectoryProperties()
    const seen: number[][] = []
    properties.subscribe((batch) => seen.push(batch.map((row) => row.frame_number)))
    properties.push([{ frame_number: 5, step: 5, properties: {} }])
    const first_snapshot = properties.rows
    expect(properties.rows.map((row) => row.frame_number)).toEqual([5])
    properties.push([
      { frame_number: 5, step: 5, properties: { dup: 1 } },
      { frame_number: 1, step: 1, properties: {} },
    ])
    expect(properties.rows.map((row) => row.frame_number)).toEqual([1, 5])
    expect(properties.rows[1].properties).toEqual({}) // The first copy of a frame wins.
    expect(first_snapshot.map((row) => row.frame_number)).toEqual([5])
    expect(seen).toEqual([[5], [5, 1]]) // Sorting must not reorder the caller's batch.
    properties.finish()
    expect(properties.complete).toBe(true)
    expect(() => properties.push([{ frame_number: 9, step: 9, properties: {} }])).toThrow(
      /after finish/,
    )
    properties.finish() // idempotent
  })

  it.each([
    [0, 1, 2],
    [2, 1, 0],
    [0, 1, 2, 1],
  ])(`owns its initial row snapshot %j`, (...frame_numbers) => {
    const rows = frame_numbers.map((frame_number) => ({
      frame_number,
      step: frame_number,
      properties: {},
    }))
    const properties = new TrajectoryProperties(rows)
    expect(rows.map((row) => row.frame_number)).toEqual(frame_numbers)
    rows[0] = { frame_number: 99, step: 99, properties: {} }
    expect(properties.rows.map((row) => row.frame_number)).toEqual([0, 1, 2])
    const previous_snapshot = properties.rows
    properties.push([{ frame_number: 3, step: 3, properties: {} }])
    expect(previous_snapshot.map((row) => row.frame_number)).toEqual([0, 1, 2])
    expect(properties.rows.map((row) => row.frame_number)).toEqual([0, 1, 2, 3])
  })
})

describe(`trajectory_from_frames validation`, () => {
  it.each([
    [`no frames`, [] as TrajectoryFrame[], {}, /at least one frame/],
    [`bad step`, [{ ...reference_frames[0], step: NaN }], {}, /invalid step/],
    [
      `wrong mass count`,
      reference_frames.slice(0, 1),
      { atom_masses: [1, 2] },
      /atom_masses has 2/,
    ],
    [
      `signal length`,
      reference_frames.slice(0, 1),
      { signals: { dipole: { values: new Float64Array(2), sample_shape: [3], steps: [0] } } },
      /signals.dipole needs a Float64Array of 3 values/,
    ],
    [
      `signal sample shape`,
      reference_frames.slice(0, 1),
      { signals: { dipole: { values: new Float64Array(), sample_shape: [0], steps: [0] } } },
      /sample_shape must be scalar/,
    ],
  ])(`rejects %s`, (_label, frames, extras, pattern) => {
    expect(() => trajectory_from_frames(frames, extras)).toThrow(pattern)
  })

  // Issue #449: a bag of generated structures in one XYZ loads and scrubs; only the
  // displacement analyses need a constant atom count and reject it when asked
  it(`accepts frames with differing atom counts and defers the check to collect_positions`, async () => {
    const [first, second] = reference_frames
    const shrunk = { ...second, structure: { sites: second.structure.sites.slice(1) } }
    const run = trajectory_from_frames([first, shrunk])
    expect((await materialize_frame_result(run.read_frame(1))).structure.sites).toHaveLength(
      N_ATOMS - 1,
    )
    await expect(run.collect_positions?.()).rejects.toThrow(
      `Atom count changed at frame 1: expected ${N_ATOMS} atoms, got ${N_ATOMS - 1}`,
    )
  })

  it(`fills property rows from the frames and exposes extras`, () => {
    const run = trajectory_from_frames(reference_frames, {
      provenance: { filename: `x.xyz` },
      time_step: { value: 2, unit: `fs` },
      metadata: { note: 1 },
      warnings: [`w`],
    })
    expect(run.properties.complete).toBe(true)
    expect(run.properties.rows).toHaveLength(N_FRAMES)
    expect(run.properties.rows[3]).toMatchObject({ frame_number: 3, step: 30 })
    expect(run.properties.rows[3].properties.energy).toBeCloseTo(-5 * N_ATOMS - 0.003, 9)
    expect(run.time_step).toEqual({ value: 2, unit: `fs` })
    expect(run.warnings).toEqual([`w`])
    expect(run.provenance.filename).toBe(`x.xyz`)
  })
})
