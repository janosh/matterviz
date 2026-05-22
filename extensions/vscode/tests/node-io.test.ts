import { describe, expect, test, vi } from 'vitest'
import { stream_file_to_buffer } from '../src/node-io'

const mock_vscode = vi.hoisted(() => ({
  Uri: {
    file: vi.fn((file_path: string) => ({ fsPath: file_path })),
  },
  workspace: {
    fs: {
      stat: vi.fn(),
      readFile: vi.fn(),
    },
  },
}))

vi.mock(`vscode`, () => mock_vscode)

describe(`stream_file_to_buffer`, () => {
  test(`returns exact bytes when VS Code returns an ArrayBuffer view`, async () => {
    const parent_buffer = new Uint8Array([0, 1, 2, 3, 4, 5])
    const file_bytes = parent_buffer.subarray(2, 5)
    mock_vscode.workspace.fs.stat.mockResolvedValue({ size: file_bytes.byteLength })
    mock_vscode.workspace.fs.readFile.mockResolvedValue(file_bytes)

    const result = await stream_file_to_buffer(`/tmp/view-backed.bin`)

    expect(Array.from(new Uint8Array(result))).toEqual([2, 3, 4])
  })
})
