import { COMPRESSION_EXTENSIONS_REGEX, CONFIG_DIRS_REGEX } from '$lib/constants'
import { FERMI_FILE_RE, VOLUMETRIC_EXT_RE, VOLUMETRIC_VASP_RE } from '$lib/file-viewer/types'
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

export const is_matterviz_filename = (filename: unknown): boolean => {
  if (typeof filename !== `string` || !filename || CONFIG_DIRS_REGEX.test(filename))
    return false
  const normalized = normalize_browser_supported_filename(filename.split(/[\\/]/).pop() ?? ``)
  if (normalized === null) return false
  return (
    FERMI_FILE_RE.test(normalized) ||
    VOLUMETRIC_EXT_RE.test(normalized) ||
    VOLUMETRIC_VASP_RE.test(normalized) ||
    is_structure_file(normalized) ||
    is_trajectory_file(normalized)
  )
}
