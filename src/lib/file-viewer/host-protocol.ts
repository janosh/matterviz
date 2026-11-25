// Message shapes exchanged between the webview (main.ts / host-bridge.ts) and whatever
// host embeds it (the VS Code extension, or a desktop host speaking the same protocol).
import type { PartialSettings } from '#lib/settings.js'
import type { ThemeName } from '#lib/theme/index.js'
import { site_stride } from '#lib/structure/site.js'
import { cart_to_frac_with_fallback } from '#lib/structure/parsers/shared.js'
import type { Vec3 } from '#lib/math.js'
import type { FrameChannels, NumericFrame } from '#lib/trajectory/frame.js'
import { wrap_frame_coordinates } from '#lib/trajectory/frame.js'
import type { TrajectoryMetadata, TrajectoryRunSummary } from '#lib/trajectory/index.js'

export interface FileData {
  filename: string
  content: string
  is_base64: boolean
}

// Preserve which side of host file loading failed across the message boundary.
export class HostFileError extends Error {
  constructor(
    message: string,
    readonly stage: `acquire` | `parse`,
  ) {
    super(message)
    this.name = 'HostFileError'
  }
}

export interface WebviewBootstrapData {
  data: FileData
  theme: ThemeName
  defaults?: PartialSettings
  moyo_wasm_url?: string
}

type HostFileRequest = {
  file_path: string
  // The host picks a per-format indexer/decoder from the name. The VS Code
  // extension derives its own from `file_path`, but hosts that index by name
  // reject the request without this, so the webview always sends it.
  filename: string
}

// Requests the host answers with a HostToWebviewMessage carrying the same request_id
export type HostRequest =
  | ({ command: `request_large_file` } & HostFileRequest)
  // channels: the vectors to read and send (all when absent), as for TrajectoryRun.read_frame
  | ({
      command: `request_frame`
      frame_index: number
      channels?: FrameChannels
      // Viewing only: xyz float32, with fractional coordinates reconstructed by the client.
      // Omit for source reads (analysis, data export, inspectors and custom callbacks).
      display?: boolean
    } & HostFileRequest)

// The host watches the rendered file itself (no webview subscription step)
export type FileChangeMessage =
  | { command: `fileUpdated`; file_path: string; data: FileData; theme?: ThemeName }
  | { command: `fileDeleted`; file_path: string }

// Theme or settings changed on the host; the webview re-applies them to the view it already
// holds instead of the host rebuilding the HTML (which would re-read the file from disk)
export type SettingsChangedMessage = {
  command: `settingsChanged`
  theme: ThemeName
  // Always sent (a theme-only push still carries the current defaults) so the webview never
  // mistakes a missing field for "reset to DEFAULTS"
  defaults: PartialSettings
}

export type WebviewToHostMessage =
  | { command: `info` | `error`; text: string }
  | (HostRequest & { request_id: string })
  // Text as is, binary exports as their bytes (an ArrayBuffer, see WireFrame below)
  | { command: `saveAs`; filename: string; content: string | ArrayBuffer }

// Replies carry the request_id of the WebviewToHostMessage they answer
export type HostToWebviewMessage =
  | FileChangeMessage
  | SettingsChangedMessage
  | {
      command: `large_file_response`
      request_id: string
      // The host keeps the run; the webview streams frames with request_frame.
      run_summary?: TrajectoryRunSummary
      error?: string
      error_stage?: `acquire` | `parse`
    }
  | {
      command: `frame_response`
      request_id: string
      frame_index?: number
      frame?: WireFrame | null
      error?: string
    }
  // Progressive per-frame plot rows, batched after large_file_response under its request_id
  // (not file_path: a re-request of the same file opens its run before the old one is disposed)
  | {
      command: `plot_metadata_stream`
      request_id: string
      rows: TrajectoryMetadata[]
      complete: boolean
    }
  // Parse warnings the run's later reads added since its summary or last such message
  | { command: `trajectory_warnings`; request_id: string; warnings: readonly string[] }

// A numeric frame as hosts post it, its typed arrays as ArrayBuffers: VS Code's webview
// postMessage recreates ArrayBuffers (engines >= 1.57) but turns typed arrays into plain
// index-keyed objects. Coordinates and atomic numbers stay binary instead of becoming one
// JSON Site record per atom (2.5x the bytes plus a decode on each side).
export type WireFrame = Omit<NumericFrame, `coordinates` | `sites` | `scalar_columns`> & {
  coordinates: ArrayBuffer
  coordinate_encoding?: `xyz-f32`
  sites: Exclude<NumericFrame[`sites`], Uint8Array> | ArrayBuffer
  scalar_columns?: Record<string, ArrayBuffer>
}

