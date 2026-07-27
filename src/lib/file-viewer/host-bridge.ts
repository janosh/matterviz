// The postMessage channel to whatever host embeds the viewer (the VS Code
// extension, or Hive's Tauri backend impersonating it).
//
// Deliberately free of DOM and Svelte imports so the worker-safe parser can
// reach the host for a `LARGE_FILE:` marker without dragging in the viewer's
// component graph. This module also owns the single `acquireVsCodeApi()` call:
// VS Code throws on a second acquisition, so nothing else may call it.
//
// VS Code's webview postMessage API takes a single argument (no targetOrigin),
// so unicorn's require-post-message-target-origin is a false positive here.
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin

import type {
  FrameIndex,
  FrameLoader,
  TrajectoryFrame,
  TrajectoryMetadata,
  TrajectoryType,
} from '$lib/trajectory'

export interface VSCodeAPI {
  postMessage(message: unknown): void
}

declare global {
  // VSCode webview API
  function acquireVsCodeApi(): VSCodeAPI
}

let host_api: VSCodeAPI | null = null
try {
  host_api = globalThis.acquireVsCodeApi?.() ?? null
} catch (error) {
  console.warn(`VSCode API already acquired or not available:`, error)
  host_api = null
}

export const get_vscode_api = (): VSCodeAPI | null => host_api

// Shared postMessage request/response plumbing for talking to the extension
// host: tags the request with a UUID, forwards responses carrying that id to
// on_response (which returns true once it settled the promise), and rejects
// on timeout. Always removes the listener + timer once settled.
export function post_request<T>(
  api: VSCodeAPI,
  message: Record<string, unknown>,
  timeout_ms: number,
  timeout_error: string,
  on_response: (
    data: Record<string, unknown>,
    resolve: (value: T) => void,
    reject: (error: Error) => void,
  ) => boolean,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request_id = crypto.randomUUID()
    const timer = setTimeout(() => {
      globalThis.removeEventListener(`message`, handler)
      reject(new Error(timeout_error))
    }, timeout_ms)
    const handler = (event: MessageEvent) => {
      if (event.data?.request_id !== request_id) return
      if (on_response(event.data, resolve, reject)) {
        globalThis.removeEventListener(`message`, handler)
        clearTimeout(timer)
      }
    }
    globalThis.addEventListener(`message`, handler)
    api.postMessage({ ...message, request_id })
  })
}

// Ask the host to index a file too large to copy into the webview, and hand back
// the preview trajectory it built. `filename` travels with the path because the
// host picks its per-format indexer from the name.
export async function request_large_file_content(
  file_path: string,
  filename: string,
  timeout: number = 120_000, // large host-side indexing can take longer than eager reads
): Promise<TrajectoryType> {
  if (!host_api) {
    throw new Error(
      `Cannot stream ${filename}: no host bridge is available (acquireVsCodeApi returned nothing).`,
    )
  }

  return post_request(
    host_api,
    { command: `request_large_file`, file_path, filename },
    timeout,
    `Large file timeout`,
    (data, resolve, reject) => {
      if (data.command === `large_file_progress`) {
        // TODO maybe forward file load progress to UI
        console.info(`Progress: ${data.stage} - ${data.progress}%`)
        return false
      }
      if (data.command !== `large_file_response`) return false
      if (data.error) reject(new Error(data.error as string))
      else if (data.parsed_trajectory && typeof data.parsed_trajectory === `object`) {
        resolve(data.parsed_trajectory as TrajectoryType)
      } else reject(new TypeError(`Malformed large-file response`))
      return true
    },
  )
}

// Streams frames of a host-indexed trajectory over the same channel.
export class VSCodeFrameLoader implements FrameLoader {
  constructor(
    private readonly file_path: string,
    private readonly filename: string,
    private readonly vscode_api: VSCodeAPI,
  ) {}

  // Only implement the method we actually use
  async load_frame(
    _data: string | ArrayBuffer,
    frame_index: number,
    timeout: number = 10, // 10 seconds
  ): Promise<TrajectoryFrame | null> {
    const message = {
      command: `request_frame`,
      file_path: this.file_path,
      // The host picks its per-format frame decoder from the name.
      filename: this.filename,
      frame_index,
    }
    return post_request(
      this.vscode_api,
      message,
      timeout * 1000,
      `Frame ${frame_index} timeout after ${timeout}s`,
      (data, resolve, reject) => {
        if (data.command !== `frame_response`) return false
        if (data.error) reject(new Error(data.error as string))
        else resolve(data.frame as TrajectoryFrame | null)
        return true
      },
    )
  }

  // Required by the FrameLoader interface but never called for host-streamed trajectories
  async get_total_frames(): Promise<number> {
    throw new Error(`Not implemented`)
  }
  async build_frame_index(): Promise<FrameIndex[]> {
    throw new Error(`Not implemented`)
  }
  async extract_plot_metadata(): Promise<TrajectoryMetadata[]> {
    throw new Error(`Not implemented`)
  }
}
