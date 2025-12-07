// Utility functions for working with trajectory data
import type { AnyStructure, Trajectory } from '$lib'
import type { ComponentProps } from 'svelte'

export { default as Trajectory } from './Trajectory.svelte'
export { default as TrajectoryError } from './TrajectoryError.svelte'
export { default as TrajectoryExportPane } from './TrajectoryExportPane.svelte'
export { default as TrajectoryInfoPane } from './TrajectoryInfoPane.svelte'

export type TrajectoryFormat = `hdf5` | `json` | `xyz` | `xdatcar` | `traj` | `unknown`

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
}

// Unified handler data interface
export interface TrajHandlerData {
  trajectory?: TrajectoryType
  step_idx?: number
  frame_count?: number
  frame?: TrajectoryFrame
  filename?: string
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

export interface FrameLoader {
  get_total_frames: (data: string | ArrayBuffer) => Promise<number>
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

export function validate_trajectory(trajectory: TrajectoryType): string[] { // with detailed error reporting
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
    } else if (indexed_frames && total_frames !== indexed_frames.length) {
      errors.push(
        `total_frames (${total_frames}) inconsistent with indexed_frames length (${indexed_frames.length})`,
      )
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
        } else if (frame_idx.frame_number !== idx) {
          errors.push(
            `indexed_frames[${idx}] frame_number (${frame_idx.frame_number}) should equal index (${idx})`,
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

export function get_trajectory_stats(
  trajectory: TrajectoryType,
): Record<string, unknown> {
  const { frames, total_frames, indexed_frames, plot_metadata } = trajectory
  const frame_count = total_frames || frames.length
  const stats: Record<string, unknown> = {
    frame_count,
    is_indexed: trajectory.is_indexed || false,
  }

  if (frames.length > 0) {
    const [first_frame, last_frame] = [frames[0], frames.at(-1) ?? frames[0]]
    const max_sample = 100

    const sampled = frames.length <= max_sample ? frames : (() => {
      const interval = Math.floor(frames.length / max_sample)
      const result = [first_frame]
      for (let idx = interval; idx < frames.length - 1; idx += interval) {
        result.push(frames[idx])
      }
      if (result.at(-1) !== last_frame) result.push(last_frame)
      return result
    })()

    const counts = sampled.map((frame) => frame.structure.sites.length)
    const constant = counts.every((c) => c === counts[0])
    const all_counts = constant
      ? [first_frame.structure.sites.length]
      : frames.map((frame) => frame.structure.sites.length)

    stats.steps = frames.map((frame) => frame.step)
    stats.step_range = [first_frame.step, last_frame.step]
    stats.constant_atom_count = constant
    if (constant) stats.total_atoms = first_frame.structure.sites.length
    else stats.atom_count_range = [Math.min(...all_counts), Math.max(...all_counts)]
  } else {
    // Handle empty trajectory case
    stats.steps = []
    stats.step_range = undefined
    stats.constant_atom_count = undefined
    stats.total_atoms = undefined
  }

  // Additional metadata for large files
  if (indexed_frames) stats.indexed_frame_count = indexed_frames.length
  if (plot_metadata) stats.plot_metadata_count = plot_metadata.length
  return stats
}
