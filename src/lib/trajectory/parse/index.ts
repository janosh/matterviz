import { is_binary } from '$lib/io/is-binary'
import { is_plain_object } from '$lib/utils'
import { DEFAULTS } from '$lib/settings'
import type { AnyStructure } from '$lib/structure/index'
import { is_structure_like, parse_xyz, structure_from_json } from '$lib/structure/parse'
import { get_parse_errors, reset_parse_diagnostics } from '$lib/structure/parsers/shared'
import {
  FORMAT_PATTERNS,
  indexed_trajectory_format,
  is_indexable_trajectory_filename,
  xyz_ext_hint,
} from '$lib/trajectory/format-detect'
import { HDF5_EXT_REGEX } from '$lib/trajectory/filename'
import { TrajFrameReader } from '$lib/trajectory/frame-reader'
import { count_xyz_frames } from '$lib/trajectory/helpers'
import type {
  ParseProgress,
  TrajectoryFrame,
  TrajectoryMetadata,
  TrajectorySource,
  TrajectoryType,
} from '$lib/trajectory/index'
import type { AtomTypeMapping, LoadingOptions } from '$lib/trajectory/types'
import { parse_ase_trajectory } from './ase'
import { get_traj_parse_warnings, reset_traj_parse_warnings, traj_warn } from './diagnostics'
import { parse_hdf5_trajectory } from './hdf5'
import { parse_lammps_trajectory } from './lammps'
import { parse_pymatgen_trajectory } from './pymatgen'
import { parse_vasp_xdatcar } from './vasp'
import { parse_xyz_trajectory } from './xyz'

// A JSON frame's structure as a real AnyStructure: pymatgen's default verbosity writes
// matrix + pbc and no scalar lattice params, older dumps no pbc at all, so the lattice is
// rebuilt from its matrix (no consumer defaults a missing pbc any more). Coordinates stay as
// written, like every other trajectory reader's frames.
const frame_structure = (structure: unknown, label: string | number): AnyStructure => {
  if (!is_structure_like(structure)) {
    const context = typeof label === `number` ? `trajectory frame ${label}` : label
    throw new Error(
      `Invalid structure in ${context}: expected non-empty 'sites' array with species and coordinates`,
    )
  }
  return structure_from_json(structure, { wrap: false })
}

export const LARGE_FILE_THRESHOLD = 400 * 1024 * 1024 // 400MB
const INDEX_SAMPLE_RATE = 100 // Default sample rate for frame indexing
export const MAX_BIN_FILE_SIZE = DEFAULTS.trajectory.bin_file_threshold // 50MB
export const MAX_TEXT_FILE_SIZE = DEFAULTS.trajectory.text_file_threshold // 25MB
export type { AtomTypeMapping, LoadingOptions } from '$lib/trajectory/types'
export {
  indexed_trajectory_format,
  is_indexable_trajectory_filename,
  is_trajectory_file,
} from '$lib/trajectory/format-detect'
export { TrajFrameReader } from '$lib/trajectory/frame-reader'

// UTF-8 size of a payload without encoding it: a 400 MB string would otherwise be copied
// into a throwaway Uint8Array just to compare against the large-file threshold. Every UTF-16
// unit is 1-3 UTF-8 bytes, so only the 1x-3x band needs the exact count.
const payload_bytes = (data: TrajectorySource, threshold: number): number => {
  if (data instanceof Blob) return data.size
  if (data instanceof ArrayBuffer) return data.byteLength
  if (data.length > threshold || data.length * 3 <= threshold) return data.length
  return new TextEncoder().encode(data).byteLength
}

const assert_parsed_trajectory_consistency = (
  trajectory: TrajectoryType,
  filename?: string,
): TrajectoryType => {
  const context = filename ? ` in ${filename}` : ``
  if (trajectory.frames.length === 0) {
    if (trajectory.metadata?.vaspout_electronic_only === true) return trajectory
    throw new Error(`Parsed trajectory${context} has no frames`)
  }
  const reference_atom_count = trajectory.frames[0].structure.sites.length
  for (const [frame_idx, frame] of trajectory.frames.entries()) {
    if (!Number.isFinite(frame.step)) {
      throw new TypeError(
        `Parsed trajectory${context} frame ${frame_idx} has invalid step ${frame.step}`,
      )
    }
    const { sites } = frame.structure
    if (sites.length !== reference_atom_count) {
      throw new Error(
        `Parsed trajectory${context} frame ${frame_idx} has ${sites.length} atoms, expected ${reference_atom_count}`,
      )
    }
    for (const [atom_idx, site] of sites.entries()) {
      if (
        site.xyz.length !== 3 ||
        site.xyz.some((coordinate) => !Number.isFinite(coordinate))
      ) {
        throw new Error(
          `Parsed trajectory${context} frame ${frame_idx} atom ${atom_idx} has invalid Cartesian coordinates`,
        )
      }
    }
    if (
      `lattice` in frame.structure &&
      frame.structure.lattice.matrix.flat().some((value) => !Number.isFinite(value))
    ) {
      throw new Error(`Parsed trajectory${context} frame ${frame_idx} has an invalid lattice`)
    }
  }
  return trajectory
}

