import type { FileInfo } from '$lib'
import type { TrajectoryFormat } from '$lib/trajectory'

export const trajectory_files = import.meta.glob(`$site/trajectories/*`, {
  query: `?url`,
})

export function get_trajectory_type(file: FileInfo): TrajectoryFormat {
  const filename = file.name.replace(/\.gz$/i, ``)
  if (/\.(?:h5|hdf5)$/i.test(filename)) return `hdf5`
  if (/\.json$/i.test(filename)) return `json`
  if (/\.(?:xyz|extxyz)$/i.test(filename)) return `xyz`
  if (/xdatcar/i.test(filename)) return `xdatcar`
  if (/\.traj$/i.test(filename)) return `traj`
  return `unknown`
}