// A view's own bytes: a view into a larger (or shared) buffer would post all of it
const own_buffer = (view: Float32Array | Float64Array | Uint8Array): ArrayBuffer =>
  view.buffer instanceof ArrayBuffer && view.byteLength === view.buffer.byteLength
    ? view.buffer
    : view.slice().buffer

export const frame_to_wire = (frame: NumericFrame, display = false): WireFrame => {
  // Extra vector channels use the existing exact format.
  display &&= frame.vector_keys.length === 0
  // Wrap before rounding: an atom just below a periodic boundary must not jump cells
  // because float32 rounds its fractional coordinate to 1. Source buffers stay untouched.
  const { coordinates, sites, scalar_columns, ...rest } = display
    ? wrap_frame_coordinates(frame)
    : frame
  const wire: WireFrame = {
    ...rest,
    coordinates: own_buffer(coordinates),
    sites: sites instanceof Uint8Array ? own_buffer(sites) : sites,
    ...(scalar_columns && {
      scalar_columns: Object.fromEntries(
        Object.entries(scalar_columns).map(([key, column]) => [key, own_buffer(column)]),
      ),
    }),
  }
  if (!display) return wire
  const xyz = new Float32Array(sites.length * 3)
  const width = site_stride(rest.vector_keys)
  for (let idx = 0; idx < sites.length; idx++) {
    for (let axis = 0; axis < 3; axis++) xyz[idx * 3 + axis] = coordinates[idx * width + axis]
  }
  // Preserve unusual coordinates outside float32's range rather than sending infinities.
  if (!xyz.every(Number.isFinite)) return wire
  return {
    ...wire,
    coordinate_encoding: `xyz-f32`,
    coordinates: xyz.buffer,
  }
}

// Throws on a frame a host posted without frame_to_wire: its typed arrays arrive as plain
// objects that would decode to empty columns, a materialized frame has no columns at all
export const frame_from_wire = (wire: WireFrame): NumericFrame => {
  const { coordinates, sites, scalar_columns, coordinate_encoding, ...rest } = wire
  const columns = Object.values(scalar_columns ?? {})
  if (
    !(coordinates instanceof ArrayBuffer) ||
    !(sites instanceof ArrayBuffer || Array.isArray(sites)) ||
    !columns.every((column) => column instanceof ArrayBuffer)
  )
    throw new Error(
      `Malformed host frame: expected ArrayBuffer coordinates and sites (see frame_to_wire), got fields ${Object.keys(wire).join(`, `)}`,
    )
  const n_sites = sites instanceof ArrayBuffer ? sites.byteLength : sites.length
  if (coordinate_encoding !== undefined && coordinate_encoding !== `xyz-f32`)
    throw new Error(`Malformed host frame: unknown coordinate encoding ${coordinate_encoding}`)
  const compact = coordinate_encoding === `xyz-f32`
  const width = site_stride(rest.vector_keys)
  const n_values = n_sites * width
  if (coordinates.byteLength !== (compact ? n_sites * 12 : n_values * 8))
    throw new Error(
      `Malformed host frame: ${coordinates.byteLength} coordinate bytes for ${n_sites} sites with vectors [${rest.vector_keys}]`,
    )
  if (compact && (rest.vector_keys.length || !rest.wrapped))
    throw new Error(
      `Malformed host frame: xyz-f32 requires wrapped coordinates without vectors`,
    )
  // one value per site, else sites past a short column would read undefined
  for (const [key, column] of Object.entries(scalar_columns ?? {}))
    if (column.byteLength !== n_sites * Float64Array.BYTES_PER_ELEMENT)
      throw new Error(
        `Malformed host frame: scalar column ${key} has ${column.byteLength} bytes for ${n_sites} sites`,
      )
  const decoded = compact ? new Float64Array(n_values) : new Float64Array(coordinates)
  if (compact) {
    const positions = new Float32Array(coordinates)
    const convert =
      rest.structure.lattice &&
      cart_to_frac_with_fallback(rest.structure.lattice.matrix).convert
    const xyz: Vec3 = [0, 0, 0]
    const abc: Vec3 = [0, 0, 0]
    for (let idx = 0; idx < n_sites; idx++) {
      for (let axis = 0; axis < 3; axis++) xyz[axis] = positions[idx * 3 + axis]
      decoded.set(xyz, idx * width)
      if (convert) {
        convert(xyz, abc)
        decoded.set(abc, idx * width + 3)
      }
    }
  }
  return {
    ...rest,
    coordinates: decoded,
    sites: sites instanceof ArrayBuffer ? new Uint8Array(sites) : sites,
    ...(scalar_columns && {
      scalar_columns: Object.fromEntries(
        Object.entries(scalar_columns).map(([key, column]) => [key, new Float64Array(column)]),
      ),
    }),
  }
}
