// Worker-safe file parsing with no Svelte or DOM imports.
import {
  BINARY_VIEWER_EXT_REGEX,
  COMPRESSION_EXTENSIONS_REGEX,
  VASP_VOLUMETRIC_REGEX,
} from '$lib/constants'
import { parse_fermi_file } from '$lib/fermi-surface/parse'
import {
  decompress_data,
  decompress_data_binary,
  detect_compression_format,
} from '$lib/io/decompress'
import { parse_volumetric_file } from '$lib/isosurface/parse'
import { is_vaspwave_filename, parse_vaspwave_charge } from '$lib/isosurface/parse-vaspwave'
import { parse_structure_file } from '$lib/structure/parse'
import { is_indexable_trajectory_filename } from '$lib/trajectory/format-detect'
import { to_error } from '$lib/utils'
import type {
  OpenTrajectoryOptions,
  ParseProgress,
  TrajectoryRun,
  TrajectoryRunSummary,
  TrajectorySource,
} from '$lib/trajectory'
import type { BandGridData, FermiSurfaceData } from '$lib/fermi-surface/types'
import type { VolumetricFileData } from '$lib/isosurface/types'
import type { PhaseData } from '$lib/convex-hull/types'
import type { PhaseDiagramData } from '$lib/phase-diagram/types'
import type { AnyStructure } from '$lib/structure'
import type { VaspoutElectronicData } from '$lib/trajectory/parse/vaspout-electronic'
import {
  is_trajectory_file,
  open_trajectory,
  VaspoutElectronicOnlyError,
} from '$lib/trajectory/parse'
import { type LargeFileMarker, parse_large_file_marker } from './host-transfer'
import type { ViewType } from './types'
import { FERMI_FILE_RE, VOLUMETRIC_EXT_RE } from './types'
import type { RenderableType } from './detect'
import { detect_view_type, volume_json_to_isosurface_input } from './detect'

// Maps detect.ts RenderableType to ViewType for direct rendering.
// Types not listed here fall through to json_browser (which can render all types
// via its internal mount_into, giving the user a tree view alongside the viz).
// structure and volumetric have special handling in parse_file_content below.
const DETECTION_TO_VIEW_TYPE: Partial<Record<RenderableType, ViewType>> = {
  convex_hull: `convex_hull`,
  phase_diagram: `phase_diagram`,
}

// Discriminated on `type`, so consumers narrow with `result.type === '...'` instead of
// casting `data`. The one place the shape is only known dynamically (detect_view_type on
// parsed JSON) casts once, below, rather than pushing that cast onto every reader.
type Result<Type extends ViewType, Data> = { type: Type; data: Data; filename: string }

export type ParseResult =
  | Result<`trajectory`, TrajectoryRun>
  | Result<`structure`, AnyStructure>
  | Result<`fermi_surface`, BandGridData | FermiSurfaceData>
  | Result<`isosurface`, VolumetricFileData>
  | Result<`convex_hull`, PhaseData[]>
  | Result<`phase_diagram`, PhaseDiagramData>
  | Result<`json_browser`, unknown>
  | Result<`vaspout_electronic`, VaspoutElectronicData>

// Same shape as it crosses the worker boundary: a live TrajectoryRun cannot be cloned, so the
// worker sends a summary and the main thread rebuilds a run around a MessagePort.
export type WireParseResult =
  | Exclude<ParseResult, { type: `trajectory` }>
  | Result<`trajectory`, TrajectoryRunSummary>

