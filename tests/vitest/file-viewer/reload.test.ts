// Side-effect import: main.ts installs window.initializeMatterViz / cleanupMatterViz
// oxlint-disable-next-line eslint-plugin-import/no-unassigned-import -- side-effect only
import '$lib/file-viewer/main'
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
  // jsdom has neither Worker nor object URLs; record what main.ts's guard hands the native
  // constructor (and that it never turns a script into a blob)
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
// Cleared spies and an empty mount point for the next webview lifecycle
const reset = (): void => {
  for (const mock of [mount, unmount, parse_file_content, parse_in_worker, post_message]) {
    mock.mockClear()
  }
  document.body.innerHTML = `<div id="matterviz-app"></div>`
}
// Bootstrap a fresh webview showing `content`; parse mocks are queued by the caller first
const boot = (content: string, filename?: string) => {
  reset()
  set_file_data(content, filename)
  return initialize_matterviz?.()
}
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const host_error = (text: unknown) => ({ command: `error`, text })
const last_mounted_props = () => mount.mock.lastCall?.[1].props

// A host -> webview postMessage as the listener in main.ts sees it
const host_message = (data: Record<string, unknown>): boolean =>
  globalThis.dispatchEvent(new MessageEvent(`message`, { data }))
const update_file = (version: string): boolean =>
  host_message({
    command: `fileUpdated`,
    data: { content: version, filename: `${version}.json`, is_base64: false },
  })
// `defaults` omitted entirely when undefined: models a host that only pushes the theme
const post_settings = (theme: string, defaults?: unknown): boolean =>
  host_message({
    command: `settingsChanged`,
    theme,
    ...(defaults !== undefined && { defaults }),
  })

test(`serializes reloads and guards cleanup, markers, and initialization`, async () => {
  const stale_parse = Promise.withResolvers<ParseResult>()
  parse_file_content
    .mockResolvedValueOnce(result(`initial`))
    .mockReturnValueOnce(stale_parse.promise)
    .mockResolvedValueOnce(result(`fresh`))

  await boot(`initial`)
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
  const cleanup = cleanup_matterviz?.()
  await vi.waitFor(() => expect(unmount).toHaveBeenCalledTimes(2))
  update_file(`after-cleanup`)
  expect(parse_file_content).toHaveBeenCalledTimes(4)
  cleanup_unmount.resolve(undefined)
  await cleanup

  parse_file_content
    .mockResolvedValueOnce(result(`reinitialized`))
    .mockResolvedValueOnce(result(`new-session`))
  set_file_data(`reinitialized`)
  await initialize_matterviz?.()
  update_file(`new-session`)
  await vi.waitFor(() => {
    expect(parse_file_content).toHaveBeenCalledTimes(6)
    expect(mount).toHaveBeenCalledTimes(4)
  })
  cleanup_parse.resolve(result(`during-cleanup`))
  await flush()
  expect(mount).toHaveBeenCalledTimes(4)
  await cleanup_matterviz?.()

  // A parse failure is reported to the host (marker handling itself is covered in
  // file-viewer/main.test.ts; delegate to the real parser for this one case)
  const { parse_file_content: real_parse_file_content } =
    await vi.importActual<typeof ParseModule>(`$lib/file-viewer/parse`)
  parse_file_content.mockImplementationOnce(real_parse_file_content)
  set_file_data(`LARGE_FILE:/tmp/structure.cif:536870912`, `structure.cif`)
  expect(await initialize_matterviz?.()).toBeNull()
  expect(parse_file_content).toHaveBeenCalledTimes(7)
  expect(post_message).toHaveBeenLastCalledWith(
    host_error(expect.stringContaining(`only supported for indexed trajectories`)),
  )

  const initialization_parse = Promise.withResolvers<ParseResult>()
  parse_file_content.mockReturnValueOnce(initialization_parse.promise)
  set_file_data(`pending-initialization`)
  const pending_initialization = initialize_matterviz?.()
  await vi.waitFor(() => expect(parse_file_content).toHaveBeenCalledTimes(8))
  const mount_count = mount.mock.calls.length
  await cleanup_matterviz?.()
  initialization_parse.resolve(result(`pending-initialization`))
  expect(await pending_initialization).toBeNull()
  expect(mount).toHaveBeenCalledTimes(mount_count)
})

