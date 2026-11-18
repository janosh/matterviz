// Decoding of the `matterviz-binary-v1` wire format (extensions/anywidget/readme.md): a JSON
// envelope whose `arrays` entries carry { dtype, shape, data } with `data` a raw little-endian
// buffer (anywidget hands over a DataView). Every mismatch throws: no JSON fallback.

import { is_plain_object } from 'svelte-widgets/utils'

export const BINARY_FORMAT = `matterviz-binary-v1`

const DTYPES = {
  float32: Float32Array,
  float64: Float64Array,
  int8: Int8Array,
  int16: Int16Array,
  int32: Int32Array,
  uint8: Uint8Array,
  uint16: Uint16Array,
  uint32: Uint32Array,
} as const
export type BinaryDtype = keyof typeof DTYPES

export interface BinaryArray {
  values: InstanceType<(typeof DTYPES)[BinaryDtype]>
  dtype: BinaryDtype
  shape: number[]
}

// Envelopes are recognised by their format tag alone, so a JSON payload never reaches the
// binary decoder and a broken binary one never falls through to the JSON parser
export const is_binary_envelope = (value: unknown): boolean =>
  is_plain_object(value) && value.format === BINARY_FORMAT

export function decode_binary_array(spec: unknown, name: string): BinaryArray {
  if (!is_plain_object(spec)) throw new TypeError(`Binary array '${name}' must be an object`)
  const { dtype, shape, data } = spec
  if (typeof dtype !== `string` || !Object.hasOwn(DTYPES, dtype)) {
    throw new TypeError(
      `Binary array '${name}' has unknown dtype ${JSON.stringify(dtype)}, expected one of ${Object.keys(DTYPES).join(`, `)}`,
    )
  }
  if (
    !Array.isArray(shape) ||
    !shape.every((size) => Number.isSafeInteger(size) && size >= 0)
  ) {
    throw new TypeError(
      `Binary array '${name}' shape must be a list of non-negative integers, got ${JSON.stringify(shape)}`,
    )
  }
  let bytes: Uint8Array
  if (data instanceof ArrayBuffer) bytes = new Uint8Array(data)
  else if (ArrayBuffer.isView(data))
    bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  else
    throw new TypeError(
      `Binary array '${name}' data must be an ArrayBuffer, DataView or typed array, got ${typeof data}`,
    )
  const Type = DTYPES[dtype as BinaryDtype]
  const length = shape.reduce((product: number, size: number) => product * size, 1)
  const expected_bytes = length * Type.BYTES_PER_ELEMENT
  if (bytes.byteLength !== expected_bytes) {
    throw new RangeError(
      `Binary array '${name}' has ${bytes.byteLength} bytes but ${dtype} shape [${shape.join(`, `)}] needs ${expected_bytes}`,
    )
  }
  // Zero-copy view when aligned, else one copy into a fresh (aligned) buffer. Typed arrays read
  // native byte order, which is little-endian on every platform browsers ship for
  const source = bytes.byteOffset % Type.BYTES_PER_ELEMENT === 0 ? bytes : bytes.slice()
  // SharedArrayBuffer-backed views work the same; the constructors' types only name ArrayBuffer
  const values = new Type(source.buffer as ArrayBuffer, source.byteOffset, length)
  return { values, dtype: dtype as BinaryDtype, shape: [...shape] }
}

// Validate the envelope and decode every array of it. `fields` are the remaining JSON fields
// (pbc, metadata, lattice, ...)
export function decode_binary_envelope(
  value: unknown,
  kind: string,
): { arrays: Record<string, BinaryArray>; fields: Record<string, unknown> } {
  if (!is_plain_object(value)) throw new TypeError(`Binary ${kind} payload must be an object`)
  if (value.format !== BINARY_FORMAT) {
    throw new TypeError(
      `Binary ${kind} payload format must be '${BINARY_FORMAT}', got ${JSON.stringify(value.format)}`,
    )
  }
  if (value.kind !== kind) {
    throw new TypeError(
      `Binary payload kind must be '${kind}', got ${JSON.stringify(value.kind)}`,
    )
  }
  if (!is_plain_object(value.arrays))
    throw new TypeError(`Binary ${kind} payload needs an arrays map`)
  const { format: _format, kind: _kind, arrays, ...fields } = value
  const decoded = Object.entries(arrays).map(([name, spec]) => [
    name,
    decode_binary_array(spec, name),
  ])
  return { arrays: Object.fromEntries(decoded), fields }
}

// The array, after checking it exists, its shape equals `shape` (null entries match any size)
// and its dtype is of the `dtype` class when given
export function checked_array(
  array: BinaryArray | undefined,
  name: string,
  shape: readonly (number | null)[],
  dtype?: `float` | `integer`,
): BinaryArray {
  if (!array) throw new TypeError(`Binary payload needs a '${name}' array`)
  const shape_ok =
    array.shape.length === shape.length &&
    shape.every((size, idx) => size === null || size === array.shape[idx])
  if (!shape_ok) {
    const want = shape.map((size) => size ?? `*`).join(`, `)
    throw new RangeError(
      `Binary array '${name}' must have shape [${want}], got [${array.shape.join(`, `)}]`,
    )
  }
  if (dtype && array.dtype.startsWith(`float`) !== (dtype === `float`)) {
    throw new TypeError(`Binary array '${name}' dtype must be ${dtype}, got ${array.dtype}`)
  }
  return array
}
