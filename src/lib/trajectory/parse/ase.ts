import { display_idx } from '#lib/labels.js'
import { element_by_symbol } from '#lib/element/data.js'
import { element_from_atomic_number } from '#lib/element/helpers.js'
import type { ElementSymbol } from '#lib/element/types.js'
import { FS_IN_ASE_TIME } from '#lib/constants.js'
import * as math from '#lib/math.js'
import { mat3x3_from_rows } from '#lib/structure/parsers/shared.js'
import type { Pbc } from '#lib/structure/index.js'
import {
  compute_force_stats,
  checked_site_forces,
  convert_atomic_numbers,
  create_plot_row_frame,
  decode_finite_frames,
  NonFiniteFrameError,
  values_per_sample,
} from '#lib/trajectory/helpers.js'
import type { TrajectoryFrame } from '#lib/trajectory/index.js'
import { to_error } from 'svelte-widgets/utils'
import { ase_stress_metadata } from './shared'
import type { ParsedTrajectory, WarnFn } from './shared'
import { atom_range, type AtomBatch, type ReadAtoms } from '../atom-batches'
import {
  create_numeric_md_frame,
  materialize_frame,
  type NumericFrame,
  write_frame_vector,
} from '../frame'

// A frame JSON header this large can only be a corrupt offsets table pointing into payload
// bytes (a real header is a few KB)
const MAX_ASE_HEADER_BYTES = 50 * 1024 * 1024
const decoder = new TextDecoder()

export const read_ase_header = (view: DataView): { n_items: number; offsets_pos: number } => ({
  n_items: Number(view.getBigInt64(32, true)),
  offsets_pos: Number(view.getBigInt64(40, true)),
})

// Random access to a ULM container by absolute byte offset: a buffer in memory, or a file a
// host reads on demand (the VS Code extension's file_byte_source), so a multi-GB .traj never
// has to fit in memory. Each read returns exactly `length` bytes or throws.
export interface ByteSource {
  // absolute offset one past the last readable byte (the file size for a whole file)
  byte_length: number
  read: (offset: number, length: number) => DataView
  release?: () => void
}

// A buffer holding the container's bytes from absolute `base_offset` on (the whole file at 0)
export const buffer_source = (buffer: ArrayBuffer, base_offset = 0): ByteSource => ({
  byte_length: base_offset + buffer.byteLength,
  read: (offset, length) => {
    const start = offset - base_offset
    if (!Number.isInteger(start) || start < 0)
      throw new Error(
        `Invalid byte offset ${offset}${base_offset ? ` (slice starts at ${base_offset})` : ``}`,
      )
    if (start + length > buffer.byteLength)
      throw new Error(
        `Out-of-bounds read: ${length} bytes at ${offset} lie outside the ${buffer.byteLength} byte slice at ${base_offset}`,
      )
    return new DataView(buffer, start, length)
  },
})

const NDARRAY_READERS: Record<
  string,
  { bytes: number; read: (view: DataView, pos: number) => number }
> = {
  int64: { bytes: 8, read: (view, pos) => Number(view.getBigInt64(pos, true)) },
  int32: { bytes: 4, read: (view, pos) => view.getInt32(pos, true) },
  float64: { bytes: 8, read: (view, pos) => view.getFloat64(pos, true) },
  float32: { bytes: 4, read: (view, pos) => view.getFloat32(pos, true) },
}

const ndarray_rows = (ref: { ndarray: unknown[] }): number => {
  const [shape] = ref.ndarray
  if (!Array.isArray(shape) || !shape.every((size) => Number.isInteger(size) && size >= 0))
    throw new Error(`Invalid ndarray shape ${JSON.stringify(shape)}`)
  return shape[0]
}

