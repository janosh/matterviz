// Module worker that runs the worker-safe parse path off the UI thread so opening
// large files (100+ MB HDF5) doesn't freeze the window. Protocol: receives
// { id, content, filename, is_base64 }, answers { id, result } | { id, error }.
// LARGE_FILE markers never reach this worker (they need the host postMessage
// transport, available only on the main thread; see parse-in-worker.ts).
//
// Worker postMessage takes no targetOrigin argument (that's window.postMessage),
// so unicorn's require-post-message-target-origin is a false positive here.
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin
import type {
  FrameLoader,
  ParseProgress,
  TrajectoryPositionStream,
  TrajectoryType,
} from '$lib/trajectory'
import { packed_frame_transferables } from '$lib/trajectory/helpers'
import { parse_trajectory_async } from '$lib/trajectory/parse'
import { Hdf5TrajectoryGroupSelectionError } from '$lib/trajectory/parse/hdf5'
import { parse_file_content, type ParseResult } from './parse'
import type {
  AnyParseWorkerRequest,
  FrameWorkerRequest,
  ParseWorkerRequest,
  ParseWorkerResponse,
  TrajectoryParseWorkerRequest,
} from './parse-worker-protocol'
import { dispose_frame_port, should_index_worker_xyz } from './parse-worker-protocol'

const error_message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const is_trajectory_request = (
  value: AnyParseWorkerRequest,
): value is TrajectoryParseWorkerRequest => `kind` in value && value.kind === `trajectory`

const position_stream_transferables = (stream: TrajectoryPositionStream): ArrayBuffer[] => {
  const buffers: ArrayBuffer[] = []
  const add = (values: Float64Array): void => {
    const buffer = values.buffer as ArrayBuffer
    if (!buffers.includes(buffer)) buffers.push(buffer)
  }
  add(stream.positions)
  for (const values of Object.values(stream.scalars ?? {})) add(values)
  for (const values of Object.values(stream.vectors ?? {})) add(values)
  for (const signal of Object.values(stream.signals ?? {})) add(signal.values)
  return buffers
}

const create_frame_loader_port = (
  frame_loader: FrameLoader,
  content: string | ArrayBuffer,
): MessagePort => {
  const channel = new MessageChannel()
  // Dropped on dispose so a closed viewer stops pinning the source string (100+ MB for the
  // trajectories worth indexing) and the loader's frame index for the worker's whole life.
  let state: { loader: FrameLoader; data: string | ArrayBuffer } | null = {
    loader: frame_loader,
    data: content,
  }
  const dispose = (): void => {
    state?.loader.dispose?.()
    state = null
    channel.port1.close()
  }
  const post_response = (response: unknown, transfer: Transferable[] = []): void => {
    if (!state) return
    try {
      channel.port1.postMessage(response, { transfer })
    } catch {
      dispose()
    }
  }
  channel.port1.addEventListener(`message`, (event: MessageEvent<FrameWorkerRequest>) => {
    const { id, method, args } = event.data
    if (method === `dispose` || !state) {
      dispose()
      return
    }
    const { loader, data } = state
    void (async () => {
      const on_progress = (progress: ParseProgress): void => post_response({ id, progress })
      try {
        let result: unknown
        let transfer: Transferable[] = []
        if (method === `get_total_frames`) {
          result = await loader.get_total_frames(data)
        } else if (method === `build_frame_index`) {
          result = await loader.build_frame_index(data, Number(args[0]), on_progress)
        } else if (method === `load_frame`) {
          result = await loader.load_frame(data, Number(args[0]))
        } else if (method === `extract_plot_metadata`) {
          result = await loader.extract_plot_metadata(
            data,
            args[0] as Parameters<FrameLoader[`extract_plot_metadata`]>[1],
            on_progress,
          )
        } else if (method === `stream_positions` && loader.stream_positions) {
          const stream = await loader.stream_positions(
            data,
            args[0] as Parameters<NonNullable<FrameLoader[`stream_positions`]>>[1],
            on_progress,
          )
          result = stream
          transfer = position_stream_transferables(stream)
        } else {
          throw new Error(`Unsupported indexed frame worker method: ${method}`)
        }
        post_response({ id, result }, transfer)
      } catch (error) {
        post_response({ id, error: error_message(error) })
      }
    })()
  })
  channel.port1.start()
  return channel.port2
}

export const prepare_parse_result = (
  id: number,
  result: ParseResult,
  content: string | ArrayBuffer,
): { response: ParseWorkerResponse; transfer: Transferable[] } => {
  const trajectory = result.type === `trajectory` ? (result.data as TrajectoryType) : null
  if (trajectory?.is_indexed !== true || !trajectory.frame_loader) {
    return { response: { id, result }, transfer: [] }
  }
  if (trajectory.frame_store) {
    const transfer = packed_frame_transferables(trajectory.frame_store)
    trajectory.frame_loader = undefined
    return { response: { id, result }, transfer }
  }
  const frame_port = create_frame_loader_port(trajectory.frame_loader, content)
  trajectory.frame_loader = undefined
  return { response: { id, result, frame_port }, transfer: [frame_port] }
}

export const handle_parse_worker_request = async (
  request: ParseWorkerRequest,
): Promise<{ response: ParseWorkerResponse; transfer: Transferable[] }> => {
  const { id, content, filename, is_base64 } = request
  try {
    if (!should_index_worker_xyz(content, filename, is_base64)) {
      return prepare_parse_result(
        id,
        await parse_file_content(content, filename, is_base64),
        content,
      )
    }
    const indexed = await parse_trajectory_async(content, filename, undefined, {
      use_indexing: true,
      extract_plot_metadata: true,
    })
    return prepare_parse_result(id, { type: `trajectory`, data: indexed, filename }, content)
  } catch (error) {
    return { response: { id, error: error_message(error) }, transfer: [] }
  }
}

export const handle_any_parse_worker_request = async (
  request: AnyParseWorkerRequest,
  on_progress?: (progress: ParseProgress) => void,
): Promise<{ response: ParseWorkerResponse; transfer: Transferable[] }> => {
  if (!is_trajectory_request(request)) {
    return handle_parse_worker_request(request)
  }
  const { id, data, filename, options } = request
  try {
    const trajectory = await parse_trajectory_async(data, filename, on_progress, options)
    return prepare_parse_result(id, { type: `trajectory`, data: trajectory, filename }, data)
  } catch (error) {
    return {
      response: {
        id,
        error: error_message(error),
        ...(error instanceof Hdf5TrajectoryGroupSelectionError
          ? { hdf5_group_paths: error.group_paths }
          : {}),
      },
      transfer: [],
    }
  }
}

self.addEventListener(`message`, (event: MessageEvent<AnyParseWorkerRequest>) => {
  const { id } = event.data
  void (async () => {
    const on_progress = (progress: ParseProgress): void =>
      self.postMessage({ id, progress } satisfies ParseWorkerResponse)
    const { response, transfer } = await handle_any_parse_worker_request(
      event.data,
      on_progress,
    )
    try {
      self.postMessage(response, { transfer })
    } catch (error) {
      dispose_frame_port(response.frame_port)
      self.postMessage({
        id,
        error: `Failed to clone parse result: ${error_message(error)}`,
      })
    }
  })()
})
