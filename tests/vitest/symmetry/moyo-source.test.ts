// A host-registered WASM source (the VS Code webview's URL) is fetched lazily by the first
// analysis and survives a failed fetch. Isolated file: it mocks the wasm-bindgen init.
import init from '@spglib/moyo-wasm'
import { ensure_moyo_wasm_ready, set_moyo_wasm_source } from '#lib/symmetry/analyze.js'
import { expect, test, vi } from 'vite-plus/test'

vi.mock(`@spglib/moyo-wasm`, async (import_original) => ({
  ...(await import_original<Record<string, unknown>>()),
  default: vi.fn(),
}))

test(`registering a moyo source defers the fetch to the first init and survives a retry`, async () => {
  const init_mock = vi.mocked(init)
  set_moyo_wasm_source(`vscode-resource:/moyo_wasm_bg.wasm`)
  expect(init_mock).not.toHaveBeenCalled()
  init_mock.mockRejectedValueOnce(new Error(`fetch failed`))
  await expect(ensure_moyo_wasm_ready()).rejects.toThrow(`fetch failed`)
  init_mock.mockResolvedValueOnce(Object.create(null))
  await ensure_moyo_wasm_ready()
  expect(init_mock.mock.calls).toEqual([
    [{ module_or_path: `vscode-resource:/moyo_wasm_bg.wasm` }],
    [{ module_or_path: `vscode-resource:/moyo_wasm_bg.wasm` }],
  ])
})
