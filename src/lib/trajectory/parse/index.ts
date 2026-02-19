// Parsing functions for trajectory data from various formats
import type { ElementSymbol } from '$lib/element'
import { is_binary } from '$lib/io/is-binary'
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { AnyStructure } from '$lib/structure'
import { parse_xyz } from '$lib/structure/parse'
import type {
  FrameLoader,
  ParseProgress,
  TrajectoryFrame,
  TrajectoryMetadata,
  TrajectoryType,
} from '../index'
import { INDEX_SAMPLE_RATE, LARGE_FILE_THRESHOLD } from '../constants'
import { FORMAT_PATTERNS, is_trajectory_file } from '../format-detect'
import { create_trajectory_frame, validate_3x3_matrix } from '../helpers'
import { parse_lammps_trajectory } from './lammps'
import { parse_torch_sim_hdf5 } from './hdf5'
import { parse_ase_trajectory } from './ase'
import { parse_vasp_xdatcar } from './vasp'
import { parse_xyz_trajectory } from './xyz'
import type { AtomTypeMapping, LoadingOptions } from '../types'
import { TrajFrameReader } from '../frame-reader'

const log_parse_debug = (message: string, error: unknown): void => {
  if (import.meta.env?.DEV) console.debug(message, error)
}

// Re-export constants and types for consumers
export {
  INDEX_SAMPLE_RATE,
  LARGE_FILE_THRESHOLD,
  MAX_BIN_FILE_SIZE,
  MAX_METADATA_SIZE,
  MAX_SAFE_STRING_LENGTH,
  MAX_TEXT_FILE_SIZE,
} from '../constants'
export type { AtomTypeMapping, LoadingOptions } from '../types'
export { is_trajectory_file }
export { TrajFrameReader }