// matterviz.trajectory.atom_type_mapping is a parser input, not a component prop: it rides in
// load_options next to index_above_bytes, and the empty default is omitted so the LAMMPS
// reader keeps guessing (and warning) the way it does without any host. A settings.json
// `null` (which merge() passes through in place of the default) counts as unset too
test(`the atom_type_mapping setting reaches the parser and an empty or null map is omitted`, async () => {
  parse_file_content.mockResolvedValueOnce(result(`dump`))
  await boot(`dump`)
  expect(parse_in_worker).toHaveBeenLastCalledWith(
    `dump`,
    `dump.json`,
    false,
    expect.objectContaining({ load_options: { index_above_bytes: 4096 } }),
  )

  const mapping = { 1: `Si`, 2: `O` }
  const cases: [unknown, Record<string, unknown>][] = [
    [mapping, { index_above_bytes: 4096, atom_type_mapping: mapping }],
    [null, { index_above_bytes: 4096 }],
  ]
  for (const [idx, [atom_type_mapping, load_options]] of cases.entries()) {
    parse_file_content.mockResolvedValueOnce(result(`dump`))
    post_settings(`light`, { trajectory: { index_above_bytes: 4096, atom_type_mapping } })
    // a parsed result is remounted, not re-parsed, so re-read the file to see the new options
    await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(idx + 2))
    update_file(`dump`)
    await vi.waitFor(() => expect(parse_in_worker).toHaveBeenCalledTimes(idx + 2))
    expect(parse_in_worker).toHaveBeenLastCalledWith(
      `dump`,
      `dump.json`,
      false,
      expect.objectContaining({ load_options }),
    )
  }
})

// A host theme/settings change must not re-read or re-parse the file (the host may have
// rendered an unsaved editor buffer): theme is applied to the DOM, changed defaults remount
// the already-parsed result, unchanged defaults are a no-op
test(`settingsChanged re-applies theme and remounts the parsed result without re-parsing`, async () => {
  parse_file_content.mockResolvedValueOnce(result(`settings`))
  await boot(`settings`)
  expect(mount).toHaveBeenCalledTimes(1)

  post_settings(`dark`, { trajectory: { index_above_bytes: 4096 } })
  await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe(`dark`))
  await flush()
  expect(unmount).not.toHaveBeenCalled()

  post_settings(`light`, { structure: { atom_radius: 0.3 } })
  await vi.waitFor(() => expect(unmount).toHaveBeenCalledTimes(1))
  await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(2))
  expect(document.documentElement.dataset.theme).toBe(`light`)
  expect(last_mounted_props()).toMatchObject({
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
  await flush()
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
  reset()
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
  expect(last_mounted_props()?.trajectory).toBe(run_a)
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
  await flush()
  expect(run_b.dispose).toHaveBeenCalledTimes(1)
  expect(mount).toHaveBeenCalledTimes(mount_count)

  // create_display throwing mid-remount disposes the detached run and reports the error
  const run_c = await init_run(`run-c`)
  mount.mockImplementationOnce(() => {
    throw new Error(`mount failed`)
  })
  post_settings(`light`, changed_defaults)
  await vi.waitFor(() => expect(run_c.dispose).toHaveBeenCalledTimes(1))
  expect(post_message).toHaveBeenLastCalledWith(
    host_error(expect.stringContaining(`mount failed`)),
  )
})

