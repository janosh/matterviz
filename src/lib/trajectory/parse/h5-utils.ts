// Shared h5wasm plumbing for HDF5 trajectory parsers: type guards plus the
// write-to-in-memory-FS/open/cleanup lifecycle both torch-sim and vaspout
// parsing need (the FS write is the expensive part, so parsers share one open
// file handle instead of re-opening per format probe).
import { is_elem_symbol } from '$lib/element/helpers'
import type { ElementSymbol } from '$lib/element/types'
import type { Matrix3x3 } from '$lib/math'
import type { Dataset, Entity, Group } from 'h5wasm'
import * as h5wasm from 'h5wasm'

export const is_hdf5_dataset = (entity: Entity | null): entity is Dataset =>
  entity !== null && `to_array` in entity && entity instanceof h5wasm.Dataset

export const is_hdf5_group = (entity: Entity | null): entity is Group =>
  entity !== null && `keys` in entity && entity instanceof h5wasm.Group

// Datasets in interrupted files can be torn mid-chunk, making to_array throw —
// treat unreadable datasets like missing ones so callers keep what parsed so far.
export const read_dataset = (h5_file: h5wasm.File, path: string): unknown => {
  try {
    const entity = h5_file.get(path)
    return is_hdf5_dataset(entity) ? entity.to_array() : null
  } catch {
    return null
  }
}

// h5wasm returns JS strings for variable-length UTF-8 but may hand back byte
// arrays for fixed-length string datasets (like VASP's |S2 ion_types).
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

// Integer datasets (like int64 number_ion_types) can surface as BigInt
// values or typed arrays depending on dtype; normalize to plain numbers.
export const to_number_array = (data: unknown): number[] | null => {
  const values: unknown[] | null = Array.isArray(data)
    ? data
    : ArrayBuffer.isView(data)
      ? Array.from(data as unknown as ArrayLike<unknown>)
      : null
  if (!values) return null
  const numbers = values.map((item) => (typeof item === `bigint` ? Number(item) : item))
  return numbers.every(
    (item): item is number => typeof item === `number` && Number.isFinite(item),
  )
    ? numbers
    : null
}

// Scalar datasets surface as plain numbers, 1-element arrays, or BigInt
// depending on dtype; normalize to a finite number or null.
export const to_scalar_number = (data: unknown): number | null => {
  const value = Array.isArray(data) ? data[0] : data
  if (typeof value === `bigint`) return Number(value)
  return typeof value === `number` && Number.isFinite(value) ? value : null
}

// Apply VASP's POSCAR-style universal scaling factor to lattice vectors
export const scale_matrix = (matrix: Matrix3x3, scale: number): Matrix3x3 =>
  scale === 1 ? matrix : (matrix.map((row) => row.map((val) => val * scale)) as Matrix3x3)

// Expand VASP's (ion_types, number_ion_types) pair into per-atom symbols,
// e.g. ([Ga, Sb], [1, 1]) -> [Ga, Sb]. Throws on unknown symbols.
export const expand_ion_types = (
  ion_types: string[],
  ion_counts: number[],
): ElementSymbol[] => {
  const elements: ElementSymbol[] = []
  for (const [type_idx, symbol] of ion_types.entries()) {
    if (!is_elem_symbol(symbol)) {
      throw new Error(`Unknown element symbol in ion_types: ${symbol}`)
    }
    for (let count = 0; count < ion_counts[type_idx]; count++) elements.push(symbol)
  }
  return elements
}

// Writes the buffer to h5wasm's in-memory FS under a unique temp name, opens
// it, runs the callback (awaiting async ones so cleanup can't race reads),
// and always closes + unlinks afterwards.
export async function with_h5_file<T>(
  buffer: ArrayBuffer,
  filename: string | undefined,
  callback: (h5_file: h5wasm.File) => T | Promise<T>,
): Promise<T> {
  const { FS } = await h5wasm.ready
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
    h5_file = new h5wasm.File(temp_filename, `r`)
    return await callback(h5_file)
  } finally {
    h5_file?.close()
    try {
      FS.unlink(temp_filename)
    } catch {
      /* temp file cleanup is best-effort */
    }
  }
}
