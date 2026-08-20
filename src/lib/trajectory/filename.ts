import {
  CONFIG_DIRS_REGEX,
  MD_SIM_EXCLUDE_REGEX,
  TRAJ_EXTENSIONS_REGEX,
  TRAJ_FALLBACK_EXTENSIONS_REGEX,
  TRAJ_KEYWORDS_REGEX,
  XDATCAR_REGEX,
  XYZ_EXTXYZ_REGEX,
} from '$lib/constants'
import { strip_compression_extensions } from '$lib/io/decompress'

export const HDF5_EXT_REGEX = /\.(?:h5|hdf5)$/i

export const is_trajectory_filename = (filename: string): boolean => {
  if (CONFIG_DIRS_REGEX.test(filename)) return false
  const base_name = strip_compression_extensions(filename)

  if (XYZ_EXTXYZ_REGEX.test(base_name)) return TRAJ_KEYWORDS_REGEX.test(base_name)
  if (TRAJ_EXTENSIONS_REGEX.test(base_name) || XDATCAR_REGEX.test(base_name)) return true
  if (MD_SIM_EXCLUDE_REGEX.test(base_name)) return false
  if (HDF5_EXT_REGEX.test(base_name)) {
    return /vaspout/i.test(base_name) || TRAJ_KEYWORDS_REGEX.test(base_name)
  }
  return TRAJ_KEYWORDS_REGEX.test(base_name) && TRAJ_FALLBACK_EXTENSIONS_REGEX.test(base_name)
}
