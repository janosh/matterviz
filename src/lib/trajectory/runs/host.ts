// Run whose frames live with an embedding host (the VS Code extension process): the host
// indexed the file, sent a summary, and answers one frame per request. Progressive plot
// rows arrive through `properties.push()` from whoever owns the host channel.
import type { TrajectoryFrame } from '../index'
import {
  assert_frame_idx,
  disposed_error,
  TrajectoryProperties,
  type TrajectoryRun,
  type TrajectoryRunSummary,
} from '../run'

export const host_run = (
  summary: TrajectoryRunSummary,
  request_frame: (frame_idx: number, signal?: AbortSignal) => Promise<TrajectoryFrame>,
  release: () => void = () => {},
): TrajectoryRun => {
  const properties = new TrajectoryProperties(
    summary.properties.rows,
    summary.properties.complete,
  )
  let disposed = false
  return {
    frame_count: summary.frame_count,
    preview: summary.preview,
    provenance: { ...summary.provenance, format: summary.provenance.format ?? `host` },
    properties,
    ...(summary.time_step ? { time_step: summary.time_step } : {}),
    ...(summary.atom_masses ? { atom_masses: summary.atom_masses } : {}),
    ...(summary.signals ? { signals: summary.signals } : {}),
    ...(summary.signal_descriptors ? { signal_descriptors: summary.signal_descriptors } : {}),
    metadata: summary.metadata,
    warnings: summary.warnings,
    read_frame: (frame_idx, signal) => {
      assert_frame_idx(summary, frame_idx)
      if (disposed) return Promise.reject(disposed_error(`Host-served trajectory`))
      if (frame_idx === 0) return summary.preview
      return request_frame(frame_idx, signal)
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      properties.finish()
      release()
    },
  }
}
