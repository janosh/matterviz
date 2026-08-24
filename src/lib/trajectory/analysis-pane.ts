// Types of the generic TrajectoryAnalysisPane, kept in a plain module so non-Svelte tooling
// (and analysis modules' collectors) can import them without going through the component.
import type { ParseProgress } from '$lib/trajectory'

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
export type AnalysisCollectOptions = {
  frame_stride: number
  on_progress: (progress: ParseProgress) => void
  // Aborted once the answer can no longer be used (a newer collect, a trajectory swap, or the
  // pane unmounting), so collectors that honour it stop reading frames early
  signal: AbortSignal
}
