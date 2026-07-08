import {
  COMPRESSION_EXTENSIONS_REGEX,
  CONFIG_DIRS_REGEX,
  STRUCT_KEYWORDS_REGEX,
  STRUCT_KEYWORDS_STRICT_REGEX,
  STRUCTURE_EXTENSIONS_REGEX,
  TRAJ_KEYWORDS_REGEX,
  VASP_FILES_REGEX,
} from '$lib/constants'

// Filename-only detection lives apart from the parsers so lightweight callers
// (desktop recents, file pickers) do not load YAML, structure math, and element
// data just to choose an icon.
export function is_structure_file(filename: string): boolean {
  const name = filename.toLowerCase()

  if (/\.(?:traj|xtc|h5|hdf5)$/i.test(name) || /xdatcar/i.test(name)) return false
  if (STRUCTURE_EXTENSIONS_REGEX.test(name) || VASP_FILES_REGEX.test(name)) return true
  if (/\.(?:xyz|extxyz)$/i.test(name)) return !TRAJ_KEYWORDS_REGEX.test(name)
  if (/\.(?:yaml|yml|xml)$/i.test(name) && STRUCT_KEYWORDS_REGEX.test(name)) return true
  if (
    /\.json$/i.test(name) &&
    STRUCT_KEYWORDS_STRICT_REGEX.test(name) &&
    !TRAJ_KEYWORDS_REGEX.test(name) &&
    !CONFIG_DIRS_REGEX.test(name)
  )
    return true
  return COMPRESSION_EXTENSIONS_REGEX.test(name)
    ? is_structure_file(name.replace(COMPRESSION_EXTENSIONS_REGEX, ``))
    : false
}
