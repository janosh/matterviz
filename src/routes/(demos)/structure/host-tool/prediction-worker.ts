// Worker postMessage has no Window targetOrigin.
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin
import { predict_demo } from './demo'
import type { AnyStructure } from '$lib/structure'

self.addEventListener(
  `message`,
  ({ data }: MessageEvent<{ structure: AnyStructure; delay_ms: number; fail: boolean }>) => {
    setTimeout(() => {
      try {
        if (data.fail) throw new Error(`Simulated model failure; retry with failure disabled`)
        const result = predict_demo(data.structure)
        self.postMessage(
          { result },
          { transfer: result.volumes.map(({ values }) => values.buffer) },
        )
      } catch (error) {
        self.postMessage({ error: String(error) })
      }
    }, data.delay_ms)
  },
)
