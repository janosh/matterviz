// Preparation worker for host-served frames (see prepare-pool.ts): decodes the host's wire
// reply here rather than on the main thread, then prepares it for display
import { select_frame_channels } from '#lib/trajectory/frame.js'
import { serve_preparation } from '#lib/trajectory/prepare-serve.js'
import type { HostPrepareInput } from './host-bridge'
import { frame_from_wire } from './host-protocol'

serve_preparation((input: HostPrepareInput, { channels }) =>
  // a host may send more channels than asked for
  select_frame_channels(
    `reply` in input ? frame_from_wire(input.reply, input.preview_sites) : input.frame,
    channels,
  ),
)
