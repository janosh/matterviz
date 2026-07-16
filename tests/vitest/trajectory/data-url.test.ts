// Regression tests for loading trajectories via the data_url prop
// (https://github.com/janosh/matterviz/issues/353): blob: object URLs from
// URL.createObjectURL have extensionless UUID basenames, so format detection
// must fall back to content sniffing instead of failing with
// "Unsupported text format".
import type { TrajHandlerData } from '$lib/trajectory'
import Trajectory from '$lib/trajectory/Trajectory.svelte'
import { mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

const MULTI_FRAME_XYZ = `2\nStep 1\nH 0.0 0.0 0.0\nH 0.0 0.0 0.74
2\nStep 2\nH 0.0 0.0 0.0\nH 0.0 0.0 0.78`
const BLOB_URL = `blob:http://localhost:5173/8a3bf2c4-d1e2-4f5a-9b8c-7d6e5f4a3b2c`

// Fresh response per fetch call since load_from_url may fetch twice (magic-byte
// sniff via Range request, then full body)
const mock_fetch_text = (content: string) =>
  vi.fn().mockImplementation(() =>
    Promise.resolve({
      ok: true,
      headers: new Headers(),
      text: () => Promise.resolve(content),
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(content).buffer),
    }),
  )

const mounted: ReturnType<typeof mount>[] = []
afterEach(() => {
  for (const app of mounted.splice(0)) void unmount(app)
})

describe(`Trajectory data_url loading`, () => {
  test(`loads multi-frame XYZ from blob: URL with UUID basename`, async () => {
    globalThis.fetch = mock_fetch_text(MULTI_FRAME_XYZ)

    let load_data: TrajHandlerData | undefined
    let error_data: TrajHandlerData | undefined
    mounted.push(
      mount(Trajectory, {
        target: document.body,
        props: {
          data_url: BLOB_URL,
          display_mode: `structure`,
          show_controls: `never`,
          on_file_load: (data: TrajHandlerData) => (load_data = data),
          on_error: (data: TrajHandlerData) => (error_data = data),
        },
      }),
    )

    await vi.waitFor(() => expect(load_data).toBeDefined())
    expect(error_data).toBeUndefined()
    expect(load_data?.frame_count).toBe(2)
    expect(load_data?.filename).toBe(`8a3bf2c4-d1e2-4f5a-9b8c-7d6e5f4a3b2c`)
    expect(load_data?.source_filename).toBe(`8a3bf2c4-d1e2-4f5a-9b8c-7d6e5f4a3b2c`)
    expect(load_data?.source_url).toBe(BLOB_URL)
    expect(load_data?.trajectory?.metadata?.source_format).toBe(`xyz_trajectory`)
  })

  test(`still reports error for unparsable blob: URL content`, async () => {
    globalThis.fetch = mock_fetch_text(`not a trajectory in any format`)

    let load_data: TrajHandlerData | undefined
    let error_data: TrajHandlerData | undefined
    mounted.push(
      mount(Trajectory, {
        target: document.body,
        props: {
          data_url: BLOB_URL,
          display_mode: `structure`,
          show_controls: `never`,
          on_file_load: (data: TrajHandlerData) => (load_data = data),
          on_error: (data: TrajHandlerData) => (error_data = data),
        },
      }),
    )

    await vi.waitFor(() => expect(error_data).toBeDefined())
    expect(load_data).toBeUndefined()
  })
})
