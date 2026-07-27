import { parse_file_content } from '$lib/file-viewer/parse'
import { afterEach, describe, expect, test, vi } from 'vitest'

test(`parses a POSCAR structure through the worker-safe entry`, async () => {
  const poscar = `Si2\n1.0\n5.43 0 0\n0 5.43 0\n0 0 5.43\nSi\n2\ndirect\n0 0 0 Si\n0.25 0.25 0.25 Si\n`
  const result = await parse_file_content(poscar, `POSCAR`)

  expect(result.type).toBe(`structure`)
  expect((result.data as { sites: unknown[] }).sites).toHaveLength(2)
})

test.each([`xz`, `bz2`] as const)(
  `rejects unsupported %s compression with an extraction hint`,
  async (format) => {
    await expect(
      parse_file_content(btoa(`content`), `data.json.${format}`, true),
    ).rejects.toThrow(`${format.toUpperCase()} decompression is not supported`)
  },
)

test(`rejects nested compression before parsing the inner payload`, async () => {
  await expect(parse_file_content(btoa(`content`), `movie.xyz.gz.gz`, true)).rejects.toThrow(
    `Nested compression is not supported`,
  )
})

// A file past the host's inline limit arrives as a marker instead of its bytes.
// Handling it here (rather than in the host entry point, as it used to be) is
// what lets callers that parse through this module — notably Hive's worker
// wrapper — reach the host's streaming bridge at all. Before this, a marker fell
// through to the structure parser and died with "XYZ frame too short".
describe(`LARGE_FILE markers`, () => {
  const marker = `LARGE_FILE:/data/movie.extxyz:268435456`

  // post_request listens on globalThis, a real EventTarget in the webview but
  // not in vitest's node environment.
  const with_host = (
    respond: (request: Record<string, unknown>) => Record<string, unknown>,
  ): ReturnType<typeof vi.fn> => {
    const message_bus = new EventTarget()
    vi.stubGlobal(`addEventListener`, message_bus.addEventListener.bind(message_bus))
    vi.stubGlobal(`removeEventListener`, message_bus.removeEventListener.bind(message_bus))
    const post_message = vi.fn((request: Record<string, unknown>) => {
      queueMicrotask(() =>
        message_bus.dispatchEvent(new MessageEvent(`message`, { data: respond(request) })),
      )
    })
    vi.stubGlobal(`acquireVsCodeApi`, () => ({ postMessage: post_message }))
    return post_message
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  test(`asks the host for the file and reports where it is streaming from`, async () => {
    const streamed = { frames: [], metadata: { source_format: `xyz_trajectory` } }
    const post_message = with_host((request) => ({
      command: `large_file_response`,
      request_id: request.request_id,
      parsed_trajectory: streamed,
    }))
    // The bridge caches the host handle at import, so take a fresh copy of both
    // modules after acquireVsCodeApi is in place.
    const { parse_file_content: parse } = await import(`$lib/file-viewer/parse`)

    const result = await parse(marker, `movie.extxyz`)

    expect(post_message).toHaveBeenCalledWith({
      command: `request_large_file`,
      request_id: expect.any(String),
      file_path: `/data/movie.extxyz`,
      // The host picks its per-format indexer from the name.
      filename: `movie.extxyz`,
    })
    expect(result.type).toBe(`trajectory`)
    expect(result.data).toEqual(streamed)
    // create_display turns this into the frame loader; without it the viewer
    // shows only the preview frames and cannot seek.
    expect(result.streaming_info).toEqual({ file_path: `/data/movie.extxyz` })
  })

  test(`says so plainly when no host is listening`, async () => {
    const { parse_file_content: parse } = await import(`$lib/file-viewer/parse`)
    await expect(parse(marker, `movie.extxyz`)).rejects.toThrow(/no host bridge is available/)
  })

  test(`refuses formats the host cannot index`, async () => {
    const post_message = with_host(() => ({}))
    const { parse_file_content: parse } = await import(`$lib/file-viewer/parse`)

    await expect(
      parse(`LARGE_FILE:/data/charge.cube:268435456`, `charge.cube`),
    ).rejects.toThrow(`only supported for indexed trajectories`)
    expect(post_message).not.toHaveBeenCalled()
  })

  test(`a malformed marker fails instead of parsing as file content`, async () => {
    await expect(
      parse_file_content(`LARGE_FILE:/data/movie.extxyz:not-a-number`, `movie.extxyz`),
    ).rejects.toThrow(`Malformed large file marker`)
  })
})
