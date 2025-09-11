// Parsing functions for trajectory data from various formats
import type { AnyStructure, ElementSymbol, Vec3 } from '$lib'
import { is_binary } from '$lib'
import { atomic_number_to_symbol } from '$lib/composition/parse'
import { COMPRESSION_EXTENSIONS } from '$lib/io/decompress'
import type { Matrix3x3 } from '$lib/math'
import * as math from '$lib/math'
import { parse_xyz } from '$lib/structure/parse'
import type { Dataset, Entity, Group } from 'h5wasm'
import * as h5wasm from 'h5wasm'
import type {
  FrameIndex,
  FrameLoader,
  ParseProgress,
  TrajectoryFrame,
  TrajectoryMetadata,
  TrajectoryType,
} from './index'

// Constants for large file handling
export const MAX_SAFE_STRING_LENGTH = 0x1fffffe8 * 0.5 // 50% of JS max string length as safety
export const MAX_METADATA_SIZE = 50 * 1024 * 1024 // 50MB limit for metadata
export const LARGE_FILE_THRESHOLD = 400 * 1024 * 1024 // 400MB
export const INDEX_SAMPLE_RATE = 100 // Default sample rate for frame indexing
export const MAX_BIN_FILE_SIZE = 100 * 1024 * 1024 // 100MB default for ArrayBuffer files
export const MAX_TEXT_FILE_SIZE = 50 * 1024 * 1024 // 50MB default for string files

// Common interfaces

export interface LoadingOptions {
  use_indexing?: boolean
  buffer_size?: number
  index_sample_rate?: number
  extract_plot_metadata?: boolean
  bin_file_threshold?: number // Threshold in bytes for ArrayBuffer files (default: MAX_BIN_FILE_SIZE)
  text_file_threshold?: number // Threshold in bytes for string files (default: MAX_TEXT_FILE_SIZE)
}

// Unified format detection
const FORMAT_PATTERNS = {
  ase: (data: unknown, filename?: string) => {
    if (!filename?.toLowerCase().endsWith(`.traj`) || !(data instanceof ArrayBuffer)) {
      return false
    }
    const view = new Uint8Array(data.slice(0, 24))
    return [0x2d, 0x20, 0x6f, 0x66, 0x20, 0x55, 0x6c, 0x6d].every((byte, idx) =>
      view[idx] === byte
    )
  },

  hdf5: (data: unknown, filename?: string) => {
    const has_ext = filename?.toLowerCase().match(/\.(h5|hdf5)$/)
    if (!has_ext || !(data instanceof ArrayBuffer) || data.byteLength < 8) return false
    const signature = new Uint8Array(data.slice(0, 8))
    return [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) =>
      signature[i] === b
    )
  },

  vasp: (data: string, filename?: string) => {
    const basename = filename?.toLowerCase().split(`/`).pop() || ``
    if (basename === `xdatcar` || basename.startsWith(`xdatcar`)) return true
    const lines = data.trim().split(/\r?\n/)
    return lines.length >= 10 &&
      lines.some((line) => line.includes(`Direct configuration=`)) &&
      !isNaN(parseFloat(lines[1])) &&
      lines.slice(2, 5).every((line) => line.trim().split(/\s+/).length === 3)
  },

  xyz_multi: (data: string, filename?: string) => {
    if (!filename?.toLowerCase().match(/\.(xyz|extxyz)(?:\.(?:gz|gzip|zip|bz2|xz))?$/)) {
      return false
    }
    return count_xyz_frames(data) >= 2
  },
} as const

// Check if file is a trajectory (supports both filename-only and content-based detection)
export function is_trajectory_file(filename: string, content?: string): boolean {
  let base_name = filename.toLowerCase()
  const compression_regex = new RegExp(
    `\\.(${COMPRESSION_EXTENSIONS.map((ext) => ext.slice(1)).join(`|`)})$`,
    `i`,
  )
  while (compression_regex.test(base_name)) {
    base_name = base_name.replace(compression_regex, ``)
  }

  // For xyz/extxyz files, use content-based detection if available
  if (/\.(xyz|extxyz)$/i.test(base_name)) {
    return content ? count_xyz_frames(content) >= 2 : false
  }

  // Always detect these specific trajectory formats
  if (/\.(traj|xtc)$/i.test(base_name) || /xdatcar/i.test(base_name)) {
    return true
  }

  // Exclude common non-trajectory files that might contain "md_simulation"
  const keywords = /(trajectory|traj|relax|npt|nvt|nve|qha|md|dynamics|simulation)/i

  // Special exclusion for generic md_simulation pattern with certain extensions
  if (/md_simulation\.(out|txt|yml|py|csv|html|css|md|js|ts)$/i.test(base_name)) {
    return false
  }

  // For .h5/.hdf5 files, require trajectory keywords
  if (/\.(h5|hdf5)$/i.test(base_name)) return keywords.test(base_name)

  // For other extensions, require both keywords and specific extensions
  return keywords.test(base_name) &&
    /\.(xyz|extxyz|dat|data|poscar|pdf|log|out|json)$/i.test(base_name)
}

