// Wire protocol and parse entry shared by the parse worker (parse-worker.ts) and its
// main-thread client (parse-in-worker.ts). Kept in its own module so the worker never pulls
// in the client (which constructs the worker) and vice versa.
//
// MessagePort.postMessage takes no targetOrigin (that's window.postMessage), so
// unicorn's require-post-message-target-origin is a false positive here.
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin
import { XYZ_EXTXYZ_REGEX } from '$lib/constants'
import type { ParseProgress, TrajectorySource } from '$lib/trajectory'
import { count_xyz_frames } from '$lib/trajectory/helpers'
import type { LoadingOptions } from '$lib/trajectory/parse'
import { parse_trajectory_async } from '$lib/trajectory/parse'
import type { ParseResult } from './parse'
import { parse_file_content } from './parse'

export interface FileParseWorkerRequest {
  kind: `file`
  id: number
  content: string
  filename: string
  is_base64: boolean
}

export interface TrajectoryParseWorkerRequest {
  kind: `trajectory`
  id: number
  data: TrajectorySource
  filename: string
  options: LoadingOptions
}

export type ParseWorkerRequest = FileParseWorkerRequest | TrajectoryParseWorkerRequest

export interface ParseWorkerResponse {
  id: number
  result?: ParseResult
  error?: string
  progress?: ParseProgress
  hdf5_group_paths?: string[]
  // Present when the worker keeps the trajectory's source and serves frames over this port
  frame_port?: MessagePort
}

export type FrameWorkerMethod =
  | `get_total_frames`
  | `build_frame_index`
  | `load_frame`
  | `extract_plot_metadata`
  | `stream_positions`
  | `dispose`

export interface FrameWorkerRequest {
  id: number
  method: FrameWorkerMethod
  args: unknown[]
}

export interface FrameWorkerResponse {
  id: number
  result?: unknown
  error?: string
  progress?: ParseProgress
}

const INDEXED_XYZ_MIN_CHARS = 1024 * 1024
const INDEXED_XYZ_MIN_FRAMES = 64

// Best-effort dispose for a transferred frame port the client never bound (stale
// reply, id mismatch, clone failure). Active loaders use their own RPC dispose.
export const dispose_frame_port = (frame_port: MessagePort | undefined): void => {
  if (!frame_port) return
  try {
    frame_port.postMessage({ id: 0, method: `dispose`, args: [] })
  } catch {
    // Port may already be closed / detached.
  }
  frame_port.close()
}

// Whether a file-viewer parse should build a frame index instead of materializing every
// frame: only multi-frame plain-text XYZ that is either large or long is worth it.
export const should_index_worker_xyz = (
  content: string,
  filename: string,
  is_base64: boolean,
): boolean => {
  if (is_base64 || !XYZ_EXTXYZ_REGEX.test(filename)) return false
  const frame_count = count_xyz_frames(content)
  return (
    frame_count >= 2 &&
    (content.length >= INDEXED_XYZ_MIN_CHARS || frame_count >= INDEXED_XYZ_MIN_FRAMES)
  )
}

// The file-viewer parse both sides run: the worker for its requests, the client when it has
// to parse on the main thread. Materializing every frame of a long trajectory would blow up
// whichever thread runs it, so indexable XYZ is indexed on both.
export const parse_file_content_indexed = async (
  content: string,
  filename: string,
  is_base64: boolean,
): Promise<ParseResult> =>
  should_index_worker_xyz(content, filename, is_base64)
    ? {
        type: `trajectory`,
        filename,
        data: await parse_trajectory_async(content, filename, undefined, {
          use_indexing: true,
          extract_plot_metadata: true,
        }),
      }
    : parse_file_content(content, filename, is_base64)
