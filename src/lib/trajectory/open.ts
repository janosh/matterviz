// The one way to turn bytes into a TrajectoryRun. Format detection stays direct (no plugin
// registry); large text files and all ASE files are indexed lazily instead of materialised.
// Text arrives as a string or as bytes; bytes past the JS string limit decode into line-aligned
// chunks (TextLines), so such a file still opens as XYZ, LAMMPS or XDATCAR.
// Decompression and HDF5 group choice belong to the caller (the file viewer): an ambiguous
// HDF5 file throws Hdf5GroupSelectionRequiredError.
import { HDF5_EXT_REGEX } from '$lib/constants'
import { decode_text_chunks, MAX_STRING_CHARS } from '$lib/io/decompress'
import { is_binary } from '$lib/io/is-binary'
import { DEFAULTS } from '$lib/settings'
import { is_plain_object, to_error } from '$lib/utils'
import type { AnyStructure } from '$lib/structure/index'
import { is_structure_like, parse_xyz, structure_from_json } from '$lib/structure/parse'
import { FORMAT_PATTERNS, xyz_ext_hint } from './format-detect'
import { count_xyz_frames, has_multiple_xyz_frames, TextLines } from './helpers'
import type {
  AtomTypeMapping,
  ParseProgress,
  TrajectoryFrame,
  TrajectorySource,
} from './index'
import { open_hdf5_trajectory } from './parse/hdf5'
import { parse_lammps_trajectory } from './parse/lammps'
import { parse_vasp_outcar } from './parse/outcar'
import { parse_pymatgen_trajectory } from './parse/pymatgen'
import type { ParsedTrajectory, WarningCollector } from './parse/shared'
import { create_warning_collector } from './parse/shared'
import { parse_vasp_xdatcar } from './parse/vasp'
import { parse_vasprun_xml } from './parse/vasprun'
import { parse_xyz_trajectory } from './parse/xyz'
import type { TrajectoryProvenance, TrajectoryRun } from './run'
import { hdf5_run } from './runs/hdf5'
import { indexed_text_run } from './runs/indexed-text'
import { trajectory_from_frames } from './runs/memory'

export { Hdf5GroupSelectionRequiredError } from './parse/h5-utils'
export { VaspoutElectronicOnlyError } from './parse/vaspout-h5'
export { trajectory_from_frame_source, trajectory_from_frames } from './runs/memory'

export interface OpenTrajectoryOptions {
  filename?: string
  signal?: AbortSignal
  on_progress?: (progress: ParseProgress) => void
  hdf5_group_path?: string
  // Map LAMMPS atom types to element symbols, e.g. { 1: 'Na', 2: 'Cl' }
  atom_type_mapping?: AtomTypeMapping
  // Index (decode on demand) XYZ, XDATCAR and LAMMPS payloads above this many bytes instead
  // of parsing every frame up front. Defaults to DEFAULTS.trajectory.index_above_bytes.
  index_above_bytes?: number
}

// Bytes of a text payload the VASP/LAMMPS/single-XYZ detectors look at. A single frame of 30k
// atoms is ~1.5 MB, so this must hold one whole frame to recognise a lone XYZ structure.
const SNIFF_BYTES = 8 * 1024 * 1024

// UTF-8 size of a payload without encoding it: a 400 MB string would otherwise be copied
// into a throwaway Uint8Array just to compare against the threshold. Every UTF-16 unit is
// 1-3 UTF-8 bytes, so only the 1x-3x band needs the exact count.
export const source_byte_size = (data: TrajectorySource, threshold = Infinity): number => {
  if (data instanceof Blob) return data.size
  if (data instanceof ArrayBuffer) return data.byteLength
  if (data.length > threshold || data.length * 3 <= threshold) return data.length
  return new TextEncoder().encode(data).byteLength
}

const run_from_parsed = (
  parsed: ParsedTrajectory,
  provenance: TrajectoryProvenance,
  collector: WarningCollector,
): TrajectoryRun =>
  trajectory_from_frames(parsed.frames, {
    provenance: { ...provenance, format: parsed.format },
    metadata: parsed.metadata,
    time_step: parsed.time_step,
    atom_masses: parsed.atom_masses,
    signals: parsed.signals,
    properties: parsed.properties,
    warnings: collector.warnings,
  })