// Cache for optimization
const matrix_cache = new WeakMap<Matrix3x3, Matrix3x3>()
const get_inverse_matrix = (matrix: Matrix3x3): Matrix3x3 => {
  const cached = matrix_cache.get(matrix)
  if (cached) return cached
  const inverse = math.matrix_inverse_3x3(matrix)
  matrix_cache.set(matrix, inverse)
  return inverse
}

// Unified utilities
const convert_atomic_numbers = (numbers: number[]): ElementSymbol[] =>
  numbers.map((num) => atomic_number_to_symbol[num] || `X`)

const create_structure = (
  positions: number[][],
  elements: ElementSymbol[],
  lattice_matrix?: Matrix3x3,
  pbc?: [boolean, boolean, boolean],
  force_data?: number[][],
): AnyStructure => {
  const inv_matrix = lattice_matrix ? get_inverse_matrix(lattice_matrix) : null
  const sites = positions.map((pos, idx) => {
    const xyz = pos as Vec3
    const abc = inv_matrix
      ? math.mat3x3_vec3_multiply(inv_matrix, xyz)
      : [0, 0, 0] as Vec3
    const properties = force_data?.[idx] ? { force: force_data[idx] as Vec3 } : {}
    return {
      species: [{ element: elements[idx], occu: 1, oxidation_state: 0 }],
      abc,
      xyz,
      label: `${elements[idx]}${idx + 1}`,
      properties,
    }
  })

  return lattice_matrix
    ? {
      sites,
      lattice: {
        matrix: lattice_matrix,
        ...math.calc_lattice_params(lattice_matrix),
        pbc: pbc || [true, true, true],
      },
    }
    : { sites }
}

const create_trajectory_frame = (
  positions: number[][],
  elements: ElementSymbol[],
  lattice_matrix: Matrix3x3 | undefined,
  pbc: [boolean, boolean, boolean] | undefined,
  step: number,
  metadata: Record<string, unknown> = {},
): TrajectoryFrame => ({
  structure: create_structure(positions, elements, lattice_matrix, pbc),
  step,
  metadata,
})

// Shared utility to read ndarray data from binary format
const read_ndarray_from_view = (
  view: DataView,
  ref: { ndarray: unknown[] },
): number[][] => {
  const [shape, dtype, array_offset] = ref.ndarray as [number[], string, number]
  const total = shape.reduce((a, b) => a * b, 1)
  const data: number[] = []
  let pos = array_offset

  const readers = {
    int64: () => {
      const v = Number(view.getBigInt64(pos, true))
      pos += 8
      return v
    },
    int32: () => {
      const v = view.getInt32(pos, true)
      pos += 4
      return v
    },
    float64: () => {
      const v = view.getFloat64(pos, true)
      pos += 8
      return v
    },
    float32: () => {
      const v = view.getFloat32(pos, true)
      pos += 4
      return v
    },
  }

  const reader = readers[dtype as keyof typeof readers]
  if (!reader) throw new Error(`Unsupported dtype: ${dtype}`)

  for (let i = 0; i < total; i++) data.push(reader())

  return shape.length === 1
    ? [data]
    : shape.length === 2
    ? Array.from({ length: shape[0] }, (_, i) =>
      data.slice(i * shape[1], (i + 1) * shape[1]))
    : (() => {
      throw new Error(`Unsupported shape`)
    })()
}

// Unified frame counting for XYZ
function count_xyz_frames(data: string): number {
  if (!data || typeof data !== `string`) return 0
  const lines = data.trim().split(/\r?\n/)
  let frame_count = 0
  let line_idx = 0

  while (line_idx < lines.length) {
    if (!lines[line_idx]?.trim()) {
      line_idx++
      continue
    }

    const num_atoms = parseInt(lines[line_idx].trim(), 10)
    if (isNaN(num_atoms) || num_atoms <= 0 || line_idx + num_atoms + 1 >= lines.length) {
      line_idx++
      continue
    }

    // Quick validation of first few atom lines
    let valid_coords = 0
    for (let idx = 0; idx < Math.min(num_atoms, 3); idx++) {
      const parts = lines[line_idx + 2 + idx]?.trim().split(/\s+/)
      if (parts?.length >= 4 && isNaN(parseInt(parts[0])) && parts[0].length <= 3) {
        if (parts.slice(1, 4).every((coord) => !isNaN(parseFloat(coord)))) valid_coords++
      }
    }

    if (valid_coords >= Math.min(num_atoms, 3)) {
      frame_count++
      line_idx += 2 + num_atoms
    } else {
      line_idx++
    }
  }

  return frame_count
}

// HDF5 utilities - consolidated type guards and helpers
const is_hdf5_dataset = (entity: Entity | null): entity is Dataset =>
  entity !== null && (`to_array` in entity || entity instanceof h5wasm.Dataset)

