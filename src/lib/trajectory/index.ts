// Utility functions for working with trajectory data
import type { ComponentProps } from 'svelte'
import type { ElementSymbol } from '$lib/element'
import type { FileLoadData } from '$lib/io/types'
import type { Matrix3x3 } from '$lib/math'
import type { AnyStructure, Pbc } from '$lib/structure/index'
import type Trajectory from './Trajectory.svelte'

export { default as Trajectory } from './Trajectory.svelte'
export { default as TrajectoryError } from './TrajectoryError.svelte'
export { default as TrajectoryExportPane } from './TrajectoryExportPane.svelte'
export { default as TrajectoryInfoPane } from './TrajectoryInfoPane.svelte'
export {
  energy_data_extractor,
  force_stress_data_extractor,
  full_data_extractor,
  structural_data_extractor,
} from './extract'
export { create_poscar_frame_range_zip, serialize_extxyz_frame_range } from './file-export'
export type { TrajectoryFrameResolver } from './file-export'
export {
  generate_axis_labels,
  generate_axis_scale_types,
  generate_plot_series,
  generate_streaming_plot_series,
  should_hide_plot,
} from './plotting'
export type { PlotSeriesOptions } from './plotting'

export type TrajectoryFormat = `hdf5` | `json` | `xyz` | `xdatcar` | `traj` | `unknown`
export type { AtomTypeMapping } from './types'

// Debounce for on-demand frame loads while scrubbing: skips fetches for steps
// the user slides past. Exported so tests stay in sync with the real delay.
export const FRAME_LOAD_DEBOUNCE_MS = 75

// Splitting side by side halves the width but keeps the full height, so the
// panes come out twice as tall relative to their width as the container is.
// A nearly square container therefore yields tall narrow panes, which a
// step-series plot reads badly in - a ~900x800 viewer gave the plot 450x800.
// Only split side by side while that leaves panes no more than this much
// taller than they are wide.
const MAX_PANE_TALLNESS = 1.4

// Smallest pane the structure viewer and the plot both stay readable in: a
// scatter spends ~80px on its y-axis label and tick labels and its legend needs
// ~10em on top of that, and below ~180px of height the x-axis labels eat the
// data area the same way.
const MIN_PANE_SIZE = { width: 320, height: 180 }

// Which way to split a container into two equal panes. Absolute size comes
// first: when only one of the two splits clears MIN_PANE_SIZE, that one wins
// regardless of shape, which is what stacks a 490x500 chat sidebar card whose
// 245px-wide panes would leave a plot no room for its axes. When both fit (or
// neither does), pane shape decides.
export function pick_pane_orientation(
  width: number,
  height: number,
): `horizontal` | `vertical` {
  const side_by_side_fits = width / 2 >= MIN_PANE_SIZE.width
  const stacked_fits = height / 2 >= MIN_PANE_SIZE.height
  if (side_by_side_fits && !stacked_fits) return `horizontal`
  if (stacked_fits && !side_by_side_fits) return `vertical`
  // a side-by-side pane is half the width and the container's full height
  return height <= (width / 2) * MAX_PANE_TALLNESS ? `horizontal` : `vertical`
}

// Core trajectory types
export interface ParseProgress {
  current: number
  total: number
  stage: string
}

export interface TrajectoryFrame {
  structure: AnyStructure
  step: number
  metadata?: Record<string, unknown>
}

export interface FrameIndex {
  frame_number: number
  byte_offset: number
  estimated_size: number
}

export interface TrajectoryMetadata {
  frame_number: number
  step: number
  properties: Record<string, number>
}

// Trajectory type with streaming support
export interface TrajectoryType {
  frames: TrajectoryFrame[]
  metadata?: Record<string, unknown>
  // Large file streaming properties
  total_frames?: number
  indexed_frames?: FrameIndex[]
  plot_metadata?: TrajectoryMetadata[]
  is_indexed?: boolean
  // On-demand frame loading for large/indexed trajectories.
  frame_loader?: FrameLoader // When present, enables lazy loading of frames instead of loading all frames into memory.
}

