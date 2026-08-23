import {
  CONFIG_DIRS_REGEX,
  HDF5_EXT_REGEX,
  STRUCT_KEYWORDS_REGEX,
  STRUCT_KEYWORDS_STRICT_REGEX,
  STRUCTURE_EXTENSIONS_REGEX,
  TRAJ_EXTENSIONS_REGEX,
  TRAJ_KEYWORDS_REGEX,
  VASP_FILES_REGEX,
  XDATCAR_REGEX,
  XYZ_EXTXYZ_REGEX,
} from '$lib/constants'
import { strip_compression_extensions } from '$lib/io/decompress'

// A LAMMPS data file always declares its atom count in the header and holds an `Atoms`
// section; used to tell a real .data file from the many other things called `*.data`
export const is_lammps_data_content = (content: string): boolean =>
  /^\s*\d+\s+atoms\s*(?:#.*)?$/im.test(content) && /^\s*Atoms\b/im.test(content)

export const is_lammps_dump_content = (content: string): boolean =>
  /^\s*ITEM:\s*TIMESTEP/im.test(content)

// Filename-only detection lives apart from the parsers so lightweight callers
// (desktop recents, file pickers) do not load YAML, structure math, and element
// data just to choose an icon.
export function is_structure_file(filename: string): boolean {
  const name = strip_compression_extensions(filename)

  if (
    TRAJ_EXTENSIONS_REGEX.test(name) ||
    HDF5_EXT_REGEX.test(name) ||
    XDATCAR_REGEX.test(name)
  ) {
    return false
  }
  if (STRUCTURE_EXTENSIONS_REGEX.test(name) || VASP_FILES_REGEX.test(name)) {
    return true
  }
  if (XYZ_EXTXYZ_REGEX.test(name)) return !TRAJ_KEYWORDS_REGEX.test(name)
  if (/\.(?:yaml|yml|xml)$/i.test(name) && STRUCT_KEYWORDS_REGEX.test(name)) return true
  return (
    /\.json$/i.test(name) &&
    STRUCT_KEYWORDS_STRICT_REGEX.test(name) &&
    !TRAJ_KEYWORDS_REGEX.test(name) &&
    !CONFIG_DIRS_REGEX.test(name)
  )
}
