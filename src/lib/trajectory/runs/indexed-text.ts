// Lazily decoded run over a large in-memory XYZ/EXTXYZ text or ASE .traj buffer. Owns the
// payload and a private frame index (line offsets for XYZ, the ULM offsets table for ASE);
// frames are decoded on read and cached by the session, never all at once. Per-frame scalars
// for the plot are extracted progressively in chunks so a 100k-frame open stays responsive.
import * as math from '$lib/math'
import { to_error } from '$lib/utils'
import { copy_numeric_fields, validate_3x3_matrix } from '../helpers'
import type { TrajectoryFrame, TrajectoryMetadata } from '../index'
import { ase_calculator_data, decode_ase_frame, read_ase_header } from '../parse/ase'
import type { WarningCollector } from '../parse/shared'
import {
  build_xyz_frame,
  index_xyz_frames,
  parse_extxyz_lattice,
  parse_xyz_comment_metadata,
} from '../parse/xyz'
import {
  assert_frame_idx,
  disposed_error,
  TrajectoryProperties,
  type TrajectoryProvenance,
  type TrajectoryRun,
} from '../run'
import { accumulate_positions } from './accumulate'

const MAX_ASE_HEADER_BYTES = 50 * 1024 * 1024
// Rows per batch pushed into `properties` before yielding to the event loop
const PROPERTY_BATCH = 2000

const ASE_PLOT_SCALARS = [
  `energy`,
  `potential_energy`,
  `kinetic_energy`,
  `total_energy`,
  `force_max`,
  `force_norm`,
  `stress_max`,
  `stress_frobenius`,
  `pressure`,
  `temperature`,
  `bandgap`,
]

const yield_to_event_loop = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0))

// Shared plumbing: frame_count, cached preview, property streaming and disposal
interface FrameSource {
  format: `xyz` | `ase`
  frame_count: number
  decode: (frame_idx: number) => TrajectoryFrame
  property_row: (frame_idx: number) => TrajectoryMetadata
  release: () => void
}

const run_from_source = (
  source: FrameSource,
  provenance: TrajectoryProvenance,
  collector: WarningCollector,
): TrajectoryRun => {
  const { frame_count } = source
  if (frame_count < 1) throw new Error(`No complete ${source.format} frames found`)
  const preview = source.decode(0)
  const properties = new TrajectoryProperties()
  let disposed = false
  const live = (): FrameSource => {
    if (disposed) throw disposed_error(`Indexed ${source.format} trajectory`)
    return source
  }
  const read_frame = (frame_idx: number): TrajectoryFrame => {
    assert_frame_idx({ frame_count }, frame_idx)
    return frame_idx === 0 ? preview : live().decode(frame_idx)
  }
  void (async () => {
    for (let start = 0; start < frame_count; start += PROPERTY_BATCH) {
      if (disposed) break
      const end = Math.min(start + PROPERTY_BATCH, frame_count)
      const batch: TrajectoryMetadata[] = []
      for (let frame_idx = start; frame_idx < end; frame_idx++) {
        try {
          batch.push(source.property_row(frame_idx))
        } catch (error) {
          collector.warn(`Skipping plot data of frame ${frame_idx}`, error)
        }
      }
      properties.push(batch)
      if (end < frame_count) await yield_to_event_loop()
    }
    properties.finish()
  })()
  return {
    frame_count,
    preview,
    provenance: { ...provenance, format: source.format },
    properties,
    metadata: {},
    warnings: collector.warnings,
    read_frame,
    collect_positions: async (options) => {
      live()
      return accumulate_positions(frame_count, read_frame, options)
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      properties.finish()
      source.release()
    },
  }
}

// === XYZ / EXTXYZ ===

const xyz_source = (data: string, collector: WarningCollector): FrameSource => {
  let lines: string[] | null = data.trim().split(/\r?\n/)
  // a torn tail is dropped now so frame_count excludes it, rather than failing on the seek
  const frames = index_xyz_frames(lines, collector.warn)
  const live_lines = (): string[] => {
    if (!lines) throw disposed_error(`Indexed XYZ trajectory`)
    return lines
  }
  return {
    format: `xyz`,
    frame_count: frames.length,
    decode: (frame_idx) =>
      build_xyz_frame(
        live_lines(),
        frames[frame_idx],
        { frame_label: `indexed frame ${frame_idx}`, default_step: frame_idx },
        collector,
      ),
    property_row: (frame_idx) => {
      const { comment } = frames[frame_idx]
      const { step, properties } = parse_xyz_comment_metadata(comment)
      if (properties.volume === undefined) {
        const lattice = parse_extxyz_lattice(comment)
        if (lattice) properties.volume = Math.abs(math.det_3x3(lattice))
      }
      return { frame_number: frame_idx, step: step ?? frame_idx, properties }
    },
    release: () => {
      lines = null
      frames.length = 0
    },
  }
}

