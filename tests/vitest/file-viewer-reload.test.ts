import { create_display } from '$lib/file-viewer/main'
import type * as ParseModule from '$lib/file-viewer/parse'
import type { ParseResult } from '$lib/file-viewer/parse'
import type * as SvelteModule from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

const test_mocks = vi.hoisted(() => {
  Object.assign(globalThis, {
    acquireVsCodeApi: () => ({ postMessage: vi.fn() }),
  })
  return {
    mount: vi.fn((_component: unknown, _options: { props: Record<string, unknown> }) => ({})),
    parse_file_content: vi.fn(),
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
const { mount, parse_file_content, unmount } = test_mocks

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

const update_file = (version: string): boolean =>
  globalThis.dispatchEvent(
    new MessageEvent(`message`, {
      data: {
        command: `fileUpdated`,
        data: { content: version, filename: `${version}.json`, is_base64: false },
      },
    }),
  )

test(`file reloads discard stale parses and cleanup blocks later updates`, async () => {
  expect(create_display).toBeTypeOf(`function`)
  let resolve_stale: (result: ParseResult) => void = () => {}
  const stale_parse = new Promise<ParseResult>((resolve) => (resolve_stale = resolve))
  parse_file_content
    .mockResolvedValueOnce(result(`initial`))
    .mockReturnValueOnce(stale_parse)
    .mockResolvedValueOnce(result(`fresh`))

  globalThis.matterviz_data = {
    data: { content: `initial`, filename: `initial.json`, is_base64: false },
    theme: `light`,
  }
  document.body.innerHTML = `<div id="matterviz-app"></div>`
  await window.initializeMatterViz?.()

  update_file(`stale`)
  await vi.waitFor(() => expect(parse_file_content).toHaveBeenCalledTimes(2))
  update_file(`fresh`)
  await vi.waitFor(() => expect(parse_file_content).toHaveBeenCalledTimes(3))
  resolve_stale(result(`stale`))

  await vi.waitFor(() => {
    expect(mount).toHaveBeenCalledTimes(2)
  })
  expect(mount.mock.calls.map((call) => call[1].props.value)).toEqual([`initial`, `fresh`])
  expect(unmount).toHaveBeenCalledTimes(1)

  let finish_cleanup: () => void = () => {}
  unmount.mockReturnValueOnce(new Promise<void>((resolve) => (finish_cleanup = resolve)))
  const cleanup = window.cleanupMatterViz?.()
  expect(unmount).toHaveBeenCalledTimes(2)
  update_file(`after-cleanup`)
  expect(parse_file_content).toHaveBeenCalledTimes(3)
  finish_cleanup()
  await cleanup
})
