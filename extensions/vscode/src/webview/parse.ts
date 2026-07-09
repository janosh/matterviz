// Parse-only path of the MatterViz webview: everything parse_file_content
// reaches, with NO Svelte/DOM imports, so embedding hosts can run it inside
// a Web Worker as well as on the main thread. main.ts re-exports everything
// here for existing callers.
import { COMPRESSION_EXTENSIONS_REGEX } from '$lib/constants'
import { parse_fermi_file } from '$lib/fermi-surface/parse'
import {
  decompress_data,
  decompress_data_binary,
  detect_compression_format,
} from '$lib/io/decompress'
import { parse_volumetric_file } from '$lib/isosurface/parse'
import { is_vaspwave_filename, parse_vaspwave_charge } from '$lib/isosurface/parse-vaspwave'
import { parse_structure_file } from '$lib/structure/parse'
import type { TrajectoryType } from '$lib/trajectory'
import { parse_num_token } from '$lib/utils'
import { is_trajectory_file, parse_trajectory_data } from '$lib/trajectory/parse'
import type { VaspoutElectronicData } from '$lib/trajectory/parse/vaspout-electronic'
import type { ViewType } from '../types'
import { FERMI_FILE_RE, VOLUMETRIC_EXT_RE, VOLUMETRIC_VASP_RE } from '../types'
import type { RenderableType } from './detect'
import { detect_view_type } from './detect'

// Maps detect.ts RenderableType to ViewType for direct rendering.
// Types not listed here fall through to json_browser (which can render all types
// via its internal mount_into, giving the user a tree view alongside the viz).
// structure and volumetric have special handling in parse_file_content below.
const DETECTION_TO_VIEW_TYPE: Partial<Record<RenderableType, ViewType>> = {
  fermi_surface: `fermi_surface`,
  band_grid: `fermi_surface`,
  convex_hull: `convex_hull`,
  phase_diagram: `phase_diagram`,
}

export type { ViewType } from '../types'
export interface FileData {
  filename: string
  content: string
  is_base64: boolean
}

export interface ParseResult {
  type: ViewType
  data: unknown
  filename: string
  // For trajectories that support VS Code streaming
  streaming_info?: { file_path: string }
}

// Convert base64 to ArrayBuffer for binary files
export function base64_to_array_buffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let idx = 0; idx < binary.length; idx++) {
    bytes[idx] = binary.charCodeAt(idx)
  }
  return bytes.buffer
}

// Type for parsed trajectory response from large file requests
export type ParsedTrajectoryResponse = {
  trajectory: TrajectoryType
  file_path: string
}

export const parse_large_file_marker = (
  content: string,
): { file_path: string; file_size: number } | null => {
  const prefix = `LARGE_FILE:`
  if (!content.startsWith(prefix)) return null
  const payload = content.slice(prefix.length)
  const size_separator_idx = payload.lastIndexOf(`:`)
  if (size_separator_idx <= 0) throw new Error(`Malformed large file marker`)

  const file_path = payload.slice(0, size_separator_idx)
  // parse_num_token maps empty/whitespace size segments to NaN (Number(``) is 0)
  const file_size = parse_num_token(payload.slice(size_separator_idx + 1))
  if (!Number.isSafeInteger(file_size) || file_size < 0) {
    throw new Error(`Malformed large file size`)
  }
  return { file_path, file_size }
}

// LARGE_FILE markers are resolved by streaming content from the embedding
// host over postMessage. That transport only exists on the main thread, so
// the host registers its requester here; contexts without one (e.g. a parse
// Web Worker) throw on marker payloads and callers fall back to the main
// thread.
export type LargeFileRequester = (
  file_path: string,
  filename: string,
  is_compressed: boolean,
) => Promise<string | ParsedTrajectoryResponse>

let large_file_requester: LargeFileRequester | null = null

export const set_large_file_requester = (requester: LargeFileRequester | null): void => {
  large_file_requester = requester
}

