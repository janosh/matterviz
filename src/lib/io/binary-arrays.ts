// Decoding of the `matterviz-binary-v1` wire format: a small JSON envelope whose `arrays`
// entries each carry { dtype, shape, data } with `data` a raw little-endian buffer (what
// anywidget hands over for a traitlets Bytes value or a buffer nested in a Dict trait: a
// DataView). Arrays decode into typed-array views over that buffer when its offset is aligned
// to the element size, else into one aligned copy. Every mismatch throws: no JSON fallback.

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
export type BinaryTypedArray = InstanceType<(typeof DTYPES)[BinaryDtype]>
export type BinaryBuffer = ArrayBuffer | ArrayBufferView

export interface BinaryArray {
  values: BinaryTypedArray
  dtype: BinaryDtype
  shape: number[]
}

export interface BinaryEnvelope {
  format: typeof BINARY_FORMAT
  kind: string
  arrays: Record<string, BinaryArray>
  // remaining JSON fields of the envelope (pbc, metadata, lattice, ...)
  fields: Record<string, unknown>
}

const is_record = (value: unknown): value is Record<string, unknown> =>
  typeof value === `object` && value !== null && !Array.isArray(value)

// Envelopes are recognised by their format tag alone, so a JSON payload never reaches the
// binary decoder and a broken binary one never falls through to the JSON parser
export const is_binary_envelope = (value: unknown): boolean =>
  is_record(value) && value.format === BINARY_FORMAT

// The platform byte order: typed-array views read native order and the format is little-endian
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1

export function decode_binary_array(spec: unknown, name: string): BinaryArray {
  if (!is_record(spec)) throw new TypeError(`Binary array '${name}' must be an object`)
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
  if (!LITTLE_ENDIAN && Type.BYTES_PER_ELEMENT > 1) {
    throw new Error(`matterviz binary arrays are little-endian; this platform is big-endian`)
  }
  // Zero-copy view when aligned, else one copy into a fresh (aligned) buffer
  const aligned = bytes.byteOffset % Type.BYTES_PER_ELEMENT === 0
  const source = aligned ? bytes : bytes.slice()
  // SharedArrayBuffer-backed views work the same; the constructors' types only name ArrayBuffer
  const values = new Type(source.buffer as ArrayBuffer, source.byteOffset, length)
  return { values, dtype: dtype as BinaryDtype, shape: [...shape] }
}

// Validate the envelope and decode every array of it
export function decode_binary_envelope(value: unknown, kind: string): BinaryEnvelope {
  if (!is_record(value)) throw new TypeError(`Binary ${kind} payload must be an object`)
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
  if (!is_record(value.arrays))
    throw new TypeError(`Binary ${kind} payload needs an arrays map`)
  const arrays = Object.fromEntries(
    Object.entries(value.arrays).map(([name, spec]) => [
      name,
      decode_binary_array(spec, name),
    ]),
  )
  const { format: _format, kind: _kind, arrays: _arrays, ...fields } = value
  return { format: BINARY_FORMAT, kind, arrays, fields }
}

export const is_float_array = (array: BinaryArray): boolean =>
  array.dtype === `float32` || array.dtype === `float64`

// Float64 values of an array: the decoded view itself for float64 (zero-copy), else one
// widening copy (float32 positions/grids, integer steps)
export const to_float64 = ({ values }: BinaryArray): Float64Array =>
  values instanceof Float64Array ? values : Float64Array.from(values)

// Throws naming the array unless its shape equals `expected` (null entries match any size)
export function assert_shape(
  array: BinaryArray,
  expected: readonly (number | null)[],
  name: string,
): void {
  const { shape } = array
  const matches =
    shape.length === expected.length &&
    expected.every((size, idx) => size === null || size === shape[idx])
  if (!matches) {
    const want = expected.map((size) => size ?? `*`).join(`, `)
    throw new RangeError(
      `Binary array '${name}' must have shape [${want}], got [${shape.join(`, `)}]`,
    )
  }
}

// Index of the first non-finite value, else -1 (indexed loop: runs over millions of values)
export function first_non_finite(values: ArrayLike<number>): number {
  for (let idx = 0; idx < values.length; idx++) {
    if (!Number.isFinite(values[idx])) return idx
  }
  return -1
}
