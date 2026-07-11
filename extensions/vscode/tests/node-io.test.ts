import { beforeEach, describe, expect, test, vi } from 'vitest'
import { MAX_STREAMING_FILE_SIZE, stream_file_to_buffer } from '../src/node-io'

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
  beforeEach(() => vi.clearAllMocks())

  test(`returns the underlying buffer without copying for full-span file bytes`, async () => {
    const file_bytes = new Uint8Array([1, 2, 3])
    mock_vscode.workspace.fs.stat.mockResolvedValue({ size: file_bytes.byteLength })
    mock_vscode.workspace.fs.readFile.mockResolvedValue(file_bytes)

    const result = await stream_file_to_buffer(`/tmp/full-span.bin`)

    expect(result).toBe(file_bytes.buffer)
  })

  test(`returns exact bytes when VS Code returns an ArrayBuffer view`, async () => {
    const parent_buffer = new Uint8Array([0, 1, 2, 3, 4, 5])
    const file_bytes = parent_buffer.subarray(2, 5)
    mock_vscode.workspace.fs.stat.mockResolvedValue({ size: file_bytes.byteLength })
    mock_vscode.workspace.fs.readFile.mockResolvedValue(file_bytes)

    const result = await stream_file_to_buffer(`/tmp/view-backed.bin`)

    expect(Array.from(new Uint8Array(result))).toEqual([2, 3, 4])
  })

  test(`rejects files above the shared host buffer limit`, async () => {
    mock_vscode.workspace.fs.stat.mockResolvedValue({ size: MAX_STREAMING_FILE_SIZE + 1 })

    await expect(stream_file_to_buffer(`/tmp/too-large.traj`)).rejects.toThrow(`Maximum: 1GB`)
    expect(mock_vscode.workspace.fs.readFile).not.toHaveBeenCalled()
  })
})
