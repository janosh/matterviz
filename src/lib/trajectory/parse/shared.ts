// Per-call collector for non-fatal parse warnings (skipped atoms, dropped torn frames, …) so
// they reach the UI on the run instead of living in module-global state. Fatal failures throw.
import { to_error } from '$lib/utils'
import type {
  PositionStreamOptions,
  TrajectoryFrame,
  TrajectoryMetadata,
  TrajectoryPositionStream,
  TrajectoryRunSignal,
  TrajectorySignal,
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
  const seen_keys = new Set<string>()
  const warn: WarnFn = (message, error) => {
    const detail = error === undefined ? `` : `: ${to_error(error).message}`
    warnings.push(`${message}${detail}`)
    if (error === undefined) console.warn(message)
    else console.warn(`${message}:`, error)
  }
  return {
    warn,
    warn_once: (key, message) => {
      if (seen_keys.has(key)) return
      seen_keys.add(key)
      warn(message)
    },
    warnings,
  }
}

// Run-level facts a file records, in the shape TrajectoryRun carries them
interface ParsedRunFacts {
  // Short format tag for provenance: 'xyz' | 'lammps' | 'xdatcar' | 'ase' | 'pymatgen-json' | …
  format: string
  metadata: Record<string, unknown>
  // Simulation time per MD step
  time_step?: { value: number; unit: string }
  atom_masses?: number[]
}

// What every format parser returns: plain frames plus whatever run-level facts the file
// records. open_trajectory turns it into a TrajectoryRun.
export interface ParsedTrajectory extends ParsedRunFacts {
  frames: TrajectoryFrame[]
  // Frames are all in memory, so every run-level signal is too
  signals?: Record<string, TrajectorySignal>
  // Pre-extracted per-frame scalars; omitted when the frames themselves are the source
  properties?: TrajectoryMetadata[]
}

// A parser that keeps its source open (HDF5 handle) and decodes frames on demand instead of
// materialising them. open_trajectory wraps it in an hdf5_run that owns `dispose`.
export interface LazyTrajectorySource extends ParsedRunFacts {
  frame_count: number
  read_frame: (frame_idx: number) => TrajectoryFrame
  // Sampled per-frame scalars (at most ~1000 rows) for the plot pane
  properties: TrajectoryMetadata[]
  collect_positions: (options: PositionStreamOptions) => TrajectoryPositionStream
  // Descriptors for what collect_positions can stream, plus any signal read eagerly
  signals?: Record<string, TrajectoryRunSignal>
  dispose?: () => void
}