// Decode one ULM ndarray item `[shape, dtype, absolute byte offset]`, reading only its bytes:
// with `rows`, only that row range (an atom batch of a large frame); `value` takes indices into
// the whole array either way
const ndarray_reader = (
  source: ByteSource,
  ref: { ndarray: unknown[] },
  rows?: { start: number; count: number },
) => {
  const [shape, dtype, absolute_offset] = ref.ndarray as [number[], string, number]
  const reader = NDARRAY_READERS[dtype]
  if (!reader) throw new Error(`Unsupported dtype: ${dtype}`)
  const row_values = shape.length > 1 ? shape[1] : 1
  const first = rows ? rows.start * row_values : 0
  const length = rows ? rows.count * row_values : values_per_sample(shape)
  const view = source.read(absolute_offset + first * reader.bytes, length * reader.bytes)
  return { shape, value: (idx: number) => reader.read(view, (idx - first) * reader.bytes) }
}

const read_source_ndarray = (source: ByteSource, ref: { ndarray: unknown[] }): number[][] => {
  const { shape, value } = ndarray_reader(source, ref)
  if (shape.length !== 1 && shape.length !== 2) throw new Error(`Unsupported shape`)
  const [rows, columns] = shape.length === 1 ? [1, shape[0]] : shape
  return Array.from({ length: rows }, (_unused, row_idx) => {
    // oxlint-disable-next-line unicorn/no-new-array -- Allocate each row once without another per-value callback.
    const row = new Array<number>(columns)
    for (let col_idx = 0; col_idx < columns; col_idx++)
      row[col_idx] = value(row_idx * columns + col_idx)
    return row
  })
}

// `view` starts at absolute `base_offset` in the container
export const read_ndarray_from_view = (
  view: DataView,
  ref: { ndarray: unknown[] },
  base_offset = 0,
): number[][] =>
  read_source_ndarray(
    buffer_source(view.buffer as ArrayBuffer, base_offset - view.byteOffset),
    ref,
  )

// Mass (amu) ASE divides an atom's momentum by: the one the file records, else the element's
// standard atomic mass (what ASE assigns an Atoms without masses). Shared by every reader that
// turns ASE momenta into velocities, so frames, atom batches and extXYZ agree.
export function ase_momentum_mass(
  element: ElementSymbol | undefined,
  recorded: number | undefined,
  label: string,
): number {
  const mass = recorded ?? (element && element_by_symbol.get(element)?.atomic_mass)
  if (mass === undefined || !(mass > 0 && Number.isFinite(mass)))
    throw new Error(`${label} has invalid mass ${mass} (element ${element})`)
  return mass
}

// ASE momenta are in sqrt(amu*eV), so p/m (m in amu) is in Å per ASE time unit; ase.units.fs
// converts it to Å/fs, i.e. atoms.get_velocities() * ase.units.fs
export const ase_velocity = (momentum: number, mass: number): number =>
  (momentum / mass) * FS_IN_ASE_TIME

export interface AseFrameOptions {
  // ASE writes numbers and pbc into frame 0, and into every later frame once they change, so
  // a frame without them inherits frame 0's
  fallback_numbers?: number[]
  fallback_pbc?: Pbc
  // Frame 0's recorded masses, which ASE gives every frame without its own topology header
  // (a frame with one carries its own masses, or none for standard ones)
  fallback_masses?: readonly number[]
  // Lazy alternative to the two fallbacks, called only when the frame lacks its own numbers,
  // so a frame with its own topology header never depends on (or decodes) earlier ones
  inherit?: () => { numbers?: number[]; pbc?: Pbc }
}

