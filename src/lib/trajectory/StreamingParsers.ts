// StreamingParsers - Fast single-frame parsers with indexing for streaming trajectory loading
import type { ElementSymbol, Vec3 } from '$lib'
import { atomic_number_to_symbol } from '$lib/composition/parse'
import type { Matrix3x3 } from '$lib/math'
import * as math from '$lib/math'
import type { TrajectoryFrame } from './index'
import type { ParseProgress } from './parse'
import type { FrameIndex, StreamingFrameParser } from './StreamingTrajectoryLoader'

// Metadata extraction interfaces
export interface TrajectoryMetadata {
  frame_number: number
  step: number
  properties: Record<string, number>
}

export interface MetadataExtractorOptions {
  sample_rate?: number // Extract every Nth frame for performance (default: 1 = all frames)
  properties?: string[] // Specific properties to extract (default: all numeric properties)
}

export interface MetadataExtractor {
  extract_all_metadata: (
    data: string | ArrayBuffer,
    options?: MetadataExtractorOptions,
    on_progress?: (progress: ParseProgress) => void,
  ) => Promise<TrajectoryMetadata[]>
}

// Simplified trajectory frame creation - reuses structure creation logic from parse.ts
function create_trajectory_frame(
  positions: number[][],
  elements: ElementSymbol[],
  lattice_matrix: Matrix3x3 | undefined,
  pbc: [boolean, boolean, boolean] | undefined,
  step: number,
  metadata: Record<string, unknown> = {},
): TrajectoryFrame {
  // Create sites manually to avoid dependency on parse.ts internals
  const inv_matrix = lattice_matrix ? math.matrix_inverse_3x3(lattice_matrix) : null
  const sites = positions.map((pos, idx) => {
    const xyz = pos as Vec3
    const abc = inv_matrix
      ? math.mat3x3_vec3_multiply(inv_matrix, xyz)
      : [0, 0, 0] as Vec3
    return {
      species: [{ element: elements[idx], occu: 1, oxidation_state: 0 }],
      abc,
      xyz,
      label: `${elements[idx]}${idx + 1}`,
      properties: {},
    }
  })

  const structure = lattice_matrix
    ? {
      sites,
      lattice: {
        matrix: lattice_matrix,
        ...math.calc_lattice_params(lattice_matrix),
        pbc: pbc || [true, true, true],
      },
    }
    : { sites }

  return { structure, step, metadata }
}

// XYZ Streaming Parser
export class XYZStreamingParser implements StreamingFrameParser, MetadataExtractor {
  async get_total_frames(data: string | ArrayBuffer, filename?: string): Promise<number> {
    if (data instanceof ArrayBuffer) {
      throw new Error(`XYZ parser requires text data`)
    }

    const lines = data.trim().split(/\r?\n/)
    let frame_count = 0
    let line_idx = 0

    while (line_idx < lines.length) {
      if (!lines[line_idx]?.trim()) {
        line_idx++
        continue
      }

      const num_atoms = parseInt(lines[line_idx].trim(), 10)
      if (isNaN(num_atoms) || num_atoms <= 0) {
        line_idx++
        continue
      }

      if (line_idx + num_atoms + 1 >= lines.length) break

      // Skip comment line and atom lines
      line_idx += 2 + num_atoms
      frame_count++
    }

    return frame_count
  }

