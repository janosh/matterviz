// Wire protocol shared by the parse worker (parse-worker.ts) and its main-thread
// client (parse-in-worker.ts). Kept in its own module so the worker never pulls in
// the client (which constructs the worker) and vice versa.
//
// MessagePort.postMessage takes no targetOrigin (that's window.postMessage), so
// unicorn's require-post-message-target-origin is a false positive here.
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin
import { XYZ_EXTXYZ_REGEX } from '$lib/constants'
import type { ParseProgress, TrajectorySource } from '$lib/trajectory'
import type { LoadingOptions } from '$lib/trajectory/parse'
import { count_xyz_frames } from '$lib/trajectory/helpers'
import type { ParseResult } from './parse'

export interface ParseWorkerRequest {
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

export type AnyParseWorkerRequest = ParseWorkerRequest | TrajectoryParseWorkerRequest

export interface ParseWorkerResponse {
  id: number
  result?: ParseResult
  error?: string
  progress?: ParseProgress
  hdf5_group_paths?: string[]
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

// Whether a worker parse should build a frame index instead of materializing every
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
