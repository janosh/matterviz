// Shared entry points of the whole-trajectory analyses (MSD, VACF, structure-id,
// spectroscopy, trails): one place that turns a run into a position sweep, and the frame
// accounting the analysis panes display before a sweep starts.
import type {
  CollectPositionsOptions,
  TrajectoryFrame,
  TrajectoryPositionStream,
} from './index'
import type { TrajectoryRun } from './run'

export type CollectTrajectoryPositionsOptions = CollectPositionsOptions & {
  // Names the analysis in the error a frame-at-a-time run raises, e.g. `MSD`
  analysis_name: string
}

export const collect_trajectory_positions = (
  run: TrajectoryRun,
  { analysis_name, ...options }: CollectTrajectoryPositionsOptions,
): Promise<TrajectoryPositionStream> => {
  if (!run.collect_positions) {
    throw new Error(
      `${analysis_name} needs a pass over all ${run.frame_count} frames, but this ` +
        `${run.provenance.format ?? `host-served`} trajectory only serves frames one at a ` +
        `time. Open the file directly (not through the host) to analyse it.`,
    )
  }
  return run.collect_positions(options)
}

// Frame counts and stride advice for the analysis panes
export function analysis_pane_setup(
  run: TrajectoryRun | undefined,
  // Omit for a pane that reads frames one at a time and so has no buffer to budget
  suggest_stride?: (run: TrajectoryRun) => number | null,
  frame_stride: number | null = 1,
) {
  const safe_stride =
    frame_stride !== null && Number.isFinite(frame_stride) && frame_stride >= 1
      ? Math.floor(frame_stride)
      : 1
  const total_frames = run?.frame_count ?? 0
  return {
    total_frames,
    n_atoms: run?.preview.structure.sites.length ?? 0,
    safe_stride,
    collected_frames: Math.ceil(total_frames / safe_stride),
    suggested_stride: run ? (suggest_stride?.(run) ?? null) : null,
    can_collect: run?.collect_positions !== undefined,
  }
}

// Evenly spaced source-frame indices, at most `max_frames` of them, for the frame-at-a-time
// sweeps (structure-id, RDF) whose per-frame cost caps the sample rather than memory. Exported
// so a UI can show the sample count and stride before committing to the sweep.
export function sweep_frame_plan(
  total_frames: number,
  max_frames: number,
): { frame_numbers: number[]; frame_stride: number } {
  for (const [name, value] of Object.entries({ total_frames, max_frames })) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`sweep_frame_plan: ${name} must be a positive integer, got ${value}`)
    }
  }
  // ceil, not floor: a stride that rounds down would let ceil(total / stride) exceed the cap
  const frame_stride = Math.max(1, Math.ceil(total_frames / max_frames))
  const frame_numbers: number[] = []
  for (let frame_number = 0; frame_number < total_frames; frame_number += frame_stride) {
    frame_numbers.push(frame_number)
  }
  return { frame_numbers, frame_stride }
}

export interface FrameSweepOptions {
  max_frames: number
  on_progress?: (done: number, total: number) => void
  // Stops the sweep between frames; the visitor gets it too for its worker request
  signal?: AbortSignal
}

// Visit `sweep_frame_plan`'s frames one at a time. Sequential, not Promise.all: one worker
// serves every request anyway, so concurrency buys nothing but a progress bar that jumps from
// 0 to 100 and n_frames structures snapshotted into memory at once.
export async function sweep_frames<Result>(
  run: TrajectoryRun,
  { max_frames, on_progress, signal }: FrameSweepOptions,
  visit: (frame: TrajectoryFrame, frame_number: number) => Promise<Result>,
): Promise<{ results: Result[]; frame_numbers: number[]; frame_stride: number }> {
  const { frame_numbers, frame_stride } = sweep_frame_plan(run.frame_count, max_frames)
  const results: Result[] = []
  for (const [done, frame_number] of frame_numbers.entries()) {
    signal?.throwIfAborted()
    results.push(await visit(await run.read_frame(frame_number, signal), frame_number))
    on_progress?.(done + 1, frame_numbers.length)
  }
  return { results, frame_numbers, frame_stride }
}

// Column-wise numbers to CSV (header row = keys, one row per index, `NaN` for a short
// column), the shape every analysis result already has: a lag/r/frequency axis plus one
// column per curve. Header fields holding a delimiter, quote or line break are quoted.
export function columns_to_csv(columns: Record<string, ArrayLike<number>>): string {
  const csv_field = (field: string): string =>
    /[",\r\n]/.test(field) ? `"${field.replaceAll(`"`, `""`)}"` : field
  const keys = Object.keys(columns)
  const n_rows = Math.max(0, ...keys.map((key) => columns[key].length))
  const header = keys.map(csv_field).join(`,`)
  const rows = Array.from({ length: n_rows }, (_unused, row_idx) =>
    keys.map((key) => String(columns[key][row_idx] ?? NaN)).join(`,`),
  )
  return [header, ...rows].join(`\n`)
}
