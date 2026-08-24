// Message shapes exchanged between the webview (main.ts / host-bridge.ts) and whatever
// host embeds it (the VS Code extension, or Hive's Tauri backend impersonating it).
import type { PartialSettings } from '$lib/settings'
import type { ThemeName } from '$lib/theme'
import type {
  TrajectoryFrame,
  TrajectoryMetadata,
  TrajectoryRunSummary,
} from '$lib/trajectory'

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
  // (Hive) reject the request without this, so the webview always sends it.
  filename: string
}

// Requests the host answers with a HostToWebviewMessage carrying the same request_id
export type HostRequest =
  | ({ command: `request_large_file` } & HostFileRequest)
  | ({ command: `request_frame`; frame_index: number } & HostFileRequest)

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
  | { command: `error`; text: string }
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
      frame?: TrajectoryFrame | null
      error?: string
    }
  // Progressive per-frame plot rows of a host-served run, batched after large_file_response
  | {
      command: `plot_metadata_stream`
      file_path: string
      rows: TrajectoryMetadata[]
      complete: boolean
    }
