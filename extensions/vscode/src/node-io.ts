// Node-side file reading for the VS Code host: lib/trajectory/ stays browser-only and does
// the parsing, this reads (and decompresses) the bytes through the vscode.workspace.fs API so
// remote (SSH) workspaces work too.

import { normalize_browser_supported_filename } from '$lib/file-viewer/eligibility'
import { detect_compression_format, is_stream_compression_format } from '$lib/io/decompress'
import type { StreamCompressionFormat } from '$lib/io/decompress'
import {
  indexed_trajectory_format,
  is_indexable_trajectory_filename,
} from '$lib/trajectory/format-detect'
import { format_bytes } from 'svelte-widgets/format'
import { constants as buffer_constants } from 'node:buffer'
import { Readable } from 'node:stream'
import { createGunzip, createInflate, createInflateRaw } from 'node:zlib'
import * as vscode from 'vscode'

// vscode.workspace.fs.readFile() has no streaming API, so the whole file lands in memory: cap
// it at 1 GiB to keep the extension host from OOMing
export const MAX_STREAMING_FILE_SIZE = 1024 * 1024 * 1024
export const MAX_TEXT_TRAJECTORY_SIZE = buffer_constants.MAX_STRING_LENGTH
const LARGE_FILE_WARNING_SIZE = 512 * 1024 * 1024
const TEXT_DECODING_BYTES_PER_OUTPUT_BYTE = 2

const to_array_buffer = (data: Uint8Array): ArrayBuffer =>
  data.buffer instanceof ArrayBuffer &&
  data.byteOffset === 0 &&
  data.byteLength === data.buffer.byteLength
    ? data.buffer
    : Uint8Array.from(data).buffer

export const decode_indexed_trajectory_text = (
  data: ArrayBuffer,
  max_byte_length: number = MAX_TEXT_TRAJECTORY_SIZE,
): string => {
  if (data.byteLength > max_byte_length) {
    throw new Error(
      `Text trajectory too large to decode (${data.byteLength} bytes). Maximum: ${max_byte_length} bytes`,
    )
  }
  return new TextDecoder().decode(data)
}

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
  const decompressor =
    format === `gzip`
      ? createGunzip()
      : format === `deflate`
        ? createInflate()
        : createInflateRaw()
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

// Stream large files efficiently to avoid memory issues
// Uses VSCode's filesystem API to support both local and remote files (SSH)
export const stream_file_to_buffer = async (file_path: string): Promise<ArrayBuffer> => {
  const uri = vscode.Uri.file(file_path)

  // Get file size and validate
  let total_size: number
  try {
    const stats = await vscode.workspace.fs.stat(uri)
    total_size = stats.size
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

  const uint8array = await vscode.workspace.fs.readFile(uri)

  // Keep the return type a true ArrayBuffer. This intentionally excludes
  // SharedArrayBuffer-backed or partial views, which are copied into an owned buffer.
  return to_array_buffer(uint8array)
}

interface IndexedTrajectoryFile {
  data: string | ArrayBuffer
  filename: string
}

export const read_indexed_trajectory_file = async (
  file_path: string,
  filename: string,
): Promise<IndexedTrajectoryFile> => {
  const compression_format = detect_compression_format(filename)
  if (compression_format && !is_stream_compression_format(compression_format)) {
    throw new Error(`Unsupported compression for indexed trajectory: ${compression_format}`)
  }

  const normalized_filename = normalize_browser_supported_filename(filename)
  if (normalized_filename === null) {
    throw new Error(`Nested compression is not supported: ${filename}`)
  }
  if (!is_indexable_trajectory_filename(normalized_filename)) {
    throw new Error(`Indexed loading is not supported for ${filename}`)
  }
  const is_text_trajectory = indexed_trajectory_format(normalized_filename) === `xyz`
  let buffer = await stream_file_to_buffer(file_path)
  if (compression_format) {
    buffer = await decompress_host_buffer(
      buffer,
      compression_format,
      is_text_trajectory ? MAX_TEXT_TRAJECTORY_SIZE : MAX_STREAMING_FILE_SIZE,
      is_text_trajectory,
    )
  }

  return {
    data: is_text_trajectory ? decode_indexed_trajectory_text(buffer) : buffer,
    filename: normalized_filename,
  }
}
