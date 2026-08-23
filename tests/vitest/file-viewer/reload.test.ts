import { create_display } from '$lib/file-viewer/main'
import type * as ParseModule from '$lib/file-viewer/parse'
import type { ParseResult } from '$lib/file-viewer/parse'
import type * as ParseWorkerModule from '$lib/file-viewer/parse-in-worker'
import type { TrajectoryRun } from '$lib/trajectory'
import type * as SvelteModule from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

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
// Captured now: afterEach's unstubAllGlobals would later drop the shimmed constructor and
// restore the pre-import (undefined) stubs of the bootstrap functions main.ts installed
const ShimmedWorker = globalThis.Worker
const { initializeMatterViz: initialize_matterviz, cleanupMatterViz: cleanup_matterviz } =
  window

parse_in_worker.mockImplementation((content, filename, is_base64) =>
  parse_file_content(content, filename, is_base64),
)

afterEach(async () => {
  await cleanup_matterviz?.()
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
// `defaults` omitted entirely when undefined: models a host that only pushes the theme
const post_settings = (theme: string, defaults?: unknown): boolean =>
  globalThis.dispatchEvent(
    new MessageEvent(`message`, {
      data: { command: `settingsChanged`, theme, ...(defaults !== undefined && { defaults }) },
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

  // A parse failure is reported to the host (marker handling itself is covered in
  // file-viewer/main.test.ts; delegate to the real parser for this one case)
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

  const initialization_parse = Promise.withResolvers<ParseResult>()
  parse_file_content.mockReturnValueOnce(initialization_parse.promise)
  set_file_data(`pending-initialization`)
  const pending_initialization = window.initializeMatterViz?.()
  await vi.waitFor(() => expect(parse_file_content).toHaveBeenCalledTimes(8))
  const mount_count = mount.mock.calls.length
  await window.cleanupMatterViz?.()
  initialization_parse.resolve(result(`pending-initialization`))
  expect(await pending_initialization).toBeNull()
  expect(mount).toHaveBeenCalledTimes(mount_count)
})

// A host theme/settings change must not re-read or re-parse the file (the host may have
// rendered an unsaved editor buffer): theme is applied to the DOM, changed defaults remount
// the already-parsed result, unchanged defaults are a no-op
test(`settingsChanged re-applies theme and remounts the parsed result without re-parsing`, async () => {
  for (const mock of [mount, unmount, parse_file_content]) mock.mockClear()
  parse_file_content.mockResolvedValueOnce(result(`settings`))
  set_file_data(`settings`)
  document.body.innerHTML = `<div id="matterviz-app"></div>`
  await initialize_matterviz?.()
  expect(mount).toHaveBeenCalledTimes(1)

  post_settings(`dark`, { trajectory: { index_above_bytes: 4096 } })
  await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe(`dark`))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(unmount).not.toHaveBeenCalled()

  post_settings(`light`, { structure: { atom_radius: 0.3 } })
  await vi.waitFor(() => expect(unmount).toHaveBeenCalledTimes(1))
  await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(2))
  expect(document.documentElement.dataset.theme).toBe(`light`)
  expect(mount.mock.lastCall?.[1].props).toMatchObject({
    value: `settings`,
    defaults: expect.objectContaining({
      structure: expect.objectContaining({ atom_radius: 0.3 }),
    }),
  })
  expect(parse_file_content).toHaveBeenCalledTimes(1)

  // A theme-only push (no defaults field) re-applies the theme, records it for re-init, and
  // neither remounts nor resets the stored defaults
  post_settings(`dark`)
  await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe(`dark`))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(unmount).toHaveBeenCalledTimes(1)
  expect(mount).toHaveBeenCalledTimes(2)
  expect(globalThis.matterviz_data).toMatchObject({
    theme: `dark`,
    defaults: { structure: { atom_radius: 0.3 } },
  })
})