const is_hdf5_group = (entity: Entity | null): entity is Group =>
  entity !== null && (`keys` in entity && entity instanceof h5wasm.Group)

// Specialized parsers - consolidated and optimized
const parse_torch_sim_hdf5 = async (
  buffer: ArrayBuffer,
  filename?: string,
): Promise<TrajectoryType> => {
  await h5wasm.ready
  const { FS } = await h5wasm.ready
  const temp_filename = filename || `temp.h5`

  FS.writeFile(temp_filename, new Uint8Array(buffer))
  const h5_file = new h5wasm.File(temp_filename, `r`)

  try {
    // Unified dataset discovery with path tracking
    const found_paths: Record<string, string> = {}
    const find_dataset = (names: string[]) => {
      const discover = (parent: Group, path = ``): Dataset | null => {
        for (const name of parent.keys()) {
          const item = parent.get(name)
          const full_path = path ? `${path}/${name}` : `/${name}`
          if (names.includes(name) && is_hdf5_dataset(item)) {
            // Track which name was found and its path
            const found_name = names.find((n) => n === name)
            if (found_name) found_paths[found_name] = full_path
            return item
          }
          if (is_hdf5_group(item)) {
            const result = discover(item, full_path)
            if (result) return result
          }
        }
        return null
      }
      return discover(h5_file as unknown as Group)
    }

    const positions_data = find_dataset([`positions`])?.to_array() as
      | number[][]
      | number[][][]
      | null
    const atomic_numbers_data = find_dataset([
      `atomic_numbers`,
      `numbers`,
      `Z`,
      `species`,
    ])?.to_array() as number[] | number[][] | null
    const cells_data = find_dataset([`cell`, `cells`, `lattice`])?.to_array() as
      | number[][][]
      | null
    const energies_data = find_dataset([`potential_energy`, `energy`])?.to_array() as
      | number[][]
      | null

    if (!positions_data || !atomic_numbers_data) {
      const missing_datasets = []
      if (!positions_data) {
        missing_datasets.push(`positions (tried: positions, coords, coordinates)`)
      }
      if (!atomic_numbers_data) {
        missing_datasets.push(
          `atomic numbers (tried: atomic_numbers, numbers, Z, species)`,
        )
      }
      throw new Error(
        `Missing required dataset(s) in HDF5 file: ${
          missing_datasets.join(`, `)
        }. Available datasets: ${Array.from(h5_file.keys()).join(`, `)}`,
      )
    }

    const positions = Array.isArray(positions_data[0]?.[0])
      ? positions_data as number[][][]
      : [positions_data as number[][]]
    const atomic_numbers = Array.isArray(atomic_numbers_data[0])
      ? atomic_numbers_data as number[][]
      : [atomic_numbers_data as number[]]
    const elements = convert_atomic_numbers(atomic_numbers[0])

    const frames = positions.map((frame_positions, idx) => {
      const lattice_matrix = cells_data?.[idx] as Matrix3x3 | undefined
      const energy = energies_data?.[idx]?.[0]
      const metadata: Record<string, unknown> = {}
      if (energy !== undefined) metadata.energy = energy
      if (lattice_matrix) {
        metadata.volume = math.calc_lattice_params(lattice_matrix).volume
      }

      return create_trajectory_frame(
        frame_positions,
        elements,
        lattice_matrix,
        lattice_matrix ? [true, true, true] : [false, false, false],
        idx,
        metadata,
      )
    })

    return {
      frames,
      metadata: {
        source_format: `hdf5_trajectory`,
        frame_count: frames.length,
        num_atoms: elements.length,
        periodic_boundary_conditions: cells_data
          ? [true, true, true]
          : [false, false, false],
        element_counts: elements.reduce((counts: Record<string, number>, element) => {
          counts[element] = (counts[element] || 0) + 1
          return counts
        }, {}),
        discovered_datasets: {
          positions: found_paths.positions || `positions`,
          atomic_numbers: found_paths.atomic_numbers || found_paths.numbers ||
            found_paths.Z || found_paths.species || `unknown`,
          cells: found_paths.cell || found_paths.cells || found_paths.lattice,
          energies: found_paths.potential_energy || found_paths.energy,
        },
        total_groups_found: 1, // Simplified for now, could be enhanced
        has_cell_info: Boolean(cells_data),
      },
    }
  } finally {
    h5_file.close()
    try {
      FS.unlink(temp_filename)
    } catch { /* ignore */ }
  }
}

