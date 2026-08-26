// The public parse-only entry stays worker-safe.
import { expect, test } from 'vitest'
import { expect_worker_safe_import_graph } from '../setup'

test(`worker-safe file-viewer entry graphs stay free of Svelte`, () => {
  expect.hasAssertions()
  expect_worker_safe_import_graph(
    [
      `src/lib/file-viewer/parse.ts`,
      `src/lib/file-viewer/eligibility.ts`,
      `src/lib/file-viewer/host-transfer.ts`,
      // These load inside a Worker, where `document` does not exist.
      `src/lib/file-viewer/parse-worker.ts`,
      `src/lib/file-viewer/parse-worker-protocol.ts`,
    ],
    10,
  )
})
