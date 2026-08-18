// oxlint-disable eslint-plugin-unicorn/relative-url-style -- Vite worker detection needs the `./` prefix
import { create_worker_client } from '$lib/worker-client.svelte'
import type { TrajectorySignal } from '$lib/trajectory'
import {
  calc_trajectory_spectroscopy,
  type FieldAxisSignals,
  type InfraredSignal,
  type RamanSignal,
  type TrajectorySpectroscopyInput,
  type TrajectorySpectroscopyOptions,
  type TrajectorySpectroscopyResult,
} from './trajectory-spectroscopy'

const copy_signal = (signal: TrajectorySignal): TrajectorySignal => ({
  values: signal.values,
  sample_shape: $state.snapshot(signal.sample_shape),
  steps: $state.snapshot(signal.steps),
  unit: signal.unit,
})

const copy_axis_signals = (signals: FieldAxisSignals): FieldAxisSignals => ({
  x: copy_signal(signals.x),
  y: copy_signal(signals.y),
  z: copy_signal(signals.z),
})

const copy_infrared = (signal: InfraredSignal | null | undefined): InfraredSignal | null => {
  if (!signal) return null
  return { ...signal, series: copy_signal(signal.series) }
}

const copy_raman = (signal: RamanSignal | null | undefined): RamanSignal | null => {
  if (!signal) return null
  if (signal.kind === `polarizability`) {
    return { ...signal, series: copy_signal(signal.series) }
  }
  return {
    ...signal,
    plus: copy_axis_signals(signal.plus),
    minus: copy_axis_signals(signal.minus),
    geometry: {
      plus: copy_axis_signals(signal.geometry.plus),
      minus: copy_axis_signals(signal.geometry.minus),
    },
  }
}

export interface TrajectorySpectroscopyAsyncRunner {
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
      build_payload: (input) => ({
        positions: {
          positions: input.positions.positions,
          n_frames: input.positions.n_frames,
          n_atoms: input.positions.n_atoms,
          elements: $state.snapshot(input.positions.elements),
          lattice_matrices: $state.snapshot(input.positions.lattice_matrices),
          pbc: $state.snapshot(input.positions.pbc),
          coords_unwrapped: input.positions.coords_unwrapped,
          frame_stride: input.positions.frame_stride,
          steps: $state.snapshot(input.positions.steps),
        },
        masses: input.masses,
        velocities: input.velocities ? copy_signal(input.velocities) : null,
        infrared_signal: copy_infrared(input.infrared_signal),
        raman_signal: copy_raman(input.raman_signal),
        time_step: input.time_step,
        time_unit: input.time_unit,
        metadata: $state.snapshot(input.metadata),
      }),
    })
    return {
      compute: (input, options = {}) => client(input, options),
      cancel: client.cancel,
    }
  }

const shared_runner = create_trajectory_spectroscopy_async_runner()

export const compute_trajectory_spectroscopy_async = (
  input: TrajectorySpectroscopyInput,
  options: TrajectorySpectroscopyOptions = {},
): Promise<TrajectorySpectroscopyResult> => shared_runner.compute(input, options)
