// Node-side file reading for the VS Code host: lib/trajectory/ stays browser-only and does
// the parsing, this reads (and decompresses) the bytes through the vscode.workspace.fs API so
// remote (SSH) workspaces work too.

import { normalize_browser_supported_filename } from '#lib/file-viewer/eligibility'
import { COMPRESSION_EXTENSIONS_REGEX } from '#lib/constants'
import { detect_compression_format, is_stream_compression_format } from '#lib/io/decompress'
import type { StreamCompressionFormat } from '#lib/io/decompress'
import {
  indexed_trajectory_format,
  is_indexable_trajectory_filename,
} from '#lib/trajectory/format-detect'
import type { ByteSource } from '#lib/trajectory/parse/ase'
import { format_bytes } from 'svelte-widgets/format'
import * as file_system from 'node:fs'
import { Readable } from 'node:stream'
import { createGunzip, createInflate } from 'node:zlib'
import * as vscode from 'vscode'

// vscode.workspace.fs.readFile() has no streaming API, so the whole file lands in memory: cap
// it at 1 GiB to keep the extension host from OOMing
export const MAX_STREAMING_FILE_SIZE = 1024 * 1024 * 1024
const LARGE_FILE_WARNING_SIZE = 512 * 1024 * 1024
const TEXT_DECODING_BYTES_PER_OUTPUT_BYTE = 2

const to_array_buffer = (data: Uint8Array): ArrayBuffer =>
  data.buffer instanceof ArrayBuffer &&
  data.byteOffset === 0 &&
  data.byteLength === data.buffer.byteLength
    ? data.buffer
    : Uint8Array.from(data).buffer

export const decompress_host_buffer = async (
  data: ArrayBuffer,
  format: StreamCompressionFormat,
  max_memory_size: number = MAX_STREAMING_FILE_SIZE,
  reserve_text_decoding: boolean = false,
): Promise<ArrayBuffer> => {
  const memory_error = (retained_size: number): Error =>
    new Error(
      `Decompressed file too large for memory budget (${retained_size} bytes retained). Maximum: ${max_memory_size} bytes`,
    )
  if (data.byteLength > max_memory_size) throw memory_error(data.byteLength)

  const output_memory_factor =
    1 + (reserve_text_decoding ? TEXT_DECODING_BYTES_PER_OUTPUT_BYTE : 0)
  const max_output_size = Math.floor(
    (max_memory_size - data.byteLength) / output_memory_factor,
  )
  const output_buffer = new ArrayBuffer(0, { maxByteLength: max_output_size })
  const decompressor = format === `gzip` ? createGunzip() : createInflate()
  const decompressed_stream = Readable.from([new Uint8Array(data)]).pipe(decompressor)

  for await (const chunk of decompressed_stream) {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
    const next_output_size = output_buffer.byteLength + bytes.byteLength
    // Input, destination, and the current zlib chunk coexist during the copy.
    // Text decoding additionally creates a UTF-16 string from the output bytes.
    const retained_size =
      data.byteLength +
      next_output_size +
      bytes.byteLength +
      (reserve_text_decoding ? next_output_size * TEXT_DECODING_BYTES_PER_OUTPUT_BYTE : 0)
    if (retained_size > max_memory_size) {
      decompressed_stream.destroy()
      throw memory_error(retained_size)
    }
    output_buffer.resize(next_output_size)
    new Uint8Array(output_buffer, next_output_size - bytes.byteLength).set(bytes)
  }
  return output_buffer
}

// Size-check and read local or remote files through VSCode's filesystem API.
export const stream_file_to_buffer = async (file_path: string): Promise<ArrayBuffer> => {
  const uri = vscode.Uri.file(file_path)

  let total_size: number
  try {
    total_size = (await vscode.workspace.fs.stat(uri)).size
  } catch (error) {
    throw new Error(`Failed to get file stats: ${error}`, { cause: error })
  }

  if (total_size > MAX_STREAMING_FILE_SIZE) {
    throw new Error(
      `File too large (${format_bytes(total_size)}). Maximum: ${format_bytes(MAX_STREAMING_FILE_SIZE)}`,
    )
  }
  if (total_size > LARGE_FILE_WARNING_SIZE) {
    console.warn(`Large file detected: ${format_bytes(total_size)}. Processing may be slow.`)
  }

  // Keep the return type a true ArrayBuffer. This intentionally excludes
  // SharedArrayBuffer-backed or partial views, which are copied into an owned buffer.
  return to_array_buffer(await vscode.workspace.fs.readFile(uri))
}

// Text trajectories stay bytes too: open_trajectory decodes them in line-aligned chunks, so a
// file past the JS string limit still opens
interface IndexedTrajectoryFile {
  data: ArrayBuffer
  filename: string
}

export const read_indexed_trajectory_file = async (
  file_path: string,
  filename: string,
): Promise<IndexedTrajectoryFile> => {
  const normalized_filename = normalize_browser_supported_filename(filename)
  if (normalized_filename === null) {
    throw new Error(`Unsupported compression for indexed trajectory: ${filename}`)
  }
  if (!is_indexable_trajectory_filename(normalized_filename)) {
    throw new Error(`Indexed loading is not supported for ${filename}`)
  }
  const is_text_trajectory = indexed_trajectory_format(normalized_filename) === `text`
  let buffer = await stream_file_to_buffer(file_path)
  for (
    let format = detect_compression_format(filename);
    format;
    format = detect_compression_format(filename)
  ) {
    if (!is_stream_compression_format(format))
      throw new Error(`Unsupported compression for indexed trajectory: ${filename}`)
    filename = filename.replace(COMPRESSION_EXTENSIONS_REGEX, ``)
    buffer = await decompress_host_buffer(
      buffer,
      format,
      MAX_STREAMING_FILE_SIZE,
      is_text_trajectory && filename === normalized_filename,
    )
  }
  return { data: buffer, filename: normalized_filename }
}

// A file read on demand through an open file descriptor. The extension host (on the remote
// machine under Remote-SSH) keeps only a frame index and the frame it is decoding in memory,
// so files past MAX_STREAMING_FILE_SIZE open in constant memory, without reading the whole
// file first.
export const file_byte_source = (file_path: string): ByteSource => {
  let fd: number | null = file_system.openSync(file_path, `r`)
  const byte_length = file_system.fstatSync(fd).size
  return {
    byte_length,
    read: (offset, length) => {
      if (fd === null) throw new Error(`${file_path} was closed`)
      if (!Number.isInteger(offset) || offset < 0 || offset + length > byte_length)
        throw new Error(
          `Out-of-bounds read: ${length} bytes at ${offset} lie outside ${file_path} (${byte_length} bytes)`,
        )
      const bytes = new Uint8Array(length)
      for (let done = 0; done < length;) {
        const count = file_system.readSync(fd, bytes, done, length - done, offset + done)
        if (count === 0)
          throw new Error(`${file_path} ended at ${offset + done} while reading`)
        done += count
      }
      return new DataView(bytes.buffer)
    },
    release: () => {
      if (fd !== null) file_system.closeSync(fd)
      fd = null
    },
  }
}
