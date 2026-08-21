// Sweep structure identification (CNA + CSP) across sampled frames of a trajectory run.
import type { TrajectoryRun } from '$lib/trajectory'
import { compute_structure_id_async } from './async-compute.svelte'
import type { StructureIdOptions, StructureIdResult } from './calc-structure-id'

// a-CNA costs ~9-14 µs per atom, so a 5000-frame run of 10k atoms is 8-12 minutes of
// worker time. Every sweep therefore samples an evenly spaced subset rather than the whole
// trajectory; 100 frames of 10k atoms is ~10 s, which is a wait a user will sit through.
export const DEFAULT_MAX_SWEEP_FRAMES = 100

export interface StructureIdSweepOptions {
  // Upper bound on how many frames are actually analysed; see DEFAULT_MAX_SWEEP_FRAMES
  max_frames?: number
  options?: StructureIdOptions
  on_progress?: (done: number, total: number) => void
  // Stops the sweep between frames and drops the in-flight worker request
  signal?: AbortSignal
}

export interface StructureIdSweep {
  // SOURCE frame index of each analysed frame, so plots label the real frame numbers
  // rather than 0..n_analysed
  frame_numbers: number[]
  // Full per-frame results, in the shape StructureTypePlot consumes directly.
  results: StructureIdResult[]
  // Source frames skipped between samples; 1 means every frame was analysed
  frame_stride: number
}

// Evenly spaced source-frame indices, at most `max_frames` of them. Exported so a UI can
// show the sample count and stride before committing to the sweep.
export function sweep_frame_plan(
  total_frames: number,
  max_frames: number = DEFAULT_MAX_SWEEP_FRAMES,
): { frame_numbers: number[]; frame_stride: number } {
  if (!Number.isInteger(total_frames) || total_frames < 1) {
    throw new Error(
      `sweep_frame_plan: total_frames must be a positive integer, got ${total_frames}`,
    )
  }
  if (!Number.isInteger(max_frames) || max_frames < 1) {
    throw new Error(
      `sweep_frame_plan: max_frames must be a positive integer, got ${max_frames}`,
    )
  }
  // ceil, not floor: a stride that rounds down would let ceil(total / stride) exceed the cap
  const frame_stride = Math.max(1, Math.ceil(total_frames / max_frames))
  const frame_numbers: number[] = []
  for (let frame_number = 0; frame_number < total_frames; frame_number += frame_stride) {
    frame_numbers.push(frame_number)
  }
  return { frame_numbers, frame_stride }
}

export async function collect_structure_id_sweep(
  run: TrajectoryRun,
  sweep_options: StructureIdSweepOptions = {},
): Promise<StructureIdSweep> {
  const {
    max_frames = DEFAULT_MAX_SWEEP_FRAMES,
    options = {},
    on_progress,
    signal,
  } = sweep_options

  const { frame_numbers, frame_stride } = sweep_frame_plan(run.frame_count, max_frames)

  const results: StructureIdResult[] = []
  // Sequential, not Promise.all: one worker serves every request anyway, so concurrency
  // buys nothing but a progress bar that jumps from 0 to 100 and n_frames structures
  // snapshotted into memory at once.
  for (const [done, frame_number] of frame_numbers.entries()) {
    signal?.throwIfAborted()
    const frame = await run.read_frame(frame_number, signal)
    const result = await compute_structure_id_async(frame.structure, options, { signal })
    if (results.length > 0 && result.n_atoms !== results[0].n_atoms) {
      throw new Error(
        `collect_structure_id_sweep: frame ${frame_number} has ${result.n_atoms} atoms but ` +
          `frame ${frame_numbers[0]} has ${results[0].n_atoms}; per-type populations across ` +
          `a varying atom count are not comparable`,
      )
    }
    results.push(result)
    on_progress?.(done + 1, frame_numbers.length)
  }

  return { frame_numbers, results, frame_stride }
}
