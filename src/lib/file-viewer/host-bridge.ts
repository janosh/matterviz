// The postMessage channel to whatever host embeds the viewer (the VS Code
// extension, or a desktop host speaking the same protocol).
//
// Deliberately free of DOM and Svelte imports so the worker-safe parser can
// reach the host for a `LARGE_FILE:` marker without dragging in the viewer's
// component graph. This module also owns the single `acquireVsCodeApi()` call:
// VS Code throws on a second acquisition, so nothing else may call it.
//
// VS Code's webview postMessage API takes a single argument (no targetOrigin),
// so unicorn's require-post-message-target-origin is a false positive here.
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin

import { display_idx } from '#lib/labels.js'
import type { FrameChannels } from '#lib/trajectory/frame.js'
import { frame_transfers, materialize_frame } from '#lib/trajectory/frame.js'
import type { TrajectoryRun } from '#lib/trajectory/index.js'
import { host_run, type HostFrameInput } from '#lib/trajectory/runs/host.js'
import type { PreparePool } from '#lib/trajectory/prepare-pool.js'
import { to_error } from 'svelte-widgets/utils'
import {
  frame_from_wire,
  HostFileError,
  wire_frame_buffers,
  wire_frame_bytes,
} from './host-protocol'
import type {
  HostRequest,
  HostToWebviewMessage,
  WebviewToHostMessage,
  WireFrame,
} from './host-protocol'
import { create_playback_telemetry } from './telemetry'

export interface VSCodeAPI {
  postMessage(message: WebviewToHostMessage): void
}

type HostReply = Extract<HostToWebviewMessage, { request_id: string }>

// The webview entry (main.ts) supplies display preparation workers for host runs. Kept out of
// this module, which the parse worker's bundle carries for LARGE_FILE markers, so that bundle
// doesn't embed a second worker.
// What a preparation worker (host-prepare-worker.ts) decodes: a host reply, with the preview's
// atomic numbers it may omit, or frame 0 decoded here
export type HostPrepareInput = HostFrameInput<WireFrame> & { preview_sites?: Uint8Array }
// A host reply's buffers are the message's own (VS Code recreates them per message), and frame
// 0 is encoded per request, so both move to the worker rather than being copied
export const host_prepare_transfers = (input: HostPrepareInput): Transferable[] =>
  `frame` in input ? frame_transfers(input.frame) : wire_frame_buffers(input.reply)
type HostPreparePool = PreparePool<HostPrepareInput>
let open_prepare_pool: (() => HostPreparePool | undefined) | undefined
export const use_host_preparation = (open: () => HostPreparePool | undefined): void => {
  open_prepare_pool = open
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
}

export const get_vscode_api = (): VSCodeAPI | null => host_api

// Disabled (every call a no-op) unless the host opted in through matterviz.telemetry
export const telemetry = create_playback_telemetry(
  host_api && globalThis.matterviz_data?.telemetry
    ? (record) => host_api?.postMessage({ command: `telemetry`, record })
    : null,
)

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
    const fail = (error: unknown): void => {
      cleanup()
      reject(to_error(error))
    }
    // the host never delivered: a load failure, not a verdict on the file's format
    const timer = setTimeout(
      () => fail(new HostFileError(timeout_error, `acquire`)),
      timeout_ms,
    )
    const abort = (): void =>
      fail(signal?.reason ?? new DOMException(`Request aborted`, `AbortError`))
    const handler = (event: MessageEvent<HostReply | undefined>) => {
      if (event.data?.request_id !== request_id) return
      try {
        if (on_response(event.data, resolve, reject)) cleanup()
      } catch (error) {
        fail(error)
      }
    }
    if (signal?.aborted) return abort()
    globalThis.addEventListener(`message`, handler)
    signal?.addEventListener(`abort`, abort, { once: true })
    try {
      api.postMessage({ ...message, request_id })
    } catch (error) {
      fail(error)
    }
  })
}

