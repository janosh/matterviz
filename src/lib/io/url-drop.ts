import { load_binary_traj } from '$lib/trajectory/parse'
import { decompress_data_binary } from './decompress'
import type { FileInfo } from './types'

const BINARY_EXTENSIONS = new Set(
  `h5 hdf5 traj npz pkl dat gz gzip zip bz2 xz brml raw`.split(` `),
)
const TEXT_EXTENSIONS = new Set(
  `xyz extxyz json cif poscar yaml yml txt md py js ts css html xml`.split(` `),
)
const VASP_BASENAME_RE = /^(poscar|xdatcar|contcar)$/i
const GZ_EXT_RE = /\.(gz|gzip)$/i

// Extract filename from Content-Disposition header, falling back to url_basename.
function extract_filename(headers: Headers | undefined, fallback: string): string {
  if (!headers) return fallback
  const content_disposition_str = headers.get(`content-disposition`)
  if (!content_disposition_str) return fallback
  const star_match = /filename\*=([^;]+)/i.exec(content_disposition_str)
  if (star_match?.[1]) {
    let raw = star_match[1].trim().replaceAll(/^"|"$/g, ``)
    // Strip any RFC 5987 charset'language' prefix; bare values pass through unchanged
    const ext_value_match = /^[\w!#$%&+^`{}~-]+'[\w-]*'(.*)$/.exec(raw)
    if (ext_value_match) raw = ext_value_match[1]
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }
  const plain_match = /filename\s*=\s*"?([^";]+)"?/i.exec(content_disposition_str)
  // truthiness check (not ??) so whitespace-only `filename=` values fall back too
  const name = plain_match?.[1]?.trim()
  if (!name) return fallback
  return name
}

const ext_of = (name: string): string => name.split(`.`).pop()?.toLowerCase() ?? ``

// Whether the file inside a .gz/.gzip wrapper is a known binary format that a
// lossy text decode would corrupt (bytes >= 0x80 → U+FFFD)
const has_binary_inner_ext = (filename: string): boolean =>
  BINARY_EXTENSIONS.has(ext_of(filename.replace(GZ_EXT_RE, ``)))

// Gunzip a fetched payload → [content, filename] with .gz/.gzip stripped; content
// stays an ArrayBuffer for binary inner formats, decoded string otherwise
async function decompress_gz_payload(
  buffer: ArrayBuffer,
  filename: string,
): Promise<[content: string | ArrayBuffer, filename: string]> {
  const decompressed = await decompress_data_binary(buffer, `gzip`)
  const content = has_binary_inner_ext(filename)
    ? decompressed
    : new TextDecoder().decode(decompressed)
  return [content, filename.replace(GZ_EXT_RE, ``)]
}

// Handle URL-based file drop data by fetching content lazily
export async function handle_url_drop(
  drag_event: DragEvent,
  callback: (content: string | ArrayBuffer, filename: string) => Promise<void> | void,
): Promise<boolean> {
  const json_data = drag_event.dataTransfer?.getData(`application/json`)
  if (!json_data) return false

  let file_info: FileInfo
  try {
    file_info = JSON.parse(json_data)
  } catch {
    return false
  }
  if (!file_info.url) return false

  await load_from_url(file_info.url, callback)
  return true
}