const parse_vasp_xdatcar = (content: string, filename?: string): TrajectoryType => {
  const lines = content.trim().split(/\r?\n/)
  if (lines.length < 10) throw new Error(`XDATCAR file too short`)

  const scale = parseFloat(lines[1])
  if (isNaN(scale)) throw new Error(`Invalid scale factor`)

  const lattice_matrix = lines.slice(2, 5).map((line) =>
    line.trim().split(/\s+/).map((x) => parseFloat(x) * scale)
  ) as Matrix3x3

  const element_names = lines[5].trim().split(/\s+/)
  const element_counts = lines[6].trim().split(/\s+/).map(Number)
  const elements: ElementSymbol[] = element_names.flatMap((name, idx) =>
    Array(element_counts[idx]).fill(name as ElementSymbol)
  )

  const frames: TrajectoryFrame[] = []
  let line_idx = 7

  while (line_idx < lines.length) {
    const config_line = lines.find((line, idx) =>
      idx >= line_idx && line.includes(`Direct configuration=`)
    )
    if (!config_line) break

    line_idx = lines.indexOf(config_line) + 1
    const step_match = config_line.match(/configuration=\s*(\d+)/)
    const step = step_match ? parseInt(step_match[1]) : frames.length + 1

    const positions = []
    for (let idx = 0; idx < elements.length && line_idx < lines.length; idx++) {
      const coords = lines[line_idx].trim().split(/\s+/).slice(0, 3).map(Number)
      if (coords.length === 3 && !coords.some(isNaN)) {
        positions.push(
          math.mat3x3_vec3_multiply(
            math.transpose_3x3_matrix(lattice_matrix),
            coords as Vec3,
          ),
        )
      }
      line_idx++
    }

    if (positions.length === elements.length) {
      frames.push(create_trajectory_frame(
        positions,
        elements,
        lattice_matrix,
        [true, true, true],
        step,
        { volume: math.calc_lattice_params(lattice_matrix).volume },
      ))
    }
  }

  return {
    frames,
    metadata: {
      filename,
      source_format: `vasp_xdatcar`,
      frame_count: frames.length,
      total_atoms: elements.length,
      periodic_boundary_conditions: [true, true, true],
      elements: element_names,
      element_counts,
    },
  }
}

const parse_xyz_trajectory = (content: string): TrajectoryType => {
  const lines = content.trim().split(/\r?\n/)
  const frames: TrajectoryFrame[] = []
  let line_idx = 0

  while (line_idx < lines.length) {
    if (!lines[line_idx]?.trim()) {
      line_idx++
      continue
    }

    const num_atoms = parseInt(lines[line_idx].trim(), 10)
    if (isNaN(num_atoms) || num_atoms <= 0 || line_idx + num_atoms + 1 >= lines.length) {
      line_idx++
      continue
    }

    const comment = lines[++line_idx] || ``
    const metadata: Record<string, unknown> = {}

    // Extract properties efficiently
    const extractors = {
      step: /(?:step|frame|ionic_step)\s*[=:]?\s*(\d+)/i,
      energy:
        /(?:energy|E|etot|total_energy)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      volume: /(?:volume|vol|V)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      pressure: /(?:pressure|press|P)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      temperature: /(?:temperature|temp|T)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      force_max:
        /(?:max_force|force_max|fmax)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      bandgap: /(?:bandgap|E_gap|gap)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
    }

    const step_match = extractors.step.exec(comment)
    const step = step_match?.[1] ? parseInt(step_match[1]) : frames.length
    Object.entries(extractors).forEach(([key, pattern]) => {
      if (key === `step`) return
      const match = pattern.exec(comment)
      if (match) metadata[key] = parseFloat(match[1])
    })

    // Extract lattice matrix
    const lattice_match = comment.match(/Lattice\s*=\s*"([^"]+)"/i)
    let lattice_matrix: Matrix3x3 | undefined
    if (lattice_match) {
      const values = lattice_match[1].split(/\s+/).map(Number)
      if (values.length === 9) {
        lattice_matrix = [[values[0], values[1], values[2]], [
          values[3],
          values[4],
          values[5],
        ], [values[6], values[7], values[8]]]
        metadata.volume = math.calc_lattice_params(lattice_matrix).volume
      }
    }

    // Parse atoms
    const positions: number[][] = []
    const elements: ElementSymbol[] = []
    const forces: number[][] = []
    const has_forces = comment.includes(`forces:R:3`)

    for (let i = 0; i < num_atoms && ++line_idx < lines.length; i++) {
      const parts = lines[line_idx].trim().split(/\s+/)
      if (parts.length >= 4) {
        elements.push(parts[0] as ElementSymbol)
        positions.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])])

        if (has_forces && parts.length >= 7) {
          forces.push([parseFloat(parts[4]), parseFloat(parts[5]), parseFloat(parts[6])])
        }
      }
    }

    if (forces.length > 0) {
      metadata.forces = forces
      const magnitudes = forces.map((f) => Math.sqrt(f[0] ** 2 + f[1] ** 2 + f[2] ** 2))
      metadata.force_max = Math.max(...magnitudes)
      metadata.force_norm = Math.sqrt(
        magnitudes.reduce((sum, f) => sum + f ** 2, 0) / magnitudes.length,
      )
    }

    frames.push(
      create_trajectory_frame(
        positions,
        elements,
        lattice_matrix,
        lattice_matrix ? [true, true, true] : undefined,
        step,
        metadata,
      ),
    )
    line_idx++
  }

  return {
    frames,
    metadata: {
      source_format: `xyz_trajectory`,
      frame_count: frames.length,
      total_atoms: frames[0]?.structure.sites.length || 0,
    },
  }
}

