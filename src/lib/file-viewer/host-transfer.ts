import {
  normalize_browser_supported_filename,
  should_encode_filename_as_base64,
} from '$lib/file-viewer/eligibility'
import {
  indexed_trajectory_format,
  is_indexable_trajectory_filename,
} from '$lib/trajectory/format-detect'

export interface LargeFileMarker {
  file_path: string
  file_size: number
}

export const format_large_file_marker = ({
  file_path,
  file_size,
}: LargeFileMarker): string => {
  if (!file_path || !Number.isSafeInteger(file_size) || file_size < 0)
    throw new Error(`Invalid large file marker data`)
  return `LARGE_FILE:${file_path}:${file_size}`
}

export const parse_large_file_marker = (content: string): LargeFileMarker | null => {
  const prefix = `LARGE_FILE:`
  if (!content.startsWith(prefix)) return null
  const separator_idx = content.lastIndexOf(`:`)
  const file_path = content.slice(prefix.length, separator_idx)
  const size_text = content.slice(separator_idx + 1)
  const file_size = Number(size_text)
  if (!file_path || !/^\d+$/.test(size_text) || !Number.isSafeInteger(file_size))
    throw new Error(`Malformed large file marker`)
  return { file_path, file_size }
}

export type HostTransferRejectReason =
  | `file-too-large`
  | `unsupported-compression`
  | `unsupported-large-format`

export type HostFileTransferPlan =
  | { kind: `inline`; is_base64: boolean }
  | { kind: `marker`; content: string }
  | { kind: `reject`; reason: HostTransferRejectReason; max_file_size?: number }

export interface HostFileTransferInput extends LargeFileMarker {
  filename: string
  large_file_threshold: number
  max_file_size: number
  max_text_file_size: number
}

export const plan_host_file_transfer = ({
  filename,
  file_path,
  file_size,
  large_file_threshold,
  max_file_size,
  max_text_file_size,
}: HostFileTransferInput): HostFileTransferPlan => {
  const normalized_filename = normalize_browser_supported_filename(filename)
  const is_large_file = file_size > large_file_threshold
  const trajectory_format =
    normalized_filename !== null && is_indexable_trajectory_filename(normalized_filename)
      ? indexed_trajectory_format(normalized_filename)
      : null
  const format_max_file_size =
    is_large_file && trajectory_format === `xyz`
      ? Math.min(max_text_file_size, max_file_size)
      : max_file_size
  if (file_size > format_max_file_size) {
    return { kind: `reject`, reason: `file-too-large`, max_file_size: format_max_file_size }
  }
  if (!is_large_file)
    return { kind: `inline`, is_base64: should_encode_filename_as_base64(filename) }

  if (normalized_filename === null)
    return { kind: `reject`, reason: `unsupported-compression` }
  if (!trajectory_format) return { kind: `reject`, reason: `unsupported-large-format` }
  return {
    kind: `marker`,
    content: format_large_file_marker({ file_path, file_size }),
  }
}
