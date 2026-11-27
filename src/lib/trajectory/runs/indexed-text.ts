// Lazily decoded run over a large in-memory XYZ/EXTXYZ, XDATCAR or LAMMPS dump text (a string,
// or TextLines over the chunks of text past one string) or ASE .traj buffer. Owns the payload
// and a private frame index (line offsets for the text formats, the ULM offsets table for
// ASE); frames are decoded on read and cached by the session, never all at once. Per-frame
// scalars for the plot are extracted progressively in chunks so a 100k-frame open stays
// responsive.
import { display_idx } from '#lib/labels'
import { to_error, yield_turn } from 'svelte-widgets/utils'
import { encode_frame, type NumericFrame } from '../frame'
import {
  create_plot_row_frame,
  iter_xyz_frames,
  TextLines,
  type XyzFrameSpec,
} from '../helpers'
import type { AtomTypeMapping, TrajectoryMetadata } from '../index'
import { type AseFrames, type ByteSource, open_ase_frames } from '../parse/ase'
import { open_lammps_frames } from '../parse/lammps'
import type { WarnFn, WarningCollector } from '../parse/shared'
import { open_xdatcar_frames } from '../parse/vasp'
import { frame_property_row } from '../extract'
import {
  build_xyz_frame,
  extxyz_run_metadata,
  index_xyz_frames,
  read_xyz_frame,
} from '../parse/xyz'
import type { TrajectoryProvenance, TrajectoryRun } from '../run'
import { sync_run, TrajectoryProperties } from '../run'
import { accumulate_positions } from './accumulate'

// Bound both cheap row counts and expensive per-atom force scans between event-loop turns.
const PROPERTY_BATCH = 2000
const PROPERTY_BUDGET_MS = 8

// === XYZ / EXTXYZ ===

// An XYZ file's frames by byte offset (index_xyz_file), each read off disk when asked for
export interface XyzFile {
  source: ByteSource
  offsets: readonly number[]
}
const is_xyz_file = (data: object | string): data is XyzFile =>
  typeof data === `object` && `offsets` in data

// Frames are read a block at a time, a block being the frames starting in one 1 MiB stretch of
// the file: a read, a decode and a line index per frame cost a file of small frames more than
// decoding them. The two blocks last used stay decoded (playback and the property pass each
// walk their own), and their fixed boundaries make stepping backward read each block once.
const XYZ_BLOCK_BYTES = 2 ** 20
const xyz_file_frames = ({ source, offsets }: XyzFile) => {
  const decoder = new TextDecoder()
  const block_of = (frame_idx: number) => Math.floor(offsets[frame_idx] / XYZ_BLOCK_BYTES)
  let blocks: { first: number; lines: TextLines; frames: XyzFrameSpec[] }[] = []
  return (frame_idx: number): [TextLines, XyzFrameSpec] => {
    const cached = blocks.findIndex(
      ({ first, frames }) => frame_idx >= first && frame_idx < first + frames.length,
    )
    if (cached === 1) blocks.reverse()
    else if (cached === -1) {
      const block = block_of(frame_idx)
      let [first, end] = [frame_idx, frame_idx + 1]
      while (first > 0 && block_of(first - 1) === block) first--
      while (end < offsets.length - 1 && block_of(end) === block) end++
      const bytes = source.read(offsets[first], offsets[end] - offsets[first])
      const lines = new TextLines(decoder.decode(bytes))
      const frames = [...iter_xyz_frames(lines)]
      if (frames.length !== end - first)
        throw new Error(
          `XYZ file changed on disk since it was indexed (reading frame ${display_idx(frame_idx)})`,
        )
      blocks = [{ first, lines, frames }, ...blocks.slice(0, 1)]
    }
    const { first, lines, frames } = blocks[0]
    return [lines, frames[frame_idx - first]]
  }
}