export async function parse_trajectory_data(
  data: unknown,
  filename?: string,
  atom_type_mapping?: AtomTypeMapping,
): Promise<TrajectoryType> {
  if (data instanceof ArrayBuffer) {
    if (FORMAT_PATTERNS.ase(data, filename)) return parse_ase_trajectory(data, filename)
    if (FORMAT_PATTERNS.hdf5(data, filename)) {
      return await parse_torch_sim_hdf5(data, filename)
    }
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

    // Single XYZ fallback
    if (filename?.toLowerCase().match(/\.(?:xyz|extxyz)$/)) {
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
      throw new Error(`Unsupported text format`)
    }
  }

  if (!data || typeof data !== `object`) throw new Error(`Invalid data format`)

  // Handle JSON formats
  if (Array.isArray(data)) {
    const frames = data.map((frame_data, idx) => {
      const frame_obj = frame_data as Record<string, unknown>
      const frame_step = frame_obj.step
      return {
        structure: (frame_obj.structure || frame_obj) as AnyStructure,
        step: typeof frame_step === `number` ? frame_step : idx,
        metadata: (frame_obj.metadata as Record<string, unknown>) || {},
      }
    })
    return { frames, metadata: { source_format: `array`, frame_count: frames.length } }
  }

  const obj = data as Record<string, unknown>

  // Pymatgen format
  if (obj[`@class`] === `Trajectory` && obj.species && obj.coords && obj.lattice) {
    const species = obj.species as { element: ElementSymbol }[]
    const coords = obj.coords as number[][][]
    const matrix = validate_3x3_matrix(obj.lattice)
    const frame_properties = obj.frame_properties as Record<string, unknown>[] || []
    const frac_to_cart = math.create_frac_to_cart(matrix)

    const frames = coords.map((frame_coords, idx) => {
      const positions = frame_coords.map((abc) => frac_to_cart(abc as Vec3))

      // Process frame properties to extract numpy arrays
      const raw_properties = frame_properties[idx] || {}
      const processed_properties: Record<string, unknown> = {}

      Object.entries(raw_properties).forEach(([key, value]) => {
        if (
          value && typeof value === `object` &&
          (value as Record<string, unknown>)[`@class`] === `array`
        ) {
          // Extract numpy array data
          const array_obj = value as Record<string, unknown>
          processed_properties[key] = array_obj.data

          // Calculate force statistics for forces
          if (key === `forces` && Array.isArray(array_obj.data)) {
            const forces = array_obj.data as number[][]
            const force_magnitudes = forces.map((force) => Math.hypot(...force))
            processed_properties.force_max = Math.max(...force_magnitudes)
            processed_properties.force_norm = Math.sqrt(
              force_magnitudes.reduce((sum, f) => sum + f ** 2, 0) /
                force_magnitudes.length,
            )
          }

          // Calculate stress statistics for stress tensor
          if (key === `stress` && Array.isArray(array_obj.data)) {
            const stress_tensor = array_obj.data
            if (!math.is_square_matrix(stress_tensor, 3)) {
              console.warn(`Invalid stress tensor structure in frame ${idx}`)
            } else {
              // Calculate stress components (diagonal elements represent normal stresses)
              const normal_stresses = [
                stress_tensor[0][0],
                stress_tensor[1][1],
                stress_tensor[2][2],
              ]
              processed_properties.stress_max = Math.max(...normal_stresses.map(Math.abs))
              // Calculate hydrostatic pressure (negative of mean normal stress)
              processed_properties.pressure =
                -(normal_stresses[0] + normal_stresses[1] + normal_stresses[2]) / 3
            }
          }
        } else {
          processed_properties[key] = value
        }
      })

      return create_trajectory_frame(
        positions,
        species.map((specie) => specie.element),
        matrix,
        [true, true, true],
        idx,
        processed_properties,
      )
    })

    return {
      frames,
      metadata: {
        filename,
        source_format: `pymatgen_trajectory`,
        frame_count: frames.length,
        species_list: [...new Set(species.map((specie) => specie.element))],
        periodic_boundary_conditions: [true, true, true],
      },
    }
  }

  // Object with frames
  if (obj.frames && Array.isArray(obj.frames)) {
    return {
      frames: obj.frames as TrajectoryFrame[],
      metadata: {
        ...obj.metadata as Record<string, unknown>,
        source_format: `object_with_frames`,
      },
    }
  }

  // Single structure
  if (obj.sites) {
    return {
      frames: [{ structure: obj as AnyStructure, step: 0, metadata: {} }],
      metadata: { source_format: `single_structure`, frame_count: 1 },
    }
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

  try {
    update_progress(0, `Detecting format...`)

    const data_size = data instanceof ArrayBuffer ? data.byteLength : data.length
    const is_large_file = data_size > LARGE_FILE_THRESHOLD
    const should_use_indexing = use_indexing ?? is_large_file

    if (is_large_file) {
      update_progress(5, `Large file detected (${Math.round(data_size / 1024 / 1024)}MB)`)
    }

    // Use indexed loading for supported large files
    if (should_use_indexing && filename.toLowerCase().match(/\.(xyz|extxyz|traj)$/)) {
      return await parse_with_unified_loader(data, filename, {
        index_sample_rate,
        extract_plot_metadata,
      }, on_progress)
    }

    // Fallback to direct parsing
    update_progress(10, `Parsing trajectory...`)
    const result = await parse_trajectory_data(data, filename, atom_type_mapping)

    update_progress(100, `Complete`)
    return result
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
  const frame_index = await loader.build_frame_index(
    data,
    index_sample_rate,
    (progress) => {
      const adjusted = 20 + (progress.current / 100) * 30
      on_progress?.({
        current: adjusted,
        total: 100,
        stage: `Building index: ${progress.stage}`,
      })
    },
  )

  on_progress?.({ current: 50, total: 100, stage: `Loading initial frames...` })
  const initial_frame_count = Math.min(10, total_frames)
  const frame_promises = Array.from(
    { length: initial_frame_count },
    (_, idx) => loader.load_frame(data, idx),
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
      console.warn(`Failed to extract plot metadata:`, error)
    }
  }

  const stage = `Ready: ${total_frames} frames indexed`
  on_progress?.({ current: 100, total: 100, stage })

  return {
    frames,
    metadata: {
      source_format: filename.toLowerCase().endsWith(`.traj`)
        ? `ase_trajectory`
        : `xyz_trajectory`,
      frame_count: total_frames,
    },
    total_frames,
    indexed_frames: frame_index,
    plot_metadata,
    is_indexed: true,
    frame_loader: loader,
  }
}

// Factory function for frame loader (simplified)
export function create_frame_loader(filename: string): FrameLoader {
  if (!filename.toLowerCase().match(/\.(xyz|extxyz|traj)$/)) {
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
  } catch (err1) {
    if (fallback) {
      console.warn(`Binary load failed for ${type}, using text:`, err1)
      try {
        return await resp.text()
      } catch (err2) {
        console.error(`Fallback to text also failed for ${type}:`, err2)
      }
    }
    throw new Error(`Failed to load ${type} as binary: ${err1}`)
  }
}
