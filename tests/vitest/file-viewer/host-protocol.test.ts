import { frame_from_wire, frame_to_wire } from '#lib/file-viewer/host-protocol.js'
import { open_trajectory } from '#lib/trajectory/open.js'
import type { NumericFrame } from '#lib/trajectory/frame.js'
import { describe, expect, test } from 'vite-plus/test'
import { gunzipSync } from 'node:zlib'
import { read_binary_test_file } from '../test-fixtures'

const open_fixture = async (filename: string) => {
  const bytes = read_binary_test_file(filename)
  const data = filename.endsWith(`.traj`)
    ? bytes
    : new TextDecoder().decode(
        filename.endsWith(`.gz`) ? gunzipSync(new Uint8Array(bytes)) : new Uint8Array(bytes),
      )
  return open_trajectory(data, {
    filename: filename.replace(/\.gz$/, ``),
    index_above_bytes: 0,
  })
}
const bytes_of = (frame: NumericFrame) => new Uint8Array(frame.coordinates.buffer)

describe(`host frame wire encoding`, () => {
  // Every numeric reader stores abc as the lattice's cart->frac map of xyz (XDATCAR too), so
  // frames travel without it and frame_from_wire recomputes the identical bits
  test.each([
    `ase-LiMnO2-chgnet-relax.traj`,
    `mp-1184225.extxyz`,
    `V8Ta12W71Re8-mace-omat.xyz`,
    `lammps-sample.lammpstrj.gz`,
    `vasp-XDATCAR-traj.gz`,
  ])(`%s round-trips bit for bit without abc on the wire`, async (filename) => {
    const run = await open_fixture(filename)
    for (const frame_idx of [0, run.frame_count - 1]) {
      const frame = await run.read_frame(frame_idx)
      const wire = frame_to_wire(frame)
      expect(wire.fractional).toBe(`derived`)
      const width = 6 + 3 * frame.vector_keys.length
      expect(wire.coordinates.byteLength).toBe(frame.sites.length * (width - 3) * 8)
      // structuredClone: what VS Code's postMessage does to the ArrayBuffers
      const decoded = frame_from_wire(structuredClone(wire))
      expect(bytes_of(decoded)).toEqual(bytes_of(frame))
      expect({ ...decoded, coordinates: null }).toEqual({ ...frame, coordinates: null })
    }
    run.dispose()
  })

  test(`a single differing abc bit sends the frame whole`, async () => {
    const run = await open_fixture(`mp-1184225.extxyz`)
    const frame = await run.read_frame(0)
    const coordinates = frame.coordinates.slice()
    coordinates[3] += Number.EPSILON * Math.max(1, Math.abs(coordinates[3]))
    const wire = frame_to_wire({ ...frame, coordinates })
    expect(wire.fractional).toBeUndefined()
    expect(bytes_of(frame_from_wire(wire))).toEqual(new Uint8Array(coordinates.buffer))
  })

  test(`an unknown fractional encoding is rejected`, async () => {
    const run = await open_fixture(`mp-1184225.extxyz`)
    const wire = frame_to_wire(await run.read_frame(0))
    expect(() => frame_from_wire({ ...wire, fractional: `f16` as `derived` })).toThrow(
      `Malformed host frame: unknown fractional encoding f16`,
    )
  })

  // Playback frames: xyz within half a 16-bit step per axis; vectors in 3 bytes each, their
  // direction within the octahedral code's resolution at any length (8 bits per component
  // would turn small vectors by tens of degrees) and length within half a log step
  test.each([
    [`ase-LiMnO2-chgnet-relax.traj`, 3],
    [`mp-1184225.extxyz`, 1],
    [`lammps-sample.lammpstrj.gz`, 0],
    [`V8Ta12W71Re8-mace-omat.xyz`, 0],
  ])(
    `%s display frames: 6 bytes per atom plus 3 per vector (%i)`,
    async (filename, n_vectors) => {
      const run = await open_fixture(filename)
      const frame = await run.read_frame(run.frame_count - 1)
      expect(frame.vector_keys).toHaveLength(n_vectors)
      const wire = frame_to_wire(frame, `display`)
      const n_sites = frame.sites.length
      expect(wire.coordinates.byteLength).toBe(n_sites * 3 * 2)
      expect(wire.vectors?.byteLength).toBe(n_sites * n_vectors * 3)
      const decoded = frame_from_wire(structuredClone(wire))
      expect(decoded.approximate).toBe(true)
      const width = 6 + 3 * n_vectors
      let max_ratio = 0
      let max_angle = 0
      let max_length_ratio = 0
      for (let idx = 0; idx < n_sites; idx++) {
        for (let axis = 0; axis < 3; axis++) {
          const offset = idx * width + axis
          const error = Math.abs(decoded.coordinates[offset] - frame.coordinates[offset])
          max_ratio = Math.max(max_ratio, error / (wire.quantized?.step[axis] ?? 0))
        }
        for (let vec = 0; vec < n_vectors; vec++) {
          const offset = idx * width + 6 + 3 * vec
          const source = frame.coordinates.slice(offset, offset + 3)
          const received = decoded.coordinates.slice(offset, offset + 3)
          const [source_len, received_len] = [source, received].map((v) => Math.hypot(...v))
          if (source_len === 0) {
            expect(received_len).toBe(0)
            continue
          }
          const cos = source.reduce((sum, value, axis) => sum + value * received[axis], 0)
          max_angle = Math.max(
            max_angle,
            (Math.acos(Math.min(1, cos / (source_len * received_len))) * 180) / Math.PI,
          )
          const [log_low, log_high] = wire.quantized?.vector_log_range[vec] ?? [0, 0]
          // half a log step, as a relative length error
          const half_step = Math.expm1((log_high - log_low) / 254 / 2)
          max_length_ratio = Math.max(
            max_length_ratio,
            Math.abs(received_len / source_len - 1) / Math.max(half_step, 1e-12),
          )
        }
      }
      // step = range / 65535; rounding is at most half a step (plus f64 round-off)
      expect(max_ratio).toBeLessThanOrEqual(0.5 + 1e-9)
      // actually rounded, not passed through (a high-symmetry cell's xyz can sit on the grid)
      expect(max_ratio + max_angle).toBeGreaterThan(0)
      // 8+8-bit octahedral cells span under 1.6 deg (measured max over MD forces: 1.2 deg)
      expect(max_angle).toBeLessThan(1.6)
      expect(max_length_ratio).toBeLessThanOrEqual(1 + 1e-6)
      run.dispose()
    },
  )

  test(`display vectors: zero vectors and all-zero columns stay zero`, async () => {
    const run = await open_fixture(`ase-LiMnO2-chgnet-relax.traj`)
    const frame = await run.read_frame(0)
    const coordinates = frame.coordinates.slice()
    const width = 6 + 3 * frame.vector_keys.length
    coordinates.fill(0, 6, 9) // first site's force
    const one_zero = frame_from_wire(frame_to_wire({ ...frame, coordinates }, `display`))
    expect(Array.from(one_zero.coordinates.subarray(6, 9))).toEqual([0, 0, 0])
    expect(Math.hypot(...one_zero.coordinates.slice(width + 6, width + 9))).toBeGreaterThan(0)
    for (let idx = 0; idx < frame.sites.length; idx++)
      coordinates.fill(0, idx * width + 6, idx * width + 9)
    const wire = frame_to_wire({ ...frame, coordinates }, `display`)
    expect(wire.quantized?.vector_log_range[0]).toEqual([0, 0])
    const all_zero = frame_from_wire(wire)
    for (let idx = 0; idx < frame.sites.length; idx++)
      expect(
        Array.from(all_zero.coordinates.subarray(idx * width + 6, idx * width + 9)),
      ).toEqual([0, 0, 0])
    run.dispose()
  })

  // The log scale spans at most 1e4 below the largest length, so one tiny vector can't
  // stretch every other's steps: any length stays within half a step of that span
  test(`display vector lengths stay within 1.9% of the largest beside a tiny one`, async () => {
    const run = await open_fixture(`mp-1184225.extxyz`)
    const frame = await run.read_frame(0)
    const coordinates = frame.coordinates.slice()
    // lengths 1e-14, 1 and the one furthest from a step of the scale between those two
    const lengths = [1e-14, 1, Math.exp(-Math.log(1e14) / 254 / 2), 0]
    lengths.forEach((length, idx) => coordinates.set([0, length, 0], idx * 9 + 6))
    const decoded = frame_from_wire(frame_to_wire({ ...frame, coordinates }, `display`))
    const received = lengths.map((_, idx) =>
      Math.hypot(...decoded.coordinates.subarray(idx * 9 + 6, idx * 9 + 9)),
    )
    const errors = received.map((length, idx) => Math.abs(length - lengths[idx]))
    expect(Math.max(...errors)).toBeLessThan(Math.expm1(Math.log(1e4) / 254 / 2))
    // the tiny one reads as the low end of the scale (f64 round-off of exp(log(1e-4)))
    expect(Math.abs(received[0] / 1e-4 - 1)).toBeLessThan(1e-12)
    run.dispose()
  })

  // Fixed-species runs send atomic numbers once, with the summary preview
  test.each([undefined, `display`] as const)(
    `frames with the preview's atomic numbers omit them (precision %s)`,
    async (precision) => {
      const run = await open_fixture(`mp-1184225.extxyz`)
      const frame = await run.read_frame(run.frame_count - 1)
      if (!(frame.sites instanceof Uint8Array)) throw new TypeError(`Expected numeric sites`)
      const preview_sites = frame.sites.slice()
      const wire = frame_to_wire(frame, precision, preview_sites)
      expect(wire.sites).toBe(`preview`)
      const decoded = frame_from_wire(structuredClone(wire), preview_sites)
      expect(decoded.sites).toEqual(frame.sites)
      expect(decoded.sites).not.toBe(preview_sites) // a copy, safe to transfer
      expect(() => frame_from_wire(wire)).toThrow(
        `reuses preview sites, but there is no preview`,
      )
      // other species, or another count, travel in full
      const other = preview_sites.slice()
      other[0]++
      for (const reference of [other, preview_sites.subarray(1)])
        expect(frame_to_wire(frame, precision, reference).sites).toBeInstanceOf(ArrayBuffer)
      run.dispose()
    },
  )

  test.each([
    [`a non-finite value`, { 0: Number.NaN }],
    [`a coordinate range past the largest float`, { 0: 1.7e308, 9: -1.7e308 }],
  ])(`a display frame with %s travels exact`, async (_label, values) => {
    const run = await open_fixture(`mp-1184225.extxyz`)
    const frame = await run.read_frame(0)
    const coordinates = frame.coordinates.slice()
    for (const [idx, value] of Object.entries(values)) coordinates[Number(idx)] = value
    const wire = frame_to_wire({ ...frame, coordinates }, `display`)
    expect(wire.quantized).toBeUndefined()
    const decoded = frame_from_wire(wire)
    expect(decoded.approximate).toBeUndefined()
    expect(bytes_of(decoded)).toEqual(new Uint8Array(coordinates.buffer))
  })

  test(`a quantization that doesn't match the frame's axes and vectors is rejected`, async () => {
    const run = await open_fixture(`mp-1184225.extxyz`)
    const wire = frame_to_wire(await run.read_frame(0), `display`)
    const quantized = { origin: [0], step: [1], vector_log_range: [] }
    expect(() => frame_from_wire({ ...wire, quantized })).toThrow(
      `Malformed host frame: quantization for 1 axes and 0 vectors`,
    )
    const { vectors: _vectors, ...without_vectors } = wire
    expect(() => frame_from_wire(without_vectors)).toThrow(`(undefined vector bytes)`)
  })
})
