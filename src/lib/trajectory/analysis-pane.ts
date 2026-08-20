// Types of the generic TrajectoryAnalysisPane, kept in a plain module so non-Svelte tooling
// (and analysis modules' collectors) can import them without going through the component.
import type { ParseProgress } from '$lib/trajectory'

// What the pane hands to a module's `controls`, `hint` and `children` snippets
export type AnalysisPaneContext<Input> = {
  input: Input | undefined
  // True once a usable timestep is entered; `dt_collected` is then the time between two
  // COLLECTED frames (source dt × frame stride) in `time_unit`
  has_valid_dt: boolean
  dt_collected: number
  time_unit: string
  safe_stride: number
  collected_frames: number
  n_atoms: number
}

// What the pane passes to a module's `collect(trajectory, options)`
export type AnalysisCollectOptions = {
  raw_data: string | ArrayBuffer | null
  frame_stride: number
  on_progress: (progress: ParseProgress) => void
}
