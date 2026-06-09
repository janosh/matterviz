// Parsing functions for trajectory data from various formats
import { is_binary } from '$lib/io/is-binary'
import type { AnyStructure } from '$lib/structure/index'
import { is_parsed_structure, parse_xyz } from '$lib/structure/parse'
import { INDEX_SAMPLE_RATE, LARGE_FILE_THRESHOLD } from '$lib/trajectory/constants'
import { strip_compression_extensions } from '$lib/io'
import { ext_hint, FORMAT_PATTERNS, is_trajectory_file } from '$lib/trajectory/format-detect'
import { TrajFrameReader } from '$lib/trajectory/frame-reader'
import { count_xyz_frames } from '$lib/trajectory/helpers'
import type {
  FrameLoader,
  ParseProgress,
  TrajectoryFrame,
  TrajectoryMetadata,
  TrajectoryType,
} from '$lib/trajectory/index'
import type { AtomTypeMapping, LoadingOptions } from '$lib/trajectory/types'
import { parse_ase_trajectory } from './ase'
import { get_traj_parse_warnings, reset_traj_parse_warnings, traj_warn } from './diagnostics'
import { parse_torch_sim_hdf5 } from './hdf5'
import { parse_lammps_trajectory } from './lammps'
import { parse_pymatgen_trajectory } from './pymatgen'
import { parse_vasp_xdatcar } from './vasp'
import { parse_xyz_trajectory } from './xyz'

// Silently swallow expected parse fallbacks — the caller throws if ALL formats fail
const log_parse_debug = (_message: string, _error: unknown): void => {}

// Re-export constants and types for consumers
export {
  LARGE_FILE_THRESHOLD,
  MAX_BIN_FILE_SIZE,
  MAX_TEXT_FILE_SIZE,
} from '$lib/trajectory/constants'
export type { AtomTypeMapping, LoadingOptions } from '$lib/trajectory/types'
export { is_trajectory_file, TrajFrameReader }

export async function parse_trajectory_data(
  data: unknown,
  filename?: string,
  atom_type_mapping?: AtomTypeMapping,
): Promise<TrajectoryType> {
  reset_traj_parse_warnings()
  if (data instanceof ArrayBuffer) {
    if (FORMAT_PATTERNS.ase(data, filename)) return parse_ase_trajectory(data, filename)
    if (FORMAT_PATTERNS.hdf5(data, filename)) return parse_torch_sim_hdf5(data, filename)
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

    // Single XYZ fallback (content-sniffed when the filename gives no format hint,
    // e.g. blob: object URLs whose basenames are UUIDs)
    const xyz_hint = ext_hint(filename, /\.(xyz|extxyz)$/)
    if (xyz_hint || (xyz_hint === null && count_xyz_frames(content) === 1)) {
      try {
        const structure = parse_xyz(content)
        if (structure) {
          return {
            frames: [{ structure, step: 0, metadata: {} }],
            metadata: { source_format: `single_xyz`, frame_count: 1 },
          }
        }
      } catch (error) {
        // Single-frame XYZ parsing failed, continue to JSON parsing.
        log_parse_debug(
          `Single XYZ parse fallback failed for ${filename ?? `unknown file`}:`,
          error,
        )
      }
    }

    try {
      data = JSON.parse(content)
    } catch (error) {
      log_parse_debug(`JSON parse failed for ${filename ?? `unknown file`}:`, error)
      throw new Error(`Unsupported text format`, { cause: error })
    }
  }

  if (!data || typeof data !== `object`) throw new Error(`Invalid data format`)

  // Handle JSON formats
  if (Array.isArray(data)) {
    const frames = data.map((frame_data, idx) => {
      const frame_obj = frame_data as Record<string, unknown>
      const frame_step = frame_obj.step
      const structure = frame_obj.structure ?? frame_obj
      if (!is_parsed_structure(structure)) {
        throw new Error(
          `Invalid structure in trajectory frame ${idx}: expected non-empty 'sites' array with species and coordinates`,
        )
      }
      return {
        structure: structure as AnyStructure,
        step: typeof frame_step === `number` ? frame_step : idx,
        metadata: (frame_obj.metadata as Record<string, unknown>) || {},
      }
    })
    return { frames, metadata: { source_format: `array`, frame_count: frames.length } }
  }

  const obj = data as Record<string, unknown>

  // Pymatgen format
  if (obj[`@class`] === `Trajectory` && obj.species && obj.coords && obj.lattice) {
    return parse_pymatgen_trajectory(obj, filename)
  }

  // Object with frames
  if (Array.isArray(obj.frames)) {
    const metadata = (obj.metadata ?? {}) as Record<string, unknown>
    const frames = obj.frames as TrajectoryFrame[]
    return { frames, metadata: { ...metadata, source_format: `object_with_frames` } }
  }

  // Single structure
  if (obj.sites) {
    if (!is_parsed_structure(obj)) {
      throw new Error(
        `Invalid structure: 'sites' must be a non-empty array of sites with species and coordinates`,
      )
    }
    const frames = [{ structure: obj as AnyStructure, step: 0, metadata: {} }]
    const metadata = { source_format: `single_structure`, frame_count: 1 }
    return { frames, metadata }
  }

  throw new Error(`Unrecognized trajectory format`)
}