  async build_frame_index(
    data: string | ArrayBuffer,
    sample_rate: number,
    on_progress?: (progress: ParseProgress) => void,
  ): Promise<FrameIndex[]> {
    if (data instanceof ArrayBuffer) {
      throw new Error(`XYZ parser requires text data`)
    }

    const lines = data.trim().split(/\r?\n/)
    const frame_index: FrameIndex[] = []
    let current_frame = 0
    let line_idx = 0
    let byte_offset = 0

    while (line_idx < lines.length) {
      if (!lines[line_idx]?.trim()) {
        byte_offset += lines[line_idx].length + 1 // +1 for newline
        line_idx++
        continue
      }

      const num_atoms = parseInt(lines[line_idx].trim(), 10)
      if (isNaN(num_atoms) || num_atoms <= 0) {
        byte_offset += lines[line_idx].length + 1
        line_idx++
        continue
      }

      if (line_idx + num_atoms + 1 >= lines.length) break

      // Index this frame if it's a sample frame
      if (current_frame % sample_rate === 0) {
        frame_index.push({
          frame_number: current_frame,
          byte_offset,
          estimated_size: 0, // Will be calculated later
        })
      }

      // Calculate frame size and move to next frame
      const frame_start_line = line_idx
      line_idx += 2 + num_atoms // Skip atom count, comment, and atom lines

      // Calculate byte size of this frame
      let frame_byte_size = 0
      for (let i = frame_start_line; i < line_idx; i++) {
        frame_byte_size += lines[i].length + 1 // +1 for newline
      }

      // Update estimated size for indexed frames
      if (current_frame % sample_rate === 0) {
        frame_index[frame_index.length - 1].estimated_size = frame_byte_size
      }

      byte_offset += frame_byte_size
      current_frame++

      // Progress reporting
      if (on_progress && current_frame % 1000 === 0) {
        const progress = Math.min(100, (line_idx / lines.length) * 100)
        on_progress({
          current: progress,
          total: 100,
          stage: `Indexing XYZ frames: ${current_frame} found`,
        })
      }
    }

    console.log(`XYZ: Indexed ${frame_index.length} of ${current_frame} frames`)
    return frame_index
  }

  async parse_single_frame(
    data: string | ArrayBuffer,
    frame_number: number,
    frame_index?: FrameIndex[],
  ): Promise<TrajectoryFrame | null> {
    if (data instanceof ArrayBuffer) {
      throw new Error(`XYZ parser requires text data`)
    }

    const text_data = data as string

    // If we have an index, use it for fast seeking
    if (frame_index && frame_index.length > 0) {
      return this.parse_frame_with_index(text_data, frame_number, frame_index)
    }

    // Fallback to sequential parsing (slower)
    return this.parse_frame_sequential(text_data, frame_number)
  }

  private parse_frame_with_index(
    data: string,
    frame_number: number,
    frame_index: FrameIndex[],
  ): TrajectoryFrame | null {
    // Find the closest index point before our target frame
    const closest_index = frame_index
      .filter((idx) => idx.frame_number <= frame_number)
      .sort((a, b) => b.frame_number - a.frame_number)[0]

    if (!closest_index) {
      // If no index point before target, start from beginning
      return this.parse_frame_sequential(data, frame_number)
    }

    // Start parsing from the closest index point
    const lines = data.split(/\r?\n/)
    let byte_pos = 0
    let line_idx = 0

    // Skip to the indexed position
    while (byte_pos < closest_index.byte_offset && line_idx < lines.length) {
      byte_pos += lines[line_idx].length + 1
      line_idx++
    }

    // Parse frames starting from the indexed position
    let current_frame = closest_index.frame_number

    while (line_idx < lines.length && current_frame <= frame_number) {
      if (!lines[line_idx]?.trim()) {
        line_idx++
        continue
      }

      const num_atoms = parseInt(lines[line_idx].trim(), 10)
      if (isNaN(num_atoms) || num_atoms <= 0) {
        line_idx++
        continue
      }

      if (line_idx + num_atoms + 1 >= lines.length) break

      // If this is our target frame, parse it
      if (current_frame === frame_number) {
        const comment_line = lines[line_idx + 1] || ``
        const atoms_lines = lines.slice(line_idx + 2, line_idx + 2 + num_atoms)

        return this.parse_xyz_frame_data(atoms_lines, comment_line, current_frame)
      }

      // Skip to next frame
      line_idx += 2 + num_atoms
      current_frame++
    }

    return null
  }

  private parse_frame_sequential(
    data: string,
    target_frame: number,
  ): TrajectoryFrame | null {
    const lines = data.trim().split(/\r?\n/)
    let current_frame = 0
    let line_idx = 0

    while (line_idx < lines.length && current_frame <= target_frame) {
      if (!lines[line_idx]?.trim()) {
        line_idx++
        continue
      }

      const num_atoms = parseInt(lines[line_idx].trim(), 10)
      if (isNaN(num_atoms) || num_atoms <= 0) {
        line_idx++
        continue
      }

      if (line_idx + num_atoms + 1 >= lines.length) break

      // If this is our target frame, parse it
      if (current_frame === target_frame) {
        const comment_line = lines[line_idx + 1] || ``
        const atoms_lines = lines.slice(line_idx + 2, line_idx + 2 + num_atoms)

        return this.parse_xyz_frame_data(atoms_lines, comment_line, current_frame)
      }

      // Skip to next frame
      line_idx += 2 + num_atoms
      current_frame++
    }

    return null
  }