const read_frame_json = (source: ByteSource, frame_offset: number): string => {
  const json_length = Number(source.read(frame_offset, 8).getBigInt64(0, true))
  if (json_length > MAX_ASE_HEADER_BYTES)
    throw new Error(`frame JSON too large: ${json_length} bytes`)
  const view = source.read(frame_offset + 8, json_length)
  return decoder.decode(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
}

const SPECTROSCOPY_CALCULATOR_KEY = /dipole|polarizability|polarization|current/i
// Calculator bookkeeping ASE stores next to the results; not per-frame properties
const CALCULATOR_BOOKKEEPING_KEYS = new Set([`name`, `parameters`])

type NdarrayReader = (ref: { ndarray: unknown[] }) => number[][]
const is_ndarray_ref = (value: unknown): value is { ndarray: unknown[] } =>
  Boolean(value && typeof value === `object` && `ndarray` in value)

export const ase_calculator_data = (
  frame_data: Record<string, unknown>,
  read_ndarray: NdarrayReader,
): Record<string, unknown> => {
  const calculator = frame_data[`calculator.`] ?? frame_data.calculator
  if (!calculator || typeof calculator !== `object`) return {}
  const results: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(calculator as Record<string, unknown>)) {
    if (CALCULATOR_BOOKKEEPING_KEYS.has(key)) continue
    if (!is_ndarray_ref(value)) {
      results[key] = value
      continue
    }
    if (key === `stress.` || key === `forces.`) {
      results[key.slice(0, -1)] = read_ndarray(value)
      continue
    }
    if (!SPECTROSCOPY_CALCULATOR_KEY.test(key)) continue
    const shape = value.ndarray[0]
    if (
      !Array.isArray(shape) ||
      !shape.every((dimension) => Number.isInteger(dimension) && dimension > 0)
    ) {
      continue
    }
    if (![3, 9].includes(values_per_sample(shape))) continue
    const result_key = key.endsWith(`.`) ? key.slice(0, -1) : key
    if (result_key in results) {
      throw new Error(`ASE calculator contains duplicate result key ${result_key}`)
    }
    const array = read_ndarray(value)
    results[result_key] = shape.length === 1 ? array[0] : array
  }
  // stress in the readers' shared convention (GPa, compression positive); an explicit
  // pressure result wins over the one derived from it
  const stress = ase_stress_metadata(results.stress)
  if (stress)
    Object.assign(results, { ...stress, pressure: results.pressure ?? stress.pressure })
  return results
}

// ase.io.jsonio writes an ndarray inside `info` as `{ __ndarray__: [shape, dtype, flat values] }`,
// which no plot row or signal could read. Real arrays decode to nested arrays of their shape;
// anything else (complex data interleaves its parts) stays as is.
const NDARRAY_KEY = `__ndarray__`
const decode_ase_info = (info: unknown): Record<string, unknown> => {
  if (!info || typeof info !== `object`) return {}
  return Object.fromEntries(
    Object.entries(info).map(([key, value]: [string, unknown]) => {
      const is_ndarray = value && typeof value === `object` && NDARRAY_KEY in value
      const encoded: unknown = is_ndarray ? value[NDARRAY_KEY] : undefined
      if (!Array.isArray(encoded)) return [key, value]
      const [shape, , flat]: unknown[] = encoded
      if (
        !Array.isArray(shape) ||
        !shape.every((size) => Number.isInteger(size) && size >= 0) ||
        !Array.isArray(flat) ||
        flat.length !== values_per_sample(shape) ||
        !flat.every((entry) => typeof entry === `number`)
      )
        return [key, value]
      // rows of the trailing axis first, then each outer axis in turn
      let nested: unknown[] = flat
      for (const size of shape.slice(1).toReversed()) {
        const rows: unknown[] = []
        for (let start = 0; start < nested.length; start += size)
          rows.push(nested.slice(start, start + size))
        nested = rows
      }
      return [key, shape.length === 0 ? flat[0] : nested]
    }),
  )
}

// A frame's cell, or undefined for none: ASE stores a molecule's missing cell as all zeros
const ase_cell = (frame_data: Record<string, unknown>): math.Matrix3x3 | undefined => {
  if (!frame_data.cell) return undefined
  const cell = mat3x3_from_rows(frame_data.cell, `ASE cell`)
  return cell.every((row) => row.every((value) => value === 0)) ? undefined : cell
}

const ase_pbc = (value: unknown): Pbc => {
  if (!math.is_pbc(value))
    throw new Error(`ASE PBC must contain three booleans, got ${JSON.stringify(value)}`)
  return [...value]
}

const plot_row_numbers = new WeakMap<number[], Uint8Array>()

type AseDecodeOptions = AseFrameOptions & { warn: WarnFn }