export function get_unsupported_format_message(
  filename: string,
  content: string,
): string | null {
  const lower = filename.toLowerCase()

  // Check for unsupported compression formats first
  const unsupported_compression = [
    { ext: `.bz2`, name: `BZ2` },
    { ext: `.xz`, name: `XZ` },
    { ext: `.zip`, name: `ZIP` },
  ]
  for (const { ext, name } of unsupported_compression) {
    if (lower.endsWith(ext)) {
      return `🚫 ${name} compression not supported in browser\nPlease decompress the file first`
    }
  }

  // .dump files are LAMMPS binary dumps which require external tools to parse.
  // .lammpstrj files are LAMMPS text-based trajectory files supported by parse_lammps_trajectory().
  const formats = [
    { extensions: [`.dump`], name: `LAMMPS binary dump`, tool: `pymatgen` },
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

// Attach non-fatal parse warnings (skipped atoms, dropped frames, plot-metadata
// extraction failures, ...) collected during parsing to the trajectory metadata so
// the UI can surface them instead of leaving them in the console only.
function attach_parse_warnings(trajectory: TrajectoryType): TrajectoryType {
  const parse_warnings = get_traj_parse_warnings()
  if (parse_warnings.length === 0) return trajectory
  return { ...trajectory, metadata: { ...trajectory.metadata, parse_warnings } }
}

// Unified async parser with streaming support
export async function parse_trajectory_async(
  data: ArrayBuffer | string,
  filename: string,
  on_progress?: (progress: ParseProgress) => void,
  options: LoadingOptions = {},
): Promise<TrajectoryType> {
  const {
    use_indexing,
    index_sample_rate = INDEX_SAMPLE_RATE,
    extract_plot_metadata = true,
    atom_type_mapping,
  } = options

  const update_progress = (current: number, stage: string) =>
    on_progress?.({ current, total: 100, stage })

  reset_traj_parse_warnings()
  try {
    update_progress(0, `Detecting format...`)

    const data_size =
      data instanceof ArrayBuffer ? data.byteLength : new TextEncoder().encode(data).byteLength
    const is_large_file = data_size > LARGE_FILE_THRESHOLD
    const should_use_indexing = use_indexing ?? is_large_file

    if (is_large_file) {
      update_progress(5, `Large file detected (${Math.round(data_size / 1024 / 1024)}MB)`)
    }

    // Use indexed loading for supported large files (including compressed names).
    // When the filename gives no format hint (e.g. blob: URLs), sniff a content
    // prefix for XYZ frames so large extensionless files still get indexed.
    const base_filename = strip_compression_extensions(filename)
    const can_index =
      /\.(xyz|extxyz|traj)$/.test(base_filename) ||
      (typeof data === `string` &&
        ext_hint(filename, /\.(xyz|extxyz)$/) === null &&
        count_xyz_frames(data.slice(0, 2 ** 20)) >= 1)
    if (should_use_indexing && can_index) {
      return attach_parse_warnings(
        await parse_with_unified_loader(
          data,
          filename,
          { index_sample_rate, extract_plot_metadata },
          on_progress,
        ),
      )
    }

    // Fallback to direct parsing
    update_progress(10, `Parsing trajectory...`)
    const result = await parse_trajectory_data(data, filename, atom_type_mapping)

    update_progress(100, `Complete`)
    return attach_parse_warnings(result)
  } catch (error) {
    const error_message = error instanceof Error ? error.message : `Unknown error`
    update_progress(100, `Error: ${error_message}`)
    throw error
  }
}

// Unified frame loading using new TrajFrameReader
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
  const frames = loaded_frames.filter((frame): frame is TrajectoryFrame => frame !== null)

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
  const source_format = filename.toLowerCase().endsWith(`.traj`)
    ? `ase_trajectory`
    : `xyz_trajectory`

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

// Factory function for frame loader (simplified)
export function create_frame_loader(filename: string): FrameLoader {
  if (!/\.(xyz|extxyz|traj)$/.exec(filename.toLowerCase())) {
    throw new Error(`Unsupported format for frame loading: ${filename}`)
  }
  return new TrajFrameReader(filename)
}

export async function load_binary_traj(
  resp: Response,
  type: string,
  fallback = false,
): Promise<ArrayBuffer | string> {
  try {
    // Read binary from a clone so the original can be used for text fallback
    return await resp.clone().arrayBuffer()
  } catch (binary_error) {
    if (fallback) {
      console.warn(`Binary load failed for ${type}, using text fallback:`, binary_error)
      try {
        return await resp.text()
      } catch (text_error) {
        const combined_error = new AggregateError(
          [binary_error, text_error],
          `Failed to load ${type} as binary or text`,
        )
        console.error(`Binary and text fallback both failed for ${type}:`, combined_error)
        throw combined_error
      }
    }
    throw new Error(`Failed to load ${type} as binary`, { cause: binary_error })
  }
}