const parse_ase_trajectory = (buffer: ArrayBuffer, filename?: string): TrajectoryType => {
  const view = new DataView(buffer)
  let offset = 0

  // Validate and read header
  const signature = new TextDecoder().decode(new Uint8Array(buffer, 0, 8))
  if (signature !== `- of Ulm`) throw new Error(`Invalid ASE trajectory`)
  offset += 24 // Skip signature and tag

  const _version = Number(view.getBigInt64(offset, true))
  offset += 8
  const n_items = Number(view.getBigInt64(offset, true))
  offset += 8
  const offsets_pos = Number(view.getBigInt64(offset, true))

  if (n_items <= 0) throw new Error(`Invalid frame count`)

  // Read offsets
  const frame_offsets = Array.from(
    { length: n_items },
    (_, idx) => Number(view.getBigInt64(offsets_pos + idx * 8, true)),
  )

  const frames: TrajectoryFrame[] = []
  let global_numbers: number[] | undefined

  for (let idx = 0; idx < n_items; idx++) {
    try {
      offset = frame_offsets[idx]
      const json_length = Number(view.getBigInt64(offset, true))
      offset += 8

      if (json_length > MAX_SAFE_STRING_LENGTH) {
        console.warn(`Skipping frame ${idx + 1}/${n_items}: too large`)
        continue
      }

      const frame_data = JSON.parse(
        new TextDecoder().decode(new Uint8Array(buffer, offset, json_length)),
      )

      const positions_ref = frame_data[`positions.`] || frame_data.positions
      const positions = positions_ref?.ndarray
        ? read_ndarray_from_view(view, positions_ref)
        : positions_ref as number[][]

      const numbers_ref = frame_data[`numbers.`] || frame_data.numbers || global_numbers
      const numbers: number[] = numbers_ref?.ndarray
        ? read_ndarray_from_view(view, numbers_ref).flat()
        : numbers_ref as number[]

      if (numbers) global_numbers = numbers
      if (!numbers || !positions) continue

      const elements = convert_atomic_numbers(numbers)
      const metadata = {
        step: idx,
        ...(frame_data.calculator || {}),
        ...(frame_data.info || {}),
      }

      frames.push(create_trajectory_frame(
        positions,
        elements,
        frame_data.cell as Matrix3x3,
        frame_data.pbc || [true, true, true],
        idx,
        metadata,
      ))
    } catch (error) {
      console.warn(`Error processing frame ${idx + 1}/${n_items}:`, error)
    }
  }

  if (frames.length === 0) throw new Error(`No valid frames found`)

  return {
    frames,
    metadata: {
      filename,
      source_format: `ase_trajectory`,
      frame_count: frames.length,
      total_atoms: global_numbers?.length || 0,
      periodic_boundary_conditions: [true, true, true],
    },
  }
}

// Unified Frame Loader - replaces separate XYZ and ASE loaders
export class TrajFrameReader implements FrameLoader {
  private format: `xyz` | `ase`
  private global_numbers?: number[] // For ASE trajectories

  constructor(filename: string) {
    this.format = filename.toLowerCase().endsWith(`.traj`) ? `ase` : `xyz`
  }

  // async needed to satisfy FrameLoader interface
  // deno-lint-ignore require-await
  async get_total_frames(
    data: string | ArrayBuffer,
  ): Promise<number> {
    if (this.format === `xyz`) {
      if (data instanceof ArrayBuffer) throw new Error(`XYZ loader requires text data`)
      return count_xyz_frames(data)
    } else {
      if (!(data instanceof ArrayBuffer)) {
        throw new Error(`ASE loader requires binary data`)
      }
      const view = new DataView(data)
      return Number(view.getBigInt64(32, true)) // n_items from header
    }
  }

