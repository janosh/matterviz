// Lazily decoded run over a large in-memory XYZ/EXTXYZ, XDATCAR or LAMMPS dump text (a string,
// or TextLines over the chunks of text past one string) or ASE .traj buffer. Owns the payload
// and a private frame index (line offsets for the text formats, the ULM offsets table for
// ASE); frames are decoded on read and cached by the session, never all at once. Per-frame
// scalars for the plot are extracted progressively in chunks so a 100k-frame open stays
// responsive.
import { to_error } from '$lib/utils'
import { encode_frame } from '../frame'
import { TextLines } from '../helpers'
import type { AtomTypeMapping, TrajectoryFrame, TrajectoryMetadata } from '../index'
import { type AseFrames, open_ase_frames } from '../parse/ase'
import { open_lammps_frames } from '../parse/lammps'
import type { WarnFn, WarningCollector } from '../parse/shared'
import { open_xdatcar_frames } from '../parse/vasp'
import { frame_property_row } from '../extract'
import { build_xyz_frame, index_xyz_frames } from '../parse/xyz'
import type { TrajectoryProvenance, TrajectoryRun } from '../run'
import { sync_run, TrajectoryProperties } from '../run'
import { accumulate_positions } from './accumulate'

// Bound both cheap row counts and expensive per-atom force scans between event-loop turns.
const PROPERTY_BATCH = 2000
const PROPERTY_BUDGET_MS = 8

const yield_to_event_loop = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0))

// === XYZ / EXTXYZ ===

const xyz_source = (lines: TextLines, collector: WarningCollector): AseFrames => {
  // Line indices, never an array of line strings (see iter_xyz_frames); a torn tail is
  // dropped now so frame_count excludes it, rather than failing on the seek
  const frames = index_xyz_frames(lines, collector.warn)
  const decode = (frame_idx: number): TrajectoryFrame =>
    build_xyz_frame(
      lines,
      frames[frame_idx],
      { frame_label: `indexed frame ${frame_idx}`, default_step: frame_idx },
      collector,
    )
  // XYZ rows need the atom lines' forces, so a reduced decode saves little over a full one
  return { frame_count: frames.length, decode, plot_row_frame: decode }
}

export const indexed_text_run = (
  data: string | TextLines | ArrayBuffer,
  format: `xyz` | `ase` | `xdatcar` | `lammps`,
  provenance: TrajectoryProvenance,
  collector: WarningCollector,
  atom_type_mapping?: AtomTypeMapping,
): TrajectoryRun => {
  // A frame decodes for its plot row and again on every read, so each warning shows once
  const warn_once: WarnFn = (message, error) => {
    const text = error === undefined ? message : `${message}: ${to_error(error).message}`
    collector.warn_once(text, text)
  }
  // dispose drops `source`, the only holder of the payload and its frame index
  let source: AseFrames | null
  if (format === `ase`) {
    if (!(data instanceof ArrayBuffer)) {
      throw new TypeError(`Indexed ASE trajectories need binary data, got text`)
    }
    source = open_ase_frames(data, warn_once)
  } else {
    if (data instanceof ArrayBuffer) {
      throw new TypeError(`Indexed ${format} trajectories need text data, got ArrayBuffer`)
    }
    const lines = TextLines.of(data)
    if (format === `xyz`) source = xyz_source(lines, collector)
    else if (format === `xdatcar`) source = open_xdatcar_frames(lines, warn_once)
    else source = open_lammps_frames(lines, warn_once, atom_type_mapping)
  }
  const { frame_count } = source
  const decode = (frame_idx: number): TrajectoryFrame => {
    if (!source) throw new Error(`Indexed ${format} trajectory was released`)
    return source.decode(frame_idx)
  }
  const properties = new TrajectoryProperties()
  const run = sync_run({
    label: `Indexed ${format} trajectory`,
    frame_count,
    read: (frame_idx) => encode_frame(decode(frame_idx)),
    read_atoms: source.read_atoms,
    atom_masses: source.atom_masses,
    provenance: { ...provenance, format },
    properties,
    metadata: source.metadata ?? {},
    warnings: collector.warnings,
    collect_positions: (options) => accumulate_positions(frame_count, decode, options),
    release: () => {
      source?.release?.()
      source = null
    },
  })
  // Yield before each batch so the preview appears before scanning property columns.
  // Disposal finishes `properties`, stopping work on the next event-loop turn.
  void (async () => {
    try {
      for (let frame_idx = 0; frame_idx < frame_count;) {
        await yield_to_event_loop()
        if (properties.complete || !source) return
        const end = Math.min(frame_idx + PROPERTY_BATCH, frame_count)
        const deadline = performance.now() + PROPERTY_BUDGET_MS
        const batch: TrajectoryMetadata[] = []
        do {
          try {
            // Exactly an in-memory run's row; plot-row frames skip positions and sites
            batch.push(frame_property_row(source.plot_row_frame(frame_idx), frame_idx))
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
