// Run whose frames live with an embedding host (the VS Code extension process): the host
// indexed the file, sent a summary, and answers one frame per request. Progressive plot
// rows arrive through `properties.push()` from whoever owns the host channel.
import type { TrajectoryFrame } from '../index'
import {
  assert_frame_idx,
  disposed_error,
  run_fields_from_summary,
  type TrajectoryRun,
  type TrajectoryRunSummary,
} from '../run'

export const host_run = (
  summary: TrajectoryRunSummary,
  request_frame: (frame_idx: number, signal?: AbortSignal) => Promise<TrajectoryFrame>,
  release: () => void = () => {},
): TrajectoryRun => {
  const fields = run_fields_from_summary(summary)
  let disposed = false
  return {
    ...fields,
    provenance: { ...summary.provenance, format: summary.provenance.format ?? `host` },
    read_frame: (frame_idx, signal) => {
      assert_frame_idx(summary, frame_idx)
      if (frame_idx === 0) return summary.preview
      if (disposed) return Promise.reject(disposed_error(`Host-served trajectory`))
      return request_frame(frame_idx, signal)
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      fields.properties.finish()
      release()
    },
  }
}
