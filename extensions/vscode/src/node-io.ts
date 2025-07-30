// Node.js I/O utilities for VS Code extension
//
// Provides Node.js file streaming that can't be in lib/trajectory/ (which must stay browser-compatible for web builds).
// Clean separation: this handles file I/O in NodeJs environments like VSCode,
// while lib/trajectory/ handles parsing.

import * as fs from 'fs'
import { Buffer } from 'node:buffer'

// Memory management constants for streaming
export const MAX_STREAMING_FILE_SIZE = 10 * 1024 * 1024 * 1024 // 10GB - practical limit
export const LARGE_FILE_WARNING_SIZE = 5 * 1024 * 1024 * 1024 // 5GB - warn user

export interface StreamingProgress {
  bytes_read: number
  total_size: number
  progress: number // 0-1
}

// Stream large files efficiently to avoid memory issues
export const stream_file_to_buffer = (
  file_path: string,
  on_progress?: (progress: StreamingProgress) => void,
): Promise<ArrayBuffer> => {
  return new Promise((resolve, reject) => {
    // Get file size and validate
    let total_size: number
    try {
      total_size = fs.statSync(file_path).size
    } catch (error) {
      return reject(new Error(`Failed to get file stats: ${error}`))
    }

    if (total_size > MAX_STREAMING_FILE_SIZE) {
      const size_gb = Math.round(total_size / 1024 / 1024 / 1024)
      const max_gb = Math.round(MAX_STREAMING_FILE_SIZE / 1024 / 1024 / 1024)
      return reject(new Error(`File too large (${size_gb}GB). Maximum: ${max_gb}GB`))
    }

    if (total_size > LARGE_FILE_WARNING_SIZE) {
      const size_gb = Math.round(total_size / 1024 / 1024 / 1024)
      console.warn(`Large file detected: ${size_gb}GB. Processing may be slow.`)
    }

    // Pre-allocate result buffer for optimal performance
    const result = new Uint8Array(total_size)
    const stream = fs.createReadStream(file_path)
    let bytes_read = 0

    const cleanup = () => {
      stream.destroy()
      clearTimeout(timeout)
    }

    stream.on(`data`, (chunk: string | Buffer) => {
      const buffer_chunk = typeof chunk === `string` ? Buffer.from(chunk) : chunk
      result.set(buffer_chunk, bytes_read)
      bytes_read += buffer_chunk.length
      on_progress?.({ bytes_read, total_size, progress: bytes_read / total_size })
    })

    stream.on(`end`, () => {
      cleanup()
      resolve(result.buffer)
    })

    stream.on(`error`, (error) => {
      cleanup()
      reject(new Error(`Failed to read file: ${error.message}`))
    })

    // 10 minute timeout for very large files
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(`File read timeout: ${file_path}`))
    }, 600_000)
  })
}
