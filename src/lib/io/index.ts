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

// Generic function to load data from URL and call callback
export async function load_from_url(
  url: string,
  callback: (content: string | ArrayBuffer, filename: string) => Promise<void> | void,
): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Fetch failed: ${response.status}`)

  const filename = url.split(`/`).pop() || url
  const is_binary = /\.(h5|hdf5|traj)$/i.test(filename)

  const content = is_binary ? await response.arrayBuffer() : await response.text()
  await callback(content, filename)
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

  if (lower_filename.match(/\.xyz(?:\.(?:gz|gzip|zip|bz2|xz))?$/)) {
    const lines = content.trim().split(/\r?\n/)
    return lines.length >= 2 && lines[1].includes(`Lattice=`) ? `crystal` : `molecule`
  }

  return `unknown`
}