// A JSON frame's structure as a real AnyStructure: pymatgen's default verbosity writes
// matrix + pbc and no scalar lattice params, older dumps no pbc at all, so the lattice is
// rebuilt from its matrix. Coordinates stay as written, like every other reader's frames.
const frame_structure = (structure: unknown, label: string | number): AnyStructure => {
  if (!is_structure_like(structure)) {
    const context = typeof label === `number` ? `trajectory frame ${label}` : label
    throw new Error(
      `Invalid structure in ${context}: expected non-empty 'sites' array with species and coordinates`,
    )
  }
  return structure_from_json(structure, { wrap: false })
}

const parse_json_value = (value: unknown, collector: WarningCollector): ParsedTrajectory => {
  if (Array.isArray(value)) {
    const frames = value.map((frame_data, idx) => {
      const frame_obj = frame_data as Record<string, unknown>
      const frame_step = frame_obj.step
      return {
        structure: frame_structure(frame_obj.structure ?? frame_obj, idx),
        step: typeof frame_step === `number` ? frame_step : idx,
        metadata: (frame_obj.metadata as Record<string, unknown>) || {},
      }
    })
    return { format: `json`, frames, metadata: {} }
  }
  if (!is_plain_object(value)) throw new Error(`Invalid data format`)
  // `lattice` is null (not absent) for a pymatgen molecule trajectory
  if (
    value[`@class`] === `Trajectory` &&
    value.species &&
    value.coords &&
    `lattice` in value
  ) {
    return parse_pymatgen_trajectory(value, collector.warn)
  }
  if (Array.isArray(value.frames)) {
    const metadata = (value.metadata ?? {}) as Record<string, unknown>
    const frames = (value.frames as TrajectoryFrame[]).map((frame, idx) => ({
      ...frame,
      structure: frame_structure(frame?.structure, idx),
    }))
    return { format: `json`, frames, metadata }
  }
  if (value.sites) {
    const frames = [
      { structure: frame_structure(value, `single structure`), step: 0, metadata: {} },
    ]
    return { format: `json`, frames, metadata: {} }
  }
  throw new Error(`Unrecognized trajectory format`)
}

// Run from an already-parsed JSON value: a pymatgen Trajectory, `{ frames: [...] }`, an array
// of structures/frames, or a single structure. Synchronous; used by anywidget and JupyterLab.
export const trajectory_from_json = (
  value: unknown,
  provenance: TrajectoryProvenance = {},
): TrajectoryRun => {
  const collector = create_warning_collector()
  return run_from_parsed(parse_json_value(value, collector), provenance, collector)
}

const parse_text = (
  text: string | TextLines,
  options: OpenTrajectoryOptions,
  provenance: TrajectoryProvenance,
  collector: WarningCollector,
  index_above_bytes: number,
): TrajectoryRun => {
  const { filename, atom_type_mapping } = options
  const xyz_hint = xyz_ext_hint(filename)
  // Eager parsing materialises every frame's sites (a 74 MB XDATCAR grew the heap by 800 MB),
  // so large multi-frame text is indexed and decoded on demand
  const index = (provenance.source_bytes ?? 0) > index_above_bytes
  const indexed = (format: `xyz` | `xdatcar` | `lammps`): TrajectoryRun =>
    indexed_text_run(text, format, provenance, collector, atom_type_mapping)
  const parsed = (result: ParsedTrajectory): TrajectoryRun =>
    run_from_parsed(result, provenance, collector)
  // XYZ, XDATCAR and LAMMPS read the text line by line in either form; every other format
  // parses one string, which text in TextLines chunks is too long to be
  const whole = (): string => {
    if (typeof text === `string`) return text
    throw new Error(
      `${filename ?? `Text`} (${provenance.source_bytes} bytes) is too long for one JS string; only XYZ/EXTXYZ, LAMMPS dump and XDATCAR trajectories open past ${MAX_STRING_CHARS} bytes`,
    )
  }
  if (xyz_hint !== false && has_multiple_xyz_frames(text)) {
    return index ? indexed(`xyz`) : parsed(parse_xyz_trajectory(text, collector))
  }
  const head = typeof text === `string` ? text.slice(0, SNIFF_BYTES) : text.head(SNIFF_BYTES)
  if (FORMAT_PATTERNS.vasp(head, filename)) {
    return index ? indexed(`xdatcar`) : parsed(parse_vasp_xdatcar(text, collector.warn))
  }
  if (FORMAT_PATTERNS.vasprun(head, filename)) {
    return parsed(parse_vasprun_xml(whole(), collector.warn))
  }
  if (FORMAT_PATTERNS.outcar(head, filename)) {
    return parsed(parse_vasp_outcar(whole(), collector.warn))
  }
  if (FORMAT_PATTERNS.lammpstrj(head, filename)) {
    if (index) return indexed(`lammps`)
    return parsed(parse_lammps_trajectory(text, collector.warn, atom_type_mapping))
  }
  const data = whole()
  if (xyz_hint || (xyz_hint === null && count_xyz_frames(head, 1) === 1)) {
    let structure: AnyStructure | undefined
    try {
      structure = parse_xyz(data)
    } catch (error) {
      // A declared XYZ format is authoritative; an unrecognized name can still hold JSON.
      if (xyz_hint)
        throw new Error(`Failed to parse ${filename} as XYZ: ${to_error(error).message}`, {
          cause: error,
        })
    }
    if (structure)
      return parsed({
        format: `xyz`,
        frames: [{ structure, step: 0, metadata: {} }],
        metadata: {},
      })
  }
  let value: unknown
  try {
    value = JSON.parse(data)
  } catch (error) {
    throw new Error(`Unsupported text format`, { cause: error })
  }
  return parsed(parse_json_value(value, collector))
}