// A file past the host's inline-transfer limit arrives as a `LARGE_FILE:` marker
// instead of its contents, and is served frame by frame over the host's
// postMessage bridge. That bridge is imported lazily: this module also runs in a
// Web Worker, where no host exists and a marker never arrives, so the import
// stays off the worker's critical path.
const resolve_large_file = async (
  marker: LargeFileMarker,
  filename: string,
): Promise<ParseResult> => {
  if (!is_indexable_trajectory_filename(filename)) {
    throw new Error(
      `Large-file loading is only supported for indexed trajectories: ${filename}`,
    )
  }
  const { request_large_file_content } = await import(`./host-bridge`)
  console.info(
    `Handling large file: ${filename} (${Math.round(marker.file_size / 1024 / 1024)}MB)`,
  )
  return {
    type: `trajectory`,
    data: await request_large_file_content(marker.file_path, filename),
    filename,
  }
}

// Host-configurable loading knobs forwarded to open_trajectory (VS Code settings reach the
// webview this way; the defaults otherwise come from DEFAULTS.trajectory)
export type TrajectoryLoadOptions = Pick<
  OpenTrajectoryOptions,
  `hdf5_group_path` | `index_above_bytes` | `atom_type_mapping`
>

const trajectory_result = async (
  source: TrajectorySource,
  filename: string,
  load_options: TrajectoryLoadOptions,
  on_progress?: (progress: ParseProgress) => void,
): Promise<ParseResult> => {
  try {
    const data = await open_trajectory(source, { ...load_options, filename, on_progress })
    return { type: `trajectory`, filename, data }
  } catch (error) {
    if (error instanceof VaspoutElectronicOnlyError) {
      return { type: `vaspout_electronic`, filename, data: error.electronic }
    }
    throw error
  }
}

// Plain loop, not Uint8Array.from(str, cb): the callback form walks the iterator protocol and
// measured 1058 ms against 35 ms on a 30 MB payload (every VS Code payload arrives base64)
export const base64_to_array_buffer = (base64: string): ArrayBuffer => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let idx = 0; idx < binary.length; idx++) bytes[idx] = binary.charCodeAt(idx)
  return bytes.buffer
}

