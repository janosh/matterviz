// oxlint-disable eslint-plugin-unicorn/relative-url-style -- Vite worker detection needs the `./` prefix
// calc_trajectory_spectroscopy via a persistent Web Worker; see create_worker_client for
// `.cancel` / `.release` semantics. The client is shared by every mounted pane, so a pane's
// unmount path is `.release()` (terminates only when nothing is in flight), never `.cancel()`.
import type { TrajectorySignal } from '$lib/trajectory'
import { plain_position_stream } from '$lib/trajectory/async-result.svelte'
import { create_worker_client } from '$lib/worker-client.svelte'
import type {
  TrajectorySpectroscopyInput,
  TrajectorySpectroscopyOptions,
  TrajectorySpectroscopyResult,
} from './trajectory-spectroscopy'
import { calc_trajectory_spectroscopy } from './trajectory-spectroscopy'

// Same field-by-field rebuild as plain_position_stream: raw typed arrays straight to
// structured clone, only the small plain parts snapshotted
const plain_signal = (signal: TrajectorySignal): TrajectorySignal => ({
  values: signal.values,
  sample_shape: $state.snapshot(signal.sample_shape),
  steps: $state.snapshot(signal.steps),
  ...(signal.unit ? { unit: signal.unit } : {}),
})

export const compute_trajectory_spectroscopy_async = create_worker_client<
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
    const { infrared_signal, raman_signal } = input
    return {
      positions: plain_position_stream(input.positions),
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
