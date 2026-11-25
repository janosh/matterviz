import {
  frame_from_wire,
  frame_to_wire,
  type WireFrame,
} from '#lib/file-viewer/host-protocol.js'
import type { Matrix3x3 } from '#lib/math.js'
import { cart_to_frac_with_fallback } from '#lib/structure/parsers/shared.js'
import { create_numeric_md_frame, wrap_frame_coordinates } from '#lib/trajectory/frame.js'
import { describe, expect, test } from 'vite-plus/test'

const cell: Matrix3x3 = [
  [3, 0, 0],
  [1, 4, 0],
  [0.5, -0.5, 5],
]
const positions = [Math.PI, -0.123456789012345, 0.25, 6.1, 0.2, 0.3, 0.5, 0.6, 0.7]
const make_frame = (matrix?: Matrix3x3, vectors: string[] = []) =>
  create_numeric_md_frame(
    positions,
    new Uint8Array([1, 6, 8]),
    matrix,
    matrix ? [true, false, true] : undefined,
    4,
    { energy: -1.23456789012345 },
    vectors,
  )

describe(`display frame transport`, () => {
  test.each([
    undefined,
    cell,
    [
      [4, 0, 0],
      [0.5, 3, 0],
      [-0.2, 0.3, 6],
    ] as Matrix3x3,
    [
      [4, 0, 0],
      [0.5, 3, 0],
      [0, 0, 0],
    ] as Matrix3x3,
  ])(`round-trips xyz-only display positions for cell %j`, (matrix) => {
    const frame = make_frame(matrix)
    frame.scalar_columns = { charge: new Float64Array([Math.PI, 0.1, 0.2]) }
    const original = frame.coordinates.slice()
    const wrapped = wrap_frame_coordinates(frame)
    const wire = frame_to_wire(frame, true)
    expect(wire.coordinate_encoding).toBe(`xyz-f32`)
    expect(wire.coordinates.byteLength).toBe(3 * 12)
    const decoded = frame_from_wire(structuredClone(wire))
    expect(decoded.wrapped).toBe(true)
    expect(decoded.structure).toEqual(frame.structure)
    expect(decoded.header).toEqual(frame.header)
    expect(decoded.topology).toEqual(frame.topology)
    expect(decoded.sites).toEqual(frame.sites)
    expect(decoded.scalar_columns).toEqual(frame.scalar_columns)
    for (let idx = 0; idx < 3; idx++) {
      const offset = idx * 6
      const xyz = Array.from(wrapped.coordinates.slice(offset, offset + 3), Math.fround)
      expect(Array.from(decoded.coordinates.slice(offset, offset + 3))).toEqual(xyz)
      const abc = matrix
        ? cart_to_frac_with_fallback(matrix).convert(xyz as [number, number, number])
        : [0, 0, 0]
      expect(Array.from(decoded.coordinates.slice(offset + 3, offset + 6))).toEqual(abc)
    }
    expect(frame.coordinates).toEqual(original)
    expect(frame_from_wire(frame_to_wire(frame))).toEqual(frame)
  })

  test(`wraps before quantization and never wraps the rounded upper boundary again`, () => {
    const frame = create_numeric_md_frame(
      [1 - 1e-8, -1e-8, 1 + 1e-8],
      new Uint8Array([14]),
      [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      [true, true, true],
      0,
      {},
      [],
    )
    const decoded = frame_from_wire(frame_to_wire(frame, true))
    expect(Array.from(decoded.coordinates.slice(0, 2))).toEqual([1, 1])
    expect(decoded.coordinates[2]).toBeGreaterThan(0)
    expect(decoded.coordinates[2]).toBeLessThan(2e-8)
    expect(wrap_frame_coordinates(decoded)).toBe(decoded)
    expect(frame_from_wire(frame_to_wire(frame)).coordinates).toEqual(frame.coordinates)
    expect(frame.wrapped).toBeUndefined()
  })

  test(`keeps vector channels exact and preserves custom site metadata`, () => {
    const frame = make_frame(cell, [`custom-vector`])
    frame.coordinates.set([Math.PI, 1e-100, -1.234567890123456], 6)
    expect(frame_to_wire(frame, true)).toEqual(frame_to_wire(frame))
    expect(frame_from_wire(frame_to_wire(frame, true))).toEqual(frame)
    const custom = {
      ...make_frame(),
      sites: [1, 6, 8].map(() => ({
        species: [{ element: `H` as const, occu: 1 }],
        label: `custom`,
        properties: { nested: { value: Math.PI } },
      })),
    }
    expect(frame_from_wire(frame_to_wire(custom, true)).sites).toEqual(custom.sites)
  })

  test(`falls back to float64 for coordinates outside float32 range`, () => {
    const frame = make_frame()
    frame.coordinates[0] = 1e100
    const wire = frame_to_wire(frame, true)
    expect(wire.coordinate_encoding).toBeUndefined()
    expect(frame_from_wire(wire).coordinates).toEqual(frame.coordinates)
  })

  test.each([
    { coordinates: new ArrayBuffer(35) },
    { vector_keys: [`force`] },
    { wrapped: undefined },
    { coordinate_encoding: `unknown` },
    { scalar_columns: { charge: new ArrayBuffer(8) } },
  ])(`rejects malformed compact frames: %j`, (changes) => {
    const wire = { ...frame_to_wire(make_frame(), true), ...changes } as WireFrame
    expect(() => frame_from_wire(wire)).toThrow(`Malformed host frame`)
  })
})
