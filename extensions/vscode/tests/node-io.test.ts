import { beforeEach, describe, expect, test, vi } from 'vitest'
import { deflateRawSync, deflateSync, gzipSync } from 'node:zlib'
import {
  decode_indexed_trajectory_text,
  decompress_host_buffer,
  MAX_STREAMING_FILE_SIZE,
  read_indexed_trajectory_file,
  stream_file_to_buffer,
} from '../src/node-io'

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
beforeEach(() => vi.clearAllMocks())

describe(`stream_file_to_buffer`, () => {
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

describe(`read_indexed_trajectory_file`, () => {
  test(`rejects text payloads above the decoder limit`, () => {
    expect(() => decode_indexed_trajectory_text(new Uint8Array([1, 2]).buffer, 1)).toThrow(
      `Text trajectory too large to decode`,
    )
  })

  test.each([
    [`movie.extxyz.gz`, gzipSync],
    [`movie.xyz.gzip`, gzipSync],
    [`movie.xyz.deflate`, deflateSync],
    [`movie.xyz.z`, deflateRawSync],
  ])(`decompresses and decodes indexed text trajectory %s`, async (filename, compress) => {
    const text = `1\nframe\nH 0 0 0\n`
    const compressed = new Uint8Array(compress(text))
    mock_vscode.workspace.fs.stat.mockResolvedValue({ size: compressed.byteLength })
    mock_vscode.workspace.fs.readFile.mockResolvedValue(compressed)

    await expect(read_indexed_trajectory_file(`/tmp/${filename}`, filename)).resolves.toEqual({
      data: text,
      filename: filename.replace(/\.(?:gz|gzip|deflate|z)$/, ``),
    })
  })

  test(`keeps decompressed ASE trajectories binary`, async () => {
    const raw = new Uint8Array([1, 2, 3, 4])
    const compressed = new Uint8Array(gzipSync(raw))
    mock_vscode.workspace.fs.stat.mockResolvedValue({ size: compressed.byteLength })
    mock_vscode.workspace.fs.readFile.mockResolvedValue(compressed)

    const result = await read_indexed_trajectory_file(`/tmp/movie.traj.gz`, `movie.traj.gz`)

    expect(result.filename).toBe(`movie.traj`)
    expect(Array.from(new Uint8Array(result.data as ArrayBuffer))).toEqual([...raw])
  })

  test(`enforces decompression and text-decoding memory budgets`, async () => {
    const text = `a`.repeat(100_000)
    const compressed = new Uint8Array(gzipSync(text))
    const data = compressed.buffer

    await expect(
      decompress_host_buffer(data, `gzip`, compressed.byteLength + 100),
    ).rejects.toThrow(`Decompressed file too large`)

    const memory_budget = compressed.byteLength + text.length * 2
    const output = await decompress_host_buffer(data, `gzip`, memory_budget)
    expect(new TextDecoder().decode(output)).toBe(text)
    await expect(decompress_host_buffer(data, `gzip`, memory_budget, true)).rejects.toThrow(
      `Decompressed file too large`,
    )
  })

  test.each([
    [`movie.xyz.bz2`, `Unsupported compression`],
    [`movie.xyz.gz.gz`, `Nested compression`],
    [`movie.h5`, `Indexed loading is not supported`],
  ])(`rejects unsupported indexed input %s before reading`, async (filename, error) => {
    await expect(read_indexed_trajectory_file(`/tmp/${filename}`, filename)).rejects.toThrow(
      error,
    )
    expect(mock_vscode.workspace.fs.stat).not.toHaveBeenCalled()
  })
})
