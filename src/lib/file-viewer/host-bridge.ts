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

import type { TrajectoryFrame, TrajectoryRun } from '$lib/trajectory'
import { host_run } from '$lib/trajectory/runs/host'
import { to_error } from '$lib/utils'
import type { HostRequest, HostToWebviewMessage, WebviewToHostMessage } from './host-protocol'

export interface VSCodeAPI {
  postMessage(message: WebviewToHostMessage): void
}

type HostReply = Extract<HostToWebviewMessage, { request_id: string }>

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
// host: tags the request with a UUID, forwards replies carrying that id to
// on_response (which returns true once it settled the promise), and rejects
// on timeout. Always removes the listener + timer once settled.
function post_request<T>(
  api: VSCodeAPI,
  message: HostRequest,
  timeout_ms: number,
  timeout_error: string,
  on_response: (
    data: HostReply,
    resolve: (value: T) => void,
    reject: (error: Error) => void,
  ) => boolean,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request_id = crypto.randomUUID()
    const cleanup = (): void => {
      globalThis.removeEventListener(`message`, handler)
      signal?.removeEventListener(`abort`, abort)
      clearTimeout(timer)
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(timeout_error))
    }, timeout_ms)
    const abort = (): void => {
      cleanup()
      reject(to_error(signal?.reason ?? new DOMException(`Request aborted`, `AbortError`)))
    }
    const handler = (event: MessageEvent<HostReply | undefined>) => {
      if (event.data?.request_id !== request_id) return
      if (on_response(event.data, resolve, reject)) {
        cleanup()
      }
    }
    if (signal?.aborted) return abort()
    globalThis.addEventListener(`message`, handler)
    signal?.addEventListener(`abort`, abort, { once: true })
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
): Promise<TrajectoryRun> {
  if (!host_api) {
    throw new Error(
      `Cannot stream ${filename}: no host bridge is available (acquireVsCodeApi returned nothing).`,
    )
  }
  // Plot rows arrive in batches after the summary; they are routed to THIS run instance
  // (matched by the file path the host stamps on them) until it completes or is disposed
  let stop_property_stream = (): void => {}
  const bind_host_properties = (path: string, run: TrajectoryRun): TrajectoryRun => {
    if (run.properties.complete) return run
    const handler = (event: MessageEvent<HostToWebviewMessage | undefined>): void => {
      const message = event.data
      if (message?.command !== `plot_metadata_stream` || message.file_path !== path) return
      if (run.properties.complete) return stop_property_stream()
      run.properties.push(message.rows)
      if (message.complete) {
        run.properties.finish()
        stop_property_stream()
      }
    }
    globalThis.addEventListener(`message`, handler)
    stop_property_stream = () => globalThis.removeEventListener(`message`, handler)
    return run
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
      if (data.error) reject(new Error(data.error))
      else if (data.run_summary && typeof data.run_summary === `object`) {
        resolve(
          bind_host_properties(
            file_path,
            host_run(
              data.run_summary,
              (frame_idx, signal) =>
                request_host_frame(file_path, filename, frame_idx, signal),
              () => stop_property_stream(),
            ),
          ),
        )
      } else reject(new TypeError(`Malformed large-file response`))
      return true
    },
  )
}

const request_host_frame = (
  file_path: string,
  filename: string,
  frame_idx: number,
  signal?: AbortSignal,
): Promise<TrajectoryFrame> => {
  if (!host_api) return Promise.reject(new Error(`No host bridge is available`))
  return post_request(
    host_api,
    { command: `request_frame`, file_path, filename, frame_index: frame_idx },
    10_000,
    `Frame ${frame_idx} timeout after 10s`,
    (data, resolve, reject) => {
      if (data.command !== `frame_response`) return false
      if (data.error) reject(new Error(data.error))
      else if (data.frame) resolve(data.frame)
      else reject(new Error(`Host returned no trajectory frame ${frame_idx}`))
      return true
    },
    signal,
  )
}
