import { decode_binary_array, BINARY_FORMAT } from '#lib/io/binary-arrays.js'
import { volume_from_binary } from '#lib/isosurface/binary.js'
import { volume_from_json } from '#lib/isosurface/types.js'
import type { Matrix3x3 } from '#lib/math.js'
import { trajectory_from_binary } from '#lib/trajectory/binary.js'
import { trajectory_from_json } from '#lib/trajectory/open.js'
import type { NumericFrame } from '#lib/trajectory/frame.js'
import { describe, expect, test } from 'vite-plus/test'

type Typed = Float32Array | Float64Array | Int32Array | Uint8Array
// One array entry as pymatviz sends it: the raw bytes arrive as a DataView
const arr = (values: Typed, shape: number[], dtype?: string) => ({
  dtype: dtype ?? values.constructor.name.replace(`Array`, ``).toLowerCase(),
  shape,
  data: new DataView(values.buffer, values.byteOffset, values.byteLength),
})
const envelope = (kind: string, arrays: Record<string, unknown>, fields = {}) => ({
  format: BINARY_FORMAT,
  kind,
  arrays,
  ...fields,
})

// 3 frames x 2 atoms (Si, O) in a cell that grows each frame, with forces and energies
const [n_frames, n_atoms] = [3, 2]
const positions = Float64Array.from(
  { length: n_frames * n_atoms * 3 },
  (_, idx) => 0.1 * idx + 0.05,
)
const forces = Float64Array.from(positions, (value) => -2 * value)
const cells = Float64Array.from({ length: n_frames * 9 }, (_, idx) => {
  const [frame_idx, entry] = [Math.floor(idx / 9), idx % 9]
  return entry % 4 === 0 ? 4 + frame_idx : entry === 1 ? 0.3 : 0
})
const energy = Float64Array.of(-10.5, -10.25, -10.125)
const steps = Int32Array.of(0, 10, 20)
const numbers = Uint8Array.of(14, 8)
// overrides set to undefined drop that array
const traj_arrays = (overrides: Record<string, unknown> = {}) => {
  const arrays: Record<string, unknown> = {
    positions: arr(positions, [n_frames, n_atoms, 3]),
    numbers: arr(numbers, [n_atoms]),
    lattice: arr(cells, [n_frames, 3, 3]),
    steps: arr(steps, [n_frames]),
    force: arr(forces, [n_frames, n_atoms, 3]),
    energy: arr(energy, [n_frames]),
    ...overrides,
  }
  return Object.fromEntries(Object.entries(arrays).filter(([, spec]) => spec !== undefined))
}

describe(`decode_binary_array`, () => {
  test(`aligned buffers decode zero-copy, misaligned ones into an exact aligned copy`, () => {
    const values = Float64Array.of(1.5, -2, 3e300)
    const aligned = decode_binary_array(arr(values, [3]), `x`)
    expect(aligned.values.buffer).toBe(values.buffer)
    expect(aligned.values).toEqual(values)
    // the same bytes 1 byte into a buffer: Float64Array can't view them in place
    const shifted = new Uint8Array(values.byteLength + 1)
    shifted.set(new Uint8Array(values.buffer), 1)
    const spec = { dtype: `float64`, shape: [3], data: new DataView(shifted.buffer, 1, 24) }
    const copied = decode_binary_array(spec, `x`)
    expect(copied.values.buffer).not.toBe(shifted.buffer)
    expect(copied.values).toEqual(values)
    // a bare ArrayBuffer works too
    expect(decode_binary_array({ ...spec, data: values.buffer }, `x`).values).toEqual(values)
  })

  test.each([
    [{ dtype: `float16`, shape: [1], data: new ArrayBuffer(2) }, /unknown dtype "float16"/],
    [{ dtype: `int64`, shape: [1], data: new ArrayBuffer(8) }, /unknown dtype "int64"/],
    [
      { dtype: `float32`, shape: [2, 3], data: new ArrayBuffer(20) },
      /has 20 bytes but float32 shape \[2, 3\] needs 24/,
    ],
    [
      { dtype: `float32`, shape: [-1], data: new ArrayBuffer(4) },
      /shape must be a list of non-negative integers/,
    ],
    [{ dtype: `float32`, shape: [1.5], data: new ArrayBuffer(4) }, /shape must be a list/],
    [{ dtype: `float32`, shape: [1], data: [1] }, /data must be an ArrayBuffer/],
    [null, /must be an object/],
  ])(`rejects malformed array spec %#`, (spec, message) => {
    expect(() => decode_binary_array(spec, `x`)).toThrow(message)
  })
})

