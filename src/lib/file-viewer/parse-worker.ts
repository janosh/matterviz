// Module worker that runs the worker-safe parse path off the UI thread so opening
// large files (100+ MB HDF5) doesn't freeze the window. Protocol: receives
// { id, content, filename, is_base64 }, answers { id, result } | { id, error }.
// LARGE_FILE markers never reach this worker (they need the host postMessage
// transport, available only on the main thread; see parse-in-worker.ts).
//
// Worker postMessage takes no targetOrigin argument (that's window.postMessage),
// so unicorn's require-post-message-target-origin is a false positive here.
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin
import type { FrameLoader, ParseProgress } from '$lib/trajectory'
import { parse_trajectory_async } from '$lib/trajectory/parse'
import { parse_file_content } from './parse'
import {
  type FrameWorkerRequest,
  type ParseWorkerRequest,
  type ParseWorkerResponse,
  should_index_worker_xyz,
} from './parse-worker-protocol'

const error_message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const create_frame_loader_port = (frame_loader: FrameLoader, content: string): MessagePort => {
  const channel = new MessageChannel()
  // Dropped on dispose so a closed viewer stops pinning the source string (100+ MB for the
  // trajectories worth indexing) and the loader's frame index for the worker's whole life.
  let state: { loader: FrameLoader; data: string } | null = {
    loader: frame_loader,
    data: content,
  }
  const dispose = (): void => {
    state?.loader.dispose?.()
    state = null
    channel.port1.close()
  }
  const post_response = (response: unknown): void => {
    if (!state) return
    try {
      channel.port1.postMessage(response)
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
          result = await loader.stream_positions(
            data,
            args[0] as Parameters<NonNullable<FrameLoader[`stream_positions`]>>[1],
            on_progress,
          )
        } else {
          throw new Error(`Unsupported indexed frame worker method: ${method}`)
        }
        post_response({ id, result })
      } catch (error) {
        post_response({ id, error: error_message(error) })
      }
    })()
  })
  channel.port1.start()
  return channel.port2
}

export const handle_parse_worker_request = async (
  request: ParseWorkerRequest,
): Promise<{ response: ParseWorkerResponse; transfer: Transferable[] }> => {
  const { id, content, filename, is_base64 } = request
  try {
    if (!should_index_worker_xyz(content, filename, is_base64)) {
      return {
        response: { id, result: await parse_file_content(content, filename, is_base64) },
        transfer: [],
      }
    }
    const indexed = await parse_trajectory_async(content, filename, undefined, {
      use_indexing: true,
      extract_plot_metadata: true,
    })
    const frame_loader = indexed.frame_loader
    if (!frame_loader) throw new Error(`Indexed trajectory has no frame loader`)
    const frame_port = create_frame_loader_port(frame_loader, content)
    indexed.frame_loader = undefined
    return {
      response: { id, result: { type: `trajectory`, data: indexed, filename }, frame_port },
      transfer: [frame_port],
    }
  } catch (error) {
    return { response: { id, error: error_message(error) }, transfer: [] }
  }
}

self.addEventListener(`message`, (event: MessageEvent<ParseWorkerRequest>) => {
  const { id } = event.data
  void (async () => {
    const { response, transfer } = await handle_parse_worker_request(event.data)
    try {
      // Catalina WKWebView only has the legacy (message, transferList) overload.
      // The DOM lib types `self` as Window; the worker scope takes the list.
      ;(self as unknown as Worker).postMessage(response, transfer)
    } catch (error) {
      try {
        response.frame_port?.postMessage({ id: 0, method: `dispose`, args: [] })
      } catch {
        // The failed transfer may already have detached the port.
      }
      response.frame_port?.close()
      self.postMessage({
        id,
        error: `Failed to clone parse result: ${error_message(error)}`,
      })
    }
  })()
})
