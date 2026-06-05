import { load_binary_traj } from '$lib/trajectory/parse'
import { decompress_data } from './decompress'
import type { FileInfo } from './types'

const BINARY_EXTENSIONS = new Set(
  `h5 hdf5 traj npz pkl dat gz gzip zip bz2 xz brml`.split(` `),
)
const TEXT_EXTENSIONS = new Set(
  `xyz extxyz json cif poscar yaml yml txt md py js ts css html xml`.split(` `),
)
const VASP_BASENAME_RE = /^(poscar|xdatcar|contcar)$/i

// Extract filename from Content-Disposition header, falling back to url_basename.
function extract_filename(headers: Headers | undefined, fallback: string): string {
  if (!headers) return fallback
  const content_disposition_str = headers.get(`content-disposition`)
  if (!content_disposition_str) return fallback
  const star_match = /filename\*=(?:UTF-8''|)([^;]+)/i.exec(content_disposition_str)
  if (star_match?.[1]) {
    const raw = star_match[1].trim().replaceAll(/^"|"$/g, ``)
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
  const url_basename = url.split(`/`).pop() ?? url
  const ext = url_basename.split(`.`).pop()?.toLowerCase() ?? ``

  if (BINARY_EXTENSIONS.has(ext)) {
    // Force binary mode for known binary files to handle GitHub Pages content-type issues
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`)
    const filename = extract_filename(resp.headers, url_basename)

    // Handle gzipped files with proper content-encoding detection
    if (ext === `gz` || ext === `gzip`) {
      if (resp.headers.get(`content-encoding`) === `gzip`) {
        // Browser automatically decompressed it, so it's text
        return callback(await resp.text(), filename)
      }
      // Need to decompress manually
      const buffer = await resp.arrayBuffer()
      const content = await decompress_data(buffer, `gzip`)
      // Remove .gz/.gzip extension when manually decompressing
      return callback(content, filename.replace(/\.(gz|gzip)$/i, ``))
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
        if (is_gzip || is_hdf5 || is_ase_traj) {
          const resp = await fetch(url)
          if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`)
          const filename = extract_filename(resp.headers, url_basename)
          const buffer = await resp.arrayBuffer()
          // Decompress sniffed gzip since downstream parsers expect text or
          // format-specific binary, not raw gzip bytes
          sniffed_callback_args = is_gzip
            ? [await decompress_data(buffer, `gzip`), filename.replace(/\.(gz|gzip)$/i, ``)]
            : [buffer, filename]
        }
      }
    } catch {
      // Fall through to text fetch if HEAD request fails
    }
  }

  if (sniffed_callback_args) return callback(...sniffed_callback_args)

  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`)
  return callback(await resp.text(), extract_filename(resp.headers, url_basename))
}
