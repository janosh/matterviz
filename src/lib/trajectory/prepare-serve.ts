// Worker side of prepare-pool.ts: decodes each input it is sent into a frame, prepares it and
// moves the DisplayFrame back. Its FramePreparer keeps bond-search scratch warm between frames.
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin
import { to_error } from 'svelte-widgets/utils'
import type { NumericFrame } from './frame'
import type { FramePreparation } from './prepare'
import { FramePreparer, display_frame_transfers } from './prepare'
import type { PrepareReply, PrepareRequest } from './prepare-pool'

// The callback's own parameter type drives Input, so it is not unnecessary despite appearing once
// oxlint-disable-next-line typescript-eslint/no-unnecessary-type-parameters
export const serve_preparation = <Input>(
  to_frame: (input: Input, preparation: FramePreparation) => NumericFrame,
): void => {
  const preparer = new FramePreparer()
  self.addEventListener(`message`, ({ data }: MessageEvent<PrepareRequest<Input>>) => {
    const { id: identifier, input, preparation } = data
    const started_at = performance.now()
    try {
      const display = preparer.prepare(to_frame(input, preparation), preparation)
      const reply: PrepareReply = {
        id: identifier,
        display,
        prepare_ms: performance.now() - started_at,
      }
      self.postMessage(reply, { transfer: display_frame_transfers(display) })
    } catch (error) {
      self.postMessage({
        id: identifier,
        error: to_error(error).message,
      } satisfies PrepareReply)
    }
  })
}
