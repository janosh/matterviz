// Wire protocol shared by the parse worker (parse-worker.ts) and its
// main-thread client (parse-in-worker.ts). Kept in its own module so the worker never pulls
// in the client (which constructs the worker) and vice versa.
import type { ParseProgress, TrajectorySource } from '$lib/trajectory'
import type { TrajectoryLoadOptions, WireParseResult } from './parse'

export interface ParseWorkerRequest {
  id: number
  content: TrajectorySource
  filename: string
  is_base64: boolean
  load_options?: TrajectoryLoadOptions
}

export interface ParseWorkerResponse {
  id: number
  result?: WireParseResult
  error?: string
  progress?: ParseProgress
  hdf5_group_paths?: string[]
  // A trajectory result's data is a summary (see WireParseResult); the live run stays in
  // the worker and is served through run_port.
  run_port?: MessagePort
}
