// Message shapes exchanged between the webview (main.ts / host-bridge.ts) and whatever
// host embeds it (the VS Code extension, or a desktop host speaking the same protocol).
import type { PartialSettings } from '#lib/settings.js'
import type { ThemeName } from '#lib/theme/index.js'
import { site_stride } from '#lib/structure/site.js'
import type { FrameChannels, NumericFrame } from '#lib/trajectory/frame.js'
import type { TrajectoryMetadata, TrajectoryRunSummary } from '#lib/trajectory/index.js'

export interface FileData {
  filename: string
  content: string
  is_base64: boolean
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
  | {
      command: `saveAs`
      filename: string
      content: string
      is_binary: boolean
    }

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
    }
  | {
      command: `frame_response`
      request_id: string
      frame_index?: number
      frame?: WireFrame | null
      error?: string
    }
  // Progressive per-frame plot rows of a host-served run, batched after large_file_response
  | {
      command: `plot_metadata_stream`
      file_path: string
      rows: TrajectoryMetadata[]
      complete: boolean
    }

// A numeric frame as hosts post it, its typed arrays as ArrayBuffers: VS Code's webview
// postMessage recreates ArrayBuffers (engines >= 1.57) but turns typed arrays into plain
// index-keyed objects. Coordinates and atomic numbers stay binary instead of becoming one
// JSON Site record per atom (2.5x the bytes plus a decode on each side).
export type WireFrame = Omit<NumericFrame, `coordinates` | `sites` | `scalar_columns`> & {
  coordinates: ArrayBuffer
  sites: Exclude<NumericFrame[`sites`], Uint8Array> | ArrayBuffer
  scalar_columns?: Record<string, ArrayBuffer>
}

// A view's own bytes: a view into a larger (or shared) buffer would post all of it
const own_buffer = (view: Float64Array | Uint8Array): ArrayBuffer =>
  view.buffer instanceof ArrayBuffer && view.byteLength === view.buffer.byteLength
    ? view.buffer
    : view.slice().buffer

export const frame_to_wire = ({
  coordinates,
  sites,
  scalar_columns,
  ...rest
}: NumericFrame): WireFrame => ({
  ...rest,
  coordinates: own_buffer(coordinates),
  sites: sites instanceof Uint8Array ? own_buffer(sites) : sites,
  ...(scalar_columns && {
    scalar_columns: Object.fromEntries(
      Object.entries(scalar_columns).map(([key, column]) => [key, own_buffer(column)]),
    ),
  }),
})

// Throws on a frame a host posted without frame_to_wire: its typed arrays arrive as plain
// objects that would decode to empty columns, a materialized frame has no columns at all
export const frame_from_wire = (wire: WireFrame): NumericFrame => {
  const { coordinates, sites, scalar_columns, ...rest } = wire
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
  const n_values = n_sites * site_stride(rest.vector_keys)
  if (coordinates.byteLength !== n_values * Float64Array.BYTES_PER_ELEMENT)
    throw new Error(
      `Malformed host frame: ${coordinates.byteLength} coordinate bytes for ${n_sites} sites with vectors [${rest.vector_keys}]`,
    )
  // one value per site, else sites past a short column would read undefined
  for (const [key, column] of Object.entries(scalar_columns ?? {}))
    if (column.byteLength !== n_sites * Float64Array.BYTES_PER_ELEMENT)
      throw new Error(
        `Malformed host frame: scalar column ${key} has ${column.byteLength} bytes for ${n_sites} sites`,
      )
  return {
    ...rest,
    coordinates: new Float64Array(coordinates),
    sites: sites instanceof ArrayBuffer ? new Uint8Array(sites) : sites,
    ...(scalar_columns && {
      scalar_columns: Object.fromEntries(
        Object.entries(scalar_columns).map(([key, column]) => [key, new Float64Array(column)]),
      ),
    }),
  }
}
