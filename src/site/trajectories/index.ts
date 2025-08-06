export const trajectory_files = import.meta.glob(`$site/trajectories/*`, {
  query: `?url`,
})

export const get_trajectory_type = (filename: string): string => {
  if (filename.match(/\.(h5|hdf5)$/i)) return `hdf5`
  if (filename.match(/\.json/i)) return `json`
  if (filename.match(/\.(xyz|extxyz)/i)) return `xyz`
  if (filename.match(/xdatcar/i)) return `xdatcar`
  if (filename.match(/\.traj$/i)) return `traj`
  return `unknown`
}
