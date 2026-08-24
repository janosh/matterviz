// The one way to turn bytes into a TrajectoryRun. Format detection stays direct (no plugin
// registry); the only policy here is the single size threshold above which text/ASE payloads
// are indexed lazily instead of materialised. Decompression and HDF5 group choice belong to
// the caller (the file viewer): an ambiguous HDF5 file throws Hdf5GroupSelectionRequiredError.
import { HDF5_EXT_REGEX } from '$lib/constants'
import { DEFAULTS } from '$lib/settings'
import { is_plain_object } from '$lib/utils'
import type { AnyStructure } from '$lib/structure/index'
import { is_structure_like, parse_xyz, structure_from_json } from '$lib/structure/parse'
import { get_parse_errors, reset_parse_diagnostics } from '$lib/structure/parsers/shared'
import { FORMAT_PATTERNS, xyz_ext_hint } from './format-detect'
import { count_xyz_frames } from './helpers'
import type { ParseProgress, TrajectoryFrame, TrajectorySource } from './index'
import { parse_ase_trajectory } from './parse/ase'
import { open_hdf5_trajectory } from './parse/hdf5'
import { parse_lammps_trajectory } from './parse/lammps'
import { parse_pymatgen_trajectory } from './parse/pymatgen'
import {
  create_warning_collector,
  type ParsedTrajectory,
  type WarningCollector,
} from './parse/shared'
import { parse_vasp_xdatcar } from './parse/vasp'
import { parse_xyz_trajectory } from './parse/xyz'
import { time_step_of, type TrajectoryProvenance, type TrajectoryRun } from './run'
import { hdf5_run } from './runs/hdf5'
import { indexed_text_run } from './runs/indexed-text'
import { trajectory_from_frames } from './runs/memory'
import type { AtomTypeMapping } from './types'

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
  // Index (decode on demand) XYZ/ASE payloads above this many bytes instead of parsing every
  // frame up front. Defaults to DEFAULTS.trajectory.index_above_bytes.
  index_above_bytes?: number
}

// Bytes a detection sniff reads from the head of a text payload. A single frame of 30k atoms
// is ~1.5 MB, so the head must hold at least two of those to recognise a multi-frame XYZ.
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
    time_step: time_step_of(parsed.time_step, parsed.time_unit),
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
  if (value[`@class`] === `Trajectory` && value.species && value.coords && value.lattice) {
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
  data: string,
  options: OpenTrajectoryOptions,
  provenance: TrajectoryProvenance,
  collector: WarningCollector,
  index_above_bytes: number,
): TrajectoryRun => {
  const { filename, atom_type_mapping } = options
  const head = data.length > SNIFF_BYTES ? data.slice(0, SNIFF_BYTES) : data
  const xyz_frames_in_head = count_xyz_frames(head, 2)
  const is_multi_xyz =
    xyz_ext_hint(filename) !== false &&
    (xyz_frames_in_head >= 2 ||
      (xyz_frames_in_head === 1 && head !== data && count_xyz_frames(data, 2) >= 2))
  if (is_multi_xyz) {
    if ((provenance.source_bytes ?? 0) > index_above_bytes) {
      return indexed_text_run(data, `xyz`, provenance, collector)
    }
    return run_from_parsed(parse_xyz_trajectory(data, collector), provenance, collector)
  }
  if (FORMAT_PATTERNS.vasp(head, filename)) {
    return run_from_parsed(parse_vasp_xdatcar(data, collector.warn), provenance, collector)
  }
  if (FORMAT_PATTERNS.lammpstrj(head, filename)) {
    return run_from_parsed(
      parse_lammps_trajectory(data, collector.warn, atom_type_mapping),
      provenance,
      collector,
    )
  }
  const xyz_hint = xyz_ext_hint(filename)
  if (xyz_hint || (xyz_hint === null && xyz_frames_in_head === 1)) {
    reset_parse_diagnostics()
    const structure = parse_xyz(data)
    if (structure) {
      const parsed: ParsedTrajectory = {
        format: `xyz`,
        frames: [{ structure, step: 0, metadata: {} }],
        metadata: {},
      }
      return run_from_parsed(parsed, provenance, collector)
    }
    // The extension says XYZ, so the structure parser's reasons beat a JSON fallback
    if (xyz_hint) {
      throw new Error(
        `Failed to parse ${filename} as XYZ: ${get_parse_errors().join(`; `) || `no valid frame found`}`,
      )
    }
  }
  let value: unknown
  try {
    value = JSON.parse(data)
  } catch (error) {
    throw new Error(`Unsupported text format`, { cause: error })
  }
  return run_from_parsed(parse_json_value(value, collector), provenance, collector)
}

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
      ...(hdf5_group_path ? { hdf5_group: hdf5_group_path } : {}),
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
  if (source instanceof Blob) {
    if (!HDF5_EXT_REGEX.test(filename ?? ``)) {
      throw new Error(`Blob trajectory sources require an HDF5 filename, got ${filename}`)
    }
    run = await open_hdf5(source)
  } else if (source instanceof ArrayBuffer) {
    if (FORMAT_PATTERNS.ase(source, filename)) {
      report(10, `Parsing ASE trajectory…`)
      run =
        source_bytes > index_above_bytes
          ? indexed_text_run(source, `ase`, provenance, collector)
          : run_from_parsed(parse_ase_trajectory(source), provenance, collector)
    } else if (FORMAT_PATTERNS.hdf5(source, filename)) {
      run = await open_hdf5(source)
    } else throw new Error(`Unsupported binary format${filename ? `: ${filename}` : ``}`)
  } else {
    report(10, `Parsing trajectory…`)
    run = parse_text(source, options, provenance, collector, index_above_bytes)
  }
  if (signal?.aborted) {
    run.dispose()
    throw signal.reason
  }
  report(100, `Complete`)
  return run
}
