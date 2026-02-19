// Constants for trajectory parsing and large file handling
export const MAX_SAFE_STRING_LENGTH = 0x1fffffe8 * 0.5 // 50% of JS max string length as safety
export const MAX_METADATA_SIZE = 50 * 1024 * 1024 // 50MB limit for metadata
export const LARGE_FILE_THRESHOLD = 400 * 1024 * 1024 // 400MB
export const INDEX_SAMPLE_RATE = 100 // Default sample rate for frame indexing
export const MAX_BIN_FILE_SIZE = 100 * 1024 * 1024 // 100MB default for ArrayBuffer files
export const MAX_TEXT_FILE_SIZE = 50 * 1024 * 1024 // 50MB default for string files