async function parse_trajectory_data_unchecked(
  data: unknown,
  filename?: string,
  atom_type_mapping?: AtomTypeMapping,
  hdf5_group_path?: string,
): Promise<TrajectoryType> {
  reset_traj_parse_warnings()
  if (data instanceof Blob) {
    if (!HDF5_EXT_REGEX.test(filename ?? ``)) {
      throw new Error(`Blob trajectory sources require an HDF5 filename, got ${filename}`)
    }
    return parse_hdf5_trajectory(data, filename, hdf5_group_path)
  }
  if (data instanceof ArrayBuffer) {
    if (FORMAT_PATTERNS.ase(data, filename)) return parse_ase_trajectory(data, filename)
    if (FORMAT_PATTERNS.hdf5(data, filename))
      return parse_hdf5_trajectory(data, filename, hdf5_group_path)
    throw new Error(`Unsupported binary format${filename ? `: ${filename}` : ``}`)
  }

  if (typeof data === `string`) {
    const content = data.trim()
    if (FORMAT_PATTERNS.xyz_multi(content, filename)) return parse_xyz_trajectory(content)
    if (FORMAT_PATTERNS.vasp(content, filename)) {
      return parse_vasp_xdatcar(content, filename)
    }
    if (FORMAT_PATTERNS.lammpstrj(content, filename)) {
      return parse_lammps_trajectory(content, filename, atom_type_mapping)
    }

    const xyz_hint = xyz_ext_hint(filename)
    if (xyz_hint || (xyz_hint === null && count_xyz_frames(content, 2) === 1)) {
      reset_parse_diagnostics()
      const structure = parse_xyz(content)
      if (structure) {
        return {
          frames: [{ structure, step: 0, metadata: {} }],
          metadata: { source_format: `single_xyz`, frame_count: 1 },
        }
      }
      // The extension says XYZ, so the structure parser's reasons beat a JSON fallback
      if (xyz_hint) {
        throw new Error(
          `Failed to parse ${filename} as XYZ: ${get_parse_errors().join(`; `) || `no valid frame found`}`,
        )
      }
    }

    try {
      data = JSON.parse(content)
    } catch (error) {
      throw new Error(`Unsupported text format`, { cause: error })
    }
  }

  if (Array.isArray(data)) {
    const frames = data.map((frame_data, idx) => {
      const frame_obj = frame_data as Record<string, unknown>
      const frame_step = frame_obj.step
      return {
        structure: frame_structure(frame_obj.structure ?? frame_obj, idx),
        step: typeof frame_step === `number` ? frame_step : idx,
        metadata: (frame_obj.metadata as Record<string, unknown>) || {},
      }
    })
    return { frames, metadata: { source_format: `array`, frame_count: frames.length } }
  }

  if (!is_plain_object(data)) throw new Error(`Invalid data format`)

  if (data[`@class`] === `Trajectory` && data.species && data.coords && data.lattice) {
    return parse_pymatgen_trajectory(data, filename)
  }

  if (Array.isArray(data.frames)) {
    const metadata = (data.metadata ?? {}) as Record<string, unknown>
    const frames = (data.frames as TrajectoryFrame[]).map((frame, idx) => ({
      ...frame,
      structure: frame_structure(frame?.structure, idx),
    }))
    return { frames, metadata: { ...metadata, source_format: `object_with_frames` } }
  }

  if (data.sites) {
    const frames = [
      { structure: frame_structure(data, `single structure`), step: 0, metadata: {} },
    ]
    const metadata = { source_format: `single_structure`, frame_count: 1 }
    return { frames, metadata }
  }

  throw new Error(`Unrecognized trajectory format`)
}

export async function parse_trajectory_data(
  data: unknown,
  filename?: string,
  atom_type_mapping?: AtomTypeMapping,
  hdf5_group_path?: string,
): Promise<TrajectoryType> {
  const trajectory = await parse_trajectory_data_unchecked(
    data,
    filename,
    atom_type_mapping,
    hdf5_group_path,
  )
  try {
    return assert_parsed_trajectory_consistency(trajectory, filename)
  } catch (error) {
    // An HDF5 loader owns an open h5wasm handle; a rejected result must not leak it
    trajectory.frame_loader?.dispose?.()
    throw error
  }
}

export function get_unsupported_format_message(
  filename: string,
  content: string,
): string | null {
  const lower = filename.toLowerCase()

  for (const [ext, name] of [
    [`.bz2`, `BZ2`],
    [`.xz`, `XZ`],
    [`.zip`, `ZIP`],
  ]) {
    if (lower.endsWith(ext)) {
      return `🚫 ${name} compression not supported in browser\nPlease decompress the file first`
    }
  }

  const formats = [
    { extensions: [`.nc`, `.netcdf`], name: `NetCDF`, tool: `MDAnalysis` },
    { extensions: [`.dcd`], name: `DCD`, tool: `MDAnalysis` },
  ]

  for (const { extensions, name, tool } of formats) {
    if (extensions.some((ext) => lower.endsWith(ext))) {
      return `🚫 ${name} format not supported\nConvert with ${tool} first`
    }
  }

  return is_binary(content)
    ? `🚫 Binary format not supported${filename ? `: ${filename}` : ``}`
    : null
}

