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
import { ATOM_BATCH_SIZE, frame_atom_batch, type ReadAtoms } from './atom-batches'
import type { HotspotRequest, HotspotResult } from './hotspots'

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
  private readonly completion = Promise.withResolvers<undefined>()
  // Resolves once `finish()` ran (immediately for static runs)
  readonly done: Promise<void> = this.completion.promise
  // Replace on subscription changes so a callback cannot shift the active notification loop.
  private listeners: readonly PropertiesListener[] = []
  private notifying = false
  // A null batch marks completion; queued data batches own their array snapshot.
  private readonly pending_notifications: (TrajectoryMetadata[] | null)[] = []

  constructor(rows: TrajectoryMetadata[] = [], complete = false) {
    this.rows = sort_rows([...rows])
    this.complete = complete
    if (complete) this.completion.resolve(undefined)
  }

  push(batch: readonly TrajectoryMetadata[]): void {
    if (this.complete) throw new Error(`TrajectoryProperties.push after finish()`)
    if (batch.length === 0) return
    // Native concatenation allocates the final snapshot once. Spreading a long prefix into
    // a growable array copied that prefix again for every progressive batch.
    this.rows = sort_rows(this.rows.concat(batch), Math.max(1, this.rows.length))
    this.notify(batch)
  }

  finish(): void {
    if (this.complete) return
    this.complete = true
    this.completion.resolve(undefined)
    this.notify(null)
  }

  // Reentrant pushes and completion follow the current batch, including across worker ports.
  // Only reentrant calls allocate queue entries; ordinary notifications dispatch directly.
  private notify(batch: readonly TrajectoryMetadata[] | null): void {
    if (this.notifying) {
      this.pending_notifications.push(batch && [...batch])
      return
    }
    this.notifying = true
    let errors: unknown[] | undefined
    try {
      for (;;) {
        for (const listener of this.listeners) {
          try {
            listener(batch ? [...batch] : [], batch === null)
          } catch (error) {
            // Finish delivery before propagating errors so worker clients receive completion.
            errors ??= []
            errors.push(error)
          }
        }
        const next = this.pending_notifications.shift()
        if (next === undefined) break
        batch = next
      }
    } finally {
      this.notifying = false
      this.pending_notifications.length = 0
    }
    if (errors?.length === 1) throw errors[0]
    if (errors)
      throw new AggregateError(errors, `${errors.length} trajectory property listeners failed`)
  }

  // Plain (non-reactive) change notification for workers and hosts that forward batches.
  // Returns an unsubscribe function.
  subscribe(listener: PropertiesListener): () => void {
    this.listeners = [...this.listeners, listener]
    return () => {
      const idx = this.listeners.indexOf(listener)
      if (idx !== -1) this.listeners = this.listeners.toSpliced(idx, 1)
    }
  }
}

const sort_rows = (rows: TrajectoryMetadata[], start = 1): TrajectoryMetadata[] => {
  // Callers supply an owned snapshot; `start` skips its already-ordered prefix. Sorting
  // that snapshot only when needed avoids another copy and preserves earlier snapshots.
  for (let idx = start; idx < rows.length; idx++) {
    if (!(rows[idx].frame_number > rows[idx - 1].frame_number)) {
      return (
        rows
          // eslint-disable-next-line unicorn/no-array-sort -- this snapshot belongs to the caller
          .sort((row_a, row_b) => row_a.frame_number - row_b.frame_number)
          .filter(
            (row, row_idx, sorted) =>
              row_idx === 0 || row.frame_number !== sorted[row_idx - 1].frame_number,
          )
      )
    }
  }
  return rows
}

type FrameResult = TrajectoryFrame | Promise<TrajectoryFrame>

export interface TrajectoryRun {
  readonly atom_count: number
  read_atoms?: ReadAtoms
  compute_hotspots?: (options: HotspotRequest) => Promise<HotspotResult>
  // Mandatory and >= 1: an electronic-only vaspout.h5 is a spectral result, never a run
  readonly frame_count: number
  // Frame 0 for layout; may sample sites, so use atom_count for the full initial topology.
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
  // aborted and throws/rejects after dispose(), including frame 0. The in-memory `preview`
  // remains readable without accessing disposed resources.
  read_frame(frame_idx: number, signal?: AbortSignal): FrameResult
  // Present iff the run supports full-pass analyses (MSD/VACF/CNA/spectroscopy/trails)
  collect_positions?(options?: CollectPositionsOptions): Promise<TrajectoryPositionStream>
  // Releases bytes, worker + frame port, HDF5 handle, index. Idempotent.
  dispose(): void
}

// Serialisable picture of a run that lives in another thread or process (parse worker,
// VS Code host). Everything except frames and collect_positions, which travel over a port.
export interface TrajectoryRunSummary {
  atom_count: number
  has_read_atoms?: boolean
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
  atom_count: run.atom_count,
  has_read_atoms: run.read_atoms !== undefined,
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
): SharedRunFields & Pick<TrajectoryRun, `frame_count` | `preview` | `atom_count`> => ({
  atom_count: summary.atom_count,
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
  atom_count?: number
  read_atoms?: ReadAtoms
  preview?: TrajectoryFrame
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
  const {
    label,
    frame_count,
    read,
    collect_positions,
    release,
    preview: source_preview,
    read_atoms: source_atoms,
    atom_count: source_atom_count,
    ...fields
  } = source
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
  const preview = source_preview ?? read(0)
  const atom_count = source_atom_count ?? preview.structure.sites.length
  let disposed = false
  const live = (): void => {
    if (disposed) throw disposed_error(label)
  }
  const read_atoms: ReadAtoms = (options, signal) => {
    live()
    signal?.throwIfAborted()
    assert_frame_idx({ frame_count }, options.frame_idx)
    return source_atoms
      ? source_atoms(options, signal)
      : frame_atom_batch(read(options.frame_idx), options, fields.atom_masses, fields.signals)
  }
  return {
    ...fields,
    atom_count,
    ...((Boolean(source_atoms) || atom_count <= ATOM_BATCH_SIZE) && {
      read_atoms,
      compute_hotspots: async (options: HotspotRequest) => {
        live()
        const { calculate_hotspots } = await import('./hotspots')
        return calculate_hotspots(frame_count, read_atoms, options)
      },
    }),
    frame_count,
    // Keep the snapshot unproxied when Svelte binds the run to reactive state.
    get preview() {
      return preview
    },
    read_frame: (frame_idx, signal) => {
      assert_frame_idx({ frame_count }, frame_idx)
      live()
      signal?.throwIfAborted()
      if (frame_idx === 0 && !source_preview) return preview
      return read(frame_idx)
    },
    ...(collect_positions && {
      collect_positions: async (options = {}) => {
        live()
        return collect_positions(options)
      },
    }),
    dispose: () => {
      if (disposed) return
      disposed = true
      try {
        fields.properties.finish()
      } finally {
        release?.()
      }
    },
  }
}