  private parse_xyz_frame_data(
    atoms_lines: string[],
    comment_line: string,
    step: number,
  ): TrajectoryFrame {
    const positions: number[][] = []
    const elements: ElementSymbol[] = []
    const forces: number[][] = []
    let has_forces = false

    for (const line of atoms_lines) {
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 4) {
        const element = parts[0] as ElementSymbol
        const coords = parts.slice(1, 4).map(parseFloat)

        if (coords.some(isNaN)) continue

        elements.push(element)
        positions.push(coords)

        // Check for forces (columns 5-7)
        if (parts.length >= 7) {
          const force = parts.slice(4, 7).map(parseFloat)
          if (!force.some(isNaN)) {
            forces.push(force)
            has_forces = true
          }
        }
      }
    }

    // Parse metadata from comment line
    const metadata: Record<string, unknown> = { step }

    // Extract common properties from comment line
    const energy_match = comment_line.match(
      /energy[=:\s]+([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/i,
    )
    if (energy_match) {
      metadata.energy = parseFloat(energy_match[1])
    }

    // Extract lattice matrix if present
    const lattice_match = comment_line.match(/Lattice\s*=\s*"([^"]+)"/i)
    let lattice_matrix: Matrix3x3 | undefined
    if (lattice_match) {
      const values = lattice_match[1].split(/\s+/).map(Number)
      if (values.length === 9) {
        lattice_matrix = [
          [values[0], values[1], values[2]],
          [values[3], values[4], values[5]],
          [values[6], values[7], values[8]],
        ]
        metadata.volume = math.calc_lattice_params(lattice_matrix).volume
      }
    }

    if (has_forces) {
      metadata.forces = forces
    }

    return create_trajectory_frame(
      positions,
      elements,
      lattice_matrix,
      lattice_matrix ? [true, true, true] : undefined,
      step,
      metadata,
    )
  }

  // Metadata extraction for plots (no atomic coordinates)
  async extract_all_metadata(
    data: string | ArrayBuffer,
    options: MetadataExtractorOptions = {},
    on_progress?: (progress: ParseProgress) => void,
  ): Promise<TrajectoryMetadata[]> {
    if (data instanceof ArrayBuffer) {
      throw new Error(`XYZ metadata extractor requires text data`)
    }

    const { sample_rate = 1, properties } = options
    const lines = data.trim().split(/\r?\n/)
    const metadata_list: TrajectoryMetadata[] = []

    let current_frame = 0
    let line_idx = 0

    while (line_idx < lines.length) {
      if (!lines[line_idx]?.trim()) {
        line_idx++
        continue
      }

      const num_atoms = parseInt(lines[line_idx].trim(), 10)
      if (isNaN(num_atoms) || num_atoms <= 0) {
        line_idx++
        continue
      }

      if (line_idx + num_atoms + 1 >= lines.length) break

      // Extract metadata only if this frame matches sample rate
      if (current_frame % sample_rate === 0) {
        const comment_line = lines[line_idx + 1] || ``
        const frame_metadata = this.parse_xyz_metadata(comment_line, current_frame)

        // Filter properties if specified
        if (properties) {
          const filtered_properties: Record<string, number> = {}
          for (const prop of properties) {
            if (prop in frame_metadata.properties) {
              filtered_properties[prop] = frame_metadata.properties[prop]
            }
          }
          frame_metadata.properties = filtered_properties
        }

        metadata_list.push(frame_metadata)
      }

      // Skip to next frame (we don't need to parse atoms for metadata)
      line_idx += 2 + num_atoms
      current_frame++

      // Progress reporting (less frequent for performance)
      if (on_progress && current_frame % 5000 === 0) {
        on_progress({
          current: Math.min(100, (line_idx / lines.length) * 100),
          total: 100,
          stage: `Extracting metadata: ${current_frame} frames`,
        })
      }
    }

    return metadata_list
  }