function attach_parse_warnings(trajectory: TrajectoryType): TrajectoryType {
  const parse_warnings = get_traj_parse_warnings()
  if (parse_warnings.length === 0) return trajectory
  return { ...trajectory, metadata: { ...trajectory.metadata, parse_warnings } }
}

export async function parse_trajectory_async(
  data: TrajectorySource,
  filename: string,
  on_progress?: (progress: ParseProgress) => void,
  options: LoadingOptions = {},
): Promise<TrajectoryType> {
  const {
    use_indexing,
    index_sample_rate = INDEX_SAMPLE_RATE,
    extract_plot_metadata = true,
    atom_type_mapping,
    hdf5_group_path,
  } = options

  const update_progress = (current: number, stage: string) =>
    on_progress?.({ current, total: 100, stage })

  reset_traj_parse_warnings()
  try {
    update_progress(0, `Detecting format...`)

    const data_size = payload_bytes(data, LARGE_FILE_THRESHOLD)
    const is_large_file = data_size > LARGE_FILE_THRESHOLD
    const should_use_indexing = use_indexing ?? is_large_file

    if (is_large_file) {
      update_progress(5, `Large file detected (${Math.round(data_size / 1024 / 1024)}MB)`)
    }

    const can_index =
      !(data instanceof Blob) &&
      (is_indexable_trajectory_filename(filename) ||
        (typeof data === `string` &&
          xyz_ext_hint(filename) === null &&
          count_xyz_frames(data.slice(0, 2 ** 20), 1) >= 1))
    if (should_use_indexing && can_index) {
      return attach_parse_warnings(
        assert_parsed_trajectory_consistency(
          await parse_with_unified_loader(
            data,
            filename,
            { index_sample_rate, extract_plot_metadata },
            on_progress,
          ),
          filename,
        ),
      )
    }

    update_progress(10, `Parsing trajectory...`)
    const result = await parse_trajectory_data(
      data,
      filename,
      atom_type_mapping,
      hdf5_group_path,
    )

    update_progress(100, `Complete`)
    return attach_parse_warnings(result)
  } catch (error) {
    const error_message = error instanceof Error ? error.message : `Unknown error`
    update_progress(100, `Error: ${error_message}`)
    throw error
  }
}

async function parse_with_unified_loader(
  data: string | ArrayBuffer,
  filename: string,
  options: { index_sample_rate: number; extract_plot_metadata: boolean },
  on_progress?: (progress: ParseProgress) => void,
): Promise<TrajectoryType> {
  const { index_sample_rate, extract_plot_metadata } = options
  const loader = new TrajFrameReader(filename)

  on_progress?.({ current: 10, total: 100, stage: `Counting frames...` })
  const total_frames = await loader.get_total_frames(data)

  on_progress?.({ current: 20, total: 100, stage: `Building frame index...` })
  const frame_index = await loader.build_frame_index(data, index_sample_rate, (progress) => {
    const adjusted = 20 + (progress.current / 100) * 30
    on_progress?.({
      current: adjusted,
      total: 100,
      stage: `Building index: ${progress.stage}`,
    })
  })

  on_progress?.({ current: 50, total: 100, stage: `Loading initial frames...` })
  const initial_frame_count = Math.min(10, total_frames)
  const frame_promises = Array.from({ length: initial_frame_count }, (_, idx) =>
    loader.load_frame(data, idx),
  )
  const loaded_frames = await Promise.all(frame_promises)
  const frames: TrajectoryFrame[] = []
  for (const frame of loaded_frames) {
    if (!frame) break
    frames.push(frame)
  }
  if (frames.length === 0) throw new Error(`Failed to load initial trajectory frame 0`)

  let plot_metadata: TrajectoryMetadata[] | undefined
  if (extract_plot_metadata) {
    on_progress?.({ current: 70, total: 100, stage: `Extracting plot metadata...` })
    try {
      plot_metadata = await loader.extract_plot_metadata(
        data,
        { sample_rate: 1 },
        (progress) => {
          const adjusted = 70 + (progress.current / 100) * 20
          on_progress?.({
            current: adjusted,
            total: 100,
            stage: `Extracting: ${progress.stage}`,
          })
        },
      )
    } catch (error) {
      traj_warn(`Failed to extract plot metadata`, error)
    }
  }

  const stage = `Ready: ${total_frames} frames indexed`
  on_progress?.({ current: 100, total: 100, stage })
  const source_format = `${indexed_trajectory_format(filename)}_trajectory`

  return {
    frames,
    metadata: { source_format, frame_count: total_frames },
    total_frames,
    indexed_frames: frame_index,
    plot_metadata,
    is_indexed: true,
    frame_loader: loader,
  }
}
