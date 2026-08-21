import { create_display } from '$lib/file-viewer/main'
import type * as ParseModule from '$lib/file-viewer/parse'
import type { ParseResult } from '$lib/file-viewer/parse'
import type * as ParseWorkerModule from '$lib/file-viewer/parse-in-worker'
import { trajectory_from_frames } from '$lib/trajectory/open'
import { summarize_run } from '$lib/trajectory/run'
import type * as SvelteModule from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { make_crystal } from './setup'

const test_mocks = vi.hoisted(() => {
  const post_message = vi.fn()
  vi.stubGlobal(`acquireVsCodeApi`, () => ({ postMessage: post_message }))
  for (const key of [`cleanupMatterViz`, `initializeMatterViz`, `matterviz_data`]) {
    vi.stubGlobal(key, undefined)
  }
  // jsdom has neither Worker nor object URLs; record what main.ts's shim hands the native
  // constructor and what it turns into a blob
  const native_worker_calls: { url: string; options?: WorkerOptions }[] = []
  const object_url_blobs: Blob[] = []
  vi.stubGlobal(
    `Worker`,
    class FakeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        native_worker_calls.push({ url: String(url), options })
      }
      terminate(): void {}
    },
  )
  URL.createObjectURL = (blob: Blob) => {
    object_url_blobs.push(blob)
    return `blob:${location.origin}/mock-${object_url_blobs.length}`
  }
  URL.revokeObjectURL = vi.fn()
  return {
    native_worker_calls,
    object_url_blobs,
    mount: vi.fn((_component: unknown, _options: { props: Record<string, unknown> }) => ({})),
    parse_file_content: vi.fn(),
    parse_in_worker: vi.fn(),
    post_message,
    unmount: vi.fn(async () => {}),
  }
})

vi.mock(`$lib/file-viewer/parse`, async (import_original) => ({
  ...(await import_original<typeof ParseModule>()),
  parse_file_content: test_mocks.parse_file_content,
}))
vi.mock(`$lib/file-viewer/parse-in-worker`, async (import_original) => ({
  ...(await import_original<typeof ParseWorkerModule>()),
  parse_in_worker: test_mocks.parse_in_worker,
}))
vi.mock(`svelte`, async (import_original) => ({
  ...(await import_original<typeof SvelteModule>()),
  mount: test_mocks.mount,
  unmount: test_mocks.unmount,
}))
const { mount, parse_file_content, parse_in_worker, post_message, unmount } = test_mocks
// Captured now: afterEach's unstubAllGlobals would later drop the shimmed constructor
const ShimmedWorker = globalThis.Worker

parse_in_worker.mockImplementation((content, filename, is_base64) =>
  parse_file_content(content, filename, is_base64),
)

afterEach(async () => {
  await window.cleanupMatterViz?.()
  vi.unstubAllGlobals()
})

const result = (version: string): ParseResult => ({
  type: `json_browser`,
  data: version,
  filename: `${version}.json`,
})
const set_file_data = (content: string, filename: string = `${content}.json`): void => {
  globalThis.matterviz_data = {
    data: { content, filename, is_base64: false },
    theme: `light`,
    // host setting that must reach the parser, not just the mounted component props
    defaults: { trajectory: { index_above_bytes: 4096 } },
  }
}

const update_file = (version: string): boolean =>
  globalThis.dispatchEvent(
    new MessageEvent(`message`, {
      data: {
        command: `fileUpdated`,
        data: { content: version, filename: `${version}.json`, is_base64: false },
      },
    }),
  )

