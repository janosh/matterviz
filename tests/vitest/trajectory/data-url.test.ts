// Regression tests for loading trajectories via the data_url prop
// (https://github.com/janosh/matterviz/issues/353): blob: object URLs from
// URL.createObjectURL have extensionless UUID basenames, so format detection
// must fall back to content sniffing instead of failing with
// "Unsupported text format".
import type { TrajHandlerData } from '$lib/trajectory'
import Trajectory from '$lib/trajectory/Trajectory.svelte'
import { mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { MULTI_FRAME_XYZ } from '../setup'

const BLOB_URL = `blob:http://localhost:5173/8a3bf2c4-d1e2-4f5a-9b8c-7d6e5f4a3b2c`
const BLOB_FILENAME = BLOB_URL.split(`/`).at(-1) ?? BLOB_URL

// Fresh response per fetch call since load_from_url may fetch twice (magic-byte
// sniff via Range request, then full body)
const mock_fetch_text = (content: string, headers = new Headers()) =>
  vi.fn().mockImplementation(() =>
    Promise.resolve({
      ok: true,
      headers,
      text: () => Promise.resolve(content),
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(content).buffer),
    }),
  )

const mounted: ReturnType<typeof mount>[] = []
afterEach(() => {
  for (const app of mounted.splice(0)) void unmount(app)
})

// Mount a viewer on `data_url` and hand back the object the handlers write into
const mount_traj = (data_url: string) => {
  const result: { load?: TrajHandlerData; error?: TrajHandlerData } = {}
  mounted.push(
    mount(Trajectory, {
      target: document.body,
      props: {
        data_url,
        display_mode: `structure`,
        show_controls: `never`,
        on_file_load: (data: TrajHandlerData) => (result.load = data),
        on_error: (data: TrajHandlerData) => (result.error = data),
      },
    }),
  )
  return result
}

describe(`Trajectory data_url loading`, () => {
  test(`loads multi-frame XYZ from blob: URL with UUID basename`, async () => {
    globalThis.fetch = mock_fetch_text(MULTI_FRAME_XYZ)
    const result = mount_traj(BLOB_URL)

    await vi.waitFor(() => expect(result.load).toBeDefined())
    expect(result.error).toBeUndefined()
    expect(result.load?.frame_count).toBe(2)
    expect(result.load?.filename).toBe(BLOB_FILENAME)
    expect(result.load?.source_filename).toBe(BLOB_FILENAME)
    expect(result.load?.source_url).toBe(BLOB_URL)
    expect(result.load?.trajectory?.metadata?.source_format).toBe(`xyz_trajectory`)
  })

  // oxfmt-ignore
  test.each([
    [`blob URL`, BLOB_URL, new Headers(), BLOB_FILENAME],
    [`compressed URL`, `https://example.com/bad.xyz.gz`,
      new Headers({ 'content-encoding': `gzip` }), `bad.xyz.gz`],
  ] as const)(
    `reports source identity for unparsable $label content`,
    async (_label, data_url, headers, source_filename) => {
      globalThis.fetch = mock_fetch_text(`not a trajectory in any format`, headers)
      const result = mount_traj(data_url)

      await vi.waitFor(() => expect(result.error).toBeDefined())
      expect(result.load).toBeUndefined()
      expect(result.error).toMatchObject({ source_filename, source_url: data_url })
    },
  )
})
