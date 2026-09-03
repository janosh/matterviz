// Per-call collector for non-fatal parse warnings (skipped atoms, dropped torn frames, …) so
// they reach the UI on the run instead of living in module-global state. Fatal failures throw.
import type { Matrix3x3 } from '$lib/math'
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

// === VASP text outputs (OUTCAR, vasprun.xml) ===

// VASP prints stress in kB; the trajectory labels declare pressure and stress in GPa
const KBAR_TO_GPA = 0.1

// Frame metadata for a stress tensor as VASP prints it: kB, positive = compressive. The
// pressure is the trace mean, which is what OUTCAR's `external pressure` line reports.
// The 3x3 matrix is not plottable, so the two magnitudes come along (stress_frobenius, a
// default-visible series, otherwise had no producer).
export const vasp_stress_metadata = (
  stress_kbar: Matrix3x3,
): { stress: Matrix3x3; pressure: number; stress_max: number; stress_frobenius: number } => {
  const stress = stress_kbar.map((row) => row.map((val) => val * KBAR_TO_GPA)) as Matrix3x3
  return {
    stress,
    pressure: (stress[0][0] + stress[1][1] + stress[2][2]) / 3,
    stress_max: Math.max(...stress.map((row, idx) => Math.abs(row[idx]))),
    stress_frobenius: Math.hypot(...stress.flat()),
  }
}

// POTIM is the time step (fs) only when IBRION = 0; relaxations reuse the tag as a step scale
type VaspRunTags = { ibrion: number | null; potim: number | null; version?: string }

// The run-level facts every VASP output records, in ParsedTrajectory shape
export const vasp_run = (
  format: string,
  frames: TrajectoryFrame[],
  atom_masses: number[] | undefined,
  { ibrion, potim, version }: VaspRunTags,
): ParsedTrajectory => {
  const metadata: Record<string, unknown> = {}
  if (ibrion !== null) metadata.ibrion = ibrion
  if (version) metadata.vasp_version = version
  return {
    format,
    frames,
    metadata,
    ...(ibrion === 0 && potim !== null && potim > 0
      ? { time_step: { value: potim, unit: `fs` } }
      : {}),
    ...(atom_masses ? { atom_masses } : {}),
  }
}
