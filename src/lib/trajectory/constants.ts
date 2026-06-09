// Constants for trajectory parsing and large file handling
export const MAX_SAFE_STRING_LENGTH = 0x1fffffe8 * 0.5 // 50% of JS max string length as safety
export const MAX_METADATA_SIZE = 50 * 1024 * 1024 // 50MB limit for metadata
export const LARGE_FILE_THRESHOLD = 400 * 1024 * 1024 // 400MB
export const INDEX_SAMPLE_RATE = 100 // Default sample rate for frame indexing
// CAUTION: these fallbacks intentionally-or-not DIVERGE from the settings-schema
// defaults DEFAULTS.trajectory.bin_file_threshold (50_000_000) and
// text_file_threshold (25_000_000) in [[src/lib/settings.ts]]. Contexts driven by
// the settings system (e.g. the VSCode extension, which forwards
// trajectory.bin/text_file_threshold into loading_options) use the ~2x smaller
// DEFAULTS values, while plain component usage without loading_options falls back
// to these constants (see Trajectory.svelte). Unify with care: changing either
// side changes when large-file/indexed loading kicks in.
export const MAX_BIN_FILE_SIZE = 100 * 1024 * 1024 // 100MB default for ArrayBuffer files
export const MAX_TEXT_FILE_SIZE = 50 * 1024 * 1024 // 50MB default for string files
