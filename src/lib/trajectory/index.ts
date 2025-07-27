// Utility functions for working with trajectory data
import type { AnyStructure } from '$lib'
import type { ComponentProps } from 'svelte'
import Trajectory from './Trajectory.svelte'

export { default as TrajectoryError } from './TrajectoryError.svelte'
export { default as TrajectoryInfoPanel } from './TrajectoryInfoPanel.svelte'
export { Trajectory }

// Core trajectory types
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

// Enhanced trajectory type with streaming support
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
  is_fullscreen?: boolean
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
    on_progress?: (progress: import('./parse').ParseProgress) => void,
  ) => Promise<FrameIndex[]>
  load_frame: (
    data: string | ArrayBuffer,
    frame_number: number,
  ) => Promise<TrajectoryFrame | null>
  extract_plot_metadata: (
    data: string | ArrayBuffer,
    options?: { sample_rate?: number; properties?: string[] },
    on_progress?: (progress: import('./parse').ParseProgress) => void,
  ) => Promise<TrajectoryMetadata[]>
}

// Compact validation with detailed error reporting
export function validate_trajectory(trajectory: TrajectoryType): string[] {
  const errors: string[] = []
  const { frames } = trajectory

  if (!frames?.length) {
    errors.push(`Trajectory must have at least one frame`)
    return errors // Early return if no frames
  }

  frames.forEach((frame, idx) => {
    if (!frame.structure?.sites?.length) {
      errors.push(`Frame ${idx} missing structure or sites`)
    }
    if (typeof frame.step !== `number`) {
      errors.push(`Frame ${idx} missing or invalid step number`)
    }
  })

  return errors
}

// Comprehensive trajectory statistics
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
    const first_frame = frames[0]
    const last_frame = frames[frames.length - 1]
    const atom_counts = frames.map((f) => f.structure.sites.length)
    const constant_atoms = atom_counts.every((count) => count === atom_counts[0])

    Object.assign(stats, {
      steps: frames.map((f) => f.step),
      step_range: [first_frame.step, last_frame.step],
      constant_atom_count: constant_atoms,
      ...(constant_atoms
        ? { total_atoms: first_frame.structure.sites.length }
        : { atom_count_range: [Math.min(...atom_counts), Math.max(...atom_counts)] }),
    })
  } else {
    // Handle empty trajectory case
    Object.assign(stats, {
      steps: [],
      step_range: undefined,
      constant_atom_count: undefined,
      total_atoms: undefined,
    })
  }

  // Additional metadata for large files
  if (indexed_frames) stats.indexed_frame_count = indexed_frames.length
  if (plot_metadata) stats.plot_metadata_count = plot_metadata.length

  return stats
}
