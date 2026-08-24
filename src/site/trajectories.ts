import type { FileInfo } from '$lib'
import { site_file_info } from '$site/imports'

// FilePicker type for a trajectory fixture: format name rather than the bare extension, so
// `.xyz`/`.extxyz` and `.h5`/`.hdf5` each collapse into one filter chip
const trajectory_type = (name: string): string => {
  const filename = name.replace(/\.gz$/i, ``)
  if (/\.(?:h5|hdf5)$/i.test(filename)) return `hdf5`
  if (/\.json$/i.test(filename)) return `json`
  if (/\.(?:xyz|extxyz)$/i.test(filename)) return `xyz`
  if (/xdatcar/i.test(filename)) return `xdatcar`
  if (/\.traj$/i.test(filename)) return `traj`
  return `unknown`
}

// ?url like the other site registries: only the keys are read, and the static symlink serves
// the fixtures at /trajectories/<name>
export const trajectory_files: FileInfo[] = Object.keys(
  import.meta.glob(`$site/trajectories/*`, { query: `?url` }),
).map((path) => {
  const file = site_file_info(path)
  return { ...file, type: trajectory_type(file.name) }
})
