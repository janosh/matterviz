// Shared entry points of the whole-trajectory analyses (MSD, VACF, structure-id,
// spectroscopy, trails): one place that turns a run into a position sweep, and the frame
// accounting the analysis panes display before a sweep starts.
import type {
  CollectPositionsOptions,
  FrameRange,
  ParseProgress,
  TrajectoryFrame,
  TrajectoryPositionStream,
} from './index'
import { csv_line } from 'svelte-widgets/csv'
import type { TrajectoryRun } from './run'
import {
  DEFAULT_POSITION_STREAM_MAX_BYTES,
  resolve_frame_range,
  suggest_frame_stride,
} from './runs/accumulate'

// The stream options an analysis's collector exposes to its pane
export type AnalysisStreamOptions = Pick<
  CollectPositionsOptions,
  `frame_stride` | `max_bytes` | `on_progress` | `signal` | `start_frame` | `end_frame`
>

// Frame stride that keeps `buffers` position-sized arrays per frame inside `max_bytes`, or
// null while the atom count is unknown (no frame read yet)
export function suggest_analysis_frame_stride(
  run: TrajectoryRun,
  max_bytes = DEFAULT_POSITION_STREAM_MAX_BYTES,
  buffers = 1,
  frame_count = run.frame_count,
): number | null {
  const n_atoms = run.preview.structure.sites.length
  return n_atoms ? suggest_frame_stride(frame_count, n_atoms * buffers, max_bytes) : null
}

export type CollectTrajectoryPositionsOptions = CollectPositionsOptions & {
  // Names the analysis in the errors below, e.g. `MSD`
  analysis_name: string
  // Frames the analysis needs at all (2 for a displacement, 3 for a central difference)
  min_frames?: number
}

// Async so the guards below reject like a failing sweep does, and one catch covers both
export const collect_trajectory_positions = async (
  run: TrajectoryRun,
  { analysis_name, min_frames = 1, ...options }: CollectTrajectoryPositionsOptions,
): Promise<TrajectoryPositionStream> => {
  const { start_frame, end_frame } = resolve_frame_range(run.frame_count, options)
  const collected_frames = Math.ceil((end_frame - start_frame) / (options.frame_stride ?? 1))
  if (collected_frames < min_frames) {
    throw new Error(
      `${analysis_name}: need at least ${min_frames} frames, got ${collected_frames}`,
    )
  }
  if (!run.collect_positions) throw new Error(no_full_pass_message(run, analysis_name))
  return run.collect_positions(options)
}

// Why a run without collect_positions cannot be analysed; shown by the panes and thrown by
// collect_trajectory_positions so the two never drift apart
export const no_full_pass_message = (run: TrajectoryRun, analysis_name: string): string =>
  `${analysis_name} needs a pass over all ${run.frame_count} frames, but this ` +
  `${run.provenance.format ?? `host-served`} trajectory only serves frames one at a time. ` +
  `Open the file directly (not through the host) to analyse it.`

// Integer >= 1 from a numeric input, else `fallback`: <input type="number"> writes null when
// cleared and Infinity for a `1e999` entry, and the sweep/stride helpers reject both outright
export const positive_int = (value: number | null | undefined, fallback: number): number =>
  value != null && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback

// undefined = steps not yet known; null = known irregular/invalid sampling. Scan only the
// selected samples, without allocating another step array for a potentially large window.
export function analysis_step_interval(
  step_at: (idx: number) => number | undefined,
  n_frames: number,
): number | null | undefined {
  if (n_frames < 2) return undefined
  const first = step_at(0)
  const last = step_at(n_frames - 1)
  if (first === undefined || last === undefined) return undefined
  const delta = (last - first) / (n_frames - 1)
  if (!Number.isFinite(first) || !Number.isFinite(delta) || delta <= 0) return null
  let previous = first
  for (let idx = 1; idx < n_frames; idx++) {
    const step = step_at(idx)
    if (step === undefined) return undefined
    // Allow four f64 epsilons at the step scale for subtraction/multiplication rounding.
    const tolerance =
      4 * Number.EPSILON * Math.max(Math.abs(first), Math.abs(step), idx * delta)
    if (
      !Number.isFinite(step) ||
      step <= previous ||
      Math.abs(step - first - idx * delta) > tolerance
    )
      return null
    previous = step
  }
  return delta
}

// Physical times only when every source step is known: sparse previews must not invent an
// interpolated window, and an MD timestep scales recorded steps, never frame indices.
export function analysis_frame_times(
  run: TrajectoryRun | undefined,
): { values: number[]; unit: string } | null {
  if (!run?.time_step || run.properties.rows.length !== run.frame_count) return null
  const { time_step } = run
  const values = run.properties.rows.map(({ frame_number, step }, idx) =>
    frame_number === idx ? step * time_step.value : NaN,
  )
  if (
    !values.every(
      (value, idx) => Number.isFinite(value) && (idx === 0 || value > values[idx - 1]),
    )
  )
    return null
  return { values, unit: time_step.unit }
}