  async build_frame_index(
    data: string | ArrayBuffer,
    sample_rate: number,
    on_progress?: (progress: ParseProgress) => void,
  ): Promise<FrameIndex[]> {
    const total_frames = await this.get_total_frames(data)
    const frame_index: FrameIndex[] = []

    if (this.format === `xyz`) {
      const data_str = data as string
      const lines = data_str.trim().split(/\r?\n/)
      const encoder = new TextEncoder() // Reuse single encoder instance

      // Detect the actual newline sequence used in the file
      const newline_sequence = data_str.includes(`\r\n`) ? `\r\n` : `\n`
      const newline_byte_len = encoder.encode(newline_sequence).length

      let [current_frame, line_idx, byte_offset] = [0, 0, 0]

      while (line_idx < lines.length && current_frame < total_frames) {
        if (!lines[line_idx]?.trim()) {
          byte_offset += encoder.encode(lines[line_idx]).length +
            newline_byte_len
          line_idx++
          continue
        }

        const num_atoms = parseInt(lines[line_idx].trim(), 10)
        if (
          isNaN(num_atoms) || num_atoms <= 0 || line_idx + num_atoms + 1 >= lines.length
        ) {
          byte_offset += encoder.encode(lines[line_idx]).length +
            newline_byte_len
          line_idx++
          continue
        }

        if (current_frame % sample_rate === 0) {
          frame_index.push({
            frame_number: current_frame,
            byte_offset,
            estimated_size: 0,
          })
        }

        // Calculate frame size and advance using actual byte lengths
        const frame_start = line_idx
        line_idx += 2 + num_atoms
        let frame_size = 0
        for (let i = frame_start; i < line_idx; i++) {
          frame_size += encoder.encode(lines[i]).length + newline_byte_len
        }

        if (current_frame % sample_rate === 0) {
          frame_index[frame_index.length - 1].estimated_size = frame_size
        }

        byte_offset += frame_size
        current_frame++

        if (on_progress && current_frame % 1000 === 0) {
          on_progress({
            current: (current_frame / total_frames) * 100,
            total: 100,
            stage: `Indexing: ${current_frame}`,
          })
        }
      }
    } else {
      // ASE indexing
      const view = new DataView(data as ArrayBuffer)
      const offsets_pos = Number(view.getBigInt64(40, true))

      for (let i = 0; i < total_frames; i += sample_rate) {
        const frame_offset = Number(view.getBigInt64(offsets_pos + i * 8, true))
        frame_index.push({
          frame_number: i,
          byte_offset: frame_offset,
          estimated_size: 0,
        })

        if (on_progress && i % 10000 === 0) {
          on_progress({
            current: (i / total_frames) * 100,
            total: 100,
            stage: `Indexing ASE: ${i}`,
          })
        }
      }
    }

    return frame_index
  }

  // async needed to satisfy FrameLoader interface
  // deno-lint-ignore require-await
  async load_frame(
    data: string | ArrayBuffer,
    frame_number: number,
  ): Promise<TrajectoryFrame | null> {
    if (this.format === `xyz`) return this.load_xyz_frame(data as string, frame_number)
    else return this.load_ase_frame(data as ArrayBuffer, frame_number)
  }

  async extract_plot_metadata(
    data: string | ArrayBuffer,
    options?: { sample_rate?: number; properties?: string[] },
    on_progress?: (progress: ParseProgress) => void,
  ): Promise<TrajectoryMetadata[]> {
    const { sample_rate = 1, properties } = options || {}
    const metadata_list: TrajectoryMetadata[] = []
    const total_frames = await this.get_total_frames(data)

    if (this.format === `xyz`) {
      const lines = (data as string).trim().split(/\r?\n/)
      let [current_frame, line_idx] = [0, 0]

      while (line_idx < lines.length && current_frame < total_frames) {
        if (!lines[line_idx]?.trim()) {
          line_idx++
          continue
        }

        const num_atoms = parseInt(lines[line_idx].trim(), 10)
        if (
          isNaN(num_atoms) || num_atoms <= 0 || line_idx + num_atoms + 1 >= lines.length
        ) {
          line_idx++
          continue
        }

        if (current_frame % sample_rate === 0) {
          const comment = lines[line_idx + 1] || ``
          const frame_metadata = this.parse_xyz_metadata(comment, current_frame)

          if (properties) {
            const filtered = Object.fromEntries(
              Object.entries(frame_metadata.properties).filter(([key]) =>
                properties.includes(key)
              ),
            )
            frame_metadata.properties = filtered
          }

          metadata_list.push(frame_metadata)
        }

        line_idx += 2 + num_atoms
        current_frame++

        if (on_progress && current_frame % 5000 === 0) {
          on_progress({
            current: (current_frame / total_frames) * 100,
            total: 100,
            stage: `Extracting: ${current_frame}`,
          })
        }
      }
    } else if (this.format === `ase`) {
      // ASE metadata extraction
      const view = new DataView(data as ArrayBuffer)
      const n_items = Number(view.getBigInt64(32, true))
      const offsets_pos = Number(view.getBigInt64(40, true))

      for (let i = 0; i < n_items; i += sample_rate) {
        try {
          const frame_offset = Number(view.getBigInt64(offsets_pos + i * 8, true))
          const json_length = Number(view.getBigInt64(frame_offset, true))

          if (json_length > MAX_METADATA_SIZE) {
            console.warn(
              `Skipping large frame ${i}: ${Math.round(json_length / 1024 / 1024)}MB`,
            )
            continue
          }

          const frame_data = JSON.parse(new TextDecoder().decode(
            new Uint8Array(data as ArrayBuffer, frame_offset + 8, json_length),
          ))

          const frame_metadata = this.parse_ase_metadata(frame_data, i)

          if (properties) {
            const filtered = Object.fromEntries(
              Object.entries(frame_metadata.properties).filter(([key]) =>
                properties.includes(key)
              ),
            )
            frame_metadata.properties = filtered
          }

          metadata_list.push(frame_metadata)

          if (on_progress && i % 5000 === 0) {
            on_progress({
              current: (i / n_items) * 100,
              total: 100,
              stage: `Extracting ASE: ${i}/${n_items}`,
            })
          }
        } catch (error) {
          console.warn(`Failed to extract metadata from ASE frame ${i}:`, error)
          continue
        }
      }
    }

    return metadata_list
  }

