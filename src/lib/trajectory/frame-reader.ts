// Unified frame loader for XYZ and ASE trajectories (large file indexing)
import type { ElementSymbol } from '$lib/element'
import * as math from '$lib/math'
import type {
  FrameIndex,
  FrameLoader,
  ParseProgress,
  TrajectoryFrame,
  TrajectoryMetadata,
} from './index'
import { MAX_METADATA_SIZE } from './constants'
import {
  convert_atomic_numbers,
  count_xyz_frames,
  create_trajectory_frame,
  read_ndarray_from_view,
  validate_3x3_matrix,
} from './helpers'

export class TrajFrameReader implements FrameLoader {
  private format: `xyz` | `ase`
  private global_numbers?: number[]

  constructor(filename: string) {
    this.format = filename.toLowerCase().endsWith(`.traj`) ? `ase` : `xyz`
  }

  // deno-lint-ignore require-await
  async get_total_frames(data: string | ArrayBuffer): Promise<number> {
    if (this.format === `xyz`) {
      if (data instanceof ArrayBuffer) throw new Error(`XYZ loader requires text data`)
      return count_xyz_frames(data)
    }
    if (!(data instanceof ArrayBuffer)) throw new Error(`ASE loader requires binary data`)
    const view = new DataView(data)
    return Number(view.getBigInt64(32, true))
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
      const encoder = new TextEncoder()
      const newline_sequence = data_str.includes(`\r\n`) ? `\r\n` : `\n`
      const newline_byte_len = encoder.encode(newline_sequence).length

      let [current_frame, line_idx, byte_offset] = [0, 0, 0]

      while (line_idx < lines.length && current_frame < total_frames) {
        if (!lines[line_idx]?.trim()) {
          byte_offset += encoder.encode(lines[line_idx]).length + newline_byte_len
          line_idx++
          continue
        }

        const num_atoms = parseInt(lines[line_idx].trim(), 10)
        if (
          isNaN(num_atoms) || num_atoms <= 0 || line_idx + num_atoms + 1 >= lines.length
        ) {
          byte_offset += encoder.encode(lines[line_idx]).length + newline_byte_len
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

        const frame_start = line_idx
        line_idx += 2 + num_atoms
        let frame_size = 0
        for (let idx = frame_start; idx < line_idx; idx++) {
          frame_size += encoder.encode(lines[idx]).length + newline_byte_len
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
      const view = new DataView(data as ArrayBuffer)
      const offsets_pos = Number(view.getBigInt64(40, true))

      for (let idx = 0; idx < total_frames; idx += sample_rate) {
        const frame_offset = Number(view.getBigInt64(offsets_pos + idx * 8, true))
        frame_index.push({
          frame_number: idx,
          byte_offset: frame_offset,
          estimated_size: 0,
        })

        if (on_progress && idx % 10000 === 0) {
          on_progress({
            current: (idx / total_frames) * 100,
            total: 100,
            stage: `Indexing ASE: ${idx}`,
          })
        }
      }
    }

    return frame_index
  }

  // deno-lint-ignore require-await
  async load_frame(
    data: string | ArrayBuffer,
    frame_number: number,
  ): Promise<TrajectoryFrame | null> {
    if (this.format === `xyz`) return this.load_xyz_frame(data as string, frame_number)
    return this.load_ase_frame(data as ArrayBuffer, frame_number)
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
      const view = new DataView(data as ArrayBuffer)
      const n_items = Number(view.getBigInt64(32, true))
      const offsets_pos = Number(view.getBigInt64(40, true))

      for (let idx = 0; idx < n_items; idx += sample_rate) {
        try {
          const frame_offset = Number(view.getBigInt64(offsets_pos + idx * 8, true))
          const json_length = Number(view.getBigInt64(frame_offset, true))

          if (json_length > MAX_METADATA_SIZE) {
            console.warn(
              `Skipping large frame ${idx}: ${Math.round(json_length / 1024 / 1024)}MB`,
            )
            continue
          }

          const frame_data = JSON.parse(new TextDecoder().decode(
            new Uint8Array(data as ArrayBuffer, frame_offset + 8, json_length),
          ))

          const frame_metadata = this.parse_ase_metadata(frame_data, idx)

          if (properties) {
            const filtered = Object.fromEntries(
              Object.entries(frame_metadata.properties).filter(([key]) =>
                properties.includes(key)
              ),
            )
            frame_metadata.properties = filtered
          }

          metadata_list.push(frame_metadata)

          if (on_progress && idx % 5000 === 0) {
            on_progress({
              current: (idx / n_items) * 100,
              total: 100,
              stage: `Extracting ASE: ${idx}/${n_items}`,
            })
          }
        } catch (error) {
          console.warn(`Failed to extract metadata from ASE frame ${idx}:`, error)
        }
      }
    }

    return metadata_list
  }

  private load_xyz_frame(data: string, frame_number: number): TrajectoryFrame | null {
    const lines = data.trim().split(/\r?\n/)
    let [current_frame, line_idx] = [0, 0]

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

    if (line_idx >= lines.length) return null
    const num_atoms = parseInt(lines[line_idx].trim(), 10)
    if (isNaN(num_atoms) || line_idx + num_atoms + 1 >= lines.length) return null

    const comment = lines[line_idx + 1] || ``
    const positions: number[][] = []
    const elements: ElementSymbol[] = []

    for (let idx = 0; idx < num_atoms; idx++) {
      const parts = lines[line_idx + 2 + idx]?.trim().split(/\s+/)
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

      const positions_ref = frame_data[`positions.`] || frame_data.positions
      const positions = positions_ref?.ndarray
        ? read_ndarray_from_view(view, positions_ref)
        : positions_ref as number[][]

      const numbers_ref = frame_data[`numbers.`] || frame_data.numbers ||
        this.global_numbers
      const numbers: number[] = numbers_ref?.ndarray
        ? read_ndarray_from_view(view, numbers_ref).flat()
        : numbers_ref as number[]

      if (numbers) this.global_numbers = numbers
      if (!numbers || !positions) throw new Error(`Missing atomic numbers or positions`)

      const cell = frame_data.cell ? validate_3x3_matrix(frame_data.cell) : undefined
      const metadata: Record<string, unknown> = {
        step: frame_number,
        ...(frame_data.calculator || {}),
        ...(frame_data.info || {}),
      }

      if (cell) {
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

  private parse_xyz_metadata(
    comment: string,
    frame_number: number,
  ): TrajectoryMetadata {
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

    if (frame_data.cell && Array.isArray(frame_data.cell)) {
      try {
        const validated_cell = validate_3x3_matrix(frame_data.cell)
        properties.volume = Math.abs(math.det_3x3(validated_cell))
      } catch (error) {
        console.warn(`Failed to calculate volume for ASE frame ${frame_number}:`, error)
      }
    }

    return { frame_number, step, properties }
  }
}
