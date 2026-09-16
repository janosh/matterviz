import { encode_frame } from '../frame'
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
  xyz_frame_force_stats,
} from '../parse/xyz'
import type { TrajectoryProvenance, TrajectoryRun } from '../run'
import { sync_run, TrajectoryProperties } from '../run'
import { accumulate_positions } from './accumulate'

// Bound both cheap row counts and expensive per-atom force scans between event-loop turns.
const PROPERTY_BATCH = 2000
const PROPERTY_BUDGET_MS = 8

const yield_to_event_loop = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0))

// === XYZ / EXTXYZ ===

const xyz_source = (data: string, collector: WarningCollector): AseFrames => {
  // Offsets into the untouched text, never an array of line strings (see iter_xyz_frames);
  // a torn tail is dropped now so frame_count excludes it, rather than failing on the seek
  let text = data
  const frames = index_xyz_frames(text, collector.warn)
  return {
    frame_count: frames.length,
    decode: (frame_idx): TrajectoryFrame =>
      build_xyz_frame(
        text,
        frames[frame_idx],
        { frame_label: `indexed frame ${frame_idx}`, default_step: frame_idx },
        collector,
      ),
    property_row: (frame_idx) => {
      const spec = frames[frame_idx]
      const { comment } = spec
      const { step, properties } = parse_xyz_comment_metadata(comment)
      if (properties.volume === undefined) {
        const lattice = parse_extxyz_lattice(comment)
        if (lattice) properties.volume = Math.abs(math.det_3x3(lattice))
      }
      // Per-atom `forces` columns, like build_xyz_frame reads for the materialized path (and
      // overriding a comment-level fmax the same way). Which path opens a file is decided by
      // its byte size alone, so leaving these to the comment lost the force curve of every
      // file above the indexing threshold that writes forces per atom.
      const force_stats = xyz_frame_force_stats(text, spec)
      if (force_stats) Object.assign(properties, force_stats)
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
  let source: AseFrames
  if (format === `xyz`) {
    if (typeof data !== `string`) {
      throw new TypeError(`Indexed XYZ trajectories need text data, got ArrayBuffer`)
    }
    source = xyz_source(data, collector)
  } else {
    if (!(data instanceof ArrayBuffer)) {
      throw new TypeError(`Indexed ASE trajectories need binary data, got text`)
    }
    source = open_ase_frames(data)
  }
  const { frame_count, decode } = source
  const properties = new TrajectoryProperties()
  const run = sync_run({
    label: `Indexed ${format} trajectory`,
    frame_count,
    read: (frame_idx) => encode_frame(decode(frame_idx)),
    provenance: { ...provenance, format },
    properties,
    metadata: {},
    warnings: collector.warnings,
    collect_positions: (options) => accumulate_positions(frame_count, decode, options),
    release: source.release,
  })
  // Yield before each batch so the preview appears before scanning property columns.
  // Disposal finishes `properties`, stopping work on the next event-loop turn.
  void (async () => {
    try {
      for (let frame_idx = 0; frame_idx < frame_count;) {
        await yield_to_event_loop()
        if (properties.complete) return
        const end = Math.min(frame_idx + PROPERTY_BATCH, frame_count)
        const deadline = performance.now() + PROPERTY_BUDGET_MS
        const batch: TrajectoryMetadata[] = []
        do {
          try {
            batch.push(source.property_row(frame_idx))
          } catch (error) {
            collector.warn(`Skipping plot data of frame ${frame_idx}`, error)
          }
          frame_idx++
        } while (frame_idx < end && performance.now() < deadline)
        try {
          properties.push(batch)
        } catch (error) {
          // push() committed the rows and notified every subscriber before rethrowing.
          collector.warn(`Plot data subscriber failed after frame ${frame_idx - 1}`, error)
        }
      }
    } finally {
      properties.finish()
    }
  })().catch((error: unknown) =>
    collector.warn(`Indexed ${format} plot data extraction failed`, error),
  )
  return run
}
