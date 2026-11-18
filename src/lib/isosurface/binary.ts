// VolumetricData from a `matterviz-binary-v1` envelope (kind 'volume'): one `values` array of
// shape [nx, ny, nz] in C order (z fastest), the small geometry fields as JSON beside it.
// float64 grids are used in place, float32 ones widened in one pass. Wire format:
// extensions/anywidget/readme.md
import {
  assert_shape,
  decode_binary_envelope,
  is_float_array,
  to_float64,
} from '#lib/io/binary-arrays.js'
import type { Vec3 } from '#lib/math.js'
import { type VolumetricData, volume_from_json } from './types'

export function volume_from_binary(payload: unknown): VolumetricData {
  const { arrays, fields } = decode_binary_envelope(payload, `volume`)
  const extra = Object.keys(arrays).filter((name) => name !== `values`)
  if (!arrays.values || extra.length > 0) {
    throw new TypeError(
      `Binary volume needs exactly one 'values' array, got [${Object.keys(arrays).join(`, `)}]`,
    )
  }
  const { values } = arrays
  assert_shape(values, [null, null, null], `values`)
  if (!is_float_array(values))
    throw new TypeError(
      `Binary array 'values' must be float32 or float64, got ${values.dtype}`,
    )
  if (`grid` in fields || `dims` in fields)
    throw new TypeError(`Binary volume takes its dims from the values shape, not grid/dims`)
  // The JSON coercion validates lattice/origin/periodic/units/... and computes data_range
  return volume_from_json({
    ...fields,
    values: to_float64(values),
    dims: values.shape as Vec3,
  })
}
