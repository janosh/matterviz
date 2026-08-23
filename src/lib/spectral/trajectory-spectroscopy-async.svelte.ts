// oxlint-disable eslint-plugin-unicorn/relative-url-style -- Vite worker detection needs the `./` prefix
// Async wrapper for calc_trajectory_spectroscopy via a persistent Web Worker.
import type { TrajectorySignal } from '$lib/trajectory'
import { create_worker_client, type WorkerRequestOptions } from '$lib/worker-client.svelte'
import {
  calc_trajectory_spectroscopy,
  type TrajectorySpectroscopyInput,
  type TrajectorySpectroscopyOptions,
  type TrajectorySpectroscopyResult,
} from './trajectory-spectroscopy'

// Worker messages cannot clone Svelte proxies, and `$state.snapshot(input)` deep-copied every
// buffer before postMessage copied it again. Rebuilding the payload field by field hands the
// raw typed arrays straight to structured clone; only the small plain parts are snapshotted.
const plain_signal = (signal: TrajectorySignal): TrajectorySignal => ({
  values: signal.values,
  sample_shape: $state.snapshot(signal.sample_shape),
  steps: $state.snapshot(signal.steps),
  ...(signal.unit ? { unit: signal.unit } : {}),
})

const run_spectroscopy = create_worker_client<
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
  build_payload: (input): TrajectorySpectroscopyInput => {
    const { positions, infrared_signal, raman_signal } = input
    return {
      positions: {
        positions: positions.positions,
        n_frames: positions.n_frames,
        n_atoms: positions.n_atoms,
        coords_unwrapped: positions.coords_unwrapped,
        frame_stride: positions.frame_stride,
        elements: $state.snapshot(positions.elements),
        lattice_matrices: $state.snapshot(positions.lattice_matrices),
        pbc: $state.snapshot(positions.pbc),
        steps: $state.snapshot(positions.steps),
        ...(positions.vectors ? { vectors: { ...positions.vectors } } : {}),
        ...(positions.signals
          ? {
              signals: Object.fromEntries(
                Object.entries(positions.signals).map(([key, signal]) => [
                  key,
                  plain_signal(signal),
                ]),
              ),
            }
          : {}),
      },
      masses: input.masses,
      velocities: input.velocities ? plain_signal(input.velocities) : null,
      infrared_signal: infrared_signal
        ? { ...infrared_signal, series: plain_signal(infrared_signal.series) }
        : null,
      raman_signal: raman_signal
        ? { kind: raman_signal.kind, series: plain_signal(raman_signal.series) }
        : null,
      ...(input.time_step !== undefined ? { time_step: input.time_step } : {}),
      ...(input.time_unit !== undefined ? { time_unit: input.time_unit } : {}),
      ...(input.metadata ? { metadata: $state.snapshot(input.metadata) } : {}),
    }
  },
})

// `.cancel(reason?)` rejects every in-flight request and terminates the worker; `.release()`
// terminates it only when nothing is in flight (a pane's unmount path: the client is shared by
// every mounted pane, so one unmount must not reject another pane's request)
export const compute_trajectory_spectroscopy_async = Object.assign(
  (
    input: TrajectorySpectroscopyInput,
    options: TrajectorySpectroscopyOptions = {},
    request_options: WorkerRequestOptions = {},
  ): Promise<TrajectorySpectroscopyResult> =>
    run_spectroscopy(input, options, request_options),
  { cancel: run_spectroscopy.cancel, release: run_spectroscopy.release },
)
