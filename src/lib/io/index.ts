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
  // returns crystal if file contains a cell, else molecule
  if (filename.endsWith(`.json`)) {
    try {
      const parsed = JSON.parse(content)
      return (parsed as { lattice?: unknown }).lattice ? `crystal` : `molecule`
    } catch {
      return `unknown`
    }
  }

  // for now,CIF files always represent crystals with lattice
  if (filename.toLowerCase().endsWith(`.cif`)) return `crystal`

  // POSCAR files always represent crystals with lattice
  if (filename.toLowerCase().includes(`poscar`) || filename === `POSCAR`) {
    return `crystal`
  }

  // YAML files: phonopy files always represent crystal structures with lattices
  if (
    filename.toLowerCase().endsWith(`.yaml`) ||
    filename.toLowerCase().endsWith(`.yml`)
  ) {
    const is_phonopy = content.includes(`phono3py:`) || content.includes(`phonopy:`)
    // Check if it's a phonopy file by looking for phonopy-specific content
    if (is_phonopy) return `crystal`
    return `unknown`
  }

  // XYZ files: try to detect lattice info from content
  if (filename.endsWith(`.xyz`)) {
    try {
      // Simple heuristic: check for lattice information in XYZ comment line
      const lines = content.trim().split(/\r?\n/)
      if (lines.length >= 2 && lines[1].includes(`Lattice=`)) {
        return `crystal`
      }
      return `molecule`
    } catch {
      return `unknown`
    }
  }

  return `unknown`
}