// What every decode mode reads off a frame's header: topology, cell, calculator metadata and
// forces, with every check. Positions and momenta stay unread until a mode asks for them.
function read_ase_frame_header(
  source: ByteSource,
  frame_offset: number,
  step: number,
  { fallback_numbers, fallback_pbc, inherit, warn }: AseDecodeOptions,
) {
  const frame_data = JSON.parse(read_frame_json(source, frame_offset))
  const read_frame_ndarray = (ref: { ndarray: unknown[] }): number[][] =>
    read_source_ndarray(source, ref)
  const positions_ref: unknown = frame_data[`positions.`] ?? frame_data.positions
  // From the shape alone: a plot row must not read every frame's positions off disk
  const n_atoms = is_ndarray_ref(positions_ref)
    ? ndarray_rows(positions_ref)
    : (positions_ref as number[][] | undefined)?.length

  // ASE's reader: a frame with its own numbers carries its whole topology header (numbers and
  // pbc); one without takes frame 0's, ignoring any pbc of its own (as read_atoms does)
  const own_numbers = frame_data[`numbers.`] ?? frame_data.numbers
  const inherited = own_numbers === undefined ? inherit?.() : undefined
  const numbers_ref = own_numbers ?? fallback_numbers ?? inherited?.numbers
  const numbers: number[] = numbers_ref?.ndarray
    ? read_frame_ndarray(numbers_ref).flat()
    : (numbers_ref as number[])

  if (!numbers || n_atoms === undefined) {
    throw new Error(`missing ${!numbers ? `numbers` : `positions`}`)
  }
  if (numbers.length !== n_atoms)
    throw new Error(`ASE frame has ${n_atoms} positions for ${numbers.length} atomic numbers`)
  const pbc_value =
    own_numbers === undefined ? (fallback_pbc ?? inherited?.pbc) : frame_data.pbc
  if (pbc_value === undefined)
    throw new Error(`missing pbc (ASE writes it with the frame's atomic numbers)`)
  const pbc = ase_pbc(pbc_value)

  // Per-atom forces (eV/Å) go on the sites, only their statistics into the metadata
  const { forces: raw_forces, ...calculator } = ase_calculator_data(
    frame_data,
    read_frame_ndarray,
  )
  const forces = checked_site_forces(
    raw_forces,
    n_atoms,
    `ASE calculator forces of frame ${display_idx(step)}`,
    warn,
  )
  const metadata = {
    step,
    ...calculator,
    ...(forces && compute_force_stats(forces)),
    ...decode_ase_info(frame_data.info),
  }
  const cell = ase_cell(frame_data)
  return {
    frame_data,
    read_ndarray: read_frame_ndarray,
    positions_ref,
    n_atoms,
    own_numbers,
    numbers,
    pbc,
    forces,
    metadata,
    cell,
  }
}
// Desktop hosts read one frame's byte span off disk and decode that slice alone: `buffer`
// holds the container's bytes from absolute `base_offset` on
export const decode_ase_frame = (
  buffer: ArrayBuffer,
  frame_offset: number,
  step: number,
  { base_offset, ...options }: AseDecodeOptions & { plot_row?: boolean; base_offset?: number },
): { frame: TrajectoryFrame; numbers: number[]; pbc: Pbc } =>
  decode_ase_source_frame(buffer_source(buffer, base_offset), frame_offset, step, options)

// `plot_row: true` skips reading positions and building sites but keeps every check, the
// metadata and the lattice, so its plot row equals the full decode's
function decode_ase_source_frame(
  source: ByteSource,
  frame_offset: number,
  step: number,
  options: AseDecodeOptions & { plot_row?: boolean },
): { frame: TrajectoryFrame; numbers: number[]; pbc: Pbc } {
  const args = [source, frame_offset, step, options] as const
  if (!options.plot_row) {
    const { numeric, numbers, pbc } = decode_ase_numeric_frame(...args)
    return { frame: materialize_frame(numeric), numbers, pbc }
  }
  const { numbers, pbc, metadata, cell } = read_ase_frame_header(...args)
  // get_density counts a plot row's atoms from numeric atomic numbers, validated and counted
  // once per numbers array (frames without their own share frame 0's)
  let atomic_numbers = plot_row_numbers.get(numbers)
  if (!atomic_numbers) {
    convert_atomic_numbers(numbers)
    atomic_numbers = Uint8Array.from(numbers)
    plot_row_numbers.set(numbers, atomic_numbers)
  }
  const frame = create_plot_row_frame(atomic_numbers, cell, pbc, step, metadata, options.warn)
  return { frame, numbers, pbc }
}

