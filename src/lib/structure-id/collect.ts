// Sweep structure identification (CNA + CSP) across the frames of a trajectory.
//
// Same indexed-trajectory trap as $lib/msd/collect: for an indexed trajectory
// `trajectory.frames` holds only the first handful of frames (the parser loads
// min(10, total_frames)) while `total_frames` can be six digits, so looping over `frames`
// would silently analyse ten of them and label the plot with the whole run. Frames outside
// that window are pulled through `frame_loader.load_frame`, or the sweep throws.
import { has_all_frames_in_memory, trajectory_total_frames } from '$lib/msd/collect'
import type { AnyStructure } from '$lib/structure'
import { normalize_fractional_coords } from '$lib/structure/parse'
import type { TrajectoryType } from '$lib/trajectory'
import { compute_structure_id_async } from './async-compute.svelte'
import type { CnaTypeName } from './calc-cna'
import type { StructureIdOptions, StructureIdResult } from './index'

// a-CNA costs ~9-14 µs per atom, so a 5000-frame run of 10k atoms is 8-12 minutes of
// worker time. Every sweep therefore samples an evenly spaced subset rather than the whole
// trajectory; 100 frames of 10k atoms is ~10 s, which is a wait a user will sit through.
export const DEFAULT_MAX_SWEEP_FRAMES = 100

export interface StructureIdSweepOptions {
  // Raw file bytes. Only Trajectory.svelte holds these (component-local `orig_data` state,
  // not a field of TrajectoryType), so a caller outside it must pass them in. Required for
  // an indexed trajectory, whose frames are loaded on demand.
  raw_data?: string | ArrayBuffer | null
  // Upper bound on how many frames are actually analysed; see DEFAULT_MAX_SWEEP_FRAMES
  max_frames?: number
  options?: StructureIdOptions
  on_progress?: (done: number, total: number) => void
}

export interface StructureIdSweep {
  // SOURCE frame index of each analysed frame, so plots label the real frame numbers
  // rather than 0..n_analysed
  frame_numbers: number[]
  // Full per-frame results, in the shape StructureTypePlot consumes directly
  results: StructureIdResult[]
  populations: Record<CnaTypeName, number>[]
  // Mean over the sites that HAVE a centrosymmetry value, null when the frame has none
  mean_centrosymmetry: (number | null)[]
  n_atoms: number
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

// Normalize fully periodic cells only; wrapping a nonperiodic axis can change slab geometry.
function analysis_structure(structure: AnyStructure): AnyStructure {
  const fully_periodic = `lattice` in structure && structure.lattice.pbc.every(Boolean)
  return fully_periodic ? normalize_fractional_coords(structure) : structure
}

// Resolve a source frame number to the structure to analyse. Built once per sweep so the
// indexed-trajectory preconditions are checked before any compute happens rather than
// failing on frame 0 of a run the user already waited on.
function make_frame_resolver(
  trajectory: TrajectoryType,
  raw_data: string | ArrayBuffer | null,
  total: number,
): (frame_number: number) => Promise<AnyStructure> {
  if (has_all_frames_in_memory(trajectory)) {
    const { frames } = trajectory
    return (frame_number) => {
      const frame = frames[frame_number]
      if (!frame) {
        throw new Error(
          `collect_structure_id_sweep: frame ${frame_number} is missing from a trajectory ` +
            `that reports all ${total} frames in memory (frames.length is ${frames.length})`,
        )
      }
      return Promise.resolve(analysis_structure(frame.structure))
    }
  }

  const loader = trajectory.frame_loader
  const loaded = trajectory.frames.length
  const indexed = `Trajectory is indexed (${loaded} of ${total} frames in memory)`
  if (!loader) {
    throw new Error(
      `Trajectory reports ${total} frames but only ${loaded} are in memory and it has no ` +
        `frame_loader. Structure identification samples frames across the whole run; ` +
        `re-load the file without indexing (loading_options.use_indexing = false) to ` +
        `analyse it.`,
    )
  }
  if (raw_data === null) {
    throw new Error(
      `${indexed} so structure identification needs the raw file bytes to load the sampled ` +
        `frames, but raw_data was not provided. Pass the payload Trajectory.svelte keeps ` +
        `in orig_data.`,
    )
  }
  return async (frame_number) => {
    const frame = await loader.load_frame(raw_data, frame_number)
    if (!frame) {
      throw new Error(
        `${indexed} and its frame_loader returned no frame for frame ${frame_number}`,
      )
    }
    return analysis_structure(frame.structure)
  }
}

// Mean over the sites that have a value. calc_centrosymmetry writes NaN for a site with
// fewer than n_csp_neighbors neighbors (cluster surfaces, isolated fragments); folding
// those into the sum would NaN the whole frame, so they are skipped and a frame where no
// site has a value reports null instead of 0.
function mean_defined(values: Float64Array | null): number | null {
  if (!values) return null
  let sum = 0
  let n_defined = 0
  for (const value of values) {
    if (Number.isNaN(value)) continue
    sum += value
    n_defined++
  }
  return n_defined === 0 ? null : sum / n_defined
}

export async function collect_structure_id_sweep(
  trajectory: TrajectoryType,
  sweep_options: StructureIdSweepOptions = {},
): Promise<StructureIdSweep> {
  const {
    raw_data = null,
    max_frames = DEFAULT_MAX_SWEEP_FRAMES,
    options = {},
    on_progress,
  } = sweep_options

  const total = trajectory_total_frames(trajectory)
  if (total < 1) {
    throw new Error(`collect_structure_id_sweep: trajectory has no frames to analyse`)
  }
  const { frame_numbers, frame_stride } = sweep_frame_plan(total, max_frames)
  const resolve_frame = make_frame_resolver(trajectory, raw_data, total)

  const results: StructureIdResult[] = []
  // Sequential, not Promise.all: one worker serves every request anyway, so concurrency
  // buys nothing but a progress bar that jumps from 0 to 100 and n_frames structures
  // snapshotted into memory at once.
  for (const [done, frame_number] of frame_numbers.entries()) {
    const structure = await resolve_frame(frame_number)
    const result = await compute_structure_id_async(structure, options)
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

  return {
    frame_numbers,
    results,
    populations: results.map(({ populations }) => populations),
    mean_centrosymmetry: results.map(({ centrosymmetry }) => mean_defined(centrosymmetry)),
    n_atoms: results[0].n_atoms,
    frame_stride,
  }
}