// === ASE ULM .traj ===

const ase_source = (data: ArrayBuffer): FrameSource => {
  let buffer: ArrayBuffer | null = data
  let view: DataView | null = new DataView(data)
  const { n_items, offsets_pos } = read_ase_header(view)
  if (n_items < 1 || offsets_pos < 0 || offsets_pos + n_items * 8 > data.byteLength) {
    throw new Error(
      `Invalid ASE frame offsets table bounds: offsets_pos=${offsets_pos}, n_items=${n_items}, byte_length=${data.byteLength}`,
    )
  }
  // ASE writes atomic numbers into the first frame only
  let numbers: number[] | undefined
  const live = (): { buffer: ArrayBuffer; view: DataView } => {
    if (!buffer || !view) throw disposed_error(`Indexed ASE trajectory`)
    return { buffer, view }
  }
  const frame_offset = (frame_idx: number): number =>
    Number(live().view.getBigInt64(offsets_pos + frame_idx * 8, true))
  const decode = (frame_idx: number): TrajectoryFrame => {
    if (frame_idx > 0 && !numbers) decode(0)
    const offset = frame_offset(frame_idx)
    try {
      const decoded = decode_ase_frame(live().view, live().buffer, offset, frame_idx, {
        fallback_numbers: numbers,
        max_json_length: MAX_ASE_HEADER_BYTES,
      })
      numbers = decoded.numbers
      return decoded.frame
    } catch (error) {
      throw new Error(
        `ASE trajectory frame ${frame_idx} of ${n_items} (byte offset ${offset}): ${to_error(error).message}`,
        { cause: error },
      )
    }
  }
  const decoder = new TextDecoder()
  return {
    format: `ase`,
    frame_count: n_items,
    decode,
    property_row: (frame_idx) => {
      const offset = frame_offset(frame_idx)
      const json_length = Number(live().view.getBigInt64(offset, true))
      // A header this large can only be a corrupt offsets table pointing into payload bytes
      if (!(json_length >= 0 && json_length <= MAX_ASE_HEADER_BYTES)) {
        throw new Error(
          `ASE trajectory frame ${frame_idx} of ${n_items} (byte offset ${offset}) declares a ${json_length} byte header`,
        )
      }
      const current_source = live()
      const header = new Uint8Array(current_source.buffer, offset + 8, json_length)
      const frame_data: Record<string, unknown> = JSON.parse(decoder.decode(header))
      // ASE puts computed results in the calculator and user-set values in `info`, but which
      // scalar lands where is up to whoever wrote the file, so both sections get every alias
      const properties: Record<string, number> = {}
      for (const section of [ase_calculator_data(frame_data), frame_data.info]) {
        if (section && typeof section === `object`) {
          copy_numeric_fields(properties, section as Record<string, unknown>, ASE_PLOT_SCALARS)
        }
      }
      if (frame_data.cell) {
        properties.volume = Math.abs(math.det_3x3(validate_3x3_matrix(frame_data.cell)))
      }
      return { frame_number: frame_idx, step: frame_idx, properties }
    },
    release: () => {
      buffer = null
      view = null
    },
  }
}

export const indexed_text_run = (
  data: string | ArrayBuffer,
  format: `xyz` | `ase`,
  provenance: TrajectoryProvenance,
  collector: WarningCollector,
): TrajectoryRun => {
  if (format === `xyz` && typeof data !== `string`) {
    throw new TypeError(`Indexed XYZ trajectories need text data, got ArrayBuffer`)
  }
  if (format === `ase` && !(data instanceof ArrayBuffer)) {
    throw new TypeError(`Indexed ASE trajectories need binary data, got text`)
  }
  const source =
    format === `xyz` ? xyz_source(data as string, collector) : ase_source(data as ArrayBuffer)
  return run_from_source(source, provenance, collector)
}