describe(`trajectory_from_binary`, () => {
  test(`matches the JSON path frame for frame, without per-frame Site records`, () => {
    const run = trajectory_from_binary(
      envelope(`trajectory`, traj_arrays(), { metadata: { source: `md` } }),
    )
    expect([run.frame_count, run.atom_count]).toEqual([n_frames, n_atoms])
    expect(run.metadata).toEqual({ source: `md` })
    expect(run.provenance.format).toBe(`binary`)
    // the same frames as pymatviz's JSON trait would carry them
    const json_frames = Array.from({ length: n_frames }, (_, frame_idx) => {
      const flat_cell = Array.from(cells.subarray(frame_idx * 9, frame_idx * 9 + 9))
      const cell = [0, 3, 6].map((start) => flat_cell.slice(start, start + 3)) as Matrix3x3
      const sites = [`Si`, `O`].map((element, atom_idx) => {
        const offset = (frame_idx * n_atoms + atom_idx) * 3
        return {
          species: [{ element, occu: 1 }],
          xyz: Array.from(positions.subarray(offset, offset + 3)),
          properties: { force: Array.from(forces.subarray(offset, offset + 3)) },
        }
      })
      return {
        step: steps[frame_idx],
        metadata: { energy: energy[frame_idx] },
        structure: { lattice: { matrix: cell, pbc: [true, true, true] }, sites },
      }
    })
    const json_run = trajectory_from_json({ frames: json_frames })
    for (let frame_idx = 0; frame_idx < n_frames; frame_idx++) {
      const binary = run.read_frame(frame_idx) as NumericFrame
      const json = json_run.read_frame(frame_idx) as NumericFrame
      expect(binary.header.step).toBe(steps[frame_idx])
      expect(binary.header.metadata?.energy).toBe(energy[frame_idx])
      expect(binary.vector_keys).toEqual([`force`])
      expect(json.vector_keys).toEqual([`force`])
      // xyz, fractional abc and forces column for column: bit-identical
      expect(binary.coordinates).toEqual(json.coordinates)
      expect(binary.sites).toEqual(Uint8Array.of(14, 8))
      expect(binary.structure.lattice?.matrix).toEqual(json.structure.lattice?.matrix)
    }
    // plot rows: same keys, values within 1e-12 relative (density sums masses either way)
    for (const [row_idx, row] of run.properties.rows.entries()) {
      const json_row = json_run.properties.rows[row_idx]
      expect(row.step).toBe(json_row.step)
      expect(Object.keys(row.properties).toSorted()).toEqual(
        Object.keys(json_row.properties).toSorted(),
      )
      for (const [key, value] of Object.entries(row.properties))
        expect(Math.abs(value - json_row.properties[key])).toBeLessThanOrEqual(
          1e-12 * Math.abs(value),
        )
    }
    expect(run.preview.structure.sites.map((site) => site.species[0].element)).toEqual([
      `Si`,
      `O`,
    ])
  })

  test(`float32 positions widen exactly, a shared cell and default steps apply to every frame`, async () => {
    const positions_f32 = Float32Array.from(positions)
    const cell = Float64Array.of(5, 0, 0, 0, 5, 0, 0, 0, 5)
    const arrays = {
      positions: arr(positions_f32, [n_frames, n_atoms, 3]),
      numbers: arr(Int32Array.of(1, 1), [n_atoms]),
      lattice: arr(cell, [3, 3]),
    }
    const fields = { pbc: [true, true, false], time_step: { value: 2, unit: `fs` } }
    const run = trajectory_from_binary(envelope(`trajectory`, arrays, fields))
    expect(run.properties.rows.map((row) => row.step)).toEqual([0, 1, 2])
    expect(run.properties.rows.map((row) => row.properties.volume)).toEqual([125, 125, 125])
    expect(run.time_step).toEqual({ value: 2, unit: `fs` })
    const frame = run.read_frame(2) as NumericFrame
    expect(frame.structure.lattice?.pbc).toEqual([true, true, false])
    const stream = await run.collect_positions?.()
    expect(stream?.positions).toEqual(Float64Array.from(positions_f32))
    expect(stream?.elements).toEqual([`H`, `H`])
  })

  test.each([
    [{ positions: undefined }, /needs a 'positions' array/],
    [{ numbers: undefined }, /needs a 'numbers' array/],
    [
      { positions: arr(positions, [n_frames * n_atoms, 3]) },
      /'positions' must have shape \[\*, \*, 3\], got \[6, 3\]/,
    ],
    [{ positions: arr(new Float64Array(0), [0, n_atoms, 3]) }, /at least 1 frame and 1 atom/],
    [
      {
        positions: arr(
          Float64Array.from(positions, (v, idx) => (idx === 4 ? NaN : v)),
          [n_frames, n_atoms, 3],
        ),
      },
      /'positions' has non-finite value at flat index 4/,
    ],
    [
      { positions: arr(Int32Array.from(positions), [n_frames, n_atoms, 3]) },
      /'positions' must be float32 or float64, got int32/,
    ],
    [
      { numbers: arr(Float64Array.of(14, 8), [n_atoms]) },
      /'numbers' must have an integer dtype/,
    ],
    [{ numbers: arr(Int32Array.of(14, 0), [n_atoms]) }, /invalid atomic number 0 at atom 2/],
    [
      { numbers: arr(Int32Array.of(270, 8), [n_atoms]) },
      /invalid atomic number 270 at atom 1/,
    ],
    [{ numbers: arr(Uint8Array.of(14, 8, 8), [3]) }, /'numbers' must have shape \[2\]/],
    [
      { lattice: arr(cells.subarray(0, 18), [2, 3, 3]) },
      /'lattice' must have shape \[3, 3, 3\]/,
    ],
    [{ steps: arr(steps.subarray(0, 2), [2]) }, /'steps' must have shape \[3\]/],
    [{ force: arr(forces.subarray(0, 6), [1, 2, 3]) }, /'force' must have shape \[3, 2, 3\]/],
    [
      { stress: arr(new Float64Array(9), [n_frames, 3]) },
      /'stress' must have shape \[3, 2, 3\], got \[3, 3\]/,
    ],
  ])(`rejects malformed trajectory arrays %#`, (overrides, message) => {
    const payload = envelope(`trajectory`, traj_arrays(overrides))
    expect(() => trajectory_from_binary(payload)).toThrow(message)
  })

  test.each([
    [
      { format: `matterviz-binary-v0`, kind: `trajectory`, arrays: {} },
      /format must be 'matterviz-binary-v1'/,
    ],
    [envelope(`volume`, {}), /kind must be 'trajectory', got "volume"/],
    [{ format: BINARY_FORMAT, kind: `trajectory` }, /needs an arrays map/],
    [
      envelope(`trajectory`, traj_arrays({ lattice: undefined }), { pbc: [true, true, true] }),
      /pbc needs a lattice/,
    ],
    [
      envelope(`trajectory`, traj_arrays(), { pbc: [true, 1, true] }),
      /pbc must be 3 booleans/,
    ],
    [envelope(`trajectory`, traj_arrays(), { metadata: [1] }), /metadata must be an object/],
    [
      envelope(`trajectory`, traj_arrays(), { time_step: { value: -1, unit: `fs` } }),
      /time_step needs a positive value/,
    ],
  ])(`rejects malformed envelope %#`, (payload, message) => {
    expect(() => trajectory_from_binary(payload)).toThrow(message)
  })
})

