// oxlint-disable eslint-plugin-unicorn/relative-url-style -- Vite worker detection needs the `./` prefix
import { create_worker_client } from '$lib/worker-client.svelte'
import {
  calc_trajectory_spectroscopy,
  type TrajectorySpectroscopyInput,
  type TrajectorySpectroscopyOptions,
  type TrajectorySpectroscopyResult,
} from './trajectory-spectroscopy'

interface TrajectorySpectroscopyAsyncRunner {
  compute: (
    input: TrajectorySpectroscopyInput,
    options?: TrajectorySpectroscopyOptions,
  ) => Promise<TrajectorySpectroscopyResult>
  cancel: (reason?: string) => void
}

export const create_trajectory_spectroscopy_async_runner =
  (): TrajectorySpectroscopyAsyncRunner => {
    const client = create_worker_client<
      TrajectorySpectroscopyInput,
      TrajectorySpectroscopyOptions,
      TrajectorySpectroscopyResult
    >({
      label: `trajectory spectroscopy`,
      create_worker: () =>
        new Worker(new URL(`./trajectory-spectroscopy-worker.js`, import.meta.url), {
          type: `module`,
        }),
      compute_sync: calc_trajectory_spectroscopy,
      // Worker messages cannot clone Svelte proxies. A single snapshot is both a complete
      // plain payload and less error-prone than mirroring every input variant here.
      build_payload: (input) => $state.snapshot(input),
    })
    return {
      compute: (input, options = {}) => client(input, options),
      cancel: client.cancel,
    }
  }