// `frame_at` locates a frame by line index, never in an array of line strings (see
// iter_xyz_frames): in the text held in memory, or in the frame's own lines read from a file
const xyz_source = (
  frame_count: number,
  frame_at: (frame_idx: number) => [TextLines, XyzFrameSpec],
  collector: WarningCollector,
): AseFrames => {
  const args = (frame_idx: number) =>
    [
      ...frame_at(frame_idx),
      { frame_label: `indexed frame ${display_idx(frame_idx)}`, default_step: frame_idx },
      collector,
    ] as const
  return {
    frame_count,
    read: (frame_idx) => {
      const frame = args(frame_idx)
      return read_xyz_frame(...frame) ?? encode_frame(build_xyz_frame(...frame))
    },
    decode: (frame_idx) => build_xyz_frame(...args(frame_idx)),
    // A row needs the forces' statistics, so it reads the numeric frame and drops its atoms;
    // a frame the numeric reader leaves to build_xyz_frame serves as its own row
    plot_row_frame: (frame_idx) => {
      const frame = args(frame_idx)
      const numeric = read_xyz_frame(...frame)
      if (!numeric) return build_xyz_frame(...frame)
      const { header, structure, sites } = numeric
      const { lattice } = structure
      return create_plot_row_frame(
        sites,
        lattice?.matrix,
        lattice?.pbc,
        header.step,
        header.metadata ?? {},
        collector.warn,
      )
    },
    metadata: extxyz_run_metadata(frame_count > 0 ? frame_at(0)[1].comment : undefined),
  }
}

export const indexed_text_run = (
  // A host's open file, read on demand: a ByteSource (ASE) or an XyzFile, else the payload
  data: string | TextLines | ArrayBuffer | ByteSource | XyzFile,
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
  const xyz_collector = { ...collector, warn: warn_once }
  if (is_xyz_file(data)) {
    const frames = xyz_source(data.offsets.length - 1, xyz_file_frames(data), xyz_collector)
    source = { ...frames, release: data.source.release }
  } else if (format === `ase`) {
    if (typeof data === `string` || data instanceof TextLines) {
      throw new TypeError(`Indexed ASE trajectories need binary data, got text`)
    }
    source = open_ase_frames(data, warn_once)
  } else {
    if (typeof data !== `string` && !(data instanceof TextLines)) {
      throw new TypeError(`Indexed ${format} trajectories need text data, got bytes`)
    }
    const lines = TextLines.of(data)
    if (format === `xyz`) {
      const frames = index_xyz_frames(lines, warn_once)
      source = xyz_source(
        frames.length,
        (frame_idx) => [lines, frames[frame_idx]],
        xyz_collector,
      )
    } else if (format === `xdatcar`) source = open_xdatcar_frames(lines, warn_once)
    else source = open_lammps_frames(lines, warn_once, atom_type_mapping)
  }
  const { frame_count } = source
  const read = (frame_idx: number): NumericFrame => {
    if (!source) throw new Error(`Indexed ${format} trajectory was released`)
    return source.read(frame_idx)
  }
  const properties = new TrajectoryProperties()
  const run = sync_run({
    label: `Indexed ${format} trajectory`,
    frame_count,
    read,
    read_atoms: source.read_atoms,
    atom_masses: source.atom_masses,
    provenance: { ...provenance, format },
    properties,
    metadata: source.metadata ?? {},
    warnings: collector.warnings,
    subscribe_warnings: collector.subscribe,
    collect_positions: (options) => accumulate_positions(frame_count, read, options),
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
        await yield_turn()
        if (properties.complete || !source) return
        const end = Math.min(frame_idx + PROPERTY_BATCH, frame_count)
        const deadline = performance.now() + PROPERTY_BUDGET_MS
        const batch: TrajectoryMetadata[] = []
        do {
          try {
            // Exactly an in-memory run's row; plot-row frames skip positions and sites
            batch.push(frame_property_row(source.plot_row_frame(frame_idx), frame_idx))
          } catch (error) {
            collector.warn(`Skipping plot data of frame ${display_idx(frame_idx)}`, error)
          }
          frame_idx++
        } while (frame_idx < end && performance.now() < deadline)
        try {
          properties.push(batch)
        } catch (error) {
          // push() committed the rows and notified every subscriber before rethrowing.
          collector.warn(`Plot data subscriber failed after frame ${frame_idx}`, error)
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