// Unified handler data interface
export interface TrajHandlerData extends FileLoadData {
  trajectory?: TrajectoryType
  step_idx?: number
  frame_count?: number
  frame?: TrajectoryFrame
  file_size?: number
  total_atoms?: number
  error_msg?: string
  fps?: number
  mode?: ComponentProps<typeof Trajectory>[`display_mode`]
  fullscreen?: boolean
}

// Function interfaces for extensibility
export type TrajectoryDataExtractor = (
  frame: TrajectoryFrame,
  trajectory: TrajectoryType,
) => Record<string, number>

// Flat per-frame Cartesian positions for a whole trajectory, laid out as n_frames
// blocks of n_atoms xyz triples: positions[(frame * n_atoms + atom) * 3 + axis].
// Flat so the buffer can be transferred (not structured-cloned) into a Web Worker,
// and so a whole-trajectory sweep never holds n_frames TrajectoryFrame objects at once.
export interface TrajectoryPositionStream {
  positions: Float64Array
  n_frames: number
  n_atoms: number
  // One entry per atom. Atom order is the atom identity and must be stable across frames.
  elements: ElementSymbol[]
  // One cell per frame (NPT-safe); null entries mean that frame had no periodicity.
  // Null overall when no frame carried a lattice.
  lattice_matrices: (Matrix3x3 | null)[] | null
  pbc: Pbc | null
  // True when the source format already stores unwrapped coordinates (LAMMPS xu/yu/zu),
  // in which case consumers must NOT re-apply the minimum image convention.
  coords_unwrapped: boolean
  // Every `frame_stride`-th source frame was collected (1 = every frame)
  frame_stride: number
  // MD step number of each collected frame, in collection order
  steps: number[]
}

export interface PositionStreamOptions {
  // Collect every Nth frame. Use `suggest_frame_stride` to stay inside a memory budget.
  frame_stride?: number
  // Hard ceiling on the allocated position buffer; the sweep throws (with the stride
  // that would fit) rather than attempting a multi-GB allocation.
  max_bytes?: number
}

export interface FrameLoader {
  get_total_frames: (data: string | ArrayBuffer) => Promise<number>
  // Optional single sequential pass over the payload emitting flat positions.
  // Whole-trajectory analyses (e.g. MSD) need this for indexed trajectories, whose
  // in-memory `frames` array holds only the first handful of frames.
  stream_positions?: (
    data: string | ArrayBuffer,
    options?: PositionStreamOptions,
    on_progress?: (progress: ParseProgress) => void,
  ) => Promise<TrajectoryPositionStream>
  build_frame_index: (
    data: string | ArrayBuffer,
    sample_rate: number,
    on_progress?: (progress: ParseProgress) => void,
  ) => Promise<FrameIndex[]>
  load_frame: (
    data: string | ArrayBuffer,
    frame_number: number,
  ) => Promise<TrajectoryFrame | null>
  extract_plot_metadata: (
    data: string | ArrayBuffer,
    options?: { sample_rate?: number; properties?: string[] },
    on_progress?: (progress: ParseProgress) => void,
  ) => Promise<TrajectoryMetadata[]>
}

