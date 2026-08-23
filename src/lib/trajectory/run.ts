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
): signal is TrajectorySignalDescriptor => !(`values` in signal)

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
  // aborted and throws/rejects after dispose().
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
  ...(run.time_step ? { time_step: run.time_step } : {}),
  ...(run.atom_masses ? { atom_masses: [...run.atom_masses] } : {}),
  ...(run.signals ? { signals: run.signals } : {}),
  metadata: run.metadata,
  warnings: [...run.warnings],
  has_collect_positions: run.collect_positions !== undefined,
})

export const assert_frame_idx = (run: { frame_count: number }, frame_idx: number): void => {
  if (!Number.isInteger(frame_idx) || frame_idx < 0 || frame_idx >= run.frame_count) {
    throw new RangeError(`Frame index ${frame_idx} is outside 0..${run.frame_count - 1}`)
  }
}

export const disposed_error = (what: string): Error =>
  new Error(`${what} was disposed; frames can no longer be read`)

// Every time_step a parser records comes with a unit; a bare number is meaningless
export const time_step_of = (
  value: number | undefined,
  unit: string | undefined,
): { value: number; unit: string } | undefined =>
  value !== undefined && Number.isFinite(value) && value > 0 && unit
    ? { value, unit }
    : undefined
