import { load_binary_traj } from '$lib/trajectory/parse'
import { decompress_data_binary } from './decompress'
import {
  BINARY_EXTENSIONS,
  ext_of,
  has_binary_inner_ext,
  has_binary_magic,
  has_gzip_magic,
  has_hdf5_magic,
  is_known_text_file,
  strip_gz_ext,
} from './is-binary'
import type { FileInfo } from './types'

// Extract filename from Content-Disposition header, falling back to url_basename.
function extract_filename(headers: Headers | undefined, fallback: string): string {
  if (!headers) return fallback
  const content_disposition_str = headers.get(`content-disposition`)
  if (!content_disposition_str) return fallback
  const star_match = /filename\*=(?<value>[^;]+)/i.exec(content_disposition_str)
  if (star_match?.[1]) {
    let raw = star_match[1].trim().replaceAll(/^"|"$/g, ``)
    // Strip any RFC 5987 charset'language' prefix; bare values pass through unchanged
    const ext_value_match = /^[\w!#$%&+^`{}~-]+'[\w-]*'(?<value>.*)$/.exec(raw)
    if (ext_value_match) raw = ext_value_match[1]
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }
  const plain_match = /filename\s*=\s*"?(?<value>[^";]+)"?/i.exec(content_disposition_str)
  // truthiness check (not ??) so whitespace-only `filename=` values fall back too
  const name = plain_match?.[1]?.trim()
  if (!name) return fallback
  return name
}

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
  return [content, strip_gz_ext(filename)]
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
      if (
        result instanceof ArrayBuffer &&
        result.byteLength >= 8 &&
        !has_hdf5_magic(new Uint8Array(result.slice(0, 8)))
      ) {
        console.warn(`File has .h5/.hdf5 extension but missing HDF5 signature`)
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
  const is_known_text = is_known_text_file(url_basename)
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
        // gzip is gunzipped downstream; other binary magic (HDF5, ZIP, ASE Ulm) stays raw
        if (has_gzip_magic(buf)) sniffed = `gzip`
        else if (has_binary_magic(buf)) sniffed = `binary`
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