  private load_xyz_frame(
    data: string,
    frame_number: number,
  ): TrajectoryFrame | null {
    const lines = data.trim().split(/\r?\n/)
    let [current_frame, line_idx] = [0, 0]

    // Skip to target frame
    while (line_idx < lines.length && current_frame < frame_number) {
      if (!lines[line_idx]?.trim()) {
        line_idx++
        continue
      }
      const num_atoms = parseInt(lines[line_idx].trim(), 10)
      if (isNaN(num_atoms) || num_atoms <= 0) {
        line_idx++
        continue
      }
      line_idx += 2 + num_atoms
      current_frame++
    }

    // Parse target frame
    if (line_idx >= lines.length) return null
    const num_atoms = parseInt(lines[line_idx].trim(), 10)
    if (isNaN(num_atoms) || line_idx + num_atoms + 1 >= lines.length) return null

    const comment = lines[line_idx + 1] || ``
    const positions: number[][] = []
    const elements: ElementSymbol[] = []

    for (let i = 0; i < num_atoms; i++) {
      const parts = lines[line_idx + 2 + i]?.trim().split(/\s+/)
      if (parts?.length >= 4) {
        elements.push(parts[0] as ElementSymbol)
        positions.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])])
      }
    }

    const metadata = this.parse_xyz_metadata(comment, frame_number)
    return create_trajectory_frame(
      positions,
      elements,
      undefined,
      undefined,
      frame_number,
      metadata.properties,
    )
  }

  private load_ase_frame(
    data: ArrayBuffer,
    frame_number: number,
  ): TrajectoryFrame | null {
    // ASE frame loading with proper ndarray support
    try {
      const view = new DataView(data)
      const n_items = Number(view.getBigInt64(32, true))
      const offsets_pos = Number(view.getBigInt64(40, true))

      if (frame_number >= n_items) return null

      const frame_offset = Number(view.getBigInt64(offsets_pos + frame_number * 8, true))
      const json_length = Number(view.getBigInt64(frame_offset, true))

      const frame_data = JSON.parse(new TextDecoder().decode(
        new Uint8Array(data, frame_offset + 8, json_length),
      ))

      // Extract positions with proper ndarray handling
      const positions_ref = frame_data[`positions.`] || frame_data.positions
      const positions = positions_ref?.ndarray
        ? read_ndarray_from_view(view, positions_ref)
        : positions_ref as number[][]

      // Extract atomic numbers with proper ndarray handling
      const numbers_ref = frame_data[`numbers.`] || frame_data.numbers ||
        this.global_numbers
      const numbers: number[] = numbers_ref?.ndarray
        ? read_ndarray_from_view(view, numbers_ref).flat()
        : numbers_ref as number[]

      if (numbers) this.global_numbers = numbers
      if (!numbers || !positions) throw new Error(`Missing atomic numbers or positions`)

      // Extract cell and calculate volume if present
      const cell = frame_data.cell as Matrix3x3 | undefined
      const metadata: Record<string, unknown> = {
        step: frame_number,
        ...(frame_data.calculator || {}),
        ...(frame_data.info || {}),
      }

      // Calculate volume from cell matrix if available
      if (cell && Array.isArray(cell) && cell.length === 3) {
        try {
          metadata.volume = Math.abs(math.det_3x3(cell))
        } catch (error) {
          console.warn(`Failed to calculate volume for frame ${frame_number}:`, error)
        }
      }

      return create_trajectory_frame(
        positions,
        convert_atomic_numbers(numbers),
        cell,
        frame_data.pbc || [true, true, true],
        frame_number,
        metadata,
      )
    } catch (error) {
      console.warn(`Failed to load ASE frame ${frame_number}:`, error)
      return null
    }
  }

  private parse_xyz_metadata(comment: string, frame_number: number): TrajectoryMetadata {
    const properties: Record<string, number> = {}

    const patterns = {
      energy: /(?:energy|E|etot)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      volume: /(?:volume|vol|V)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      pressure: /(?:pressure|press|P)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      force_max: /(?:max_force|fmax)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
    }

    Object.entries(patterns).forEach(([key, pattern]) => {
      const match = pattern.exec(comment)
      if (match) properties[key] = parseFloat(match[1])
    })

    const step_match = comment.match(/(?:step|frame)\s*[=:]?\s*(\d+)/i)
    const step = step_match ? parseInt(step_match[1]) : frame_number

    return { frame_number, step, properties }
  }

  private parse_ase_metadata(
    frame_data: Record<string, unknown>,
    frame_number: number,
  ): TrajectoryMetadata {
    const properties: Record<string, number> = {}
    const step = frame_number

    // Extract calculator properties (energies, etc.)
    if (frame_data.calculator && typeof frame_data.calculator === `object`) {
      const calculator = frame_data.calculator as Record<string, unknown>
      const calc_properties = [
        `energy`,
        `potential_energy`,
        `kinetic_energy`,
        `total_energy`,
      ]

      for (const prop of calc_properties) {
        if (prop in calculator && typeof calculator[prop] === `number`) {
          properties[prop] = calculator[prop] as number
        }
      }
    }

    // Extract info properties (forces, stress, etc.)
    if (frame_data.info && typeof frame_data.info === `object`) {
      const info = frame_data.info as Record<string, unknown>
      const info_properties = [
        `force_max`,
        `force_norm`,
        `stress_max`,
        `stress_frobenius`,
        `pressure`,
        `temperature`,
      ]

      for (const prop of info_properties) {
        if (prop in info && typeof info[prop] === `number`) {
          properties[prop] = info[prop] as number
        }
      }
    }

    // Calculate volume from cell if present
    if (frame_data.cell && Array.isArray(frame_data.cell)) {
      const cell = frame_data.cell as number[][]
      if (cell.length === 3 && cell[0]?.length === 3) {
        try {
          properties.volume = Math.abs(math.det_3x3(cell as Matrix3x3))
        } catch (error) {
          console.warn(`Failed to calculate volume for ASE frame ${frame_number}:`, error)
        }
      }
    }

    return { frame_number, step, properties }
  }
}

