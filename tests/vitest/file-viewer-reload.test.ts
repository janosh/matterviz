import { create_display } from '$lib/file-viewer/main'
import type * as ParseModule from '$lib/file-viewer/parse'
import type { ParseResult } from '$lib/file-viewer/parse'
import type * as SvelteModule from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

const test_mocks = vi.hoisted(() => {
  const post_message = vi.fn()
  Object.assign(globalThis, {
    acquireVsCodeApi: () => ({ postMessage: post_message }),
  })
  return {
    mount: vi.fn((_component: unknown, _options: { props: Record<string, unknown> }) => ({})),
    parse_file_content: vi.fn(),
    post_message,
    unmount: vi.fn(async () => {}),
  }
})

vi.mock(`$lib/file-viewer/parse`, async (import_original) => ({
  ...(await import_original<typeof ParseModule>()),
  parse_file_content: test_mocks.parse_file_content,
}))
vi.mock(`svelte`, async (import_original) => ({
  ...(await import_original<typeof SvelteModule>()),
  mount: test_mocks.mount,
  unmount: test_mocks.unmount,
}))
const { mount, parse_file_content, post_message, unmount } = test_mocks

afterEach(async () => {
  await window.cleanupMatterViz?.()
  for (const key of [
    `acquireVsCodeApi`,
    `cleanupMatterViz`,
    `initializeMatterViz`,
    `matterviz_data`,
  ]) {
    Reflect.deleteProperty(globalThis, key)
  }
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

test(`serializes reloads, blocks post-cleanup updates, and rejects invalid markers`, async () => {
  expect(create_display).toBeTypeOf(`function`)
  let resolve_stale: (result: ParseResult) => void = () => {}
  const stale_parse = new Promise<ParseResult>((resolve) => (resolve_stale = resolve))
  parse_file_content
    .mockResolvedValueOnce(result(`initial`))
    .mockReturnValueOnce(stale_parse)
    .mockResolvedValueOnce(result(`fresh`))

  set_file_data(`initial`)
  document.body.innerHTML = `<div id="matterviz-app"></div>`
  await window.initializeMatterViz?.()

  update_file(`stale`)
  await vi.waitFor(() => expect(parse_file_content).toHaveBeenCalledTimes(2))
  update_file(`fresh`)
  await Promise.resolve()
  expect(parse_file_content).toHaveBeenCalledTimes(2)
  resolve_stale(result(`stale`))

  await vi.waitFor(() => {
    expect(parse_file_content).toHaveBeenCalledTimes(3)
    expect(mount).toHaveBeenCalledTimes(2)
  })
  expect(mount.mock.calls.map((call) => call[1].props.value)).toEqual([`initial`, `fresh`])
  expect(unmount).toHaveBeenCalledTimes(1)

  let resolve_cleanup_parse: (result: ParseResult) => void = () => {}
  const cleanup_parse = new Promise<ParseResult>(
    (resolve) => (resolve_cleanup_parse = resolve),
  )
  parse_file_content.mockReturnValueOnce(cleanup_parse)
  update_file(`during-cleanup`)
  await vi.waitFor(() => expect(parse_file_content).toHaveBeenCalledTimes(4))

  let finish_cleanup: () => void = () => {}
  unmount.mockReturnValueOnce(new Promise<void>((resolve) => (finish_cleanup = resolve)))
  const cleanup = window.cleanupMatterViz?.()
  await vi.waitFor(() => expect(unmount).toHaveBeenCalledTimes(2))
  update_file(`after-cleanup`)
  expect(parse_file_content).toHaveBeenCalledTimes(4)
  finish_cleanup()
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
  resolve_cleanup_parse(result(`during-cleanup`))
  await new Promise((resolve) => setTimeout(resolve))
  expect(mount).toHaveBeenCalledTimes(4)
  await window.cleanupMatterViz?.()

  set_file_data(`LARGE_FILE:/tmp/structure.cif:536870912`, `structure.cif`)
  expect(await window.initializeMatterViz?.()).toBeNull()
  expect(parse_file_content).toHaveBeenCalledTimes(6)
  expect(post_message).toHaveBeenLastCalledWith({
    command: `error`,
    text: expect.stringContaining(`only supported for indexed trajectories`),
  })

  set_file_data(`LARGE_FILE:/tmp/movie.traj:536870912`, `movie.traj`)
  const valid_marker_init = window.initializeMatterViz?.()
  await vi.waitFor(() =>
    expect(post_message).toHaveBeenCalledWith(
      expect.objectContaining({ command: `request_large_file` }),
    ),
  )
  const request = post_message.mock.calls
    .map(([message]) => message as Record<string, unknown>)
    .findLast(({ command }) => command === `request_large_file`)
  globalThis.dispatchEvent(
    new MessageEvent(`message`, {
      data: {
        command: `large_file_response`,
        request_id: request?.request_id,
        parsed_trajectory: { frames: [], total_frames: 0 },
      },
    }),
  )
  expect(await valid_marker_init).not.toBeNull()

  let resolve_initialization: (result: ParseResult) => void = () => {}
  parse_file_content.mockReturnValueOnce(
    new Promise<ParseResult>((resolve) => (resolve_initialization = resolve)),
  )
  set_file_data(`pending-initialization`)
  const pending_initialization = window.initializeMatterViz?.()
  await vi.waitFor(() => expect(parse_file_content).toHaveBeenCalledTimes(7))
  const mount_count = mount.mock.calls.length
  await window.cleanupMatterViz?.()
  resolve_initialization(result(`pending-initialization`))
  expect(await pending_initialization).toBeNull()
  expect(mount).toHaveBeenCalledTimes(mount_count)
})
