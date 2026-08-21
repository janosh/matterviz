// Wire protocol and parse entry shared by the parse worker (parse-worker.ts) and its
// main-thread client (parse-in-worker.ts). Kept in its own module so the worker never pulls
// in the client (which constructs the worker) and vice versa.
//
// MessagePort.postMessage takes no targetOrigin (that's window.postMessage), so
// unicorn's require-post-message-target-origin is a false positive here.
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin
import type { OpenTrajectoryOptions, ParseProgress, TrajectorySource } from '$lib/trajectory'
import type { ParseResult, TrajectoryLoadOptions } from './parse'

interface FileParseWorkerRequest {
  kind: `file`
  id: number
  content: string
  filename: string
  is_base64: boolean
  load_options?: TrajectoryLoadOptions
}

interface TrajectoryParseWorkerRequest {
  kind: `trajectory`
  id: number
  data: TrajectorySource
  filename: string
  options: Omit<OpenTrajectoryOptions, `filename` | `signal` | `on_progress`>
}

export type ParseWorkerRequest = FileParseWorkerRequest | TrajectoryParseWorkerRequest

export interface ParseWorkerResponse {
  id: number
  result?: ParseResult
  error?: string
  progress?: ParseProgress
  hdf5_group_paths?: string[]
  // A trajectory result carries a serializable summary here; the live run stays in the
  // worker and is served through run_port.
  run_port?: MessagePort
}
