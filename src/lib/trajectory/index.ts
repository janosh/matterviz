// Utility functions for working with trajectory data
import type { AnyStructure } from '$lib'

export { default as TrajectoryViewer } from './Trajectory.svelte'
export { default as TrajectoryError } from './TrajectoryError.svelte'

// Trajectory types for pymatgen trajectory data
export type TrajectoryFrame = {
  structure: AnyStructure
  step: number
  metadata?: Record<string, unknown>
}

export type Trajectory = {
  frames: TrajectoryFrame[]
  metadata?: Record<string, unknown>
}

// Function signature for extracting plot data from trajectory frames
export type TrajectoryDataExtractor = (
  frame: TrajectoryFrame,
  trajectory: Trajectory,
) => Record<string, number>

// Validate trajectory data
export function validate_trajectory(trajectory: Trajectory): string[] {
  const errors: string[] = []

  if (!trajectory.frames || trajectory.frames.length === 0) {
    errors.push(`Trajectory must have at least one frame`)
  }

  for (let idx = 0; idx < trajectory.frames.length; idx++) {
    const frame = trajectory.frames[idx]

    if (!frame.structure) {
      errors.push(`Frame ${idx} missing structure`)
    } else if (!frame.structure.sites || frame.structure.sites.length === 0) {
      errors.push(`Frame ${idx} structure has no sites`)
    }

    if (typeof frame.step !== `number`) {
      errors.push(`Frame ${idx} missing or invalid step number`)
    }
  }

  return errors
}

// Get trajectory statistics
export function get_trajectory_stats(
  trajectory: Trajectory,
): Record<string, unknown> {
  const stats: Record<string, unknown> = {
    frame_count: trajectory.frames.length,
    steps: trajectory.frames.map((f) => f.step),
  }

  if (trajectory.frames.length > 0) {
    const first_frame = trajectory.frames[0]
    const last_frame = trajectory.frames[trajectory.frames.length - 1]

    stats.step_range = [first_frame.step, last_frame.step]

    // Check if all frames have the same number of atoms
    const atom_counts = trajectory.frames.map((f) => f.structure.sites.length)
    const constant_atoms = atom_counts.every(
      (count) => count === atom_counts[0],
    )
    stats.constant_atom_count = constant_atoms

    if (constant_atoms) {
      stats.total_atoms = first_frame.structure.sites.length
    } else {
      stats.atom_count_range = [
        Math.min(...atom_counts),
        Math.max(...atom_counts),
      ]
    }
  }

  return stats
}
