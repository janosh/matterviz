// Format detection for trajectory files
import {
  CONFIG_DIRS_REGEX,
  ext_regex,
  HDF5_EXT_REGEX,
  MD_SIM_EXCLUDE_REGEX,
  TRAJ_EXTENSIONS_REGEX,
  TRAJ_FALLBACK_EXTENSIONS_REGEX,
  TRAJ_KEYWORDS_REGEX,
  XDATCAR_REGEX,
  XYZ_EXTENSIONS,
  XYZ_EXTXYZ_REGEX,
} from '$lib/constants'
import { strip_compression_extensions } from '$lib/io/decompress'
import { has_ase_traj_magic, has_hdf5_magic, magic_head } from '$lib/io/is-binary'
import { is_lammps_data_content } from '$lib/structure/format-detect'
import { parse_leading_num } from '$lib/utils'
import { count_xyz_frames } from './helpers'

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

// Extensions that explicitly identify a format — when present, format detection trusts
// the extension instead of sniffing content
// oxfmt-ignore
const KNOWN_FORMAT_EXT_REGEX = ext_regex([
  ...XYZ_EXTENSIONS, `traj`, `h5`, `hdf5`, `lammpstrj`, `json`, `cif`, `poscar`, `vasp`, `yaml`,
  `yml`, `xml`, `csv`,
])
const INDEXABLE_EXT_REGEX = ext_regex([...XYZ_EXTENSIONS, `traj`])

// Classify the filename hint for a format whose extensions match ext_regex:
// true = filename matches, false = filename names a different known format,
// null = no usable hint (missing filename or unrecognized extension, e.g. the UUID
// basenames of blob: object URLs) — callers should fall back to content detection
function ext_hint(filename: string | undefined, format_regex: RegExp): boolean | null {
  if (!filename) return null
  const base = strip_compression_extensions(filename)
  if (format_regex.test(base)) return true
  return KNOWN_FORMAT_EXT_REGEX.test(base) ? false : null
}

export const xyz_ext_hint = (filename: string | undefined): boolean | null =>
  ext_hint(filename, XYZ_EXTXYZ_REGEX)

// Large-file frame indexing currently supports text XYZ/EXTXYZ and binary ASE .traj.
export const indexed_trajectory_format = (filename: string): `ase` | `xyz` =>
  /\.traj$/i.test(strip_compression_extensions(filename)) ? `ase` : `xyz`

export const is_indexable_trajectory_filename = (filename: string): boolean =>
  INDEXABLE_EXT_REGEX.test(strip_compression_extensions(filename))

// Unified format detection. Each pattern trusts a matching file extension when present
// but falls back to content/magic-byte detection when the filename gives no hint
// (e.g. blob: object URLs, extensionless API endpoints).
export const FORMAT_PATTERNS = {
  ase: (data: unknown, filename?: string) => {
    if (ext_hint(filename, /\.traj$/i) === false || !(data instanceof ArrayBuffer)) {
      return false
    }
    return has_ase_traj_magic(magic_head(data))
  },

  hdf5: (data: unknown, filename?: string) => {
    if (ext_hint(filename, HDF5_EXT_REGEX) === false || !(data instanceof ArrayBuffer)) {
      return false
    }
    return has_hdf5_magic(magic_head(data))
  },

  // Only the header lines are split: a whole-file split would scan every coordinate line
  // of a multi-hundred-MB MD run just to read five lines.
  vasp: (data: string, filename?: string) => {
    const basename = filename?.toLowerCase().split(`/`).pop() ?? ``
    if (basename.startsWith(`xdatcar`)) return true
    if (!data.includes(`Direct configuration=`)) return false
    const lines = data.trimStart().split(/\r?\n/, 10)
    return (
      lines.length === 10 &&
      !Number.isNaN(parse_leading_num(lines[1])) &&
      lines.slice(2, 5).every((line) => line.trim().split(/\s+/).length === 3)
    )
  },

  lammpstrj: (data: string, filename?: string) => {
    if (ext_hint(filename, /\.lammpstrj$/i) === false) return false
    return data.includes(`ITEM: TIMESTEP`) && data.includes(`ITEM: ATOMS`)
  },
} as const

// Check if file is a trajectory (supports both filename-only and content-based detection)
export function is_trajectory_file(filename: string, content?: string): boolean {
  if (content === undefined) return is_trajectory_filename(filename)
  if (CONFIG_DIRS_REGEX.test(filename)) return false
  const base_name = strip_compression_extensions(filename)

  if (XYZ_EXTXYZ_REGEX.test(base_name)) return count_xyz_frames(content, 2) >= 2

  // `.data` is a fallback trajectory extension but also the LAMMPS structure extension,
  // and md.data/nvt.data/nve.data are among the most common LAMMPS names — so a real
  // data file must not be claimed here just because its name carries a trajectory keyword
  if (/\.data$/i.test(base_name) && is_lammps_data_content(content)) return false
  return is_trajectory_filename(filename)
}