// Route file content to the parser for its format and wrap the result with its view type
export const parse_file_content = async (
  source: TrajectorySource,
  filename: string,
  is_base64: boolean = false,
  load_options: TrajectoryLoadOptions = {},
  on_progress?: (progress: ParseProgress) => void,
): Promise<ParseResult> => {
  // Oversized files never carry their own bytes — the host sends a marker and
  // serves frames on demand. Check before anything tries to parse the marker text.
  const large_file_marker = typeof source === `string` && parse_large_file_marker(source)
  if (large_file_marker) return resolve_large_file(large_file_marker, filename)

  // Handle base64-encoded compressed/binary files by converting them first
  if (is_base64) {
    if (typeof source !== `string`)
      throw new Error(`Base64 payload for ${filename} is not text`)
    let buffer = base64_to_array_buffer(source)
    const compression_format = detect_compression_format(filename)
    if (compression_format) {
      const normalized_filename = filename.replace(COMPRESSION_EXTENSIONS_REGEX, ``)
      if (detect_compression_format(normalized_filename)) {
        throw new Error(`Nested compression is not supported: ${filename}`)
      }
      filename = normalized_filename
    }

    // Compressed binary formats (e.g. vaspwave.h5.gz as ferrox stores them on S3,
    // or compressed ASE .traj files): decompress to binary first — generic text
    // decompression would corrupt their bytes — so routing sees the inner name.
    const is_binary_format = BINARY_VIEWER_EXT_REGEX.test(filename)
    if (compression_format) {
      // gzip/deflate/zip inflate here; unsupported formats fail with a clear extraction error
      if (is_binary_format) buffer = await decompress_data_binary(buffer, compression_format)
      else source = await decompress_data(buffer, compression_format)
    }

    // vaspwave.h5 holds charge density (+ wavefunctions), not a trajectory —
    // route to the volumetric parser so it renders as an isosurface.
    if (is_vaspwave_filename(filename)) {
      const data = await parse_vaspwave_charge(buffer, filename)
      return { type: `isosurface`, data, filename }
    }

    // Binary trajectory formats: pass buffer directly to trajectory parser
    if (is_binary_format) {
      return trajectory_result(buffer, filename, load_options, on_progress)
    }
  }

  // Raw binary payloads come from open_material after decompression/classification. HDF5
  // stays Blob-backed for lazy reads; all other non-binary formats continue as decoded text.
  if (typeof source !== `string`) {
    if (is_vaspwave_filename(filename)) {
      const buffer = source instanceof Blob ? await source.arrayBuffer() : source
      return {
        type: `isosurface`,
        data: await parse_vaspwave_charge(buffer, filename),
        filename,
      }
    }
    if (BINARY_VIEWER_EXT_REGEX.test(filename)) {
      return trajectory_result(source, filename, load_options, on_progress)
    }
    source = source instanceof Blob ? await source.text() : new TextDecoder().decode(source)
  }
  const content = source

  // Match on the basename in case filename retains a directory prefix
  const basename = filename.split(/[\\/]/).pop() ?? filename
  if (FERMI_FILE_RE.test(basename)) {
    return { type: `fermi_surface`, data: parse_fermi_file(content, filename), filename }
  }
  // .cube, CHGCAR, AECCAR*, ELFCAR, LOCPOT, PARCHG
  if (VOLUMETRIC_EXT_RE.test(basename) || VASP_VOLUMETRIC_REGEX.test(basename)) {
    const data = parse_volumetric_file(content, filename)
    if (data) return { type: `isosurface`, data, filename }
    throw new Error(`Failed to parse volumetric file: ${filename}`)
  }

  const structure_id = filename.replace(/\.[^/.]+$/, ``)
  // JSON files: render typed JSON before filename heuristics. Otherwise names like
  // convex-hull.json can be mistaken for trajectory keywords such as nve.
  const is_json = /\.json$/i.test(filename)
  let parsed_json: unknown
  if (is_json) {
    try {
      parsed_json = JSON.parse(content)
    } catch (error) {
      throw new Error(`Invalid JSON in ${filename}: ${to_error(error).message}`, {
        cause: error,
      })
    }
    const detected = detect_view_type(parsed_json)
    if (detected === `structure`) {
      // Structure JSON needs normalization (OPTIMADE, fractional coords, etc.); a shape that
      // looks like a structure but fails the detailed parse still gets the JSON browser
      try {
        const structure = parse_structure_file(content, filename)
        return { type: `structure`, data: { ...structure, id: structure_id }, filename }
      } catch {
        return { type: `json_browser`, data: parsed_json, filename }
      }
    }
    if (detected === `volumetric`) {
      return {
        type: `isosurface`,
        data: volume_json_to_isosurface_input(parsed_json),
        filename,
      }
    }
    if (detected === `fermi_surface` || detected === `band_grid`) {
      return { type: `fermi_surface`, data: parse_fermi_file(content, filename), filename }
    }
    if (detected) {
      // detect_view_type already matched the payload against each type's shape, so this is
      // the one place the mapping from detection to data type is established
      return {
        type: DETECTION_TO_VIEW_TYPE[detected] ?? `json_browser`,
        data: parsed_json,
        filename,
      } as ParseResult
    }
  }

  if (is_trajectory_file(filename, content)) {
    try {
      return await trajectory_result(content, filename, load_options, on_progress)
    } catch (error) {
      // Trajectory-looking filename but not trajectory-shaped JSON (e.g. nve-config.json):
      // fall through to the JSON browser instead of failing the render
      if (!is_json) throw error
    }
  }
  if (is_json) return { type: `json_browser`, data: parsed_json, filename }

  // CIF, POSCAR, XYZ, ...: parse_structure_file throws descriptive reasons on failure but can
  // still return zero atoms (a CIF with cell params but no _atom_site records)
  const structure = parse_structure_file(content, filename)
  if (!structure.sites?.length) throw new Error(`No atoms found in ${filename}`)
  return { type: `structure`, data: { ...structure, id: structure_id }, filename }
}