// Adapts a sweep's (done, total) callback to the pane's progress shape
export const sweep_progress =
  (on_progress: (progress: { current: number; total: number; stage: string }) => void) =>
  (done: number, total: number): void =>
    on_progress({ current: done, total, stage: `frame ${done} of ${total}` })

// === TrajectoryAnalysisPane contract ===

// What the pane hands to a module's `controls`, `hint` and `children` snippets. Every field
// is a live getter onto its own signal, so read only what you need: reading `dt_collected`
// subscribes to the frame stride, and a fresh options object re-runs the module's compute.
export type AnalysisPaneContext<Input> = {
  input: Input | undefined
  // True once a usable timestep is entered; `dt_collected` is then the time between two
  // COLLECTED frames (source dt × frame stride) in `time_unit`
  has_valid_dt: boolean
  dt_collected: number
  time_unit: string
  collected_frames: number
  n_atoms: number
  // True while `collect` is running, for plots that show their own in-progress state
  collecting: boolean
}

// What the pane passes to a module's collector
export type AnalysisCollectOptions = FrameRange & {
  frame_stride: number
  on_progress: (progress: ParseProgress) => void
  // Aborted once the answer can no longer be used (a newer collect, a trajectory swap, or the
  // pane unmounting), so collectors that honour it stop reading frames early
  signal: AbortSignal
}

export function analysis_pane_setup(
  run: TrajectoryRun | undefined,
  // Receives the selected frame count for budgeting. Omit for frame-at-a-time analyses.
  suggest_stride?: (run: TrajectoryRun, frame_count: number) => number | null,
  frame_stride: number | null = 1,
  range: FrameRange = {},
) {
  const safe_stride = positive_int(frame_stride, 1)
  const total_frames = run?.frame_count ?? 0
  const { start_frame, end_frame } = total_frames
    ? resolve_frame_range(total_frames, range)
    : { start_frame: 0, end_frame: 0 }
  const selected_frames = end_frame - start_frame
  return {
    total_frames,
    n_atoms: run?.preview.structure.sites.length ?? 0,
    safe_stride,
    collected_frames: Math.ceil(selected_frames / safe_stride),
    suggested_stride: run ? (suggest_stride?.(run, selected_frames) ?? null) : null,
    can_collect: run?.collect_positions !== undefined,
  }
}

// Evenly spaced source-frame indices, at most `max_frames` of them, for the frame-at-a-time
// sweeps (structure-id, RDF) whose per-frame cost caps the sample rather than memory. Exported
// so a UI can show the sample count and stride before committing to the sweep.
export function sweep_frame_plan(
  total_frames: number,
  max_frames: number,
  range: FrameRange = {},
): { frame_numbers: number[]; frame_stride: number } {
  for (const [name, value] of Object.entries({ total_frames, max_frames })) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`sweep_frame_plan: ${name} must be a positive integer, got ${value}`)
    }
  }
  // ceil, not floor: a stride that rounds down would let ceil(total / stride) exceed the cap
  const { start_frame, end_frame } = resolve_frame_range(total_frames, range)
  const frame_stride = Math.max(1, Math.ceil((end_frame - start_frame) / max_frames))
  const frame_numbers: number[] = []
  for (
    let frame_number = start_frame;
    frame_number < end_frame;
    frame_number += frame_stride
  ) {
    frame_numbers.push(frame_number)
  }
  return { frame_numbers, frame_stride }
}

export interface FrameSweepOptions extends FrameRange {
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
  { max_frames, on_progress, signal, ...range }: FrameSweepOptions,
  visit: (frame: TrajectoryFrame, frame_number: number) => Promise<Result>,
): Promise<{ results: Result[]; frame_numbers: number[]; frame_stride: number }> {
  const { frame_numbers, frame_stride } = sweep_frame_plan(run.frame_count, max_frames, range)
  const results: Result[] = []
  for (const [done, frame_number] of frame_numbers.entries()) {
    signal?.throwIfAborted()
    const frame = await run.read_frame(frame_number, signal)
    signal?.throwIfAborted()
    results.push(await visit(frame, frame_number))
    on_progress?.(done + 1, frame_numbers.length)
  }
  return { results, frame_numbers, frame_stride }
}

// Column-wise numbers to CSV (header row = keys, one row per index, `NaN` for a short
// column), the shape every analysis result already has: a lag/r/frequency axis plus one
// column per curve. Header fields holding a delimiter, quote or line break are quoted.
export function columns_to_csv(columns: Record<string, ArrayLike<number>>): string {
  const keys = Object.keys(columns)
  const n_rows = Math.max(0, ...keys.map((key) => columns[key].length))
  const header = csv_line(keys)
  const rows = Array.from({ length: n_rows }, (_unused, row_idx) =>
    keys.map((key) => String(columns[key][row_idx] ?? NaN)).join(`,`),
  )
  return [header, ...rows].join(`\n`)
}
