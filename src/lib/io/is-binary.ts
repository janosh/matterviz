// Single source of truth for binary-vs-text detection in the io layer (used by
// decompress.ts and url-drop.ts): (1) is_binary string heuristic, (2) has_*_magic byte
// signatures, (3) extension/filename classification.

// === (1) string-content heuristic ===
// Detect binary from decoded text: a NUL byte or a high ratio of non-printable chars.
export const is_binary = (content: string): boolean => {
  if (!content) return false
  if (content.includes(`\0`)) return true

  let binary_char_count = 0
  let printable_ascii_count = 0

  for (let char_idx = 0; char_idx < content.length; char_idx += 1) {
    const char_code = content.charCodeAt(char_idx)
    if (
      char_code <= 8 ||
      (char_code >= 14 && char_code <= 31) ||
      (char_code >= 127 && char_code <= 255)
    ) {
      binary_char_count += 1
    }
    if (char_code >= 32 && char_code <= 126) printable_ascii_count += 1
  }

  return (
    binary_char_count / content.length > 0.1 || printable_ascii_count / content.length < 0.7
  )
}

// === (2) magic-byte signatures ===
const starts_with = (bytes: Uint8Array, sig: number[]): boolean =>
  bytes.length >= sig.length && sig.every((byte, idx) => bytes[idx] === byte)

// gzip member header
export const has_gzip_magic = (bytes: Uint8Array): boolean => starts_with(bytes, [0x1f, 0x8b])

// Full 8-byte HDF5 superblock signature "\x89HDF\r\n\x1a\n" — used to validate that a file
// claiming a .h5/.hdf5 extension really is HDF5 (stricter than the binary sniff below).
export const has_hdf5_magic = (bytes: Uint8Array): boolean =>
  starts_with(bytes, [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a])

// Leading bytes that mark a payload as binary so a lossy UTF-8 decode would corrupt it.
// HDF5 is matched by its 4-byte "\x89HDF" prefix (the non-ASCII 0x89 already rules out text
// starting with "HDF"); the full 4-byte ZIP signatures rule out text merely starting "PK".
export const has_binary_magic = (bytes: Uint8Array): boolean =>
  has_gzip_magic(bytes) ||
  starts_with(bytes, [0x89, 0x48, 0x44, 0x46]) || // HDF5 "\x89HDF"
  starts_with(bytes, [0x50, 0x4b, 0x03, 0x04]) || // ZIP local file
  starts_with(bytes, [0x50, 0x4b, 0x05, 0x06]) || // ZIP empty archive (EOCD)
  starts_with(bytes, [0x50, 0x4b, 0x07, 0x08]) || // ZIP spanned
  starts_with(bytes, [0x2d, 0x20, 0x6f, 0x66, 0x20, 0x55, 0x6c, 0x6d]) // ASE .traj "- of Ulm"

// === (3) extension / filename classification ===
export const ext_of = (name: string): string => name.split(`.`).pop()?.toLowerCase() ?? ``

// Binary data formats whose lossy UTF-8 decode would corrupt bytes (post-decompression)
const BINARY_DATA_EXTENSIONS = new Set(`h5 hdf5 traj npz pkl dat brml raw`.split(` `))

// All extensions treated as binary: data formats + compressed wrappers that must be
// downloaded/kept as raw bytes (used for binary-fetch mode and .gz inner-format checks)
export const BINARY_EXTENSIONS = new Set([
  ...BINARY_DATA_EXTENSIONS,
  ...`gz gzip zip bz2 xz`.split(` `),
])

// Known text formats (plus extensionless VASP files) — safe to fetch/sniff as text
const TEXT_EXTENSIONS = new Set(
  `xyz extxyz json cif poscar yaml yml txt md py js ts css html xml`.split(` `),
)
const VASP_BASENAME_RE = /^(?:poscar|xdatcar|contcar)$/i
export const is_known_text_file = (basename: string): boolean =>
  TEXT_EXTENSIONS.has(ext_of(basename)) || VASP_BASENAME_RE.test(basename)

const GZ_EXT_RE = /\.(?:gz|gzip)$/i
// Strip a trailing .gz/.gzip wrapper extension, leaving any inner extension intact
export const strip_gz_ext = (filename: string): string => filename.replace(GZ_EXT_RE, ``)

// Whether the file inside a .gz/.gzip wrapper is a known binary format that a lossy text
// decode would corrupt (bytes >= 0x80 -> U+FFFD)
export const has_binary_inner_ext = (filename: string): boolean =>
  BINARY_EXTENSIONS.has(ext_of(strip_gz_ext(filename)))

// Binary if the (post-decompression) extension is a known binary data format or the leading
// bytes match a magic signature
export const is_binary_payload = (filename: string, buffer: ArrayBuffer): boolean =>
  BINARY_DATA_EXTENSIONS.has(ext_of(filename)) ||
  has_binary_magic(new Uint8Array(buffer.slice(0, 8)))
