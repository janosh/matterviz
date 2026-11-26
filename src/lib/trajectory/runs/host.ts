// Run whose frames live with an embedding host (the VS Code extension process): the host
// indexed the file, sent a summary, and answers one frame per request (several pipelined,
// each a round trip away over Remote SSH, see host_read_concurrency). Progressive plot
// rows arrive through `properties.deliver()` and the host's new warnings through
// `receive_warnings()`, both from whoever owns the host channel.
import { encode_frame, select_frame_channels } from '../frame'
import type { FrameChannels, NumericFrame } from '../frame'
import { to_error } from 'svelte-widgets/utils'
import type { TrajectoryRun, TrajectoryRunSummary } from '../run'
import { assert_frame_idx, disposed_error, run_fields_from_summary } from '../run'
import { mirror_warning_collector } from '../parse/shared'
import type { DisplayFrame, FramePreparation } from '../prepare'

// Unanswered frame requests a host run keeps in flight: enough to cover a long round trip
// (over Remote SSH a frame is ~180 ms away, so 8 in flight cap playback at ~44 fps), bounded by
// ~4 MB of playback frames (~16 B per atom: 16-bit xyz and one vector, plus its element) since
// a seek waits behind every request already sent, as a host can't drop one
const IN_FLIGHT_BYTES = 4_000_000
const PLAYBACK_BYTES_PER_ATOM = 16
export const host_read_concurrency = (atom_count: number): number =>
  Math.min(
    64,
    Math.max(8, Math.round(IN_FLIGHT_BYTES / (PLAYBACK_BYTES_PER_ATOM * atom_count))),
  )

export type HostRun = TrajectoryRun & {
  receive_warnings: (warnings: readonly string[]) => void
}

// What a frame to prepare starts as: the host's reply, still encoded, or a frame decoded here
// (frame 0, from the summary)
export type HostFrameInput<Reply> = { reply: Reply } | { frame: NumericFrame }
// Display preparation off the main thread (see prepare-pool.ts): `request` asks the host for a
// frame without decoding it, and `prepare` decodes and prepares it in a worker. Without it the
// scene prepares frames itself.
export interface HostPreparation<Reply> {
  request: (
    frame_idx: number,
    signal?: AbortSignal,
    channels?: FrameChannels,
  ) => Promise<Reply>
  prepare: (
    input: HostFrameInput<Reply>,
    preparation: FramePreparation,
    signal?: AbortSignal,
  ) => Promise<DisplayFrame>
}

export const host_run = <Reply>(
  summary: TrajectoryRunSummary,
  request_frame: (
    frame_idx: number,
    signal?: AbortSignal,
    channels?: FrameChannels,
  ) => Promise<NumericFrame>,
  release: () => void = () => {},
  preparation?: HostPreparation<Reply>,
): HostRun => {
  const fields = run_fields_from_summary(summary)
  const warnings = mirror_warning_collector(summary.warnings)
  let disposed = false
  // why a read can't start, if it can't
  const blocked = (frame_idx: number, signal?: AbortSignal): Error | undefined => {
    assert_frame_idx(summary, frame_idx)
    if (disposed) return disposed_error(`Host-served trajectory`)
    if (signal?.aborted) return to_error(signal.reason)
    return undefined
  }
  // frame 0 is the summary's preview, unless that is only a render sample of it
  const local_frame = (frame_idx: number): NumericFrame | undefined =>
    frame_idx === 0 && !summary.preview.metadata?.render_sample
      ? encode_frame(summary.preview)
      : undefined
  const read_frame: HostRun[`read_frame`] = (frame_idx, signal, channels) => {
    const error = blocked(frame_idx, signal)
    if (error) return Promise.reject(error)
    const local = local_frame(frame_idx)
    if (local) return select_frame_channels(local, channels)
    // a host may send more channels than asked for
    return request_frame(frame_idx, signal, channels).then((frame) =>
      select_frame_channels(frame, channels),
    )
  }
  return {
    ...fields,
    // Keep the snapshot unproxied when Svelte binds the run to reactive state.
    get preview() {
      return summary.preview
    },
    provenance: { ...summary.provenance, format: summary.provenance.format ?? `host` },
    read_concurrency: host_read_concurrency(summary.atom_count),
    rounds_display_frames: true,
    subscribe_warnings: warnings.subscribe,
    receive_warnings: warnings.receive,
    read_frame,
    ...(preparation && {
      // Every input is fresh (a host reply, or frame 0 encoded from the summary for this
      // call), so the preparation may take its buffers. Channels are selected where it decodes.
      prepare_frame: async (frame_idx, settings, signal) => {
        const error = blocked(frame_idx, signal)
        if (error) throw error
        const frame = local_frame(frame_idx)
        const input: HostFrameInput<Reply> = frame
          ? { frame }
          : { reply: await preparation.request(frame_idx, signal, settings.channels) }
        signal?.throwIfAborted()
        return preparation.prepare(input, settings, signal)
      },
    }),
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
