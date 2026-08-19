import { is_elem_symbol } from '$lib/element/helpers'
import type { ElementSymbol } from '$lib/element/types'
import type { Matrix3x3 } from '$lib/math'
import type { Dataset, Entity, Group } from 'h5wasm'
import type * as h5wasm from 'h5wasm'

export const is_hdf5_dataset = (entity: Entity | null): entity is Dataset =>
  entity !== null && `to_array` in entity

export const is_hdf5_group = (entity: Entity | null): entity is Group =>
  entity !== null && `keys` in entity

export class Hdf5TrajectoryGroupSelectionError extends Error {
  constructor(
    readonly group_paths: string[],
    message = `Ambiguous HDF5 trajectory: positions and atomic numbers occur together in ${group_paths.join(`, `)}`,
  ) {
    super(message)
    this.name = 'Hdf5TrajectoryGroupSelectionError'
  }
}

export const attribute_value = (entity: Dataset | Group, names: string[]): unknown => {
  for (const name of names) {
    const attribute = entity.attrs[name]
    if (attribute) return attribute.to_array()
  }
  return undefined
}

export const string_value = (value: unknown): string | undefined => {
  if (typeof value === `string`) return value.trim() || undefined
  if (value instanceof Uint8Array) return new TextDecoder().decode(value).trim() || undefined
  if (Array.isArray(value) && value.length === 1) return string_value(value[0])
  return undefined
}

export const read_dataset = (h5_file: h5wasm.File, path: string): unknown => {
  try {
    const entity = h5_file.get(path)
    return is_hdf5_dataset(entity) ? entity.to_array() : null
  } catch {
    return null
  }
}

export const to_string_array = (data: unknown): string[] | null => {
  if (!Array.isArray(data)) return null
  const decoder = new TextDecoder()
  const strings: string[] = []
  for (const item of data) {
    if (typeof item === `string`) strings.push(item.trim())
    else if (item instanceof Uint8Array) strings.push(decoder.decode(item).trim())
    else return null
  }
  return strings
}

const to_finite_number = (value: unknown): number | null => {
  const number = typeof value === `bigint` ? Number(value) : value
  const valid_bigint =
    typeof value !== `bigint` || (typeof number === `number` && Number.isSafeInteger(number))
  return typeof number === `number` && Number.isFinite(number) && valid_bigint ? number : null
}

export const to_number_array = (data: unknown): number[] | null => {
  const values: unknown[] | null = Array.isArray(data)
    ? data
    : ArrayBuffer.isView(data)
      ? Array.from(data as unknown as ArrayLike<unknown>)
      : null
  if (!values) return null
  const numbers = values.map(to_finite_number)
  return numbers.every((item): item is number => item !== null) ? numbers : null
}

export const to_scalar_number = (data: unknown): number | null => {
  if (Array.isArray(data) && data.length !== 1) return null
  return to_finite_number(Array.isArray(data) ? data[0] : data)
}

export const scale_matrix = (matrix: Matrix3x3, scale: number): Matrix3x3 =>
  scale === 1 ? matrix : (matrix.map((row) => row.map((val) => val * scale)) as Matrix3x3)

export const expand_ion_types = (
  ion_types: string[],
  ion_counts: number[],
): ElementSymbol[] => {
  if (ion_types.length !== ion_counts.length) {
    throw new Error(
      `ion_types (${ion_types.length}) and ion_counts (${ion_counts.length}) length mismatch`,
    )
  }
  const elements: ElementSymbol[] = []
  for (const [type_idx, symbol] of ion_types.entries()) {
    if (!is_elem_symbol(symbol)) {
      throw new Error(`Unknown element symbol in ion_types: ${symbol}`)
    }
    const ion_count = ion_counts[type_idx]
    if (!Number.isFinite(ion_count) || !Number.isInteger(ion_count) || ion_count < 0) {
      throw new Error(`Invalid ion count for ${symbol}: ${ion_count}`)
    }
    for (let count = 0; count < ion_count; count++) elements.push(symbol)
  }
  return elements
}

export async function with_h5_file<T>(
  buffer: ArrayBuffer,
  filename: string | undefined,
  callback: (h5_file: h5wasm.File) => T | Promise<T>,
): Promise<T> {
  const h5 = await import(`h5wasm`)
  const { FS } = await h5.ready
  const file_basename =
    filename
      ?.split(`/`)
      .at(-1)
      ?.replaceAll(/[^\w.-]/g, `_`) ?? `temp`
  const unique_suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const temp_filename = `${file_basename}-${unique_suffix}.h5`

  FS.writeFile(temp_filename, new Uint8Array(buffer))
  let h5_file: h5wasm.File | null = null
  try {
    h5_file = new h5.File(temp_filename, `r`)
    return await callback(h5_file)
  } finally {
    h5_file?.close()
    try {
      FS.unlink(temp_filename)
    } catch {}
  }
}
