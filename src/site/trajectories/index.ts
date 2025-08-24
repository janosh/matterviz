import type { FileInfo } from '$lib'
import type { TrajectoryFormat } from '$lib/trajectory'

// Auto-updating object storing all trajectory files
export const trajectory_files = import.meta.glob(`$site/trajectories/*`, {
  query: `?url`,
})

// Determines the trajectory file type based on filename
export function get_trajectory_type(file: FileInfo): TrajectoryFormat {
  if (file.name.match(/\.(h5|hdf5)$/i)) return `hdf5`
  if (file.name.match(/\.json/i)) return `json`
  if (file.name.match(/\.(xyz|extxyz)/i)) return `xyz`
  if (file.name.match(/xdatcar/i)) return `xdatcar`
  if (file.name.match(/\.traj$/i)) return `traj`
  return `unknown`
}
