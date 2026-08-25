// Run over an open h5wasm file (TorchSim / Reference MD layouts). The parser hands over a
// LazyTrajectorySource whose `dispose` closes the handle; this wraps it in the run contract.
import type { LazyTrajectorySource } from '../parse/shared'
import type { TrajectoryProvenance, TrajectoryRun } from '../run'
import { sync_run, TrajectoryProperties } from '../run'

export const hdf5_run = (
  source: LazyTrajectorySource,
  provenance: TrajectoryProvenance,
  warnings: readonly string[],
): TrajectoryRun => {
  const { frame_count, time_step, atom_masses, signals, metadata } = source
  return sync_run({
    label: `HDF5 trajectory`,
    frame_count,
    read: source.read_frame,
    provenance: { ...provenance, format: source.format },
    properties: new TrajectoryProperties(source.properties, true),
    time_step,
    atom_masses,
    signals,
    metadata,
    warnings,
    // Sync hyperslab reads: there is no frame loop to report progress from, so the one
    // stage announces itself and the result follows
    collect_positions: async ({ on_progress, signal, ...options }) => {
      signal?.throwIfAborted()
      on_progress?.({ current: 0, total: 100, stage: `Reading HDF5 datasets` })
      return source.collect_positions(options)
    },
    release: source.dispose,
  })
}
