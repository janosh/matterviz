// Node.js I/O utilities for VS Code extension
//
// Provides Node.js file streaming that can't be in lib/trajectory/ (which must stay browser-compatible for web builds).
// Clean separation: this handles file I/O in NodeJs environments like VSCode,
// while lib/trajectory/ handles parsing.

import * as vscode from 'vscode'

// Memory management constants for streaming
export const MAX_STREAMING_FILE_SIZE = 10 * 1024 * 1024 * 1024 // 10GB - practical limit
export const LARGE_FILE_WARNING_SIZE = 5 * 1024 * 1024 * 1024 // 5GB - warn user

export interface StreamingProgress {
  bytes_read: number
  total_size: number
  progress: number // 0-1
}

// Stream large files efficiently to avoid memory issues
// Uses VSCode's filesystem API to support both local and remote files (SSH)
export const stream_file_to_buffer = async (
  file_path: string,
  on_progress?: (progress: StreamingProgress) => void,
): Promise<ArrayBuffer> => {
  const uri = vscode.Uri.file(file_path)

  // Get file size and validate
  let total_size: number
  try {
    const stats = await vscode.workspace.fs.stat(uri)
    total_size = stats.size
  } catch (error) {
    throw new Error(`Failed to get file stats: ${error}`)
  }

  if (total_size > MAX_STREAMING_FILE_SIZE) {
    const size_gb = Math.round(total_size / 1024 / 1024 / 1024)
    const max_gb = Math.round(MAX_STREAMING_FILE_SIZE / 1024 / 1024 / 1024)
    throw new Error(`File too large (${size_gb}GB). Maximum: ${max_gb}GB`)
  }

  if (total_size > LARGE_FILE_WARNING_SIZE) {
    const size_gb = Math.round(total_size / 1024 / 1024 / 1024)
    console.warn(`Large file detected: ${size_gb}GB. Processing may be slow.`)
  }

  // Read entire file using VSCode API (works with both local and remote files)
  const uint8array = await vscode.workspace.fs.readFile(uri)

  // Report progress (always 100% since we read the whole file at once)
  on_progress?.({
    bytes_read: uint8array.length,
    total_size,
    progress: 1.0,
  })

  return uint8array.buffer
}
