import { to_error } from '$lib/utils'

// Collector for non-fatal trajectory parse warnings (skipped atoms, dropped frames, plot-metadata extraction failures, ...) so they reach the UI not just the console. Reset at the start of each top-level parse call; format parsers append via traj_warn (mirrored to console.warn). Fatal failures throw — see parse_trajectory_data.
let traj_parse_warnings: string[] = []

// Read-only snapshot of warnings since the last top-level parse; no in-repo consumer yet, kept for UI surfacing of parse warnings (the whole point of this module)
export const get_traj_parse_warnings = (): string[] => [...traj_parse_warnings]

export const reset_traj_parse_warnings = (): void => void (traj_parse_warnings = [])

export const traj_warn = (message: string, error?: unknown): void => {
  const detail = error === undefined ? `` : `: ${to_error(error).message}`
  traj_parse_warnings.push(`${message}${detail}`)
  if (error === undefined) console.warn(message)
  else console.warn(`${message}:`, error)
}
