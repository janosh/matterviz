import { beforeEach, describe, expect, test, vi } from 'vitest'
import { deflateSync, gzipSync } from 'node:zlib'
import {
  decompress_host_buffer,
  MAX_STREAMING_FILE_SIZE,
  read_indexed_trajectory_file,
  stream_file_to_buffer,
} from '../src/node-io'

const mock_vscode = vi.hoisted(() => ({
  Uri: { file: vi.fn((file_path: string) => ({ fsPath: file_path })) },
  workspace: { fs: { stat: vi.fn(), readFile: vi.fn() } },
}))

vi.mock(`vscode`, () => mock_vscode)
beforeEach(() => vi.clearAllMocks())

const mock_file = (bytes: Uint8Array) => {
  mock_vscode.workspace.fs.stat.mockResolvedValue({ size: bytes.byteLength })
  mock_vscode.workspace.fs.readFile.mockResolvedValue(bytes)
}

describe(`stream_file_to_buffer`, () => {
  test(`returns full-span bytes uncopied and view-backed bytes exactly`, async () => {
    const file_bytes = new Uint8Array([1, 2, 3])
    mock_file(file_bytes)
    expect(await stream_file_to_buffer(`/tmp/full-span.bin`)).toBe(file_bytes.buffer)

    mock_file(new Uint8Array([0, 1, 2, 3, 4, 5]).subarray(2, 5))
    const result = await stream_file_to_buffer(`/tmp/view-backed.bin`)
    expect(Array.from(new Uint8Array(result))).toEqual([2, 3, 4])
  })

  test(`rejects files above the shared host buffer limit`, async () => {
    mock_vscode.workspace.fs.stat.mockResolvedValue({ size: MAX_STREAMING_FILE_SIZE + 1 })
    await expect(stream_file_to_buffer(`/tmp/too-large.traj`)).rejects.toThrow(
      `Maximum: 1.00 GiB`,
    )
    expect(mock_vscode.workspace.fs.readFile).not.toHaveBeenCalled()
  })
})

describe(`read_indexed_trajectory_file`, () => {
  test.each([
    [`movie.extxyz.gz`, gzipSync],
    [`movie.xyz.gzip`, gzipSync],
    [`movie.xyz.deflate`, deflateSync],
    [`movie.xyz.gz.gz`, (text: string) => gzipSync(gzipSync(text))],
    [`movie.xyz.deflate.gz`, (text: string) => gzipSync(deflateSync(text))],
    [`movie.traj.gz`, gzipSync], // binary ASE trajectory
  ])(`decompresses indexed trajectory %s to bytes`, async (filename, compress) => {
    const text = `1\nframe\nH 0 0 0\n`
    mock_file(new Uint8Array(compress(text)))
    const result = await read_indexed_trajectory_file(`/tmp/${filename}`, filename)
    expect(result.filename).toBe(filename.replace(/(?:\.(?:gz|gzip|deflate))+$/, ``))
    expect(new TextDecoder().decode(result.data)).toBe(text)
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
    [`movie.xyz.z`, `Unsupported compression`],
    [`movie.xyz.xz.gz`, `Unsupported compression`],
    [`movie.h5`, `Indexed loading is not supported`],
  ])(`rejects unsupported indexed input %s before reading`, async (filename, error) => {
    await expect(read_indexed_trajectory_file(`/tmp/${filename}`, filename)).rejects.toThrow(
      error,
    )
    expect(mock_vscode.workspace.fs.stat).not.toHaveBeenCalled()
  })
})