test(`serializes reloads and guards cleanup, markers, and initialization`, async () => {
  expect(create_display).toBeTypeOf(`function`)
  const stale_parse = Promise.withResolvers<ParseResult>()
  parse_file_content
    .mockResolvedValueOnce(result(`initial`))
    .mockReturnValueOnce(stale_parse.promise)
    .mockResolvedValueOnce(result(`fresh`))

  set_file_data(`initial`)
  document.body.innerHTML = `<div id="matterviz-app"></div>`
  await window.initializeMatterViz?.()
  expect(parse_in_worker).toHaveBeenCalledWith(
    `initial`,
    `initial.json`,
    false,
    expect.objectContaining({
      signal: expect.any(AbortSignal),
      load_options: { index_above_bytes: 4096 },
    }),
  )

  update_file(`stale`)
  await vi.waitFor(() => expect(parse_file_content).toHaveBeenCalledTimes(2))
  update_file(`fresh`)
  await Promise.resolve()
  expect(parse_file_content).toHaveBeenCalledTimes(2)
  stale_parse.resolve(result(`stale`))

  await vi.waitFor(() => {
    expect(parse_file_content).toHaveBeenCalledTimes(3)
    expect(mount).toHaveBeenCalledTimes(2)
  })
  expect(mount.mock.calls.map((call) => call[1].props.value)).toEqual([`initial`, `fresh`])
  expect(unmount).toHaveBeenCalledTimes(1)

  const cleanup_parse = Promise.withResolvers<ParseResult>()
  parse_file_content.mockReturnValueOnce(cleanup_parse.promise)
  update_file(`during-cleanup`)
  await vi.waitFor(() => expect(parse_file_content).toHaveBeenCalledTimes(4))

  const cleanup_unmount = Promise.withResolvers<undefined>()
  unmount.mockReturnValueOnce(cleanup_unmount.promise)
  const cleanup = window.cleanupMatterViz?.()
  await vi.waitFor(() => expect(unmount).toHaveBeenCalledTimes(2))
  update_file(`after-cleanup`)
  expect(parse_file_content).toHaveBeenCalledTimes(4)
  cleanup_unmount.resolve(undefined)
  await cleanup

  parse_file_content
    .mockResolvedValueOnce(result(`reinitialized`))
    .mockResolvedValueOnce(result(`new-session`))
  set_file_data(`reinitialized`)
  await window.initializeMatterViz?.()
  update_file(`new-session`)
  await vi.waitFor(() => {
    expect(parse_file_content).toHaveBeenCalledTimes(6)
    expect(mount).toHaveBeenCalledTimes(4)
  })
  cleanup_parse.resolve(result(`during-cleanup`))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(mount).toHaveBeenCalledTimes(4)
  await window.cleanupMatterViz?.()

  // Marker handling lives inside parse_file_content, so these two cases delegate
  // to the real implementation instead of the stub the rest of the test uses.
  const { parse_file_content: real_parse_file_content } =
    await vi.importActual<typeof ParseModule>(`$lib/file-viewer/parse`)

  parse_file_content.mockImplementationOnce(real_parse_file_content)
  set_file_data(`LARGE_FILE:/tmp/structure.cif:536870912`, `structure.cif`)
  expect(await window.initializeMatterViz?.()).toBeNull()
  expect(parse_file_content).toHaveBeenCalledTimes(7)
  expect(post_message).toHaveBeenLastCalledWith({
    command: `error`,
    text: expect.stringContaining(`only supported for indexed trajectories`),
  })

  parse_file_content.mockImplementationOnce(real_parse_file_content)
  set_file_data(`LARGE_FILE:/tmp/movie.traj:536870912`, `movie.traj`)
  const valid_marker_initialization = window.initializeMatterViz?.()
  await vi.waitFor(() =>
    expect(post_message).toHaveBeenCalledWith(
      expect.objectContaining({ command: `request_large_file` }),
    ),
  )
  const request = post_message.mock.calls.findLast(
    ([message]) => message.command === `request_large_file`,
  )?.[0] as Record<string, unknown>
  // The host picks its indexer from the name, so the request has to carry it.
  expect(request).toMatchObject({ file_path: `/tmp/movie.traj`, filename: `movie.traj` })
  // The host keeps the indexed run and answers with its summary; the webview mounts a host run
  const run_summary = summarize_run(
    trajectory_from_frames([{ step: 0, structure: make_crystal(5, [[`H`, [0, 0, 0]]]) }]),
  )
  globalThis.dispatchEvent(
    new MessageEvent(`message`, {
      data: { command: `large_file_response`, request_id: request?.request_id, run_summary },
    }),
  )
  expect(await valid_marker_initialization).not.toBeNull()
  expect(mount.mock.lastCall?.[1].props.trajectory).toMatchObject({ frame_count: 1 })

  const initialization_parse = Promise.withResolvers<ParseResult>()
  parse_file_content.mockReturnValueOnce(initialization_parse.promise)
  set_file_data(`pending-initialization`)
  const pending_initialization = window.initializeMatterViz?.()
  await vi.waitFor(() => expect(parse_file_content).toHaveBeenCalledTimes(9))
  const mount_count = mount.mock.calls.length
  await window.cleanupMatterViz?.()
  initialization_parse.resolve(result(`pending-initialization`))
  expect(await pending_initialization).toBeNull()
  expect(mount).toHaveBeenCalledTimes(mount_count)
})

test(`routes cross-origin worker scripts through a same-origin blob module`, async () => {
  const { native_worker_calls, object_url_blobs } = test_mocks
  const resource_url = `https://file+.vscode-resource.vscode-cdn.net/ext/dist/assets/parse-worker.js`
  const workers = [
    new ShimmedWorker(resource_url, { type: `module` }),
    new ShimmedWorker(new URL(resource_url), { type: `classic`, name: `msd` }),
    new ShimmedWorker(`${location.origin}/assets/same-origin.js`, { type: `module` }),
    new ShimmedWorker(`blob:${location.origin}/already-a-blob`),
  ]
  expect(workers).toHaveLength(4)
  expect(native_worker_calls).toEqual([
    { url: `blob:${location.origin}/mock-1`, options: { type: `module` } },
    // blob wrappers are module workers regardless of what the caller asked for
    { url: `blob:${location.origin}/mock-2`, options: { type: `module`, name: `msd` } },
    { url: `${location.origin}/assets/same-origin.js`, options: { type: `module` } },
    { url: `blob:${location.origin}/already-a-blob`, options: undefined },
  ])
  // A static import would be blocked by the webview CSP; only the dynamic form loads
  expect(await Promise.all(object_url_blobs.map((blob) => blob.text()))).toEqual(
    Array(2).fill(`await import(${JSON.stringify(resource_url)})`),
  )
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
})
