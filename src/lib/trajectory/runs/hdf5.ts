// Run over an open h5wasm file (TorchSim / Reference MD layouts). The parser hands over a
// LazyTrajectorySource whose `dispose` closes the handle; this wraps it in the run contract.
import { with_stream_progress } from '../parse/h5-utils'
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
    read_atoms: source.read_atoms,
    atom_count: source.atom_count,
    preview: source.preview,
    provenance: { ...provenance, format: source.format },
    properties: new TrajectoryProperties(source.properties, true),
    time_step,
    atom_masses,
    signals,
    metadata,
    warnings,
    // Sync hyperslab reads, in 8 MB slices that each report progress (in a worker, its
    // messages reach the page while the reads run)
    collect_positions: async ({ on_progress, signal, ...options }) => {
      signal?.throwIfAborted()
      const report = (current: number) =>
        on_progress?.({ current, total: 100, stage: `Reading HDF5 datasets` })
      return with_stream_progress(report, () => source.collect_positions(options))
    },
    release: source.dispose,
  })
}
