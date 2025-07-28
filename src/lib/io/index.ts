import type { FileInfo } from '$site'

export * from './decompress'
export * from './export'
export * from './parse'

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

async function load_binary_traj(
  resp: Response,
  type: string,
  fallback = false,
): Promise<ArrayBuffer | string> {
  try {
    const buffer = await resp.arrayBuffer()
    return buffer
  } catch (error) {
    if (fallback) {
      console.warn(`Binary load failed for ${type}, using text:`, error)
      return await resp.text()
    }
    console.error(`Binary load failed for ${type}:`, error)
    throw new Error(`Failed to load ${type} as binary: ${error}`)
  }
}

export async function load_from_url(
  url: string,
  callback: (content: string | ArrayBuffer, filename: string) => Promise<void> | void,
): Promise<void> {
  const filename = url.split(`/`).pop() || url
  const ext = filename.split(`.`).pop()?.toLowerCase() || ``

  // Check for known binary file extensions
  const known_bin_extensions = `h5 hdf5 traj npz pkl dat gz gzip zip bz2 xz`.split(` `)
  if (known_bin_extensions.includes(ext)) {
    // Force binary mode for known binary files to handle GitHub Pages content-type issues
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`)

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

      return callback(result, filename)
    }

    // For .traj files, ensure we always get ArrayBuffer for proper ASE parsing
    if (ext === `traj`) {
      const buffer = await load_binary_traj(resp, `.traj`)
      return callback(buffer, filename)
    }

    if (resp.headers.get(`content-encoding`) === `gzip`) {
      return callback(await resp.text(), filename)
    }

    return callback(await resp.arrayBuffer(), filename)
  }

  // Skip Range requests for known text formats to avoid production server issues
  const known_text_extensions =
    `xyz extxyz json cif poscar yaml yml txt md py js ts css html xml`.split(` `)
  // Include VASP files that don't have extensions (POSCAR, XDATCAR, CONTCAR)
  const is_known_text = known_text_extensions.includes(ext) ||
    filename.toLowerCase().match(/^(poscar|xdatcar|contcar)$/i)

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
          return callback(await resp.arrayBuffer(), filename)
        }
      }
    } catch {
      // Fall through to text fetch if HEAD request fails
    }
  }

  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`)
  return callback(await resp.text(), filename)
}

export const detect_structure_type = (
  filename: string,
  content: string,
): `crystal` | `molecule` | `unknown` => {
  const lower_filename = filename.toLowerCase()

  if (filename.endsWith(`.json`)) {
    try {
      return JSON.parse(content).lattice ? `crystal` : `molecule`
    } catch {
      return `unknown`
    }
  }

  if (lower_filename.endsWith(`.cif`)) return `crystal`
  if (lower_filename.includes(`poscar`) || filename === `POSCAR`) return `crystal`

  if (lower_filename.endsWith(`.yaml`) || lower_filename.endsWith(`.yml`)) {
    return content.includes(`phono3py:`) || content.includes(`phonopy:`)
      ? `crystal`
      : `unknown`
  }

  if (lower_filename.match(/\.(xyz|extxyz)(?:\.(?:gz|gzip|zip|bz2|xz))?$/)) {
    const lines = content.trim().split(/\r?\n/)
    return lines.length >= 2 && lines[1].includes(`Lattice=`) ? `crystal` : `molecule`
  }

  return `unknown`
}
