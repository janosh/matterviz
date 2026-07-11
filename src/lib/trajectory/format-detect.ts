// Format detection for trajectory files
import {
  CONFIG_DIRS_REGEX,
  MD_SIM_EXCLUDE_REGEX,
  TRAJ_EXTENSIONS_REGEX,
  TRAJ_FALLBACK_EXTENSIONS_REGEX,
  TRAJ_KEYWORDS_SIMPLE_REGEX,
  XDATCAR_REGEX,
} from '$lib/constants'
import { strip_compression_extensions } from '$lib/io/decompress'
import { parse_leading_num } from '$lib/utils'
import { count_xyz_frames } from './helpers'

// Extensions that explicitly identify a format — when present, format detection trusts
// the extension instead of sniffing content
const KNOWN_FORMAT_EXT_REGEX =
  /\.(?:xyz|extxyz|traj|h5|hdf5|lammpstrj|json|cif|poscar|vasp|yaml|yml|xml|csv)$/

// Classify the filename hint for a format whose extensions match ext_regex:
// true = filename matches, false = filename names a different known format,
// null = no usable hint (missing filename or unrecognized extension, e.g. the UUID
// basenames of blob: object URLs) — callers should fall back to content detection
export function ext_hint(filename: string | undefined, ext_regex: RegExp): boolean | null {
  if (!filename) return null
  const base = strip_compression_extensions(filename)
  if (ext_regex.test(base)) return true
  return KNOWN_FORMAT_EXT_REGEX.test(base) ? false : null
}

// Large-file frame indexing currently supports text XYZ/EXTXYZ and binary ASE .traj.
export const indexed_trajectory_format = (filename: string): `ase` | `xyz` =>
  strip_compression_extensions(filename).endsWith(`.traj`) ? `ase` : `xyz`

export const is_indexable_trajectory_filename = (filename: string): boolean =>
  /\.(?:xyz|extxyz|traj)$/i.test(strip_compression_extensions(filename))

// Unified format detection. Each pattern trusts a matching file extension when present
// but falls back to content/magic-byte detection when the filename gives no hint
// (e.g. blob: object URLs, extensionless API endpoints).
export const FORMAT_PATTERNS = {
  ase: (data: unknown, filename?: string) => {
    if (ext_hint(filename, /\.traj$/) === false || !(data instanceof ArrayBuffer)) {
      return false
    }
    const view = new Uint8Array(data.slice(0, 24))
    return [0x2d, 0x20, 0x6f, 0x66, 0x20, 0x55, 0x6c, 0x6d].every(
      (byte, idx) => view[idx] === byte,
    )
  },

  hdf5: (data: unknown, filename?: string) => {
    if (ext_hint(filename, /\.(?:h5|hdf5)$/) === false) return false
    if (!(data instanceof ArrayBuffer) || data.byteLength < 8) return false
    const signature = new Uint8Array(data.slice(0, 8))
    return [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (byte, idx) => signature[idx] === byte,
    )
  },

  vasp: (data: string, filename?: string) => {
    const basename = filename?.toLowerCase().split(`/`).pop() ?? ``
    if (basename === `xdatcar` || basename.startsWith(`xdatcar`)) return true
    const lines = data.trim().split(/\r?\n/)
    return (
      lines.length >= 10 &&
      lines.some((line) => line.includes(`Direct configuration=`)) &&
      !isNaN(parse_leading_num(lines[1])) &&
      lines.slice(2, 5).every((line) => line.trim().split(/\s+/).length === 3)
    )
  },

  xyz_multi: (data: string, filename?: string) => {
    if (ext_hint(filename, /\.(?:xyz|extxyz)$/) === false) return false
    return count_xyz_frames(data) >= 2
  },

  lammpstrj: (data: string, filename?: string) => {
    if (ext_hint(filename, /\.lammpstrj$/) === false) return false
    return data.includes(`ITEM: TIMESTEP`) && data.includes(`ITEM: ATOMS`)
  },
} as const

// Check if file is a trajectory (supports both filename-only and content-based detection)
export function is_trajectory_file(filename: string, content?: string): boolean {
  if (CONFIG_DIRS_REGEX.test(filename)) return false
  const base_name = strip_compression_extensions(filename)

  // For xyz/extxyz files, use content-based detection if available
  if (/\.(?:xyz|extxyz)$/i.test(base_name)) {
    if (content) return count_xyz_frames(content) >= 2
    return TRAJ_KEYWORDS_SIMPLE_REGEX.test(base_name)
  }

  // Always detect these specific trajectory formats
  if (TRAJ_EXTENSIONS_REGEX.test(base_name) || XDATCAR_REGEX.test(base_name)) return true

  // Special exclusion for generic md_simulation pattern with certain extensions
  if (MD_SIM_EXCLUDE_REGEX.test(base_name)) return false

  // For .h5/.hdf5 files, require trajectory keywords. vaspout.h5 (VASP's
  // HDF5 output) is always trajectory-shaped regardless of keywords.
  if (/\.(?:h5|hdf5)$/i.test(base_name)) {
    return /vaspout/i.test(base_name) || TRAJ_KEYWORDS_SIMPLE_REGEX.test(base_name)
  }

  // For other extensions, require both keywords and specific extensions
  return (
    TRAJ_KEYWORDS_SIMPLE_REGEX.test(base_name) &&
    TRAJ_FALLBACK_EXTENSIONS_REGEX.test(base_name)
  )
}
