// Module worker that runs the worker-safe parse path off the UI thread so opening
// large files (100+ MB HDF5) doesn't freeze the window. Protocol: receives a
// ParseWorkerRequest, posts `{ id, progress }` messages while parsing and answers once
// with `{ id, result, frame_port? } | { id, error }`. LARGE_FILE markers never reach this
// worker (they need the host postMessage transport, available only on the main thread;
// see parse-in-worker.ts).
//
// Worker postMessage takes no targetOrigin argument (that's window.postMessage),
// so unicorn's require-post-message-target-origin is a false positive here.
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin
import type {
  FrameLoader,
  ParseProgress,
  TrajectorySource,
  TrajectoryType,
} from '$lib/trajectory'
import { trajectory_data_transferables } from '$lib/trajectory/helpers'
import { parse_trajectory_async } from '$lib/trajectory/parse'
import { Hdf5TrajectoryGroupSelectionError } from '$lib/trajectory/parse/hdf5'
import type { ParseResult } from './parse'
import type {
  FrameWorkerRequest,
  ParseWorkerRequest,
  ParseWorkerResponse,
} from './parse-worker-protocol'
import { dispose_frame_port, parse_file_content_indexed } from './parse-worker-protocol'

const error_message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const create_frame_loader_port = (
  frame_loader: FrameLoader,
  content: TrajectorySource,
): MessagePort => {
  const channel = new MessageChannel()
  // Dropped on dispose so a closed viewer stops pinning the source string (100+ MB for the
  // trajectories worth indexing) and the loader's frame index for the worker's whole life.
  if (content instanceof Blob && frame_loader.requires_source !== false) {
    throw new Error(`Blob-backed frame loaders must own their HDF5 source`)
  }
  let state: { loader: FrameLoader; data: string | ArrayBuffer } | null = {
    loader: frame_loader,
    data: content instanceof Blob ? `` : content,
  }
  let request_queue = Promise.resolve()
  const dispose = (): void => {
    try {
      state?.loader.dispose?.()
    } finally {
      state = null
      channel.port1.close()
    }
  }
  const post_response = (response: unknown, transfer: Transferable[] = []): void => {
    if (!state) return
    try {
      channel.port1.postMessage(response, { transfer })
    } catch (error) {
      if (response && typeof response === `object` && `id` in response) {
        try {
          channel.port1.postMessage({ id: response.id, error: error_message(error) })
        } catch {
          // The port itself is unusable; disposal below releases the retained source.
        }
      }
      dispose()
    }
  }
  channel.port1.addEventListener(`message`, (event: MessageEvent<FrameWorkerRequest>) => {
    const { id, method, args } = event.data
    if (method === `dispose` || !state) {
      dispose()
      return
    }
    request_queue = request_queue.then(async () => {
      if (!state) return
      const { loader, data } = state
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
          transfer = trajectory_data_transferables(stream)
        } else {
          throw new Error(`Unsupported indexed frame worker method: ${method}`)
        }
        post_response({ id, result }, transfer)
      } catch (error) {
        post_response({ id, error: error_message(error) })
      }
    })
  })
  channel.port1.start()
  return channel.port2
}

// Strip the non-cloneable frame loader off an indexed result: packed frame stores travel as
// transferred buffers, anything else is served from this worker over a frame port.
export const prepare_parse_result = (
  id: number,
  result: ParseResult,
  content: TrajectorySource,
): { response: ParseWorkerResponse; transfer: Transferable[] } => {
  const trajectory = result.type === `trajectory` ? (result.data as TrajectoryType) : null
  if (trajectory?.is_indexed !== true || !trajectory.frame_loader) {
    return { response: { id, result }, transfer: [] }
  }
  const { frame_loader, frame_store } = trajectory
  trajectory.frame_loader = undefined
  if (frame_store) {
    return { response: { id, result }, transfer: trajectory_data_transferables(frame_store) }
  }
  const frame_port = create_frame_loader_port(frame_loader, content)
  return { response: { id, result, frame_port }, transfer: [frame_port] }
}

export const handle_parse_worker_request = async (
  request: ParseWorkerRequest,
  on_progress?: (progress: ParseProgress) => void,
): Promise<{ response: ParseWorkerResponse; transfer: Transferable[] }> => {
  const { id, filename } = request
  try {
    if (request.kind === `trajectory`) {
      const { data, options } = request
      const trajectory = await parse_trajectory_async(data, filename, on_progress, options)
      return prepare_parse_result(id, { type: `trajectory`, data: trajectory, filename }, data)
    }
    const { content, is_base64 } = request
    const result = await parse_file_content_indexed(content, filename, is_base64)
    return prepare_parse_result(id, result, content)
  } catch (error) {
    return {
      response: {
        id,
        error: error_message(error),
        ...(error instanceof Hdf5TrajectoryGroupSelectionError && {
          hdf5_group_paths: error.group_paths,
        }),
      },
      transfer: [],
    }
  }
}

self.addEventListener(`message`, (event: MessageEvent<ParseWorkerRequest>) => {
  const { id } = event.data
  void (async () => {
    const on_progress = (progress: ParseProgress): void =>
      self.postMessage({ id, progress } satisfies ParseWorkerResponse)
    const { response, transfer } = await handle_parse_worker_request(event.data, on_progress)
    try {
      self.postMessage(response, { transfer })
    } catch (error) {
      dispose_frame_port(response.frame_port)
      self.postMessage({ id, error: `Failed to clone parse result: ${error_message(error)}` })
    }
  })()
})
