// Lazily decoded run over a large in-memory XYZ/EXTXYZ text or ASE .traj buffer. Owns the
// payload and a private frame index (line offsets for XYZ, the ULM offsets table for ASE);
// frames are decoded on read and cached by the session, never all at once. Per-frame scalars
// for the plot are extracted progressively in chunks so a 100k-frame open stays responsive.
import * as math from '$lib/math'
import type { TrajectoryFrame, TrajectoryMetadata } from '../index'
import { type AseFrames, open_ase_frames } from '../parse/ase'
import type { WarningCollector } from '../parse/shared'
import {
  build_xyz_frame,
  index_xyz_frames,
  parse_extxyz_lattice,
  parse_xyz_comment_metadata,
} from '../parse/xyz'
import type { TrajectoryProvenance, TrajectoryRun } from '../run'
import { sync_run, TrajectoryProperties } from '../run'
import { accumulate_positions } from './accumulate'

// Rows per batch pushed into `properties` before yielding to the event loop
const PROPERTY_BATCH = 2000

const yield_to_event_loop = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0))

type FrameSource = AseFrames & { format: `xyz` | `ase` }

const run_from_source = (
  source: FrameSource,
  provenance: TrajectoryProvenance,
  collector: WarningCollector,
): TrajectoryRun => {
  const { frame_count, format, decode } = source
  const properties = new TrajectoryProperties()
  // Disposal finishes `properties`, which is what stops this loop
  void (async () => {
    for (let start = 0; start < frame_count; start += PROPERTY_BATCH) {
      if (properties.complete) return
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
  return sync_run({
    label: `Indexed ${format} trajectory`,
    frame_count,
    read: decode,
    provenance: { ...provenance, format },
    properties,
    metadata: {},
    warnings: collector.warnings,
    collect_positions: (options) => accumulate_positions(frame_count, decode, options),
    release: source.release,
  })
}

// === XYZ / EXTXYZ ===

const xyz_source = (data: string, collector: WarningCollector): FrameSource => {
  // Offsets into the untouched text, never an array of line strings (see iter_xyz_frames);
  // a torn tail is dropped now so frame_count excludes it, rather than failing on the seek
  let text = data
  const frames = index_xyz_frames(text, collector.warn)
  return {
    format: `xyz`,
    frame_count: frames.length,
    decode: (frame_idx): TrajectoryFrame =>
      build_xyz_frame(
        text,
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
    // sync_run refuses reads after dispose, so dropping the text here only frees it
    release: () => {
      text = ``
      frames.length = 0
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
  const source: FrameSource =
    format === `xyz`
      ? xyz_source(data as string, collector)
      : { format: `ase`, ...open_ase_frames(data as ArrayBuffer) }
  return run_from_source(source, provenance, collector)
}