// Leading bytes of a binary source, enough for is_binary's sniff
const BINARY_SNIFF_BYTES = 8192

export async function open_trajectory(
  source: TrajectorySource,
  options: OpenTrajectoryOptions = {},
): Promise<TrajectoryRun> {
  const {
    filename,
    signal,
    on_progress,
    hdf5_group_path,
    index_above_bytes = DEFAULTS.trajectory.index_above_bytes,
  } = options
  signal?.throwIfAborted()
  const report = (current: number, stage: string): void =>
    on_progress?.({ current, total: 100, stage })
  report(0, `Detecting format…`)
  const collector = create_warning_collector()
  const source_bytes = source_byte_size(source, index_above_bytes)
  const provenance: TrajectoryProvenance = { filename, source_bytes }

  const open_hdf5 = async (data: ArrayBuffer | Blob): Promise<TrajectoryRun> => {
    report(10, `Reading HDF5…`)
    const result = await open_hdf5_trajectory(data, collector, filename, hdf5_group_path)
    signal?.throwIfAborted()
    const hdf5_provenance = {
      ...provenance,
      ...(hdf5_group_path && { hdf5_group: hdf5_group_path }),
    }
    if (result.kind === `parsed`)
      return run_from_parsed(result.parsed, hdf5_provenance, collector)
    try {
      return hdf5_run(result.lazy, hdf5_provenance, collector.warnings)
    } catch (error) {
      result.lazy.dispose?.()
      throw error
    }
  }

  let run: TrajectoryRun
  if (typeof source === `string`) {
    report(10, `Parsing trajectory…`)
    run = parse_text(source, options, provenance, collector, index_above_bytes)
  } else if (source instanceof Blob && HDF5_EXT_REGEX.test(filename ?? ``)) {
    run = await open_hdf5(source)
  } else if (source instanceof ArrayBuffer && FORMAT_PATTERNS.ase(source, filename)) {
    report(10, `Parsing ASE trajectory…`)
    run = indexed_text_run(source, `ase`, provenance, collector)
  } else if (source instanceof ArrayBuffer && FORMAT_PATTERNS.hdf5(source, filename)) {
    run = await open_hdf5(source)
  } else {
    // Any other bytes are text
    const head =
      source instanceof Blob
        ? await source.slice(0, BINARY_SNIFF_BYTES).arrayBuffer()
        : source.slice(0, BINARY_SNIFF_BYTES)
    if (is_binary(new TextDecoder().decode(head))) {
      throw new Error(`Unsupported binary format${filename ? `: ${filename}` : ``}`)
    }
    report(10, `Parsing trajectory…`)
    // Text that fits one string reads exactly like a string source; past that, only as lines
    const text =
      source_bytes > MAX_STRING_CHARS
        ? new TextLines(await decode_text_chunks(source))
        : source instanceof Blob
          ? await source.text()
          : new TextDecoder().decode(source)
    signal?.throwIfAborted()
    run = parse_text(text, options, provenance, collector, index_above_bytes)
  }
  if (signal?.aborted) {
    run.dispose()
    throw signal.reason
  }
  report(100, `Complete`)
  return run
}
