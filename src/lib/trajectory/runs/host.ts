import { encode_frame, select_frame_channels } from '../frame'
// Run whose frames live with an embedding host (the VS Code extension process): the host
// indexed the file, sent a summary, and answers one frame per request. Progressive plot
// rows arrive through `properties.push()` from whoever owns the host channel.
import type { TrajectoryFrame } from '../index'
import { to_error } from '$lib/utils'
import type { TrajectoryRun, TrajectoryRunSummary } from '../run'
import { assert_frame_idx, disposed_error, run_fields_from_summary } from '../run'

export const host_run = (
  summary: TrajectoryRunSummary,
  request_frame: (frame_idx: number, signal?: AbortSignal) => Promise<TrajectoryFrame>,
  release: () => void = () => {},
): TrajectoryRun => {
  const fields = run_fields_from_summary(summary)
  let disposed = false
  return {
    ...fields,
    // Keep the snapshot unproxied when Svelte binds the run to reactive state.
    get preview() {
      return summary.preview
    },
    provenance: { ...summary.provenance, format: summary.provenance.format ?? `host` },
    read_frame: (frame_idx, signal, channels) => {
      assert_frame_idx(summary, frame_idx)
      if (disposed) return Promise.reject(disposed_error(`Host-served trajectory`))
      if (signal?.aborted) return Promise.reject(to_error(signal.reason))
      if (frame_idx === 0 && !summary.preview.metadata?.render_sample)
        return select_frame_channels(encode_frame(summary.preview), channels)
      return request_frame(frame_idx, signal).then((frame) =>
        select_frame_channels(encode_frame(frame), channels),
      )
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      try {
        fields.properties.finish()
      } finally {
        release()
      }
    },
  }
}
