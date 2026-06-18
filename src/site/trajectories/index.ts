import type { FileInfo } from '$lib'
import type { TrajectoryFormat } from '$lib/trajectory'

// Auto-updating object storing all trajectory files
export const trajectory_files = import.meta.glob(`$site/trajectories/*`, {
  query: `?url`,
})

// Determines the trajectory file type based on filename
export function get_trajectory_type(file: FileInfo): TrajectoryFormat {
  if (/\.(?:h5|hdf5)$/i.test(file.name)) return `hdf5`
  if (/\.json$/i.test(file.name)) return `json`
  if (/\.(?:xyz|extxyz)$/i.test(file.name)) return `xyz`
  if (/xdatcar/i.test(file.name)) return `xdatcar`
  if (/\.traj$/i.test(file.name)) return `traj`
  return `unknown`
}