  private parse_xyz_metadata(
    comment_line: string,
    frame_number: number,
  ): TrajectoryMetadata {
    const properties: Record<string, number> = {}

    // Extract step number
    const step_match = comment_line.match(/(?:step|frame|ionic_step)\s*[=:]?\s*(\d+)/i)
    const step = step_match ? parseInt(step_match[1]) : frame_number

    // Extract common properties from comment line
    const property_patterns = {
      energy:
        /(?:energy|E|etot|total_energy)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      energy_per_atom:
        /(?:e_per_atom|energy\/atom)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      volume: /(?:volume|vol|V)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      pressure: /(?:pressure|press|P)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      temperature: /(?:temperature|temp|T)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      force_max:
        /(?:max_force|force_max|fmax)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      stress_max:
        /(?:max_stress|stress_max)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      stress_frobenius: /stress_frobenius\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
    }

    Object.entries(property_patterns).forEach(([key, pattern]) => {
      const match = comment_line.match(pattern)
      if (match) {
        properties[key] = parseFloat(match[1])
      }
    })

    // Extract lattice matrix and calculate volume if present
    const lattice_match = comment_line.match(/Lattice\s*=\s*"([^"]+)"/i)
    if (lattice_match && !properties.volume) {
      const values = lattice_match[1].split(/\s+/).map(Number)
      if (values.length === 9) {
        const lattice_matrix = [
          [values[0], values[1], values[2]],
          [values[3], values[4], values[5]],
          [values[6], values[7], values[8]],
        ]
        properties.volume = Math.abs(math.det_3x3(lattice_matrix as Matrix3x3))
      }
    }

    return {
      frame_number,
      step,
      properties,
    }
  }
}

// ASE Trajectory Streaming Parser
export class ASEStreamingParser implements StreamingFrameParser, MetadataExtractor {
  private global_numbers: number[] | null = null
  async get_total_frames(data: string | ArrayBuffer, filename?: string): Promise<number> {
    if (!(data instanceof ArrayBuffer)) {
      throw new Error(`ASE parser requires binary data`)
    }

    const view = new DataView(data)

    // Validate signature
    const signature = new TextDecoder().decode(new Uint8Array(data, 0, 8))
    if (signature !== `- of Ulm`) throw new Error(`Invalid ASE trajectory`)

    const tag = new TextDecoder().decode(new Uint8Array(data, 8, 16)).replace(
      /\0/g,
      ``,
    ).trim()
    if (!tag.startsWith(`ASE-Trajectory`)) throw new Error(`Invalid ASE trajectory`)

    // Read header
    const _version = Number(view.getBigInt64(24, true))
    const n_items = Number(view.getBigInt64(32, true))

    if (n_items <= 0) throw new Error(`Invalid frame count`)

    return n_items
  }

  async build_frame_index(
    data: string | ArrayBuffer,
    sample_rate: number,
    on_progress?: (progress: ParseProgress) => void,
  ): Promise<FrameIndex[]> {
    if (!(data instanceof ArrayBuffer)) {
      throw new Error(`ASE parser requires binary data`)
    }

    const view = new DataView(data)

    // Read header
    const n_items = Number(view.getBigInt64(32, true))
    const offsets_pos = Number(view.getBigInt64(40, true))

    // Read all frame offsets
    const frame_index: FrameIndex[] = []
    let offset = offsets_pos

    for (let idx = 0; idx < n_items; idx++) {
      const frame_offset = Number(view.getBigInt64(offset, true))

      // Index every Nth frame
      if (idx % sample_rate === 0) {
        frame_index.push({
          frame_number: idx,
          byte_offset: frame_offset,
          estimated_size: 0, // Will be calculated
        })
      }

      offset += 8

      // Progress reporting
      if (on_progress && idx % 10000 === 0) {
        const progress = (idx / n_items) * 100
        on_progress({
          current: progress,
          total: 100,
          stage: `Indexing ASE frames: ${idx}/${n_items}`,
        })
      }
    }

    // Calculate estimated frame sizes
    for (let i = 0; i < frame_index.length - 1; i++) {
      frame_index[i].estimated_size = frame_index[i + 1].byte_offset -
        frame_index[i].byte_offset
    }

    console.log(`ASE: Indexed ${frame_index.length} of ${n_items} frames`)
    return frame_index
  }