// A failed bootstrap display (the parse threw, the error display is on screen) used to be
// retried by the host rebuilding the webview HTML on every config change; settingsChanged must
// re-attempt the display from the bootstrap payload the same way instead of bailing because
// there is nothing to remount
test(`settingsChanged re-attempts a failed initial display from the bootstrap payload`, async () => {
  parse_file_content.mockRejectedValueOnce(new Error(`needs a bigger index threshold`))
  expect(await boot(`retry`)).toBeNull()
  expect(document.body.textContent).toContain(`needs a bigger index threshold`)
  expect(post_message).toHaveBeenLastCalledWith(
    host_error(`Error rendering retry.json: needs a bigger index threshold`),
  )
  expect(mount).not.toHaveBeenCalled()

  // Neither a theme-only push nor unchanged defaults can affect a parse, so neither retries
  post_settings(`dark`)
  post_settings(`dark`, { trajectory: { index_above_bytes: 4096 } })
  await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe(`dark`))
  await flush()
  expect(parse_file_content).toHaveBeenCalledTimes(1)

  // A retry that fails again re-reports and keeps the error display
  parse_file_content.mockRejectedValueOnce(new Error(`still broken`))
  post_settings(`dark`, { trajectory: { index_above_bytes: 8192 } })
  await vi.waitFor(() => expect(parse_file_content).toHaveBeenCalledTimes(2))
  await vi.waitFor(() => expect(document.body.textContent).toContain(`still broken`))
  expect(post_message).toHaveBeenLastCalledWith(
    host_error(`Error rendering retry.json: still broken`),
  )
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
  expect(last_mounted_props()).toMatchObject({
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

// The retry source is whatever the host last asked to show, not the bootstrap payload: a
// reload that fails while nothing is on screen is what gets retried, a reload that lands
// mid-retry wins silently (no AbortError reported), and a deleted file is never resurrected
test(`settingsChanged retries the latest host file and never a superseded or deleted one`, async () => {
  parse_file_content.mockRejectedValueOnce(new Error(`bootstrap broken`))
  expect(await boot(`bootstrap`)).toBeNull()

  // A failed reload with nothing on screen replaces the error display and the retry source
  parse_file_content.mockRejectedValueOnce(new Error(`reload broken`))
  update_file(`reloaded`)
  await vi.waitFor(() => expect(document.body.textContent).toContain(`reload broken`))
  expect(post_message).toHaveBeenLastCalledWith(
    host_error(`Error rendering reloaded.json: reload broken`),
  )
  parse_file_content.mockResolvedValueOnce(result(`reloaded`))
  post_settings(`light`, { structure: { atom_radius: 0.3 } })
  await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(1))
  expect(parse_in_worker).toHaveBeenLastCalledWith(
    `reloaded`,
    `reloaded.json`,
    false,
    expect.anything(),
  )

  // A reload arriving while a retry parse is pending aborts it without an error report and is
  // what the next settings change remounts
  await cleanup_matterviz?.()
  parse_file_content.mockRejectedValueOnce(new Error(`bootstrap broken`))
  set_file_data(`bootstrap`)
  await initialize_matterviz?.()
  post_message.mockClear()
  const retry_parse = Promise.withResolvers<ParseResult>()
  parse_file_content
    .mockReturnValueOnce(retry_parse.promise)
    .mockResolvedValueOnce(result(`newer`))
  post_settings(`light`, { structure: { atom_radius: 0.5 } })
  await vi.waitFor(() => expect(parse_file_content).toHaveBeenCalledTimes(5))
  update_file(`newer`)
  retry_parse.reject(new DOMException(`aborted`, `AbortError`))
  await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(2))
  expect(last_mounted_props()?.value).toBe(`newer`)
  expect(post_message.mock.calls.map(([msg]) => msg.command)).not.toContain(`error`)
  post_settings(`light`, { structure: { atom_radius: 0.7 } })
  await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(3))
  expect(last_mounted_props()?.value).toBe(`newer`)
  expect(parse_file_content).toHaveBeenCalledTimes(6)

  // After fileDeleted there is nothing to retry or remount
  host_message({ command: `fileDeleted`, file_path: `/tmp/newer.json` })
  await vi.waitFor(() => expect(document.body.textContent).toContain(`File Deleted`))
  post_settings(`light`, { structure: { atom_radius: 0.9 } })
  await flush()
  expect(parse_file_content).toHaveBeenCalledTimes(6)
  expect(mount).toHaveBeenCalledTimes(3)
  expect(document.body.textContent).toContain(`File Deleted`)
})

// A reload that fails to parse keeps the previous file on screen, but that file is no longer
// what the host asked for: the next settings change must re-parse the new file (the new
// defaults may be what its parse needed), not remount the stale one
test(`settingsChanged after a failed reload re-parses the new file instead of remounting the old`, async () => {
  parse_file_content.mockResolvedValueOnce(result(`old`))
  await boot(`old`)
  expect(mount).toHaveBeenCalledTimes(1)

  parse_file_content.mockRejectedValueOnce(new Error(`reload broken`))
  update_file(`new`)
  await vi.waitFor(() =>
    expect(post_message).toHaveBeenLastCalledWith(
      host_error(`Error rendering new.json: reload broken`),
    ),
  )
  // the old display stays up rather than being replaced by the error display
  expect(unmount).not.toHaveBeenCalled()
  expect(document.body.textContent).not.toContain(`reload broken`)

  parse_file_content.mockResolvedValueOnce(result(`new`))
  post_settings(`light`, { structure: { atom_radius: 0.3 } })
  await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(2))
  expect(parse_in_worker).toHaveBeenLastCalledWith(`new`, `new.json`, false, expect.anything())
  expect(last_mounted_props()?.value).toBe(`new`)
  expect(unmount).toHaveBeenCalledTimes(1)
})