export function validate_trajectory(trajectory: TrajectoryType): string[] {
  const errors: string[] = []
  const { frames, total_frames, indexed_frames, plot_metadata, is_indexed } = trajectory

  if (!frames?.length) return [`Trajectory must have at least one frame`]

  frames.forEach((frame, idx) => {
    if (!frame.structure?.sites?.length) {
      errors.push(`Frame ${idx} missing structure or sites`)
    }
    if (typeof frame.step !== `number`) {
      errors.push(`Frame ${idx} missing or invalid step number`)
    }
  })

  // Validate streaming-related properties
  if (total_frames !== undefined) {
    if (typeof total_frames !== `number` || total_frames < 1) {
      errors.push(`total_frames must be a positive number, got ${total_frames}`)
    } else if (indexed_frames?.length) {
      const last_indexed_frame = indexed_frames.at(-1)
      if (last_indexed_frame && last_indexed_frame.frame_number >= total_frames) {
        errors.push(`indexed_frames contains frame_number >= total_frames (${total_frames})`)
      }
    }
  }

  if (is_indexed === true && !indexed_frames?.length) {
    errors.push(`is_indexed is true but indexed_frames is missing or empty`)
  }

  if (indexed_frames) {
    if (!Array.isArray(indexed_frames)) {
      errors.push(`indexed_frames must be an array`)
    } else {
      indexed_frames.forEach((frame_idx, idx) => {
        if (typeof frame_idx.frame_number !== `number`) {
          errors.push(`indexed_frames[${idx}] missing or invalid frame_number`)
        } else if (frame_idx.frame_number < 0) {
          errors.push(
            `indexed_frames[${idx}] frame_number (${frame_idx.frame_number}) must be non-negative`,
          )
        } else if (idx > 0 && frame_idx.frame_number <= indexed_frames[idx - 1].frame_number) {
          errors.push(
            `indexed_frames[${idx}] frame_number (${frame_idx.frame_number}) must be strictly increasing`,
          )
        }
        if (typeof frame_idx.byte_offset !== `number`) {
          errors.push(`indexed_frames[${idx}] missing or invalid byte_offset`)
        }
        if (typeof frame_idx.estimated_size !== `number`) {
          errors.push(`indexed_frames[${idx}] missing or invalid estimated_size`)
        }
      })
    }
  }

  if (plot_metadata) {
    if (!Array.isArray(plot_metadata)) {
      errors.push(`plot_metadata must be an array`)
    } else {
      plot_metadata.forEach((meta, idx) => {
        if (typeof meta.frame_number !== `number`) {
          errors.push(`plot_metadata[${idx}] missing or invalid frame_number`)
        }
        if (typeof meta.step !== `number`) {
          errors.push(`plot_metadata[${idx}] missing or invalid step`)
        }
        if (!meta.properties || typeof meta.properties !== `object`) {
          errors.push(`plot_metadata[${idx}] missing or invalid properties object`)
        }
      })
    }
  }

  return errors
}

export function get_trajectory_stats(trajectory: TrajectoryType): Record<string, unknown> {
  const { frames, total_frames, indexed_frames, plot_metadata } = trajectory
  const frame_count = total_frames ?? frames.length
  const stats: Record<string, unknown> = {
    frame_count,
    is_indexed: trajectory.is_indexed ?? false,
  }

  if (frames.length > 0) {
    const [first_frame, last_frame] = [frames[0], frames.at(-1) ?? frames[0]]
    const max_sample = 100

    const sampled =
      frames.length <= max_sample
        ? frames
        : (() => {
            const interval = Math.floor(frames.length / max_sample)
            const result = [first_frame]
            for (let idx = interval; idx < frames.length - 1; idx += interval) {
              result.push(frames[idx])
            }
            if (result.at(-1) !== last_frame) result.push(last_frame)
            return result
          })()

    const counts = sampled.map((frame) => frame.structure.sites.length)
    const constant = counts.every((count) => count === counts[0])
    const all_counts = constant
      ? [first_frame.structure.sites.length]
      : frames.map((frame) => frame.structure.sites.length)

    stats.steps = frames.map((frame) => frame.step)
    stats.step_range = [first_frame.step, last_frame.step]
    stats.constant_atom_count = constant
    if (constant) stats.total_atoms = first_frame.structure.sites.length
    else stats.atom_count_range = [Math.min(...all_counts), Math.max(...all_counts)]
  } else stats.steps = [] // empty trajectory

  // Additional metadata for large files
  if (indexed_frames) stats.indexed_frame_count = indexed_frames.length
  if (plot_metadata) stats.plot_metadata_count = plot_metadata.length
  return stats
}