// Parse file content and determine if it's a structure or trajectory
export const parse_file_content = async (
  content: string,
  filename: string,
  is_compressed: boolean = false,
  recursion_depth: number = 0,
): Promise<ParseResult> => {
  if (recursion_depth > 2) {
    throw new Error(
      `parse_file_content exceeded max recursion depth=2 while parsing file ${filename}`,
    )
  }

  const large_file_marker = parse_large_file_marker(content)
  if (large_file_marker) {
    const { file_path, file_size } = large_file_marker

    console.info(`Handling large file: ${filename} (${Math.round(file_size / 1024 / 1024)}MB)`)

    if (!large_file_requester) throw new Error(`VS Code API not available`)
    const parsed_trajectory = await large_file_requester(file_path, filename, is_compressed)

    // Check if we received a pre-parsed trajectory with VS Code streaming support
    if (
      parsed_trajectory &&
      typeof parsed_trajectory === `object` &&
      `trajectory` in parsed_trajectory &&
      `file_path` in parsed_trajectory
    ) {
      const { trajectory, file_path: streaming_file_path } = parsed_trajectory
      const streaming_info = { file_path: streaming_file_path }
      return { type: `trajectory`, data: trajectory, filename, streaming_info }
    }

    // Fallback: if not pre-parsed, treat as raw content. The response is
    // untyped postMessage data, so don't trust the declared union at runtime —
    // a malformed host reply would otherwise crash deep in the recursive call.
    if (typeof parsed_trajectory !== `string`) {
      throw new TypeError(`Malformed large-file response for ${filename}`)
    }
    return parse_file_content(parsed_trajectory, filename, is_compressed, recursion_depth + 1)
  }

  // Handle compressed/binary files by converting from base64 first
  if (is_compressed) {
    let buffer = base64_to_array_buffer(content)

    // Gzipped binary formats (e.g. vaspwave.h5.gz as ferrox stores them on S3,
    // or gzipped ASE .traj files): decompress to binary first — the generic text
    // decompression below would corrupt their bytes — so the binary routing
    // below sees the inner name.
    if (/\.(?:h5|hdf5|traj)\.gz$/i.test(filename)) {
      buffer = await decompress_data_binary(buffer, `gzip`)
      filename = filename.replace(/\.gz$/i, ``)
    }

    // vaspwave.h5 holds charge density (+ wavefunctions), not a trajectory —
    // route to the volumetric parser so it renders as an isosurface.
    if (is_vaspwave_filename(filename)) {
      const data = await parse_vaspwave_charge(buffer, filename)
      return { type: `isosurface`, data, filename }
    }

    // Binary trajectory formats: pass buffer directly to trajectory parser
    if (/\.(?:h5|hdf5|traj)$/i.test(filename)) {
      const data = await parse_trajectory_data(buffer, filename)
      // DOS/bands-only vaspout.h5 (e.g. phelel band paths): no frames to animate,
      // route the electronic results to the spectral components instead.
      // Require at least one renderable result rather than trusting the
      // parser's invariant (the metadata cast is unchecked): an empty
      // electronic object would otherwise mount <Dos doses={null}>.
      const electronic = data.metadata?.electronic as VaspoutElectronicData | undefined
      if (data.frames.length === 0 && (electronic?.dos || electronic?.bands)) {
        return { type: `vaspout_electronic`, filename, data: electronic }
      }
      return { type: `trajectory`, filename, data }
    }

    // Unified handling for all supported compression formats
    const format = detect_compression_format(filename)
    if (format && format !== `zip`) {
      // Skip ZIP as it's not supported in browser
      content = await decompress_data(buffer, format)
      filename = filename.replace(COMPRESSION_EXTENSIONS_REGEX, ``)
    }
  }

  // Fermi surface files (.bxsf, .frmsf)
  // Use basename for regex matching in case filename retains a directory prefix
  const basename = filename.split(`/`).pop() ?? filename
  if (FERMI_FILE_RE.test(basename)) {
    // parse_fermi_file throws a descriptive error when parsing fails
    return { type: `fermi_surface`, data: parse_fermi_file(content, filename), filename }
  }

  // Volumetric data files (.cube, CHGCAR, AECCAR*, ELFCAR, LOCPOT, PARCHG)
  if (VOLUMETRIC_EXT_RE.test(basename) || VOLUMETRIC_VASP_RE.test(basename)) {
    const data = parse_volumetric_file(content, filename)
    if (data) return { type: `isosurface`, data, filename }
    throw new Error(`Failed to parse volumetric file: ${filename}`)
  }

  let parsed_json: unknown
  let has_parsed_json = false

  // JSON files: render typed JSON before filename heuristics. Otherwise names like
  // convex-hull.json can be mistaken for trajectory keywords such as nve.
  if (/\.json$/i.test(filename)) {
    try {
      parsed_json = JSON.parse(content)
      has_parsed_json = true
      // Check if the top-level value matches a known visualization type
      const detected = detect_view_type(parsed_json)
      if (detected) {
        // Structure JSON needs normalization (OPTIMADE, fractional coords, etc.)
        if (detected === `structure`) {
          try {
            const structure = parse_structure_file(content, filename)
            return {
              type: `structure`,
              data: { ...structure, id: filename.replace(/\.[^/.]+$/, ``) },
              filename,
            }
          } catch {
            // Detailed parse failed despite structure-like shape — fall through to
            // generic JSON handling below
          }
        }
        // Volumetric JSON needs wrapping in { structure, volumes } for the isosurface renderer
        if (detected === `volumetric`) {
          const vol = parsed_json as { lattice?: unknown }
          return {
            type: `isosurface`,
            data: { structure: { sites: [], lattice: vol.lattice }, volumes: [parsed_json] },
            filename,
          }
        }
        return {
          type: DETECTION_TO_VIEW_TYPE[detected] ?? `json_browser`,
          data: parsed_json,
          filename,
        }
      }
    } catch {
      // JSON parse failed, fall through to structure parser
    }
  }

  // Try trajectory parsing if it looks like a trajectory
  if (is_trajectory_file(filename, content)) {
    try {
      const data = await parse_trajectory_data(content, filename)
      return { type: `trajectory`, data, filename }
    } catch (error) {
      // Trajectory-looking filename but not trajectory-shaped JSON (e.g. nve-config.json):
      // fall through to the JSON browser instead of failing the render
      if (!has_parsed_json) throw error
    }
  }

  // No top-level match -- show JSON browser for navigation
  if (has_parsed_json) return { type: `json_browser`, data: parsed_json, filename }

  // Parse as structure (CIF, POSCAR, XYZ, etc.) — throws descriptive reasons on failure
  const structure = parse_structure_file(content, filename)
  // parse_structure_file throws on parse failure but can still return zero atoms (e.g. a
  // CIF with cell params but no _atom_site records), which is invalid downstream
  if (!structure.sites?.length) throw new Error(`No atoms found in ${filename}`)
  const data = { ...structure, id: filename.replace(/\.[^/.]+$/, ``) }
  return { type: `structure`, data, filename }
}
