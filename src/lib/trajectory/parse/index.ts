// `matterviz/trajectory/parse`: the format parsers plus the opener that dispatches to them.
import {
  detect_compression_format,
  is_browser_decompressible_format,
} from '#lib/io/decompress.js'
import { is_binary } from '#lib/io/is-binary.js'

export {
  Hdf5GroupSelectionRequiredError,
  open_trajectory,
  type OpenTrajectoryOptions,
  trajectory_from_frames,
  trajectory_from_json,
  VaspoutElectronicOnlyError,
} from '#lib/trajectory/open.js'
export type { AtomTypeMapping } from '#lib/trajectory/index.js'
export {
  indexed_trajectory_format,
  is_indexable_trajectory_filename,
  is_trajectory_file,
  is_trajectory_filename,
} from '#lib/trajectory/format-detect.js'
export { parse_ase_trajectory } from './ase'
export { open_hdf5_trajectory } from './hdf5'
export { parse_lammps_trajectory } from './lammps'
export { parse_vasp_outcar } from './outcar'
export { parse_pymatgen_trajectory } from './pymatgen'
export {
  create_warning_collector,
  type LazyTrajectorySource,
  type ParsedTrajectory,
  type WarningCollector,
  type WarnFn,
} from './shared'
export { parse_vasp_xdatcar } from './vasp'
export { parse_vasprun_xml } from './vasprun'
export { parse_xyz_trajectory } from './xyz'

export function get_unsupported_format_message(
  filename: string,
  content: string,
): string | null {
  const lower = filename.toLowerCase()
  const compression = detect_compression_format(filename)
  if (compression && !is_browser_decompressible_format(compression)) {
    return `🚫 ${compression.toUpperCase()} decompression is not supported in the browser\nPlease decompress the file first`
  }

  const formats = [
    { extensions: [`.nc`, `.netcdf`], name: `NetCDF`, tool: `MDAnalysis` },
    { extensions: [`.dcd`], name: `DCD`, tool: `MDAnalysis` },
  ]

  for (const { extensions, name, tool } of formats) {
    if (extensions.some((ext) => lower.endsWith(ext))) {
      return `🚫 ${name} format not supported\nConvert with ${tool} first`
    }
  }

  return is_binary(content)
    ? `🚫 Binary format not supported${filename ? `: ${filename}` : ``}`
    : null
}
