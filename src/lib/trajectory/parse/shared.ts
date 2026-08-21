// Per-call collector for non-fatal parse warnings (skipped atoms, dropped torn frames, …) so
// they reach the UI on the run instead of living in module-global state. Fatal failures throw.
import { to_error } from '$lib/utils'
import type {
  PositionStreamOptions,
  TrajectoryFrame,
  TrajectoryMetadata,
  TrajectoryPositionStream,
  TrajectorySignal,
  TrajectorySignalDescriptor,
} from '$lib/trajectory/index'

export type WarnFn = (message: string, error?: unknown) => void

export interface WarningCollector {
  warn: WarnFn
  // Emit a message at most once per key (e.g. one "invalid pbc" warning per file)
  warn_once: (key: string, message: string) => void
  readonly warnings: string[]
}

export const create_warning_collector = (): WarningCollector => {
  const warnings: string[] = []
  const seen_keys: string[] = []
  const warn: WarnFn = (message, error) => {
    const detail = error === undefined ? `` : `: ${to_error(error).message}`
    warnings.push(`${message}${detail}`)
    if (error === undefined) console.warn(message)
    else console.warn(`${message}:`, error)
  }
  return {
    warn,
    warn_once: (key, message) => {
      if (seen_keys.includes(key)) return
      seen_keys.push(key)
      warn(message)
    },
    warnings,
  }
}

// What every format parser returns: plain frames plus whatever run-level facts the file
// records. open_trajectory turns it into a TrajectoryRun.
export interface ParsedTrajectory {
  // Short format tag for provenance: 'xyz' | 'lammps' | 'xdatcar' | 'ase' | 'pymatgen-json' | …
  format: string
  frames: TrajectoryFrame[]
  metadata: Record<string, unknown>
  // Simulation time per MD step; `time_unit` is required for it to count
  time_step?: number
  time_unit?: string
  atom_masses?: number[]
  signals?: Record<string, TrajectorySignal>
  signal_descriptors?: Record<string, TrajectorySignalDescriptor>
  // Pre-extracted per-frame scalars; omitted when the frames themselves are the source
  properties?: TrajectoryMetadata[]
}

// A parser that keeps its source open (HDF5 handle) and decodes frames on demand instead of
// materialising them. open_trajectory wraps it in an hdf5_run that owns `dispose`.
export interface LazyTrajectorySource {
  format: string
  frame_count: number
  read_frame: (frame_idx: number) => TrajectoryFrame
  // Sampled per-frame scalars (at most ~1000 rows) for the plot pane
  properties: TrajectoryMetadata[]
  collect_positions: (options: PositionStreamOptions) => TrajectoryPositionStream
  metadata: Record<string, unknown>
  time_step?: number
  time_unit?: string
  atom_masses?: number[]
  signal_descriptors?: Record<string, TrajectorySignalDescriptor>
  dispose?: () => void
}