describe(`volume_from_binary`, () => {
  const geometry = {
    id: `rho`,
    lattice: [
      [4, 0, 0],
      [0, 4, 0],
      [0, 0, 4],
    ],
    origin: [0, 0, 0],
    periodic: true,
    units: `e/A^3`,
  }
  const grid = Float64Array.from({ length: 2 * 3 * 4 }, (_, idx) => Math.sin(idx) * 0.5)

  test.each([`float64`, `float32`] as const)(`%s grid matches the JSON path`, (dtype) => {
    const values = dtype === `float64` ? grid : Float32Array.from(grid)
    const volume = volume_from_binary(
      envelope(`volume`, { values: arr(values, [2, 3, 4]) }, geometry),
    )
    const json = volume_from_json({ ...geometry, values: Array.from(values), dims: [2, 3, 4] })
    expect(volume).toEqual(json)
    expect(volume.dims).toEqual([2, 3, 4])
    expect(volume.values instanceof Float64Array).toBe(true)
    // float64 is used in place, float32 widened once
    expect(volume.values.buffer === grid.buffer).toBe(dtype === `float64`)
  })

  test.each([
    [
      { values: arr(grid, [2, 3, 4]), extra: arr(grid, [24]) },
      {},
      /exactly one 'values' array, got \[values, extra\]/,
    ],
    [{}, {}, /exactly one 'values' array, got \[\]/],
    [
      { values: arr(grid, [6, 4]) },
      {},
      /'values' must have shape \[\*, \*, \*\], got \[6, 4\]/,
    ],
    [
      { values: arr(Int32Array.from(grid), [2, 3, 4]) },
      {},
      /must be float32 or float64, got int32/,
    ],
    [{ values: arr(grid, [2, 3, 4]) }, { dims: [2, 3, 4] }, /dims from the values shape/],
    [
      { values: arr(grid, [2, 3, 4]) },
      {
        lattice: [
          [1, 0],
          [0, 1],
        ],
      },
      /needs a 3x3 lattice/,
    ],
  ])(`rejects malformed volume %#`, (arrays, fields, message) => {
    expect(() =>
      volume_from_binary(envelope(`volume`, arrays, { ...geometry, ...fields })),
    ).toThrow(message)
  })
})
