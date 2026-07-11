import type { DefaultSettings } from '$lib/settings'
import type { ThemeName } from '$lib/theme'
import type { TrajectoryType } from '$lib/trajectory'

export interface FileData {
  filename: string
  content: string
  is_base64: boolean
}

export interface WebviewBootstrapData {
  data: FileData
  theme: ThemeName
  defaults?: DefaultSettings
  moyo_wasm_url?: string
}

export interface ParsedTrajectoryResponse {
  trajectory: TrajectoryType
  file_path: string
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
  filename: string
}

export type FileChangeMessage = WatchedFileContext &
  ({ command: `fileUpdated`; data: FileData; theme?: ThemeName } | { command: `fileDeleted` })

export type WebviewToHostMessage =
  | { command: `info` | `error`; text: string }
  | ({ command: `request_large_file`; is_base64: boolean } & HostFileRequest)
  | ({ command: `request_frame`; frame_index: number } & HostFileRequest)
  | {
      command: `saveAs`
      filename: string
      content: string
      is_binary?: boolean
    }
  | ({ command: `startWatching` } & WatchedFileContext)
  | { command: `stopWatching`; file_path: string }