  async parse_single_frame(
    data: string | ArrayBuffer,
    frame_number: number,
    frame_index?: FrameIndex[],
  ): Promise<TrajectoryFrame | null> {
    if (!(data instanceof ArrayBuffer)) {
      throw new Error(`ASE parser requires binary data`)
    }

    const view = new DataView(data)

    // Read header to get frame offsets
    const n_items = Number(view.getBigInt64(32, true))
    const offsets_pos = Number(view.getBigInt64(40, true))

    if (frame_number >= n_items) {
      return null
    }

    // Get frame offset
    const frame_offset_pos = offsets_pos + frame_number * 8
    const frame_offset = Number(view.getBigInt64(frame_offset_pos, true))

    // Read frame data
    let offset = frame_offset
    const json_length = Number(view.getBigInt64(offset, true))
    offset += 8

    // Check safety limits
    if (json_length > 100 * 1024 * 1024) { // 100MB limit
      throw new Error(
        `Frame ${frame_number} too large: ${Math.round(json_length / 1024 / 1024)}MB`,
      )
    }

    // Parse frame JSON
    const json_str = new TextDecoder().decode(
      new Uint8Array(data, offset, json_length),
    )
    const frame_data = JSON.parse(json_str)

    // Extract frame data
    const positions_ref = frame_data[`positions.`] || frame_data.positions
    const positions = (positions_ref as { ndarray?: unknown[] })?.ndarray
      ? this.read_ndarray(data, positions_ref as { ndarray: unknown[] })
      : positions_ref as number[][]

    const cell = frame_data.cell as Matrix3x3
    const numbers_ref = frame_data[`numbers.`] || frame_data.numbers

    let numbers: number[] = []
    if (numbers_ref) {
      numbers = (numbers_ref as { ndarray?: unknown })?.ndarray
        ? this.read_ndarray(data, numbers_ref as { ndarray: unknown[] }).flat()
        : numbers_ref as number[]

      // Store global numbers for future frames
      if (numbers.length > 0) {
        this.global_numbers = numbers
      }
    } else if (this.global_numbers) {
      // Use previously stored atomic numbers
      numbers = this.global_numbers
    }

    // If numbers is still empty, we have a problem
    if (!numbers || numbers.length === 0) {
      console.error(`ASE frame ${frame_number} debug:`, {
        numbers_ref_exists: !!numbers_ref,
        global_numbers_exists: !!this.global_numbers,
        frame_data_keys: Object.keys(frame_data),
      })
      throw new Error(
        `Frame ${frame_number} missing atomic numbers data. This may indicate that frame 0 should be parsed first to establish atomic numbers.`,
      )
    }

    const elements = numbers.map((num) =>
      atomic_number_to_symbol[num] || (`X` as ElementSymbol)
    )

    const metadata = {
      step: frame_number,
      ...(frame_data.calculator && typeof frame_data.calculator === `object`
        ? frame_data.calculator
        : {}),
      ...(frame_data.info && typeof frame_data.info === `object` ? frame_data.info : {}),
    }

    return create_trajectory_frame(
      positions,
      elements,
      cell,
      (frame_data.pbc as [boolean, boolean, boolean]) || [true, true, true],
      frame_number,
      metadata,
    )
  }

  private read_ndarray(data: ArrayBuffer, ref: { ndarray: unknown[] }): number[][] {
    const view = new DataView(data)
    const [shape, dtype, array_offset] = ref.ndarray as [number[], string, number]
    const total = shape.reduce((a, b) => a * b, 1)
    const data_array: number[] = []
    let pos = array_offset

    for (let idx = 0; idx < total; idx++) {
      let value: number
      if (dtype === `int64`) {
        value = Number(view.getBigInt64(pos, true))
        pos += 8
      } else if (dtype === `int32`) {
        value = view.getInt32(pos, true)
        pos += 4
      } else if (dtype === `float64`) {
        value = view.getFloat64(pos, true)
        pos += 8
      } else if (dtype === `float32`) {
        value = view.getFloat32(pos, true)
        pos += 4
      } else {
        throw new Error(`Unsupported dtype: ${dtype}`)
      }
      data_array.push(value)
    }

    return shape.length === 1
      ? [data_array]
      : shape.length === 2
      ? Array.from({ length: shape[0] }, (_, i) =>
        data_array.slice(i * shape[1], (i + 1) * shape[1]))
      : (() => {
        throw new Error(`Unsupported shape`)
      })()
  }