// A frame as the run reads it, without Site records: positions go straight from the ndarray
// into the packed coordinates (20k atoms: 10.3 -> 2.9 ms per read). decode_ase_frame
// materializes it, so both see one frame.
function decode_ase_numeric_frame(
  source: ByteSource,
  frame_offset: number,
  step: number,
  options: AseDecodeOptions,
): { numeric: NumericFrame; numbers: number[]; pbc: Pbc } {
  const header = read_ase_frame_header(source, frame_offset, step, options)
  const { frame_data, read_ndarray, positions_ref, n_atoms, own_numbers } = header
  const { numbers, pbc, forces, metadata, cell } = header
  const elements = convert_atomic_numbers(numbers)
  const positions = new Float64Array(n_atoms * 3)
  if (is_ndarray_ref(positions_ref)) {
    const { shape, value } = ndarray_reader(source, positions_ref)
    if (shape.length !== 2 || shape[1] !== 3)
      throw new Error(`Invalid position at site 1: expected 3 finite coordinates`)
    for (let idx = 0; idx < positions.length; idx++) {
      positions[idx] = value(idx)
      if (!Number.isFinite(positions[idx]))
        throw new NonFiniteFrameError(
          `Non-finite position at site ${display_idx(Math.floor(idx / 3))}`,
        )
    }
  } else {
    ;(positions_ref as number[][]).forEach((xyz, atom_idx) => {
      if (!math.is_finite_vec3_like(xyz))
        throw new Error(
          `Invalid position at site ${display_idx(atom_idx)}: expected 3 finite coordinates`,
        )
      positions.set(xyz, atom_idx * 3)
    })
  }
  // Velocities (Å/fs) from ASE momenta, divided by the frame's masses or the standard ones
  const momenta_ref: unknown = frame_data[`momenta.`] ?? frame_data.momenta
  const momenta = is_ndarray_ref(momenta_ref)
    ? read_ndarray(momenta_ref)
    : (momenta_ref as number[][] | undefined)
  const masses_ref: unknown =
    own_numbers === undefined
      ? options.fallback_masses
      : (frame_data[`masses.`] ?? frame_data.masses)
  const masses = is_ndarray_ref(masses_ref)
    ? read_ndarray(masses_ref).flat()
    : (masses_ref as readonly number[] | undefined)
  if (
    momenta &&
    (momenta.length !== n_atoms ||
      momenta.some((momentum) => momentum.length !== 3) ||
      (masses && masses.length !== n_atoms))
  )
    throw new Error(
      `ASE frame has ${n_atoms} atoms but momenta of shape [${momenta.length}, ${momenta[0]?.length}] and ${masses?.length ?? `no`} masses`,
    )
  const velocities = momenta?.map((momentum, atom_idx) => {
    const label = `ASE atom ${display_idx(atom_idx)}`
    const mass = ase_momentum_mass(elements[atom_idx], masses?.[atom_idx], label)
    return momentum.map((component) => ase_velocity(component, mass))
  })
  // momenta also stay as `momentum` (as the extXYZ reader keeps them), so an extXYZ export
  // writes ASE's own `momenta` column back
  const vectors = [
    forces && [`force`, forces],
    velocities && [`velocity`, velocities],
    momenta && [`momentum`, momenta],
  ].filter((entry): entry is [string, number[][]] => Boolean(entry))
  const numeric = create_numeric_md_frame(
    positions,
    Uint8Array.from(numbers),
    cell,
    pbc,
    step,
    metadata,
    vectors.map(([key]) => key),
    { fixed_order: false, warn: options.warn },
  )
  for (const [column, [, values]] of vectors.entries())
    write_frame_vector(numeric, column, values.flat())
  // recorded (isotope) masses stay on the sites, so an extXYZ export writes ASE's `masses`
  // column and ASE divides the momenta by them again; standard masses stay implicit
  if (masses) numeric.scalar_columns = { mass: Float64Array.from(masses) }
  return { numeric, numbers, pbc }
}