// The run behind a trajectory display holds a worker/port or host listener: a defaults
// remount must hand it to the new app, and a lifecycle that ends (or a mount that fails)
// mid-remount must dispose it exactly once
test(`settingsChanged remount keeps the trajectory run alive and never leaks it`, async () => {
  for (const mock of [mount, unmount, parse_file_content, post_message]) mock.mockClear()
  document.body.innerHTML = `<div id="matterviz-app"></div>`
  const make_run = (): TrajectoryRun =>
    ({ dispose: vi.fn(), frame_count: 3, metadata: {} }) as unknown as TrajectoryRun
  const init_run = async (name: string): Promise<TrajectoryRun> => {
    const run = make_run()
    parse_file_content.mockResolvedValueOnce({ type: `trajectory`, data: run, filename: name })
    set_file_data(name, `${name}.traj`)
    await initialize_matterviz?.()
    return run
  }
  const changed_defaults = { structure: { atom_radius: 0.3 } }

  // The run survives the remount, is re-registered to the new app, and cleanup disposes it once
  const run_a = await init_run(`run-a`)
  expect(mount).toHaveBeenCalledTimes(1)
  post_settings(`light`, changed_defaults)
  await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(2))
  expect(unmount).toHaveBeenCalledTimes(1)
  expect(run_a.dispose).not.toHaveBeenCalled()
  expect(mount.mock.lastCall?.[1].props.trajectory).toBe(run_a)
  await cleanup_matterviz?.()
  expect(unmount).toHaveBeenCalledTimes(2)
  expect(run_a.dispose).toHaveBeenCalledTimes(1)

  // Cleanup while the remount's unmount is pending: the detached run is disposed exactly once
  // and nothing remounts
  const run_b = await init_run(`run-b`)
  const pending_unmount = Promise.withResolvers<undefined>()
  unmount.mockReturnValueOnce(pending_unmount.promise)
  post_settings(`light`, changed_defaults)
  await vi.waitFor(() => expect(unmount).toHaveBeenCalledTimes(3))
  const mount_count = mount.mock.calls.length
  await cleanup_matterviz?.()
  expect(run_b.dispose).not.toHaveBeenCalled()
  pending_unmount.resolve(undefined)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(run_b.dispose).toHaveBeenCalledTimes(1)
  expect(mount).toHaveBeenCalledTimes(mount_count)

  // create_display throwing mid-remount disposes the detached run and reports the error
  const run_c = await init_run(`run-c`)
  mount.mockImplementationOnce(() => {
    throw new Error(`mount failed`)
  })
  post_settings(`light`, changed_defaults)
  await vi.waitFor(() => expect(run_c.dispose).toHaveBeenCalledTimes(1))
  expect(post_message).toHaveBeenLastCalledWith({
    command: `error`,
    text: expect.stringContaining(`mount failed`),
  })
})

// A failed bootstrap display (the parse threw, the error display is on screen) used to be
// retried by the host rebuilding the webview HTML on every config change; settingsChanged must
// re-attempt the display from the bootstrap payload the same way instead of bailing because
// there is nothing to remount
test(`settingsChanged re-attempts a failed initial display from the bootstrap payload`, async () => {
  for (const mock of [mount, unmount, parse_file_content, post_message]) mock.mockClear()
  document.body.innerHTML = `<div id="matterviz-app"></div>`
  parse_file_content.mockRejectedValueOnce(new Error(`needs a bigger index threshold`))
  set_file_data(`retry`)
  expect(await initialize_matterviz?.()).toBeNull()
  expect(document.body.textContent).toContain(`needs a bigger index threshold`)
  expect(post_message).toHaveBeenLastCalledWith({
    command: `error`,
    text: `Error rendering retry.json: needs a bigger index threshold`,
  })
  expect(mount).not.toHaveBeenCalled()

  // A retry that fails again re-reports and keeps the error display
  parse_file_content.mockRejectedValueOnce(new Error(`still broken`))
  post_settings(`dark`, { trajectory: { index_above_bytes: 8192 } })
  await vi.waitFor(() => expect(parse_file_content).toHaveBeenCalledTimes(2))
  await vi.waitFor(() => expect(document.body.textContent).toContain(`still broken`))
  expect(post_message).toHaveBeenLastCalledWith({
    command: `error`,
    text: `Error rendering retry.json: still broken`,
  })
  expect(mount).not.toHaveBeenCalled()

  // The changed defaults reach the parser and the mounted component; theme applies as usual
  parse_file_content.mockResolvedValueOnce(result(`retry`))
  post_settings(`light`, { trajectory: { index_above_bytes: 16_384 } })
  await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(1))
  expect(parse_in_worker).toHaveBeenLastCalledWith(
    `retry`,
    `retry.json`,
    false,
    expect.objectContaining({ load_options: { index_above_bytes: 16_384 } }),
  )
  expect(mount.mock.lastCall?.[1].props).toMatchObject({
    value: `retry`,
    defaults: expect.objectContaining({
      trajectory: expect.objectContaining({ index_above_bytes: 16_384 }),
    }),
  })
  expect(document.documentElement.dataset.theme).toBe(`light`)
  expect(unmount).not.toHaveBeenCalled()

  // Once a display is up, settings changes remount it without re-parsing again
  post_settings(`light`, { structure: { atom_radius: 0.3 } })
  await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(2))
  expect(unmount).toHaveBeenCalledTimes(1)
  expect(parse_file_content).toHaveBeenCalledTimes(3)
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