// Ask the host to index a file too large to copy into the webview, and hand back
// the preview trajectory it built. `filename` travels with the path because the
// host picks its per-format indexer from the name.
export async function request_large_file_content(
  file_path: string,
  filename: string,
  timeout = 120_000, // large host-side indexing can take longer than eager reads
): Promise<TrajectoryRun> {
  if (!host_api) {
    throw new Error(
      `Cannot stream ${filename}: no host bridge is available (acquireVsCodeApi returned nothing).`,
    )
  }
  const sent_at = performance.now()
  return post_request(
    host_api,
    { command: `request_large_file`, file_path, filename },
    timeout,
    `Large file timeout`,
    (data, resolve, reject) => {
      if (data.command !== `large_file_response`) return false
      if (data.error) reject(new HostFileError(data.error, data.error_stage ?? `acquire`))
      else if (data.run_summary && typeof data.run_summary === `object` && data.preview) {
        // Plot rows and grown warnings arrive after the summary, stamped with its request_id;
        // they are routed to THIS run instance until it is disposed
        const handler = (event: MessageEvent<HostReply | undefined>): void => {
          const message = event.data
          if (message?.request_id !== data.request_id) return
          if (message.command === `trajectory_warnings`) run.receive_warnings(message.warnings)
          else if (message.command === `plot_metadata_stream` && !run.properties.complete)
            run.properties.deliver(message.rows, message.complete, `Host`)
        }
        const preview_frame = frame_from_wire(data.preview)
        // frames with the preview's atomic numbers arrive without them (WireFrame sites)
        const preview_sites =
          preview_frame.sites instanceof Uint8Array ? preview_frame.sites.slice() : undefined
        const preview = materialize_frame(preview_frame)
        const pool = open_prepare_pool?.()
        const request = (frame_idx: number, signal?: AbortSignal, channels?: FrameChannels) =>
          request_host_frame(file_path, filename, data.request_id, frame_idx, signal, channels)
        const run = host_run(
          { ...data.run_summary, preview },
          // reads outside prepared playback (exports, small systems) decode here
          (frame_idx, signal, channels) =>
            request(frame_idx, signal, channels).then((wire) => {
              const started_at = performance.now()
              const frame = frame_from_wire(wire, preview_sites)
              telemetry.decoded(performance.now() - started_at)
              return frame
            }),
          () => {
            globalThis.removeEventListener(`message`, handler)
            pool?.dispose()
          },
          pool && {
            request,
            prepare: (input, preparation, signal) =>
              pool.prepare({ ...input, preview_sites }, preparation, signal),
          },
        )
        globalThis.addEventListener(`message`, handler)
        telemetry.event({
          kind: `run_summary`,
          filename,
          frame_count: run.frame_count,
          prepares_in_worker: Boolean(pool),
          rtt_ms: Math.round(performance.now() - sent_at),
          since_navigation_ms: Math.round(performance.now()),
        })
        resolve(run)
      } else reject(new TypeError(`Malformed large-file response`))
      return true
    },
  )
}

const request_host_frame = (
  file_path: string,
  filename: string,
  run_id: string,
  frame_idx: number,
  signal?: AbortSignal,
  channels?: FrameChannels,
): Promise<WireFrame> => {
  if (!host_api) return Promise.reject(new Error(`No host bridge is available`))
  const in_flight = telemetry.in_flight()
  const settle_request = telemetry.track_request()
  const sent_at = performance.now()
  const request = post_request<WireFrame>(
    host_api,
    {
      command: `request_frame`,
      file_path,
      filename,
      run_id,
      frame_index: frame_idx,
      channels,
    },
    10_000,
    `Frame ${display_idx(frame_idx)} timeout after 10s`,
    (data, resolve, reject) => {
      if (data.command !== `frame_response`) return false
      if (data.error) reject(new Error(data.error))
      else if (data.frame) {
        if (telemetry.enabled)
          telemetry.frame({
            idx: frame_idx,
            rtt_ms: performance.now() - sent_at,
            host_read_ms: data.timing?.read_ms,
            host_encode_ms: data.timing?.encode_ms,
            wire_bytes: wire_frame_bytes(data.frame),
            in_flight,
          })
        resolve(data.frame)
      } else reject(new Error(`Host returned no trajectory frame ${display_idx(frame_idx)}`))
      return true
    },
    signal,
  )
  return request.finally(settle_request)
}
