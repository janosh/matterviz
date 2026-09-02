// The one runtime object every trajectory consumer sees. A run owns its resources (bytes,
// worker port, HDF5 handle, frame index) and exposes exactly one frame-access path, so a
// consumer never has to work out whether the frames it can see are all the frames there are.
//
// Deliberately free of Svelte runes: runs are built inside Web Workers and the VS Code
// extension host as well as in components. The viewer mirrors `properties` into `$state`
// through `subscribe` (see session.svelte.ts).
import type {
  CollectPositionsOptions,
  TrajectoryFrame,
  TrajectoryMetadata,
  TrajectoryPositionStream,
  TrajectoryRunSignal,
  TrajectorySignal,
  TrajectorySignalDescriptor,
} from './index'

// `values` is what separates a signal held in memory from one the run streams on request
export const is_loaded_signal = (signal: TrajectoryRunSignal): signal is TrajectorySignal =>
  `values` in signal

export const is_signal_descriptor = (
  signal: TrajectoryRunSignal,
): signal is TrajectorySignalDescriptor => !is_loaded_signal(signal)

export interface TrajectoryProvenance {
  filename?: string
  // 'xyz' | 'lammps' | 'xdatcar' | 'ase' | 'pymatgen-json' | 'json' | 'hdf5' | 'vaspout-h5' | 'host' | …
  format?: string
  source_bytes?: number
  hdf5_group?: string
}

type PropertiesListener = (batch: TrajectoryMetadata[], complete: boolean) => void

// Frame-level scalar properties (energy, volume, pressure, …) that feed the plot pane, the
// info pane and the data inspector. Static runs fill `rows` at construction; progressive
// runs (indexed text, worker and host streaming) push batches and `finish()`. Rows stay
// sorted by frame_number and deduplicated so a re-delivered batch cannot double a frame.
export class TrajectoryProperties {
  rows: readonly TrajectoryMetadata[]
  complete: boolean
  // Resolves once `finish()` ran (immediately for static runs)
  readonly done: Promise<void>
  private resolve_done: () => void = () => {}
  private readonly listeners: PropertiesListener[] = []

  constructor(rows: TrajectoryMetadata[] = [], complete = false) {
    this.rows = sort_rows(rows)
    this.complete = complete
    this.done = new Promise<void>((resolve) => {
      this.resolve_done = resolve
    })
    if (complete) this.resolve_done()
  }

  push(batch: readonly TrajectoryMetadata[]): void {
    if (this.complete) throw new Error(`TrajectoryProperties.push after finish()`)
    if (batch.length === 0) return
    const last = this.rows.at(-1)
    const merged = [...this.rows, ...batch]
    const in_order =
      (last === undefined || batch[0].frame_number > last.frame_number) &&
      batch.every((row, idx) => idx === 0 || row.frame_number > batch[idx - 1].frame_number)
    this.rows = in_order ? merged : sort_rows(merged)
    for (const listener of this.listeners) listener([...batch], false)
  }

  finish(): void {
    if (this.complete) return
    this.complete = true
    this.resolve_done()
    for (const listener of this.listeners) listener([], true)
  }

  // Plain (non-reactive) change notification for workers and hosts that forward batches.
  // Returns an unsubscribe function.
  subscribe(listener: PropertiesListener): () => void {
    this.listeners.push(listener)
    return () => {
      const idx = this.listeners.indexOf(listener)
      if (idx !== -1) this.listeners.splice(idx, 1)
    }
  }
}

const sort_rows = (rows: readonly TrajectoryMetadata[]): TrajectoryMetadata[] =>
  rows
    .toSorted((row_a, row_b) => row_a.frame_number - row_b.frame_number)
    .filter(
      (row, idx, sorted) => idx === 0 || row.frame_number !== sorted[idx - 1].frame_number,
    )

type FrameResult = TrajectoryFrame | Promise<TrajectoryFrame>

export interface TrajectoryRun {
  // Mandatory and >= 1: an electronic-only vaspout.h5 is a spectral result, never a run
  readonly frame_count: number
  // Frame 0: species, atom count and lattice for layout; cheap to produce for every run kind
  readonly preview: TrajectoryFrame
  readonly provenance: TrajectoryProvenance
  readonly properties: TrajectoryProperties
  readonly time_step?: { value: number; unit: string }
  readonly atom_masses?: readonly number[]
  // Run-level signals on their own step axes, keyed by name. A `TrajectorySignal` is loaded
  // (whole series in memory); a `TrajectorySignalDescriptor` is streamed on request by
  // collect_positions({ signal_keys }) (or `vector_keys` for a per-frame [n_atoms, 3] one)
  readonly signals?: Record<string, TrajectoryRunSignal>
  // Free-form file metadata (electronic results, units, discovered dataset paths, …)
  readonly metadata: Record<string, unknown>
  // Non-fatal parse warnings, returned on the run rather than collected globally
  readonly warnings: readonly string[]
  // The only frame-access path. Sync for in-memory and same-thread indexed runs so scrubbing
  // needs no microtask; a Promise for worker/host runs. Rejects with the signal's reason when
  // aborted and throws/rejects after dispose(), except for frame 0, which is the in-memory
  // `preview` and needs no resource.
  read_frame(frame_idx: number, signal?: AbortSignal): FrameResult
  // Present iff the run supports full-pass analyses (MSD/VACF/CNA/spectroscopy/trails)
  collect_positions?(options?: CollectPositionsOptions): Promise<TrajectoryPositionStream>
  // Releases bytes, worker + frame port, HDF5 handle, index. Idempotent.
  dispose(): void
}

