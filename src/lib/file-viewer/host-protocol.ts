import type { PartialSettings } from '$lib/settings'
import type { ThemeName } from '$lib/theme'

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

type WatchedFileContext = {
  file_path: string
  request_id?: string
  filename?: string
  frame_index?: number
}

type HostFileRequest = {
  request_id: string
  file_path: string
  // The host picks a per-format indexer/decoder from the name. The VS Code
  // extension derives its own from `file_path`, but hosts that index by name
  // (Hive) reject the request without this, so the webview always sends it.
  filename: string
}

export type FileChangeMessage = WatchedFileContext &
  ({ command: `fileUpdated`; data: FileData; theme?: ThemeName } | { command: `fileDeleted` })

export type WebviewToHostMessage =
  | { command: `info` | `error`; text: string }
  | ({ command: `request_large_file` } & HostFileRequest)
  | ({ command: `request_frame`; frame_index: number } & HostFileRequest)
  | {
      command: `saveAs`
      filename: string
      content: string
      is_binary?: boolean
    }
  | ({ command: `startWatching` } & WatchedFileContext)
  | { command: `stopWatching`; file_path: string }
