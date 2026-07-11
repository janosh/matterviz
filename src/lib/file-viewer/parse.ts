// Worker-safe file parsing with no Svelte or DOM imports.
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
import { is_trajectory_file, parse_trajectory_data } from '$lib/trajectory/parse'
import type { VaspoutElectronicData } from '$lib/trajectory/parse/vaspout-electronic'
import type { ViewType } from './types'
import { FERMI_FILE_RE, VOLUMETRIC_EXT_RE, VOLUMETRIC_VASP_RE } from './types'
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

export type { ViewType } from './types'

export interface ParseResult {
  type: ViewType
  data: unknown
  filename: string
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

// Parse file content and determine if it's a structure or trajectory
export const parse_file_content = async (
  content: string,
  filename: string,
  is_base64: boolean = false,
): Promise<ParseResult> => {
  // Handle base64-encoded compressed/binary files by converting them first
  if (is_base64) {
    let buffer = base64_to_array_buffer(content)
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
    const is_binary_format = /\.(?:h5|hdf5|traj)$/i.test(filename)
    if (compression_format === `zip`) {
      const { unzipSync } = await import(`fflate`)
      const payload = Object.entries(unzipSync(new Uint8Array(buffer))).find(
        ([entry_name]) => !entry_name.endsWith(`/`),
      )?.[1]
      if (!payload) throw new Error(`ZIP archive contains no files: ${filename}`)
      if (is_binary_format) buffer = payload.slice().buffer
      else content = new TextDecoder().decode(payload)
    } else if (compression_format) {
      // Unified handling for all supported compression formats
      // Unsupported formats fail here with a clear extraction error
      if (is_binary_format) buffer = await decompress_data_binary(buffer, compression_format)
      else content = await decompress_data(buffer, compression_format)
    }

    // vaspwave.h5 holds charge density (+ wavefunctions), not a trajectory —
    // route to the volumetric parser so it renders as an isosurface.
    if (is_vaspwave_filename(filename)) {
      const data = await parse_vaspwave_charge(buffer, filename)
      return { type: `isosurface`, data, filename }
    }

    // Binary trajectory formats: pass buffer directly to trajectory parser
    if (is_binary_format) {
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
