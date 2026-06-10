// Constants for trajectory parsing and large file handling
import { DEFAULTS } from '$lib/settings'

export const MAX_SAFE_STRING_LENGTH = 0x1fffffe8 * 0.5 // 50% of JS max string length as safety
export const MAX_METADATA_SIZE = 50 * 1024 * 1024 // 50MB limit for metadata
export const LARGE_FILE_THRESHOLD = 400 * 1024 * 1024 // 400MB
export const INDEX_SAMPLE_RATE = 100 // Default sample rate for frame indexing
// Fallback thresholds for component usage without loading_options, derived from the
// settings schema so settings-driven contexts (e.g. the VSCode extension) and direct
// component use agree on when large-file/indexed loading kicks in.
export const MAX_BIN_FILE_SIZE = DEFAULTS.trajectory.bin_file_threshold // 50MB
export const MAX_TEXT_FILE_SIZE = DEFAULTS.trajectory.text_file_threshold // 25MB
