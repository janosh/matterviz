// Sweep structure identification (CNA + CSP) across sampled frames of a trajectory run.
import type { FrameRange, TrajectoryRun } from '$lib/trajectory'
import { sweep_frames } from '$lib/trajectory/analysis'
import { calc_structure_id_async } from './async-compute.svelte'
import type { StructureIdOptions, StructureIdResult } from './calc-structure-id'

// a-CNA costs ~9-14 µs per atom, so a 5000-frame run of 10k atoms is 8-12 minutes of
// worker time. Every sweep therefore samples an evenly spaced subset rather than the whole
// trajectory; 100 frames of 10k atoms is ~10 s, which is a wait a user will sit through.
export const DEFAULT_MAX_SWEEP_FRAMES = 100

interface StructureIdSweepOptions extends FrameRange {
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

export async function collect_structure_id_sweep(
  run: TrajectoryRun,
  sweep_options: StructureIdSweepOptions = {},
): Promise<StructureIdSweep> {
  const {
    max_frames = DEFAULT_MAX_SWEEP_FRAMES,
    options = {},
    on_progress,
    signal,
    start_frame,
    end_frame,
  } = sweep_options

  let first: { frame_number: number; n_atoms: number } | undefined
  return sweep_frames(
    run,
    { max_frames, on_progress, signal, start_frame, end_frame },
    async (frame, frame_number) => {
      const result = await calc_structure_id_async(frame.structure, options, { signal })
      first ??= { frame_number, n_atoms: result.n_atoms }
      if (result.n_atoms !== first.n_atoms) {
        throw new Error(
          `collect_structure_id_sweep: frame ${frame_number} has ${result.n_atoms} atoms but ` +
            `frame ${first.frame_number} has ${first.n_atoms}; per-type populations across ` +
            `a varying atom count are not comparable`,
        )
      }
      return result
    },
  )
}
