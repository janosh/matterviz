import { BINARY_FORMAT, series_from_binary } from '#lib/io/binary-arrays'
import { describe, expect, test } from 'vite-plus/test'

// One array entry as pymatviz sends it: the raw bytes arrive as a DataView
const arr = (values: Float64Array | Float32Array, shape = [values.length]) => ({
  dtype: values instanceof Float64Array ? `float64` : `float32`,
  shape,
  data: new DataView(values.buffer, values.byteOffset, values.byteLength),
})
const envelope = (arrays: Record<string, unknown>, fields = {}, kind = `plot-series`) => ({
  format: BINARY_FORMAT,
  kind,
  arrays,
  ...fields,
})

const [len_1, len_2] = [arr(Float64Array.of(1)), arr(Float64Array.of(1, 2))]
const square = arr(Float64Array.of(1, 2, 3, 4), [2, 2])

describe(`series_from_binary`, () => {
  test(`decodes columns to typed arrays and keeps the JSON fields`, () => {
    const [x, y] = [Float64Array.of(1, 2, 3), Float32Array.of(4, 5, 6)]
    const series = series_from_binary(
      envelope({ x: arr(x), y: arr(y) }, { label: `A`, markers: `points` }),
    )
    expect(series).toEqual({ label: `A`, markers: `points`, x, y })
    expect(series.x).toBeInstanceOf(Float64Array)
    expect(series.y).toBeInstanceOf(Float32Array)
  })

  test(`zips metadata.<key> columns into per-point metadata, non-finite as null`, () => {
    const [x, threshold, f1] = [
      Float64Array.of(1, 2),
      Float64Array.of(Infinity, 0.5),
      Float64Array.of(0.25, NaN),
    ]
    const series = series_from_binary(
      envelope({ x: arr(x), 'metadata.threshold': arr(threshold), 'metadata.f1': arr(f1) }),
    )
    expect(series).toEqual({
      x,
      metadata: [
        { threshold: null, f1: 0.25 },
        { threshold: 0.5, f1: null },
      ],
    })
  })

  test.each([
    [`2D column`, envelope({ x: square }), `'x' must be 1D, got shape [2, 2]`],
    [`mismatched lengths`, envelope({ x: len_2, y: len_1 }), `share one length, got x=2, y=1`],
    [
      `field sent as array and JSON`,
      envelope({ x: len_1 }, { x: [5] }),
      `fields x are sent both as arrays and as JSON`,
    ],
    [
      `metadata sent as columns and JSON`,
      envelope({ 'metadata.a': len_1, 'metadata.b': len_1 }, { metadata: [{}] }),
      `fields metadata are sent both as arrays and as JSON`,
    ],
    [
      `metadata column of another length`,
      envelope({ x: len_2, 'metadata.a': len_1 }),
      `share one length, got x=2, metadata.a=1`,
    ],
    [
      `another payload kind`,
      envelope({ x: len_1 }, {}, `trajectory`),
      `kind must be 'plot-series'`,
    ],
  ])(`rejects a %s`, (_name, value, message) => {
    expect(() => series_from_binary(value)).toThrow(message)
  })
})
