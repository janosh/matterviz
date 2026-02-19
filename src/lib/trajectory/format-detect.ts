// Format detection for trajectory files
import {
  COMPRESSION_EXTENSIONS_REGEX,
  CONFIG_DIRS_REGEX,
  MD_SIM_EXCLUDE_REGEX,
  TRAJ_EXTENSIONS_REGEX,
  TRAJ_FALLBACK_EXTENSIONS_REGEX,
  TRAJ_KEYWORDS_SIMPLE_REGEX,
  XDATCAR_REGEX,
} from '$lib/constants'
import { count_xyz_frames } from './helpers'

// Unified format detection
export const FORMAT_PATTERNS = {
  ase: (data: unknown, filename?: string) => {
    const base_name = filename?.toLowerCase().replace(COMPRESSION_EXTENSIONS_REGEX, ``)
    if (!base_name?.endsWith(`.traj`) || !(data instanceof ArrayBuffer)) {
      return false
    }
    const view = new Uint8Array(data.slice(0, 24))
    return [0x2d, 0x20, 0x6f, 0x66, 0x20, 0x55, 0x6c, 0x6d].every((byte, idx) =>
      view[idx] === byte
    )
  },

  hdf5: (data: unknown, filename?: string) => {
    const base_name = filename?.toLowerCase().replace(COMPRESSION_EXTENSIONS_REGEX, ``)
    const has_ext = base_name?.match(/\.(h5|hdf5)$/)
    if (!has_ext || !(data instanceof ArrayBuffer) || data.byteLength < 8) return false
    const signature = new Uint8Array(data.slice(0, 8))
    return [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a].every((b, idx) =>
      signature[idx] === b
    )
  },

  vasp: (data: string, filename?: string) => {
    const basename = filename?.toLowerCase().split(`/`).pop() || ``
    if (basename === `xdatcar` || basename.startsWith(`xdatcar`)) return true
    const lines = data.trim().split(/\r?\n/)
    return lines.length >= 10 &&
      lines.some((line) => line.includes(`Direct configuration=`)) &&
      !isNaN(parseFloat(lines[1])) &&
      lines.slice(2, 5).every((line) => line.trim().split(/\s+/).length === 3)
  },

  xyz_multi: (data: string, filename?: string) => {
    const lower = filename?.toLowerCase() ?? ``
    const base = lower.replace(COMPRESSION_EXTENSIONS_REGEX, ``)
    if (!/\.(xyz|extxyz)$/.test(base)) return false
    return count_xyz_frames(data) >= 2
  },

  lammpstrj: (data: string, filename?: string) => {
    const lower = filename?.toLowerCase() ?? ``
    const base = lower.replace(COMPRESSION_EXTENSIONS_REGEX, ``)
    if (!/\.lammpstrj$/.test(base)) return false
    return data.includes(`ITEM: TIMESTEP`) && data.includes(`ITEM: ATOMS`)
  },
} as const

// Check if file is a trajectory (supports both filename-only and content-based detection)
export function is_trajectory_file(filename: string, content?: string): boolean {
  if (CONFIG_DIRS_REGEX.test(filename)) return false
  let base_name = filename.toLowerCase()
  while (COMPRESSION_EXTENSIONS_REGEX.test(base_name)) {
    base_name = base_name.replace(COMPRESSION_EXTENSIONS_REGEX, ``)
  }

  // For xyz/extxyz files, use content-based detection if available
  if (/\.(xyz|extxyz)$/i.test(base_name)) {
    if (content) return count_xyz_frames(content) >= 2
    return TRAJ_KEYWORDS_SIMPLE_REGEX.test(base_name)
  }

  // Always detect these specific trajectory formats
  if (TRAJ_EXTENSIONS_REGEX.test(base_name) || XDATCAR_REGEX.test(base_name)) return true

  // Special exclusion for generic md_simulation pattern with certain extensions
  if (MD_SIM_EXCLUDE_REGEX.test(base_name)) return false

  // For .h5/.hdf5 files, require trajectory keywords
  if (/\.(h5|hdf5)$/i.test(base_name)) {
    return TRAJ_KEYWORDS_SIMPLE_REGEX.test(base_name)
  }

  // For other extensions, require both keywords and specific extensions
  return TRAJ_KEYWORDS_SIMPLE_REGEX.test(base_name) &&
    TRAJ_FALLBACK_EXTENSIONS_REGEX.test(base_name)
}