// A remount superseded mid-unmount by a reload disposes what it was remounting; if that reload
// then fails to parse, the next settings change must retry the reload's file rather than find
// a disposed result to "remount" and do nothing
test(`settingsChanged after a superseded remount and a failed reload re-parses the reload's file`, async () => {
  parse_file_content.mockResolvedValueOnce(result(`shown`))
  await boot(`shown`)

  const pending_unmount = Promise.withResolvers<undefined>()
  unmount.mockReturnValueOnce(pending_unmount.promise)
  post_settings(`light`, { structure: { atom_radius: 0.3 } })
  await vi.waitFor(() => expect(unmount).toHaveBeenCalledTimes(1))
  parse_file_content.mockRejectedValueOnce(new Error(`reload broken`))
  update_file(`reloaded`)
  pending_unmount.resolve(undefined)
  await vi.waitFor(() => expect(document.body.textContent).toContain(`reload broken`))
  expect(mount).toHaveBeenCalledTimes(1)

  parse_file_content.mockResolvedValueOnce(result(`reloaded`))
  post_settings(`light`, { structure: { atom_radius: 0.5 } })
  await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(2))
  expect(parse_in_worker).toHaveBeenLastCalledWith(
    `reloaded`,
    `reloaded.json`,
    false,
    expect.anything(),
  )
  expect(last_mounted_props()?.value).toBe(`reloaded`)
})

// The bootstrap display is queued like every other host message: a settings change that lands
// during its parse waits for the mount and remounts it, instead of starting a retry parse that
// aborts the bootstrap one (a spurious AbortError report plus a second parse)
test(`settingsChanged during the bootstrap parse waits for it instead of racing it`, async () => {
  const bootstrap_parse = Promise.withResolvers<ParseResult>()
  parse_in_worker.mockImplementationOnce(
    (_content, _filename, _is_base64, { signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener(`abort`, () =>
          reject(new DOMException(`aborted`, `AbortError`)),
        )
        void bootstrap_parse.promise.then(resolve)
      }),
  )
  const initializing = boot(`boot`)
  await vi.waitFor(() => expect(parse_in_worker).toHaveBeenCalledTimes(1))

  post_settings(`light`, { structure: { atom_radius: 0.3 } })
  await flush()
  expect(mount).not.toHaveBeenCalled()
  bootstrap_parse.resolve(result(`boot`))
  expect(await initializing).not.toBeNull()
  await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(2))
  expect(parse_in_worker).toHaveBeenCalledTimes(1)
  expect(unmount).toHaveBeenCalledTimes(1)
  expect(last_mounted_props()?.defaults).toMatchObject({ structure: { atom_radius: 0.3 } })
  expect(post_message.mock.calls.map(([msg]) => msg.command)).not.toContain(`error`)
})

// A bootstrap that throws before it can display anything (an empty payload) must still leave
// the webview listening, so the host's next reload reaches it
test(`a bootstrap that fails before displaying still accepts host reloads`, async () => {
  expect(await boot(``, ``)).toBeNull()
  expect(post_message).toHaveBeenLastCalledWith(
    host_error(expect.stringContaining(`No data provided`)),
  )

  parse_file_content.mockResolvedValueOnce(result(`late`))
  update_file(`late`)
  await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(1))
  expect(last_mounted_props()?.value).toBe(`late`)
})

// #451: a worker script on the vscode-cdn resource origin cannot load from a worker context
// (the webview service worker only serves the document), so the constructor throws at once
// and every client falls back to the main thread instead of stalling ~20 s per file
test(`rejects cross-origin worker scripts synchronously and passes same-origin ones through`, () => {
  const { native_worker_calls, object_url_blobs } = test_mocks
  const resource_url = `https://file+.vscode-resource.vscode-cdn.net/ext/dist/assets/parse-worker.js`
  for (const url of [resource_url, new URL(resource_url)]) {
    expect(() => new ShimmedWorker(url, { type: `module` })).toThrow(
      expect.objectContaining({
        name: `SecurityError`,
        message: expect.stringContaining(resource_url),
      }),
    )
  }
  const passed_through = [
    new ShimmedWorker(`${location.origin}/assets/same-origin.js`, { type: `module` }),
    new ShimmedWorker(`blob:${location.origin}/already-a-blob`),
  ]
  expect(passed_through).toHaveLength(2)
  expect(native_worker_calls).toEqual([
    { url: `${location.origin}/assets/same-origin.js`, options: { type: `module` } },
    { url: `blob:${location.origin}/already-a-blob`, options: undefined },
  ])
  expect(object_url_blobs).toEqual([])
})