  // Metadata extraction for plots (no atomic coordinates)
  async extract_all_metadata(
    data: string | ArrayBuffer,
    options: MetadataExtractorOptions = {},
    on_progress?: (progress: ParseProgress) => void,
  ): Promise<TrajectoryMetadata[]> {
    if (!(data instanceof ArrayBuffer)) {
      throw new Error(`ASE metadata extractor requires binary data`)
    }

    const { sample_rate = 1, properties } = options
    const view = new DataView(data)

    // Validate signature and read header
    const signature = new TextDecoder().decode(new Uint8Array(data, 0, 8))
    if (signature !== `- of Ulm`) throw new Error(`Invalid ASE trajectory`)

    const n_items = Number(view.getBigInt64(32, true))
    const offsets_pos = Number(view.getBigInt64(40, true))

    // Read frame offsets
    const frame_offsets: number[] = []
    let offset = offsets_pos
    for (let idx = 0; idx < n_items; idx++) {
      frame_offsets.push(Number(view.getBigInt64(offset, true)))
      offset += 8
    }

    const metadata_list: TrajectoryMetadata[] = []

    // Process frames according to sample rate
    for (let idx = 0; idx < n_items; idx += sample_rate) {
      try {
        offset = frame_offsets[idx]
        const json_length = Number(view.getBigInt64(offset, true))
        offset += 8

        // Safety check for JSON size
        if (json_length > 50 * 1024 * 1024) { // 50MB limit for metadata
          console.warn(
            `Skipping large frame ${idx}: ${Math.round(json_length / 1024 / 1024)}MB`,
          )
          continue
        }

        // Parse only the JSON metadata, not the arrays
        const json_str = new TextDecoder().decode(
          new Uint8Array(data, offset, json_length),
        )
        const frame_data = JSON.parse(json_str)

        const frame_metadata = this.parse_ase_metadata(frame_data, idx)

        // Filter properties if specified
        if (properties) {
          const filtered_properties: Record<string, number> = {}
          for (const prop of properties) {
            if (prop in frame_metadata.properties) {
              filtered_properties[prop] = frame_metadata.properties[prop]
            }
          }
          frame_metadata.properties = filtered_properties
        }

        metadata_list.push(frame_metadata)

        // Progress reporting (less frequent for performance)
        if (on_progress && idx % 5000 === 0) {
          on_progress({
            current: (idx / n_items) * 100,
            total: 100,
            stage: `Extracting metadata: ${idx}/${n_items}`,
          })
        }
      } catch (error) {
        console.warn(`Failed to extract metadata from ASE frame ${idx}:`, error)
        continue
      }
    }

    return metadata_list
  }

  private parse_ase_metadata(
    frame_data: Record<string, unknown>,
    frame_number: number,
  ): TrajectoryMetadata {
    const properties: Record<string, number> = {}
    const step = frame_number // ASE uses frame index as step

    // Extract calculator properties (energies, forces, etc.)
    if (frame_data.calculator && typeof frame_data.calculator === `object`) {
      const calculator = frame_data.calculator as Record<string, unknown>

      // Common calculator properties
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

      // Look for force and stress statistics
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
        properties.volume = Math.abs(math.det_3x3(cell as Matrix3x3))
      }
    }

    return {
      frame_number,
      step,
      properties,
    }
  }
}

// Factory functions
export function create_streaming_parser(filename: string): StreamingFrameParser {
  const lower_name = filename.toLowerCase()

  if (lower_name.endsWith(`.traj`)) {
    return new ASEStreamingParser()
  } else if (lower_name.match(/\.(xyz|extxyz)$/)) {
    return new XYZStreamingParser()
  }

  throw new Error(`Unsupported format for streaming: ${filename}`)
}

export function create_metadata_extractor(filename: string): MetadataExtractor {
  const lower_name = filename.toLowerCase()

  if (lower_name.endsWith(`.traj`)) {
    return new ASEStreamingParser()
  } else if (lower_name.match(/\.(xyz|extxyz)$/)) {
    return new XYZStreamingParser()
  }

  throw new Error(`Unsupported format for metadata extraction: ${filename}`)
}
