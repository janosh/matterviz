// Public surface of the trajectory subsystem: the run contract, the two components, the
// analysis panes and the shared types every consumer needs.
import type { ElementSymbol } from '$lib/element'
import type { FileLoadData } from '$lib/io'
import type { Matrix3x3 } from '$lib/math'
import type { AnyStructure, Pbc } from '$lib/structure/index'
import type { TrajectoryRun } from './run'

export * from './analysis'
export * from './positions'
export {
  Hdf5GroupSelectionRequiredError,
  open_trajectory,
  type OpenTrajectoryOptions,
  source_byte_size,
  trajectory_from_frame_source,
  trajectory_from_frames,
  trajectory_from_json,
  VaspoutElectronicOnlyError,
} from './open'
export * from './run'
export type { MemoryRunExtras } from './runs/memory'
export { default as Trajectory } from './Trajectory.svelte'
export { default as TrajectoryFileViewer } from './TrajectoryFileViewer.svelte'
export { default as TrajectoryAnalysisPane } from './TrajectoryAnalysisPane.svelte'
export { default as TrajectoryDataInspectorPane } from './TrajectoryDataInspectorPane.svelte'
export { default as TrajectoryError } from './TrajectoryError.svelte'
export { default as TrajectoryExportPane } from './TrajectoryExportPane.svelte'
export { default as TrajectoryInfoPane } from './TrajectoryInfoPane.svelte'
export {
  energy_data_extractor,
  force_stress_data_extractor,
  full_data_extractor,
  structural_data_extractor,
} from './extract'
export type {
  TrajectoryFrameResolver,
  TrajectoryPropertyRow,
  TrajectoryPropertyTable,
} from './file-export'
export type {
  FrameStepSamples,
  PlotSeriesOptions,
  TrajectoryXMap,
  TrajectoryXQuantity,
} from './plotting'

// LAMMPS atom type -> element symbol, e.g. { 1: 'Na', 2: 'Cl' }
export type AtomTypeMapping = Record<number, ElementSymbol>

// Splitting side by side halves the width but keeps the full height, so the
// panes come out twice as tall relative to their width as the container is.
// A nearly square container therefore yields tall narrow panes, which a
// step-series plot reads badly in - a ~900x800 viewer gave the plot 450x800.
// Only split side by side while that leaves panes no more than this much
// taller than they are wide.
const MAX_PANE_TALLNESS = 1.4

// Smallest pane the structure viewer and the plot both stay readable in: a
// scatter spends ~80px on its y-axis label and tick labels and its legend needs
// ~10em on top of that, and below ~180px of height the x-axis labels eat the
// data area the same way.
const MIN_PANE_SIZE = { width: 320, height: 180 }

// Which way to split a container into two equal panes. Absolute size comes
// first: when only one of the two splits clears MIN_PANE_SIZE, that one wins
// regardless of shape, which is what stacks a 490x500 chat sidebar card whose
// 245px-wide panes would leave a plot no room for its axes. When both fit (or
// neither does), pane shape decides.
export function pick_pane_orientation(
  width: number,
  height: number,
): `horizontal` | `vertical` {
  const side_by_side_fits = width / 2 >= MIN_PANE_SIZE.width
  const stacked_fits = height / 2 >= MIN_PANE_SIZE.height
  if (side_by_side_fits && !stacked_fits) return `horizontal`
  if (stacked_fits && !side_by_side_fits) return `vertical`
  // a side-by-side pane is half the width and the container's full height
  return height <= (width / 2) * MAX_PANE_TALLNESS ? `horizontal` : `vertical`
}

// Core trajectory types
export interface ParseProgress {
  current: number
  total: number
  stage: string
}

export interface TrajectoryFrame {
  structure: AnyStructure
  // MD/ionic step recorded in the file. A LAMMPS dump written every 500 steps counts
  // 0, 500, 1000, … so this is NOT the frame's position in the trajectory.
  step: number
  metadata?: Record<string, unknown>
}

export interface TrajectoryMetadata {
  frame_number: number
  step: number
  properties: Record<string, number>
}

// Contiguous samples with an independent MD-step axis.
export interface TrajectorySignal {
  values: Float64Array
  sample_shape: number[]
  steps: number[]
  unit?: string
}

// A signal the run can stream on request (collect_positions `signal_keys`, or `vector_keys`
// for a per-atom [n_atoms, 3] signal with one sample per frame) but has not loaded
export interface TrajectorySignalDescriptor {
  sample_shape: number[]
  sample_count: number
  unit?: string
  // true when the signal's step axis is the geometry's (one sample per frame, same steps),
  // decided by the parser that has both axes. Only then may a [n_atoms, 3] signal be
  // streamed strided beside positions via `vector_keys`; `sample_count === frame_count`
  // alone does not imply it (a velocity on steps [1, 2, 3, 4] beside frames on [0, 1, 2, 3])
  frame_aligned?: boolean
}

// One entry of `TrajectoryRun.signals`: loaded (`values` present) or a lazy descriptor. Use
// `is_loaded_signal` / `is_signal_descriptor` from run.ts to tell them apart.
export type TrajectoryRunSignal = TrajectorySignal | TrajectorySignalDescriptor

export type TrajectorySource = string | ArrayBuffer | Blob

// What every viewer event handler receives
export interface TrajHandlerData extends FileLoadData {
  trajectory?: TrajectoryRun
  step_idx?: number
  frame_count?: number
  frame?: TrajectoryFrame
  error_msg?: string
  file_size?: number
  total_atoms?: number
}

// Imperative navigation handle for hosts (VS Code, JupyterLab); see on_controller
export interface TrajectoryController {
  set_step: (step_idx: number) => number
  state: () => { current_step_idx: number; total_frames: number }
  play: () => void
  pause: () => void
}

// Per-frame scalar extraction feeding the plot rows of an in-memory run
export type TrajectoryDataExtractor = (frame: TrajectoryFrame) => Record<string, number>

// Flat frame-major Cartesian positions.
export interface TrajectoryPositionStream {
  positions: Float64Array
  n_frames: number
  n_atoms: number
  elements: ElementSymbol[]
  // One cell per frame; null if none exist.
  lattice_matrices: (Matrix3x3 | null)[] | null
  pbc: Pbc | null
  coords_unwrapped: boolean
  frame_stride: number
  steps: number[]
  // Opt-in per-atom vec3 site properties (velocities), parallel to positions.
  vectors?: Record<string, Float64Array>
  // Requested frame-level signals on their native step axes.
  signals?: Record<string, TrajectorySignal>
}

// Zero-based source frames, start inclusive and end exclusive; omitted bounds select all.
export interface FrameRange {
  start_frame?: number
  end_frame?: number
}

export interface PositionStreamOptions extends FrameRange {
  // Collect every Nth frame. Use `suggest_frame_stride` to stay inside a memory budget.
  frame_stride?: number
  // Hard ceiling on the allocated position buffer; the sweep throws (with the stride
  // that would fit) rather than attempting a multi-GB allocation.
  max_bytes?: number
  // Required per-atom vec3 properties.
  vector_keys?: string[]
  // Frame metadata keys to collect as scalar, vec3, or 3x3 signals.
  signal_keys?: string[]
}

// What a run's collect_positions takes: the sweep options plus the progress / cancellation
// plumbing of one particular call
export interface CollectPositionsOptions extends PositionStreamOptions {
  on_progress?: (progress: ParseProgress) => void
  // Rejects with the signal's reason once aborted, so an analysis pane that no longer wants
  // the answer stops the frame reads
  signal?: AbortSignal
}
