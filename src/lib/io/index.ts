import type { FileInfo } from '$lib'
import { load_binary_traj } from '$lib/trajectory/parse'

export * from './decompress'
export * from './export'
export * from './fetch'

// Handle URL-based file drop data by fetching content lazily
export async function handle_url_drop(
  drag_event: DragEvent,
  callback: (content: string | ArrayBuffer, filename: string) => Promise<void> | void,
): Promise<boolean> {
  const json_data = drag_event.dataTransfer?.getData(`application/json`)
  if (!json_data) return false

  const file_info: FileInfo = JSON.parse(json_data)
  if (!file_info.url) return false

  await load_from_url(file_info.url, callback)
  return true
}

export async function load_from_url(
  url: string,
  callback: (content: string | ArrayBuffer, filename: string) => Promise<void> | void,
): Promise<void> {
  const url_basename = url.split(`/`).pop() || url
  const ext = url_basename.split(`.`).pop()?.toLowerCase() || ``

  const extract_filename = (headers?: Headers): string => {
    const fallback = url_basename
    if (!headers) return fallback
    const content_disposition_str = headers.get(`content-disposition`)
    if (!content_disposition_str) return fallback
    const star_match = /filename\*=(?:UTF-8''|)([^;]+)/i.exec(content_disposition_str)
    if (star_match?.[1]) {
      const raw = star_match[1].trim().replace(/^"|"$/g, ``)
      try {
        return decodeURIComponent(raw)
      } catch {
        return raw
      }
    }
    const plain_match = /filename\s*=\s*"?([^";]+)"?/i.exec(content_disposition_str)
    return plain_match?.[1]?.trim() || fallback
  }

  // Check for known binary file extensions
  const known_bin_extensions = `h5 hdf5 traj npz pkl dat gz gzip zip bz2 xz brml`.split(
    ` `,
  )
  if (known_bin_extensions.includes(ext)) {
    // Force binary mode for known binary files to handle GitHub Pages content-type issues
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`)
    const filename = extract_filename(resp.headers)

    // Handle gzipped files with proper content-encoding detection
    if (ext === `gz` || ext === `gzip`) {
      if (resp.headers.get(`content-encoding`) === `gzip`) {
        // Browser automatically decompressed it, so it's text
        return callback(await resp.text(), filename)
      } else {
        // Need to decompress manually
        const { decompress_data } = await import(`./decompress`)
        const buffer = await resp.arrayBuffer()
        const content = await decompress_data(buffer, `gzip`)
        // Remove .gz extension when manually decompressing
        return callback(content, filename.replace(/\.gz$/, ``))
      }
    }

    // For H5 files, always load as binary regardless of signature
    // to handle files that have .h5/.hdf5 extensions but may not have the proper HDF5 signature
    if ([`h5`, `hdf5`].includes(ext)) {
      const result = await load_binary_traj(resp, `H5`, true)

      // Log warning if signature doesn't match (only for ArrayBuffer results)
      if (result instanceof ArrayBuffer && result.byteLength >= 8) {
        const view = new Uint8Array(result.slice(0, 8))
        const hdf5_signature = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]
        if (!hdf5_signature.every((byte, idx) => view[idx] === byte)) {
          console.warn(`File has .h5/.hdf5 extension but missing HDF5 signature`)
        }
      }

      return callback(result, extract_filename(resp.headers))
    }

    // For .traj files, ensure we always get ArrayBuffer for proper ASE parsing
    if (ext === `traj`) {
      const buffer = await load_binary_traj(resp, `.traj`)
      return callback(buffer, extract_filename(resp.headers))
    }

    if (resp.headers.get(`content-encoding`) === `gzip`) {
      return callback(await resp.text(), extract_filename(resp.headers))
    }

    return callback(await resp.arrayBuffer(), extract_filename(resp.headers))
  }

  // Skip Range requests for known text formats to avoid production server issues
  const known_text_extensions =
    `xyz extxyz json cif poscar yaml yml txt md py js ts css html xml`.split(` `)
  // Include VASP files that don't have extensions (POSCAR, XDATCAR, CONTCAR)
  const is_known_text = known_text_extensions.includes(ext) ||
    url_basename.toLowerCase().match(/^(poscar|xdatcar|contcar)$/i)

  if (!is_known_text) {
    try { // Check for magic bytes only for unknown formats
      const head = await fetch(url, { headers: { Range: `bytes=0-15` } })
      if (head.ok) {
        const buf = new Uint8Array(await head.arrayBuffer())
        const is_gzip = buf[0] === 0x1f && buf[1] === 0x8b
        const is_hdf5 = buf[0] === 0x89 && buf[1] === 0x48 && buf[2] === 0x44 &&
          buf[3] === 0x46
        if (is_gzip || is_hdf5) {
          const resp = await fetch(url)
          if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`)
          return callback(await resp.arrayBuffer(), extract_filename(resp.headers))
        }
      }
    } catch {
      // Fall through to text fetch if HEAD request fails
    }
  }

  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`)
  return callback(await resp.text(), extract_filename(resp.headers))
}