// Serialisable picture of a run that lives in another thread or process (parse worker,
// VS Code host). Everything except frames and collect_positions, which travel over a port.
export interface TrajectoryRunSummary {
  frame_count: number
  preview: TrajectoryFrame
  provenance: TrajectoryProvenance
  properties: { rows: TrajectoryMetadata[]; complete: boolean }
  time_step?: { value: number; unit: string }
  atom_masses?: number[]
  signals?: Record<string, TrajectoryRunSignal>
  metadata: Record<string, unknown>
  warnings: string[]
  has_collect_positions: boolean
}

export const summarize_run = (run: TrajectoryRun): TrajectoryRunSummary => ({
  frame_count: run.frame_count,
  preview: run.preview,
  provenance: run.provenance,
  properties: { rows: [...run.properties.rows], complete: run.properties.complete },
  time_step: run.time_step,
  atom_masses: run.atom_masses && [...run.atom_masses],
  signals: run.signals,
  metadata: run.metadata,
  warnings: [...run.warnings],
  has_collect_positions: run.collect_positions !== undefined,
})

// The run fields a summary carries verbatim; host_run and worker_run add frame access and
// disposal on top. `properties` is a fresh live instance the caller pushes later batches into.
type SharedRunFields = Pick<
  TrajectoryRun,
  | `provenance`
  | `properties`
  | `time_step`
  | `atom_masses`
  | `signals`
  | `metadata`
  | `warnings`
>

export const run_fields_from_summary = (
  summary: TrajectoryRunSummary,
): SharedRunFields & Pick<TrajectoryRun, `frame_count` | `preview`> => ({
  frame_count: summary.frame_count,
  preview: summary.preview,
  provenance: summary.provenance,
  properties: new TrajectoryProperties(summary.properties.rows, summary.properties.complete),
  time_step: summary.time_step,
  atom_masses: summary.atom_masses,
  signals: summary.signals,
  metadata: summary.metadata,
  warnings: summary.warnings,
})

export const assert_frame_idx = (run: { frame_count: number }, frame_idx: number): void => {
  if (!Number.isInteger(frame_idx) || frame_idx < 0 || frame_idx >= run.frame_count) {
    throw new RangeError(`Frame index ${frame_idx} is outside 0..${run.frame_count - 1}`)
  }
}

export const disposed_error = (what: string): Error =>
  new Error(`${what} was disposed; frames can no longer be read`)

// What a same-thread run supplies on top of the shared fields: a synchronous frame decoder,
// optionally a full-pass sweep, and the resources `release` lets go of on dispose
export interface SyncRunSource extends SharedRunFields {
  // Names the run in the disposed error, e.g. `HDF5 trajectory`
  label: string
  frame_count: number
  read: (frame_idx: number) => TrajectoryFrame
  collect_positions?: (options: CollectPositionsOptions) => Promise<TrajectoryPositionStream>
  release?: () => void
}

// The run contract over a synchronous frame source (memory, indexed text/ASE, open HDF5):
// frame 0 is decoded once as the preview, every read is range-checked, and dispose is
// idempotent, finishes the property stream and refuses further reads.
export function sync_run(source: SyncRunSource): TrajectoryRun {
  const { label, frame_count, read, collect_positions, release, ...fields } = source
  if (!Number.isInteger(frame_count) || frame_count < 1) {
    throw new Error(`Trajectory must have at least one frame, got ${frame_count}`)
  }
  const { time_step } = fields
  if (
    time_step &&
    !(Number.isFinite(time_step.value) && time_step.value > 0 && time_step.unit)
  ) {
    throw new Error(
      `time_step needs a positive value and a unit, got ${JSON.stringify(time_step)}`,
    )
  }
  const preview = read(0)
  let disposed = false
  const live = (): void => {
    if (disposed) throw disposed_error(label)
  }
  return {
    ...fields,
    frame_count,
    preview,
    read_frame: (frame_idx) => {
      assert_frame_idx({ frame_count }, frame_idx)
      if (frame_idx === 0) return preview
      live()
      return read(frame_idx)
    },
    ...(collect_positions
      ? {
          collect_positions: async (options = {}) => {
            live()
            return collect_positions(options)
          },
        }
      : {}),
    dispose: () => {
      if (disposed) return
      disposed = true
      fields.properties.finish()
      release?.()
    },
  }
}
