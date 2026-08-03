import {
  COMPRESSION_EXTENSIONS_REGEX,
  CONFIG_DIRS_REGEX,
  STRUCTURE_EXTENSIONS,
  TRAJ_EXTENSIONS,
  TRAJ_KEYWORDS_REGEX,
  VASP_STRUCTURE_FILES,
  VASP_VOLUMETRIC_FILES,
  XYZ_EXTENSIONS,
} from '$lib/constants'
import {
  FERMI_FILE_EXTENSIONS,
  FERMI_FILE_RE,
  VOLUMETRIC_EXT_RE,
  VOLUMETRIC_VASP_RE,
} from '$lib/file-viewer/types'
import {
  detect_compression_format,
  is_browser_decompressible_format,
} from '$lib/io/decompress'
import { is_structure_file } from '$lib/structure/format-detect'
import { is_trajectory_file } from '$lib/trajectory/format-detect'

// Return the browser-visible filename after removing one supported compression
// wrapper. Nested and unsupported wrappers are deliberately rejected because the
// parser only decompresses one layer.
export const normalize_browser_supported_filename = (filename: string): string | null => {
  const format = detect_compression_format(filename)
  if (!format) return filename
  if (!is_browser_decompressible_format(format)) return null
  const normalized = filename.replace(COMPRESSION_EXTENSIONS_REGEX, ``)
  return detect_compression_format(normalized) ? null : normalized
}

export const should_encode_filename_as_base64 = (filename: string): boolean =>
  detect_compression_format(filename) !== null || /\.(?:traj|h5|hdf5)$/i.test(filename)

const normalize_eligible_filename = (filename: unknown): string | null => {
  if (typeof filename !== `string` || !filename || CONFIG_DIRS_REGEX.test(filename))
    return null
  return normalize_browser_supported_filename(filename.split(/[\\/]/).pop() ?? ``)
}

// Broad: MatterViz can open/view this file (JSON/YAML structures, keyword trajs, …).
export const is_matterviz_filename = (filename: unknown): boolean => {
  const normalized = normalize_eligible_filename(filename)
  if (normalized === null) return false
  return (
    FERMI_FILE_RE.test(normalized) ||
    VOLUMETRIC_EXT_RE.test(normalized) ||
    VOLUMETRIC_VASP_RE.test(normalized) ||
    is_structure_file(normalized) ||
    is_trajectory_file(normalized)
  )
}

// What `is_matterviz_filename` answers, as a literal list, for hosts that cannot call a
// predicate: native open dialogs and OS file associations take an extension array.
// `eligibility.test.ts` checks both directions — every entry is one the predicate accepts,
// and every canonical filename family is present. HDF5 remains explicit because its
// detection is keyword-gated. JSON/YAML are left out because the viewer takes them only
// with a structure keyword in the name — a host that wants every .json adds it itself.
export const MATTERVIZ_FILE_EXTENSIONS: readonly string[] = Object.freeze([
  ...new Set([
    ...[...STRUCTURE_EXTENSIONS, ...TRAJ_EXTENSIONS].map((ext) => ext.slice(1)),
    ...XYZ_EXTENSIONS.map((ext) => ext.slice(1)),
    `h5`, // is_trajectory_file, keyword-gated
    `hdf5`,
    ...FERMI_FILE_EXTENSIONS.map((ext) => ext.slice(1)),
    `xdatcar`, // XDATCAR_REGEX, matched as a bare filename
    ...VASP_STRUCTURE_FILES,
    ...VASP_VOLUMETRIC_FILES,
  ]),
])

// Conservative auto-open list: only unambiguous structure / trajectory / volumetric /
// Fermi filenames. No JSON/YAML/XML, no keyword+.log/.out/.dat/.data heuristics.
const AUTO_RENDER_EXT_RE =
  /\.(?:cif|mcif|mmcif|xyz|extxyz|poscar|vasp|cube|pdb|mol|mol2|sdf|lmp|dump|traj|xtc|lammpstrj)$/i
const AUTO_RENDER_VASP_NAME_RE = /(?:^|[\\/_.-])(?:poscar|contcar|xdatcar)(?:[\\/_.-]|$)/i

export const is_auto_renderable_filename = (filename: unknown): boolean => {
  const normalized = normalize_eligible_filename(filename)
  if (normalized === null) return false
  if (
    FERMI_FILE_RE.test(normalized) ||
    VOLUMETRIC_EXT_RE.test(normalized) ||
    VOLUMETRIC_VASP_RE.test(normalized) ||
    AUTO_RENDER_VASP_NAME_RE.test(normalized) ||
    AUTO_RENDER_EXT_RE.test(normalized)
  ) {
    return true
  }
  // HDF5 only when the name clearly marks a trajectory
  return (
    /\.(?:h5|hdf5)$/i.test(normalized) &&
    (/vaspout/i.test(normalized) || TRAJ_KEYWORDS_REGEX.test(normalized))
  )
}