// Main parsing entry point - simplified
export async function parse_trajectory_data(
  data: unknown,
  filename?: string,
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
      } catch { /* ignore */ }
    }

    try {
      data = JSON.parse(content)
    } catch {
      throw new Error(`Unsupported text format`)
    }
  }

  if (!data || typeof data !== `object`) throw new Error(`Invalid data format`)

  // Handle JSON formats
  if (Array.isArray(data)) {
    const frames = data.map((frame_data, idx) => {
      const frame_obj = frame_data as Record<string, unknown>
      return {
        structure: (frame_obj.structure || frame_obj) as AnyStructure,
        step: (frame_obj.step as number) || idx,
        metadata: (frame_obj.metadata as Record<string, unknown>) || {},
      }
    })
    return { frames, metadata: { source_format: `array`, frame_count: frames.length } }
  }

  const obj = data as Record<string, unknown>

  // Pymatgen format
  if (obj[`@class`] === `Trajectory` && obj.species && obj.coords && obj.lattice) {
    const species = obj.species as Array<{ element: ElementSymbol }>
    const coords = obj.coords as number[][][]
    const matrix = obj.lattice as Matrix3x3
    const frame_properties = obj.frame_properties as Array<Record<string, unknown>> || []

    const frames = coords.map((frame_coords, idx) => {
      const positions = frame_coords.map((abc) =>
        math.mat3x3_vec3_multiply(math.transpose_3x3_matrix(matrix), abc as Vec3)
      )

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
            const force_magnitudes = forces.map((force) =>
              Math.sqrt((force as number[]).reduce((sum, f) => sum + f * f, 0))
            )
            processed_properties.force_max = Math.max(...force_magnitudes)
            processed_properties.force_norm = Math.sqrt(
              force_magnitudes.reduce((sum, f) => sum + f * f, 0),
            )
          }

          // Calculate stress statistics for stress tensor
          if (key === `stress` && Array.isArray(array_obj.data)) {
            const stress_tensor = array_obj.data as number[][]
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
        } else {
          processed_properties[key] = value
        }
      })

      return create_trajectory_frame(
        positions,
        species.map((s) => s.element),
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
        species_list: [...new Set(species.map((s) => s.element))],
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
  const formats = [
    { extensions: [`.dump`, `.lammpstrj`], name: `LAMMPS`, tool: `pymatgen` },
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
    const result = await parse_trajectory_data(data, filename)

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

  on_progress?.({
    current: 100,
    total: 100,
    stage: `Ready: ${total_frames} frames indexed`,
  })

  return {
    frames,
    metadata: {
      source_format: filename.toLowerCase().endsWith(`.traj`)
        ? `ase_trajectory`
        : `xyz_trajectory`,
      frame_count: frames.length,
    },
    total_frames,
    indexed_frames: frame_index,
    plot_metadata,
    is_indexed: true,
  }
}

// Factory function for frame loader (simplified)
export function create_frame_loader(filename: string): FrameLoader {
  if (!filename.toLowerCase().match(/\.(xyz|extxyz|traj)$/)) {
    throw new Error(`Unsupported format for frame loading: ${filename}`)
  }
  return new TrajFrameReader(filename)
}

// Backward compatibility exports
export const XYZFrameLoader = TrajFrameReader
export const ASEFrameLoader = TrajFrameReader

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
