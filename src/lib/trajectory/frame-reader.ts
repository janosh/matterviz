// Unified frame loader for XYZ and ASE trajectories (large file indexing)
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
  copy_numeric_fields,
  count_xyz_frames,
  iter_xyz_frames,
  validate_3x3_matrix,
} from './helpers'
import { strip_compression_extensions } from '$lib/io'
import { decode_ase_frame, read_ase_header } from './parse/ase'
import { build_xyz_frame, parse_xyz_comment_metadata } from './parse/xyz'

// Restrict frame metadata to the requested property keys (no-op when unset)
const filter_properties = (metadata: TrajectoryMetadata, properties?: string[]): void => {
  if (!properties) return
  metadata.properties = Object.fromEntries(
    Object.entries(metadata.properties).filter(([key]) => properties.includes(key)),
  )
}

export class TrajFrameReader implements FrameLoader {
  private readonly format: `xyz` | `ase`
  private global_numbers?: number[]
  // Split lines + per-frame start indices for the last XYZ payload, so repeat seeks are
  // O(1) lookup instead of re-splitting + rescanning from line 0 (was O(n²) over playback)
  private xyz_cache?: { data: string; lines: string[]; frame_starts: number[] }

  constructor(filename: string) {
    const base_filename = strip_compression_extensions(filename)
    this.format = base_filename.endsWith(`.traj`) ? `ase` : `xyz`
  }

  async get_total_frames(data: string | ArrayBuffer): Promise<number> {
    if (this.format === `xyz`) {
      if (data instanceof ArrayBuffer) throw new Error(`XYZ loader requires text data`)
      return count_xyz_frames(data)
    }
    if (!(data instanceof ArrayBuffer)) throw new Error(`ASE loader requires binary data`)
    return read_ase_header(new DataView(data)).n_items
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
      const line_bytes = (idx: number): number =>
        encoder.encode(lines[idx]).length + newline_byte_len

      // cursor = next line whose bytes haven't been added to byte_offset yet
      let [current_frame, cursor, byte_offset] = [0, 0, 0]

      for (const { start, num_atoms } of iter_xyz_frames(lines)) {
        if (current_frame >= total_frames) break

        // Accumulate bytes of blank/invalid lines skipped before this frame
        for (; cursor < start; cursor++) byte_offset += line_bytes(cursor)
        let frame_size = 0
        for (; cursor < start + num_atoms + 2; cursor++) frame_size += line_bytes(cursor)

        if (current_frame % sample_rate === 0) {
          frame_index.push({
            frame_number: current_frame,
            byte_offset,
            estimated_size: frame_size,
          })
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
      const { offsets_pos } = read_ase_header(view)

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

  async load_frame(
    data: string | ArrayBuffer,
    frame_number: number,
  ): Promise<TrajectoryFrame | null> {
    const actual_data_type = data instanceof ArrayBuffer ? `ArrayBuffer` : typeof data

    if (this.format === `xyz`) {
      if (typeof data !== `string`) {
        throw new TypeError(
          `load_frame expected string data for xyz format, received ${actual_data_type}`,
        )
      }
      return this.load_xyz_frame(data, frame_number)
    }
    if (!(data instanceof ArrayBuffer)) {
      throw new TypeError(
        `load_frame expected ArrayBuffer data for ase format, received ${actual_data_type}`,
      )
    }
    return this.load_ase_frame(data, frame_number)
  }

  async extract_plot_metadata(
    data: string | ArrayBuffer,
    options?: { sample_rate?: number; properties?: string[] },
    on_progress?: (progress: ParseProgress) => void,
  ): Promise<TrajectoryMetadata[]> {
    const { sample_rate = 1, properties } = options ?? {}
    const metadata_list: TrajectoryMetadata[] = []
    const total_frames = await this.get_total_frames(data)

    if (this.format === `xyz`) {
      const lines = (data as string).trim().split(/\r?\n/)
      let current_frame = 0

      for (const { start, comment } of iter_xyz_frames(lines)) {
        if (current_frame >= total_frames) break

        if (current_frame % sample_rate === 0) {
          let frame_metadata: TrajectoryMetadata | null = null
          try {
            const { step, properties: props } = parse_xyz_comment_metadata(comment)
            frame_metadata = {
              frame_number: current_frame,
              step: step ?? current_frame,
              properties: props,
            }
          } catch (error) {
            console.warn(
              `Failed to parse XYZ metadata for frame ${current_frame} at line ${start + 1}:`,
              error,
            )
          }

          if (frame_metadata) {
            filter_properties(frame_metadata, properties)
            metadata_list.push(frame_metadata)
          }
        }

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
      const { n_items, offsets_pos } = read_ase_header(view)

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

          const frame_data = JSON.parse(
            new TextDecoder().decode(
              new Uint8Array(data as ArrayBuffer, frame_offset + 8, json_length),
            ),
          )

          const frame_metadata = this.parse_ase_metadata(frame_data, idx)
          filter_properties(frame_metadata, properties)
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

  // Build + cache the line array and per-frame start indices once per payload
  private get_xyz_cache(data: string): { lines: string[]; frame_starts: number[] } {
    if (this.xyz_cache?.data === data) return this.xyz_cache
    const lines = data.trim().split(/\r?\n/)
    const frame_starts = Array.from(iter_xyz_frames(lines), ({ start }) => start)
    this.xyz_cache = { data, lines, frame_starts }
    return this.xyz_cache
  }

  private load_xyz_frame(data: string, frame_number: number): TrajectoryFrame | null {
    const { lines, frame_starts } = this.get_xyz_cache(data)
    const start = frame_starts[frame_number]
    if (start === undefined) return null // out-of-range frame

    const num_atoms = parseInt(lines[start]?.trim(), 10)
    const comment = lines[start + 1] ?? ``
    return build_xyz_frame(
      lines,
      { start, num_atoms, comment },
      {
        frame_label: `indexed frame ${frame_number}`,
        default_step: frame_number,
      },
    )
  }

  private load_ase_frame(data: ArrayBuffer, frame_number: number): TrajectoryFrame | null {
    try {
      const view = new DataView(data)
      const { n_items, offsets_pos } = read_ase_header(view)

      if (frame_number >= n_items) return null

      const frame_offset = Number(view.getBigInt64(offsets_pos + frame_number * 8, true))
      const { frame, numbers } = decode_ase_frame(
        view,
        data,
        frame_offset,
        frame_number,
        this.global_numbers,
      )
      this.global_numbers = numbers
      return frame
    } catch (error) {
      console.warn(`Failed to load ASE frame ${frame_number}:`, error)
      return null
    }
  }

  private parse_ase_metadata(
    frame_data: Record<string, unknown>,
    frame_number: number,
  ): TrajectoryMetadata {
    const properties: Record<string, number> = {}
    const step = frame_number

    if (frame_data.calculator && typeof frame_data.calculator === `object`) {
      copy_numeric_fields(properties, frame_data.calculator as Record<string, unknown>, [
        `energy`,
        `potential_energy`,
        `kinetic_energy`,
        `total_energy`,
      ])
    }

    if (frame_data.info && typeof frame_data.info === `object`) {
      copy_numeric_fields(properties, frame_data.info as Record<string, unknown>, [
        `force_max`,
        `force_norm`,
        `stress_max`,
        `stress_frobenius`,
        `pressure`,
        `temperature`,
      ])
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