export async function load_from_url(
  url: string,
  callback: (content: string | ArrayBuffer, filename: string) => Promise<void> | void,
): Promise<void> {
  // Strip query string/hash before basename/extension detection so pre-signed
  // URLs like traj.h5?X-Amz-Expires=300 still hit the right format path
  const url_basename = url.split(/[?#]/)[0].split(`/`).pop() ?? url
  const ext = ext_of(url_basename)

  if (BINARY_EXTENSIONS.has(ext)) {
    // Force binary mode for known binary files to handle GitHub Pages content-type issues
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`)
    const filename = extract_filename(resp.headers, url_basename)

    // Handle gzipped files with proper content-encoding detection
    if (ext === `gz` || ext === `gzip`) {
      if (resp.headers.get(`content-encoding`) === `gzip`) {
        // Browser already decompressed the stored .gz (GitHub Pages-style serving), so
        // the body is the inner file — keep binary inner formats (.h5.gz, ...) binary
        return callback(
          await (has_binary_inner_ext(filename) ? resp.arrayBuffer() : resp.text()),
          filename,
        )
      }
      return callback(...(await decompress_gz_payload(await resp.arrayBuffer(), filename)))
    }

    // For H5 files, always load as binary regardless of signature
    // to handle files that have .h5/.hdf5 extensions but may not have the proper HDF5 signature
    if (ext === `h5` || ext === `hdf5`) {
      const result = await load_binary_traj(resp, `H5`, true)

      // Log warning if signature doesn't match (only for ArrayBuffer results)
      if (result instanceof ArrayBuffer && result.byteLength >= 8) {
        const view = new Uint8Array(result.slice(0, 8))
        const hdf5_signature = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]
        if (!hdf5_signature.every((byte, idx) => view[idx] === byte)) {
          console.warn(`File has .h5/.hdf5 extension but missing HDF5 signature`)
        }
      }

      return callback(result, filename)
    }

    // For .traj files, ensure we always get ArrayBuffer for proper ASE parsing
    if (ext === `traj`) {
      const buffer = await load_binary_traj(resp, `.traj`)
      return callback(buffer, filename)
    }

    // Content-Encoding is transparent transport compression: fetch already
    // decompressed the body, so binary formats (npz, pkl, brml, ...) must still
    // be read as ArrayBuffer — .text() would corrupt them via lossy UTF-8 decode
    return callback(await resp.arrayBuffer(), filename)
  }

  // Skip Range requests for known text formats to avoid production server issues
  // Include VASP files that don't have extensions (POSCAR, XDATCAR, CONTCAR)
  const is_known_text = TEXT_EXTENSIONS.has(ext) || VASP_BASENAME_RE.test(url_basename)
  let sniffed_callback_args: [content: string | ArrayBuffer, filename: string] | undefined

  if (!is_known_text) {
    // Only the Range sniff is guarded (failure → plain text fetch). Once magic bytes
    // commit to a binary format, download/decompress errors must propagate instead of
    // falling through to a text fetch that would parse the binary bytes as garbage.
    let sniffed: `gzip` | `binary` | null = null
    try {
      // Check for magic bytes only for unknown formats (covers extensionless URLs
      // like blob: object URLs whose basenames are UUIDs)
      const head = await fetch(url, { headers: { Range: `bytes=0-15` } })
      if (head.ok) {
        const buf = new Uint8Array(await head.arrayBuffer())
        const is_gzip = buf[0] === 0x1f && buf[1] === 0x8b
        const is_hdf5 =
          buf[0] === 0x89 && buf[1] === 0x48 && buf[2] === 0x44 && buf[3] === 0x46
        // ASE .traj files start with the Ulm signature "- of Ulm"
        const is_ase_traj = [0x2d, 0x20, 0x6f, 0x66, 0x20, 0x55, 0x6c, 0x6d].every(
          (byte, idx) => buf[idx] === byte,
        )
        if (is_gzip) sniffed = `gzip`
        else if (is_hdf5 || is_ase_traj) sniffed = `binary`
      }
    } catch {
      // Fall through to text fetch if the Range HEAD request fails
    }

    if (sniffed) {
      const resp = await fetch(url)
      if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`)
      const filename = extract_filename(resp.headers, url_basename)
      const buffer = await resp.arrayBuffer()
      // Gunzip sniffed gzip — downstream parsers can't handle raw gzip bytes
      sniffed_callback_args =
        sniffed === `gzip` ? await decompress_gz_payload(buffer, filename) : [buffer, filename]
    }
  }

  if (sniffed_callback_args) return callback(...sniffed_callback_args)

  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`)
  return callback(await resp.text(), extract_filename(resp.headers, url_basename))
}
