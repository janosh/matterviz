// VolumetricData from a `matterviz-binary-v1` envelope (kind 'volume'): one `values` array of
// shape [nx, ny, nz] in C order (z fastest), the small geometry fields as JSON beside it.
// float64 grids are used in place (the volume borrows the buffer, which must then stay
// unmodified, or data_range goes stale), float32 ones widened in one pass by volume_from_json.
// Wire format: extensions/anywidget/readme.md
import { checked_array, decode_binary_envelope } from '#lib/io/binary-arrays'
import { type VolumetricData, volume_from_json } from './types'

export function volume_from_binary(payload: unknown): VolumetricData {
  const { arrays, fields } = decode_binary_envelope(payload, `volume`)
  const names = Object.keys(arrays)
  if (names.length !== 1 || names[0] !== `values`) {
    throw new TypeError(
      `Binary volume needs exactly one 'values' array, got [${names.join(`, `)}]`,
    )
  }
  const { values, shape } = checked_array(arrays.values, `values`, [null, null, null], `float`)
  if (`grid` in fields || `dims` in fields)
    throw new TypeError(`Binary volume takes its dims from the values shape, not grid/dims`)
  // The JSON coercion validates lattice/origin/periodic/units/... and computes data_range
  return volume_from_json({ ...fields, values, dims: shape })
}
