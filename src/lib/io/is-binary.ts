// Single source of truth for binary-vs-text detection in the io layer (used by
// decompress.ts and url-drop.ts): (1) is_binary string heuristic, (2) has_*_magic byte
// signatures, (3) extension/filename classification.

import {
  BINARY_VIEWER_EXTENSIONS,
  VASP_STRUCTURE_FILES,
  VASP_TRAJECTORY_FILES,
} from '$lib/constants'

// === (1) string-content heuristic ===
// Detect binary from decoded text: a NUL byte or a high ratio of non-printable chars. Only
// the leading window is inspected (like file(1)): a 25 MB trajectory is classified in
// microseconds instead of a full 50 ms scan, and binary headers sit at the front anyway.
const BINARY_SNIFF_CHARS = 8192
export const is_binary = (content: string): boolean => {
  if (!content) return false
  const sample = content.slice(0, BINARY_SNIFF_CHARS)
  if (sample.includes(`\0`)) return true

  let binary_char_count = 0
  let printable_ascii_count = 0

  for (let char_idx = 0; char_idx < sample.length; char_idx += 1) {
    const char_code = sample.charCodeAt(char_idx)
    if (
      char_code <= 8 ||
      (char_code >= 14 && char_code <= 31) ||
      (char_code >= 127 && char_code <= 255)
    ) {
      binary_char_count += 1
    }
    // 9-13 (tab, LF, VT, FF, CR) are text: excluding them read CRLF XYZ as binary
    if ((char_code >= 32 && char_code <= 126) || (char_code >= 9 && char_code <= 13)) {
      printable_ascii_count += 1
    }
  }

  return binary_char_count / sample.length > 0.1 || printable_ascii_count / sample.length < 0.7
}

// === (2) magic-byte signatures ===
const starts_with = (bytes: Uint8Array, sig: number[]): boolean =>
  bytes.length >= sig.length && sig.every((byte, idx) => bytes[idx] === byte)

// Leading bytes to test a magic signature against. Guards the slice: byteLength reads 0 for
// a detached ArrayBuffer and slice() throws on one. Short buffers are passed through as-is
// so a 2-byte gzip header still matches — every has_*_magic below length-checks itself.
export const magic_head = (buffer: ArrayBuffer, count = 8): Uint8Array =>
  buffer.byteLength === 0 ? new Uint8Array() : new Uint8Array(buffer.slice(0, count))

// gzip member header
export const has_gzip_magic = (bytes: Uint8Array): boolean => starts_with(bytes, [0x1f, 0x8b])

// Full 8-byte HDF5 superblock signature "\x89HDF\r\n\x1a\n" — used to validate that a file
// claiming a .h5/.hdf5 extension really is HDF5 (stricter than the binary sniff below).
export const has_hdf5_magic = (bytes: Uint8Array): boolean =>
  starts_with(bytes, [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a])

// ASE .traj container header "- of Ulm"
export const has_ase_traj_magic = (bytes: Uint8Array): boolean =>
  starts_with(bytes, [0x2d, 0x20, 0x6f, 0x66, 0x20, 0x55, 0x6c, 0x6d])

// Leading bytes that mark a payload as binary so a lossy UTF-8 decode would corrupt it.
// HDF5 is matched by its 4-byte "\x89HDF" prefix (the non-ASCII 0x89 already rules out text
// starting with "HDF"); the full 4-byte ZIP signatures rule out text merely starting "PK".
export const has_binary_magic = (bytes: Uint8Array): boolean =>
  has_gzip_magic(bytes) ||
  starts_with(bytes, [0x89, 0x48, 0x44, 0x46]) || // HDF5 "\x89HDF"
  starts_with(bytes, [0x50, 0x4b, 0x03, 0x04]) || // ZIP local file
  starts_with(bytes, [0x50, 0x4b, 0x05, 0x06]) || // ZIP empty archive (EOCD)
  starts_with(bytes, [0x50, 0x4b, 0x07, 0x08]) || // ZIP spanned
  has_ase_traj_magic(bytes)

// === (3) extension / filename classification ===
export const ext_of = (name: string): string => name.split(`.`).pop()?.toLowerCase() ?? ``

// Binary data formats whose lossy UTF-8 decode would corrupt bytes (post-decompression)
const BINARY_DATA_EXTENSIONS = new Set([
  ...BINARY_VIEWER_EXTENSIONS,
  ...`npz pkl dat brml raw`.split(` `),
])
export const is_binary_data_extension = (ext: string): boolean =>
  BINARY_DATA_EXTENSIONS.has(ext)

// Known text formats (plus extensionless VASP files) — safe to fetch/sniff as text
const TEXT_EXTENSIONS = new Set(
  `xyz extxyz json cif poscar yaml yml txt md py js ts css html xml`.split(` `),
)
const VASP_BASENAME_RE = new RegExp(
  `^(?:${[...VASP_STRUCTURE_FILES, ...VASP_TRAJECTORY_FILES].join(`|`)})$`,
  `i`,
)
export const is_known_text_file = (basename: string): boolean =>
  TEXT_EXTENSIONS.has(ext_of(basename)) || VASP_BASENAME_RE.test(basename)

// Binary if the (post-decompression) extension is a known binary data format or the leading
// bytes match a magic signature
export const is_binary_payload = (filename: string, buffer: ArrayBuffer): boolean =>
  is_binary_data_extension(ext_of(filename)) || has_binary_magic(magic_head(buffer))
