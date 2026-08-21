// Run over an open h5wasm file (TorchSim / Reference MD layouts). The parser hands over a
// LazyTrajectorySource whose `dispose` closes the handle; this wraps it in the run contract.
import type { LazyTrajectorySource } from '../parse/shared'
import {
  assert_frame_idx,
  disposed_error,
  time_step_of,
  TrajectoryProperties,
  type TrajectoryProvenance,
  type TrajectoryRun,
} from '../run'

export const hdf5_run = (
  source: LazyTrajectorySource,
  provenance: TrajectoryProvenance,
  warnings: readonly string[],
): TrajectoryRun => {
  const { frame_count, atom_masses, signal_descriptors, metadata } = source
  if (frame_count < 1) throw new Error(`HDF5 trajectory has no frames`)
  const preview = source.read_frame(0)
  const time_step = time_step_of(source.time_step, source.time_unit)
  let disposed = false
  const live = (): LazyTrajectorySource => {
    if (disposed) throw disposed_error(`HDF5 trajectory`)
    return source
  }
  return {
    frame_count,
    preview,
    provenance: { ...provenance, format: source.format },
    properties: new TrajectoryProperties(source.properties, true),
    ...(time_step ? { time_step } : {}),
    ...(atom_masses ? { atom_masses } : {}),
    ...(signal_descriptors ? { signal_descriptors } : {}),
    metadata,
    warnings,
    read_frame: (frame_idx) => {
      assert_frame_idx({ frame_count }, frame_idx)
      return frame_idx === 0 ? preview : live().read_frame(frame_idx)
    },
    collect_positions: async (options, on_progress, signal) => {
      signal?.throwIfAborted()
      on_progress?.({ current: 0, total: 100, stage: `Reading HDF5 datasets` })
      return live().collect_positions(options ?? {})
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      source.dispose?.()
    },
  }
}