// The ULM container of an ASE .traj, validated and indexed: frames decode on demand;
// `plot_row_frame` is decode_ase_frame's plot_row mode. `release` drops the buffer, which
// read_atoms keeps alive in its run (a text source's payload goes with the source).
export interface AseFrames {
  frame_count: number
  // The run's frame read: decode's frame as encode_frame would make it, which text formats
  // build directly instead of through Site records
  read: (frame_idx: number) => NumericFrame
  decode: (frame_idx: number) => TrajectoryFrame
  plot_row_frame: (frame_idx: number) => TrajectoryFrame
  release?: () => void
  read_atoms?: ReadAtoms
  atom_masses?: number[]
  metadata?: Record<string, unknown>
}

// `data`: the whole file, or a ByteSource reading it on demand (released with the frames)
export function open_ase_frames(data: ArrayBuffer | ByteSource, warn: WarnFn): AseFrames {
  let source: ByteSource | null = data instanceof ArrayBuffer ? buffer_source(data) : data
  const { byte_length } = source
  const header_view = byte_length < 48 ? undefined : source.read(0, 48)
  if (
    !header_view ||
    decoder.decode(new Uint8Array(header_view.buffer, header_view.byteOffset, 8)) !==
      `- of Ulm`
  ) {
    throw new Error(`Invalid ASE trajectory`)
  }
  const { n_items, offsets_pos } = read_ase_header(header_view)
  if (n_items <= 0) throw new Error(`Invalid frame count`)
  if (offsets_pos < 0 || offsets_pos + n_items * 8 > byte_length) {
    throw new Error(
      `Invalid ASE frame offsets table bounds: offsets_pos=${offsets_pos}, n_items=${n_items}, byte_length=${byte_length}`,
    )
  }
  const offsets = source.read(offsets_pos, n_items * 8)
  const live = (): ByteSource => {
    if (!source) throw new Error(`ASE trajectory buffer was released`)
    return source
  }
  const frame_offset = (frame_idx: number): number =>
    Number(offsets.getBigInt64(frame_idx * 8, true))
  const frame_error = (frame_idx: number, offset: number, error: unknown): Error =>
    new Error(
      `ASE trajectory frame ${display_idx(frame_idx)} of ${n_items} (byte offset ${offset}): ${to_error(error).message}`,
      { cause: error },
    )
  // ASE's reader rule (as read_atoms below follows): a frame without its own topology header
  // takes frame 0's. ASE's writer repeats the header in every frame once one changes, so no
  // file it writes inherits a later header. Frame 0's decode supplies it, read once.
  let initial_topology: { numbers: number[]; pbc: Pbc } | undefined
  const decode_with = <Result extends { numbers: number[]; pbc: Pbc }>(
    frame_idx: number,
    decode: (...args: Parameters<typeof decode_ase_numeric_frame>) => Result,
  ): Result => {
    const offset = frame_offset(frame_idx)
    try {
      const result = decode(live(), offset, frame_idx, {
        // frame 0 inherits from nothing (and must not recurse into its own decode)
        inherit:
          frame_idx === 0
            ? undefined
            : () => {
                if (!initial_topology) decode_frame(0, true)
                return initial_topology ?? {}
              },
        fallback_masses: atom_masses,
        warn,
      })
      if (frame_idx === 0) initial_topology ??= { numbers: result.numbers, pbc: result.pbc }
      return result
    } catch (error) {
      throw frame_error(frame_idx, offset, error)
    }
  }
  const decode_frame = (frame_idx: number, plot_row: boolean): TrajectoryFrame =>
    decode_with(frame_idx, (byte_source, offset, step, options) =>
      decode_ase_source_frame(byte_source, offset, step, { ...options, plot_row }),
    ).frame
  const frame_header = (frame_idx: number): Record<string, unknown> => {
    const offset = frame_offset(frame_idx)
    try {
      return JSON.parse(read_frame_json(live(), offset))
    } catch (error) {
      throw frame_error(frame_idx, offset, error)
    }
  }
  const initial_header = frame_header(0)
  // ASE stores numbers, masses and PBC in frame 0, repeating them only when they change.
  // Retain descriptors, not decoded frames: each analysis read copies only its atom batch.
  const array_ref = (header: Record<string, unknown>, name: string) => {
    const ref = header[`${name}.`] ?? header[name]
    if (ref === undefined) return undefined
    if (!ref || typeof ref !== `object` || !(`ndarray` in ref) || !Array.isArray(ref.ndarray))
      throw new Error(`ASE ${name} must be a numeric array`)
    return { ndarray: ref.ndarray }
  }
  const array_column = (
    header: Record<string, unknown>,
    name: string,
    width: number,
    rows?: { start: number; count: number },
  ) => {
    const ref = array_ref(header, name)
    if (!ref) return undefined
    const column = ndarray_reader(live(), ref, rows)
    if (
      column.shape.length !== (width === 1 ? 1 : 2) ||
      (width !== 1 && column.shape[1] !== width)
    )
      throw new Error(`ASE ${name} has invalid shape [${column.shape}]`)
    return column
  }
  const first_masses = array_column(initial_header, `masses`, 1)
  const atom_masses =
    first_masses &&
    Array.from({ length: first_masses.shape[0] }, (_, idx) => first_masses.value(idx))
  // An MD blow-up writes non-finite positions from its onset to the end of the run: skip those
  // trailing frames at open (keeping the first, whose read then fails), as the text readers do.
  // A frame that cannot be read here counts as finite: it fails its own read, breaking only itself.
  const finite_positions = (frame_idx: number): boolean => {
    try {
      const header = frame_header(frame_idx)
      const ref = header[`positions.`] ?? header.positions
      if (!is_ndarray_ref(ref)) return true
      const { shape, value } = ndarray_reader(live(), ref)
      for (let idx = 0; idx < values_per_sample(shape); idx++)
        if (!Number.isFinite(value(idx))) return false
    } catch {}
    return true
  }
  let frame_count = n_items
  while (frame_count > 1 && !finite_positions(frame_count - 1)) frame_count--
  if (frame_count < n_items)
    warn(
      `Skipping ASE frames ${frame_count + 1}-${n_items} of ${n_items}: non-finite positions, as after an MD blow-up`,
    )
  const read_atoms: ReadAtoms = (options, signal) => {
    signal?.throwIfAborted()
    const { frame_idx, velocity_key, energy_key, selection_key, mass_source } = options
    const offset = frame_offset(frame_idx)
    const header = frame_header(frame_idx)
    try {
      // A repeated topology header is complete; absent headers inherit frame 0 (ASE's rule).
      const topology = header[`numbers.`] || header.numbers ? header : initial_header
      // the atom count comes from the shape alone, so each column reads only the batch's rows
      const positions_ref = array_ref(header, `positions`)
      const elements_ref = array_ref(topology, `numbers`)
      const total_atoms = positions_ref ? ndarray_rows(positions_ref) : 0
      if (!elements_ref || ndarray_rows(elements_ref) !== total_atoms)
        throw new Error(`ASE positions and atomic numbers must have matching atom counts`)
      const rows = atom_range(total_atoms, options)
      const { start, count } = rows
      const column = (name: string, width: number, source_header = header) => {
        const ref = array_ref(source_header, name)
        if (ref && ndarray_rows(ref) !== total_atoms)
          throw new Error(
            `ASE ${name} has ${ndarray_rows(ref)} atoms, expected ${total_atoms}`,
          )
        return array_column(source_header, name, width, rows)
      }
      const positions = column(`positions`, 3)
      const elements = column(`numbers`, 1, topology)
      if (!positions || !elements)
        throw new Error(`ASE positions and atomic numbers must have matching atom counts`)
      if (velocity_key && velocity_key !== `velocity`)
        throw new Error(`Unknown ASE velocity property: ${velocity_key}; use velocity`)
      const momenta = velocity_key && column(`momenta`, 3)
      if (velocity_key && !momenta)
        throw new Error(
          `This ASE frame has no momenta; thermal analysis needs per-atom motion`,
        )
      const energies = energy_key && column(energy_key, 1)
      if (energy_key && !energies)
        throw new Error(
          `ASE frame has no per-atom ${energy_key}; frame totals cannot locate hotspots`,
        )
      const selection = selection_key && column(selection_key, 1)
      if (selection_key && !selection)
        throw new Error(`ASE frame has no atom selection property ${selection_key}`)
      const masses =
        (mass_source !== undefined || Boolean(momenta)) && column(`masses`, 1, topology)
      const info = header.info as Record<string, unknown> | undefined
      const time = info?.time_fs
      if (time !== undefined && (typeof time !== `number` || !Number.isFinite(time)))
        throw new Error(`ASE time_fs must be finite, got ${JSON.stringify(time)}`)
      const frame_pbc = ase_pbc(topology.pbc)
      const batch: AtomBatch = {
        positions: new Float64Array(count * 3),
        atomic_numbers: new Uint8Array(count),
        total_atoms,
        start,
        step: frame_idx,
        cell: ase_cell(header),
        origin: [0, 0, 0],
        pbc: frame_pbc,
        ...(time !== undefined && { time }),
        ...(momenta && { velocities: new Float64Array(count * 3) }),
        ...(mass_source && { masses: new Float64Array(count) }),
        ...(energies && { energies: new Float64Array(count) }),
        ...(selection && { selected: new Uint8Array(count) }),
      }
      for (let idx = 0; idx < count; idx++) {
        const atom_idx = start + idx
        const atomic_number = elements.value(atom_idx)
        const symbol = element_from_atomic_number(atomic_number)
        if (!symbol)
          throw new Error(
            `ASE atom ${display_idx(atom_idx)} has invalid atomic number ${atomic_number}`,
          )
        const label = `ASE atom ${display_idx(atom_idx)}`
        const recorded_mass =
          momenta || mass_source
            ? ase_momentum_mass(symbol, masses ? masses.value(atom_idx) : undefined, label)
            : undefined
        batch.atomic_numbers[idx] = atomic_number
        if (batch.masses && recorded_mass !== undefined)
          batch.masses[idx] =
            mass_source === `standard`
              ? ase_momentum_mass(symbol, undefined, label)
              : recorded_mass
        for (let axis = 0; axis < 3; axis++) {
          batch.positions[idx * 3 + axis] = positions.value(atom_idx * 3 + axis)
          if (batch.velocities && momenta && recorded_mass !== undefined)
            batch.velocities[idx * 3 + axis] = ase_velocity(
              momenta.value(atom_idx * 3 + axis),
              recorded_mass,
            )
        }
        if (batch.energies && energies) batch.energies[idx] = energies.value(atom_idx)
        if (batch.selected && selection) {
          const selected = selection.value(atom_idx)
          if (selected !== 0 && selected !== 1)
            throw new Error(
              `ASE selection ${selection_key} at atom ${display_idx(atom_idx)} must be 0 or 1`,
            )
          batch.selected[idx] = selected
        }
      }
      return batch
    } catch (error) {
      throw frame_error(frame_idx, offset, error)
    }
  }
  return {
    frame_count,
    read_atoms,
    atom_masses,
    metadata: {
      mass_unit: `amu`,
      ...(Boolean(initial_header[`momenta.`]) && { velocity_unit: `A/fs` }),
    },
    read: (frame_idx) => decode_with(frame_idx, decode_ase_numeric_frame).numeric,
    decode: (frame_idx) => decode_frame(frame_idx, false),
    plot_row_frame: (frame_idx) => decode_frame(frame_idx, true),
    release: () => {
      source?.release?.()
      source = null
    },
  }
}

// Every frame materialised. ASE rewrites the ULM header only after a frame is fully written,
// so every frame the offsets table points at should decode; one that does not is
// corruption, not a torn tail.
// A mid-run frame with non-finite positions is skipped with a warning, like trailing ones.
export function parse_ase_trajectory(buffer: ArrayBuffer, warn: WarnFn): ParsedTrajectory {
  const { frame_count, decode } = open_ase_frames(buffer, warn)
  const frames = decode_finite_frames(frame_count, decode, `ASE`, warn)
  return { format: `ase`, frames, metadata: {} }
}
