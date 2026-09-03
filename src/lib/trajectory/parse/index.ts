// `matterviz/trajectory/parse`: the format parsers plus the opener that dispatches to them.
import { is_binary } from '$lib/io/is-binary'

export {
  Hdf5GroupSelectionRequiredError,
  open_trajectory,
  type OpenTrajectoryOptions,
  source_byte_size,
  trajectory_from_frames,
  trajectory_from_json,
  VaspoutElectronicOnlyError,
} from '$lib/trajectory/open'
export type { AtomTypeMapping } from '$lib/trajectory/index'
export {
  indexed_trajectory_format,
  is_indexable_trajectory_filename,
  is_trajectory_file,
  is_trajectory_filename,
} from '$lib/trajectory/format-detect'
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

  for (const [ext, name] of [
    [`.bz2`, `BZ2`],
    [`.xz`, `XZ`],
  ]) {
    if (lower.endsWith(ext)) {
      return `🚫 ${name} compression not supported in browser\nPlease decompress the file first`
    }
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
