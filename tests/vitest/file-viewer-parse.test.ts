import { parse_file_content } from '$lib/file-viewer/parse'
import type { TrajectoryRun } from '$lib/trajectory'
import { trajectory_from_frames } from '$lib/trajectory/open'
import { summarize_run } from '$lib/trajectory/run'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { make_crystal } from './setup'

test(`parses a POSCAR structure through the worker-safe entry`, async () => {
  const poscar = `Si2\n1.0\n5.43 0 0\n0 5.43 0\n0 0 5.43\nSi\n2\ndirect\n0 0 0 Si\n0.25 0.25 0.25 Si\n`
  const result = await parse_file_content(poscar, `POSCAR`)

  expect(result.type).toBe(`structure`)
  expect((result.data as { sites: unknown[] }).sites).toHaveLength(2)
})

test(`multi-frame XYZ text opens as a trajectory run`, async () => {
  const h2 = (step: number, dz: number): string => `2\nstep=${step}\nH 0 0 0\nH 0 0 ${dz}`
  const result = await parse_file_content(`${h2(0, 0.74)}\n${h2(1, 0.78)}`, `h2.xyz`)
  expect(result.type).toBe(`trajectory`)
  const run = result.data as TrajectoryRun
  expect(run.frame_count).toBe(2)
  expect(run.provenance).toMatchObject({ filename: `h2.xyz`, format: `xyz` })
  expect((await run.read_frame(1)).step).toBe(1)
  run.dispose()
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
  const backing = trajectory_from_frames(
    [0, 1, 2].map((step) => ({
      step,
      structure: make_crystal(5, [[`H`, [0, 0, step / 10]]]),
    })),
    { provenance: { filename: `movie.extxyz`, format: `xyz` } },
  )

  // post_request listens on globalThis, a real EventTarget in the webview but
  // not in vitest's node environment.
  const with_host = (
    respond: (request: Record<string, unknown>) => Record<string, unknown>,
  ): { post_message: ReturnType<typeof vi.fn>; message_bus: EventTarget } => {
    const message_bus = new EventTarget()
    vi.stubGlobal(`addEventListener`, message_bus.addEventListener.bind(message_bus))
    vi.stubGlobal(`removeEventListener`, message_bus.removeEventListener.bind(message_bus))
    const post_message = vi.fn((request: Record<string, unknown>) => {
      queueMicrotask(() =>
        message_bus.dispatchEvent(new MessageEvent(`message`, { data: respond(request) })),
      )
    })
    vi.stubGlobal(`acquireVsCodeApi`, () => ({ postMessage: post_message }))
    return { post_message, message_bus }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  test(`asks the host for the file and serves frames and plot rows from it`, async () => {
    // The host keeps the indexed run and hands over only its summary; plot rows follow
    const summary = { ...summarize_run(backing), properties: { rows: [], complete: false } }
    const { post_message, message_bus } = with_host((request) =>
      request.command === `request_frame`
        ? {
            command: `frame_response`,
            request_id: request.request_id,
            frame: backing.read_frame(Number(request.frame_index)),
          }
        : {
            command: `large_file_response`,
            request_id: request.request_id,
            run_summary: summary,
          },
    )
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
    const run = result.data as TrajectoryRun
    expect(run.frame_count).toBe(3)
    expect(run.provenance).toMatchObject({ filename: `movie.extxyz`, format: `xyz` })
    expect(run.read_frame(0)).toBe(run.preview)

    // Frames past the preview are fetched from the host one request at a time
    const frame = await run.read_frame(2)
    expect(post_message).toHaveBeenLastCalledWith({
      command: `request_frame`,
      request_id: expect.any(String),
      file_path: `/data/movie.extxyz`,
      filename: `movie.extxyz`,
      frame_index: 2,
    })
    expect(frame.step).toBe(2)
    expect(frame.structure.sites[0].xyz[2]).toBeCloseTo(1, 12)

    // Plot rows stream in after the summary, keyed by the host file path
    expect(run.properties.complete).toBe(false)
    const rows = [...backing.properties.rows]
    for (const [batch, complete, file_path] of [
      [rows.slice(0, 2), false, `/data/movie.extxyz`],
      [rows.slice(2), true, `/data/other.extxyz`], // another file's rows must not leak in
      [rows.slice(2), true, `/data/movie.extxyz`],
    ] as const) {
      message_bus.dispatchEvent(
        new MessageEvent(`message`, {
          data: { command: `plot_metadata_stream`, file_path, rows: batch, complete },
        }),
      )
    }
    await run.properties.done
    expect(run.properties.rows.map((row) => row.frame_number)).toEqual([0, 1, 2])
    run.dispose()
    await expect(Promise.resolve().then(() => run.read_frame(1))).rejects.toThrow(/disposed/)
  })

  test(`surfaces a host-side error for the file`, async () => {
    with_host((request) => ({
      command: `large_file_response`,
      request_id: request.request_id,
      error: `indexer crashed`,
    }))
    const { parse_file_content: parse } = await import(`$lib/file-viewer/parse`)
    await expect(parse(marker, `movie.extxyz`)).rejects.toThrow(`indexer crashed`)
  })

  test(`says so plainly when no host is listening`, async () => {
    const { parse_file_content: parse } = await import(`$lib/file-viewer/parse`)
    await expect(parse(marker, `movie.extxyz`)).rejects.toThrow(/no host bridge is available/)
  })

  test(`refuses formats the host cannot index`, async () => {
    const { post_message } = with_host(() => ({}))
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
