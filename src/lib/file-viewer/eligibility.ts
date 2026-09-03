import {
  BINARY_VIEWER_EXT_REGEX,
  COMPRESSION_EXTENSIONS_REGEX,
  CONFIG_DIRS_REGEX,
  ext_regex,
  filename_token_regex,
  HDF5_EXT_REGEX,
  STRUCTURE_EXTENSIONS,
  TRAJ_EXTENSIONS,
  TRAJ_KEYWORDS_REGEX,
  VASP_STRUCTURE_FILES,
  VASP_TRAJECTORY_FILES,
  VASP_VOLUMETRIC_REGEX,
  VASPRUN_REGEX,
  XYZ_EXTENSIONS,
} from '$lib/constants'
import { FERMI_FILE_RE, VOLUMETRIC_EXT_RE } from '$lib/file-viewer/types'
import {
  detect_compression_format,
  is_browser_decompressible_format,
  is_stream_compression_format,
} from '$lib/io/decompress'
import { is_structure_file } from '$lib/structure/format-detect'
import { is_trajectory_filename } from '$lib/trajectory/format-detect'

// One compression wrapper removed; nested and unsupported ones are rejected because the parser
// only decompresses one layer. `supported` differs by consumer: the webview inflates ZIP.
type FormatPredicate = (fmt: ReturnType<typeof detect_compression_format>) => boolean
export const normalize_browser_supported_filename = (
  filename: string,
  supported: FormatPredicate = is_stream_compression_format,
): string | null => {
  const format = detect_compression_format(filename)
  if (!format) return filename
  if (!supported(format)) return null
  const normalized = filename.replace(COMPRESSION_EXTENSIONS_REGEX, ``)
  return detect_compression_format(normalized) ? null : normalized
}

export const should_encode_filename_as_base64 = (filename: string): boolean =>
  detect_compression_format(filename) !== null || BINARY_VIEWER_EXT_REGEX.test(filename)

const normalize_eligible_filename = (filename: unknown): string | null => {
  if (typeof filename !== `string` || !filename || CONFIG_DIRS_REGEX.test(filename))
    return null
  const base_name = filename.split(/[\\/]/).pop() ?? ``
  return normalize_browser_supported_filename(base_name, is_browser_decompressible_format)
}

const is_fermi_or_volumetric = (normalized: string): boolean =>
  FERMI_FILE_RE.test(normalized) ||
  VOLUMETRIC_EXT_RE.test(normalized) ||
  VASP_VOLUMETRIC_REGEX.test(normalized)

// Broad: MatterViz can open/view this file (JSON/YAML structures, keyword trajs, …). Hosts
// that need a literal extension list use the viewer vocabularies in $lib/constants.
export const is_matterviz_filename = (filename: unknown): boolean => {
  const normalized = normalize_eligible_filename(filename)
  if (normalized === null) return false
  return (
    is_fermi_or_volumetric(normalized) ||
    is_structure_file(normalized) ||
    is_trajectory_filename(normalized)
  )
}

// Conservative auto-open list: only unambiguous structure / trajectory / volumetric /
// Fermi filenames. No JSON/YAML/XML (vasprun.xml excepted: the name is unambiguous), no
// keyword+.log/.out/.dat/.data heuristics; `.data` is left out because it is as often a
// LAMMPS data file as anything else.
const AUTO_RENDER_EXT_RE = ext_regex([
  ...STRUCTURE_EXTENSIONS.filter((ext) => ext !== `.data`),
  ...XYZ_EXTENSIONS,
  ...TRAJ_EXTENSIONS,
])
const AUTO_RENDER_VASP_NAME_RE = filename_token_regex([
  ...VASP_STRUCTURE_FILES,
  ...VASP_TRAJECTORY_FILES,
])

export const is_auto_renderable_filename = (filename: unknown): boolean => {
  const normalized = normalize_eligible_filename(filename)
  if (normalized === null) return false
  // HDF5 only when the name clearly marks a trajectory
  return (
    is_fermi_or_volumetric(normalized) ||
    AUTO_RENDER_VASP_NAME_RE.test(normalized) ||
    VASPRUN_REGEX.test(normalized) ||
    AUTO_RENDER_EXT_RE.test(normalized) ||
    (HDF5_EXT_REGEX.test(normalized) &&
      (/vaspout/i.test(normalized) || TRAJ_KEYWORDS_REGEX.test(normalized)))
  )
}
