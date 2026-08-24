// Module worker for file parsing. TrajectoryRun instances stay in this worker and cross the
// boundary as a summary plus a MessagePort implementing read_frame/collect_positions.
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin
import type { ParseProgress, TrajectoryRun } from '$lib/trajectory'
import { open_trajectory } from '$lib/trajectory/open'
import { Hdf5GroupSelectionRequiredError } from '$lib/trajectory/parse'
import { summarize_run } from '$lib/trajectory/run'
import { dispose_run_port, serve_run_over_port } from '$lib/trajectory/runs/worker'
import { to_error } from '$lib/utils'
import type { ParseWorkerRequest, ParseWorkerResponse } from './parse-worker-protocol'
import { parse_file_content, type ParseResult } from './parse'

const prepare_parse_result = (
  id: number,
  result: ParseResult,
): { response: ParseWorkerResponse; transfer: Transferable[] } => {
  if (result.type !== `trajectory`) return { response: { id, result }, transfer: [] }
  const run = result.data as TrajectoryRun
  const run_port = serve_run_over_port(run)
  return {
    response: { id, result: { ...result, data: summarize_run(run) }, run_port },
    transfer: [run_port],
  }
}

export const handle_parse_worker_request = async (
  request: ParseWorkerRequest,
  on_progress?: (progress: ParseProgress) => void,
): Promise<{ response: ParseWorkerResponse; transfer: Transferable[] }> => {
  const { id, filename } = request
  try {
    const result =
      request.kind === `trajectory`
        ? {
            type: `trajectory` as const,
            filename,
            data: await open_trajectory(request.data, {
              ...request.options,
              filename,
              on_progress,
            }),
          }
        : await parse_file_content(
            request.content,
            filename,
            request.is_base64,
            request.load_options,
          )
    return prepare_parse_result(id, result)
  } catch (error) {
    return {
      response: {
        id,
        error: to_error(error).message,
        ...(error instanceof Hdf5GroupSelectionRequiredError && {
          hdf5_group_paths: error.groups,
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
      dispose_run_port(response.run_port)
      self.postMessage({
        id,
        error: `Failed to clone parse result: ${to_error(error).message}`,
      })
    }
  })()
})
