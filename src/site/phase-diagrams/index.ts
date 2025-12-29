import type { FileInfo } from '$lib'
import { decompress_data } from '$lib/io/decompress'
import type { PhaseDiagramData } from '$lib/phase-diagram'
import { normalize_system_name } from '$lib/phase-diagram/parse'

// Auto-discover binary phase diagram files using Vite's import.meta.glob
// Supports both JSON and gzipped JSON files
const binary_pd_modules = import.meta.glob(`./binary/*.json.gz`, {
  query: `?url`,
  eager: true,
  import: `default`,
}) as Record<string, string>

// Auto-discover TDB files
const tdb_modules = import.meta.glob(`./tdb/*.tdb`, {
  query: `?url`,
  eager: true,
  import: `default`,
}) as Record<string, string>

// Convert glob results to FileInfo array for binary phase diagrams
export const binary_phase_diagram_files: FileInfo[] = Object.entries(
  binary_pd_modules,
).map(([path, url]) => {
  const name = path.split(`/`).pop() || path
  return { name, url, type: `json.gz`, category: `Binary`, category_icon: `📊` }
})

// Convert glob results to FileInfo array for TDB files
export const tdb_files: FileInfo[] = Object.entries(tdb_modules).map(
  ([path, url]) => {
    const name = path.split(`/`).pop() || path
    return { name, url, type: `tdb`, category: `TDB`, category_icon: `📄` }
  },
)

// Combined list of all phase diagram files
export const all_phase_diagram_files: FileInfo[] = [
  ...binary_phase_diagram_files,
  ...tdb_files,
]

// Map normalized system names to pre-computed JSON URLs for auto-loading when TDB is dropped
const precomputed_map = new Map(
  binary_phase_diagram_files.map((file) => [
    normalize_system_name(file.name.replace(/\.json(\.gz)?$/, ``)),
    file.url,
  ]),
)

// Find precomputed phase diagram URL by system name (handles any format: "Al-Cu", "AlCu", "al_cu")
export function find_precomputed_url(system: string): string | undefined {
  return precomputed_map.get(normalize_system_name(system))
}

// Load binary phase diagram data from URL
export async function load_binary_phase_diagram(
  url: string,
): Promise<PhaseDiagramData | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      console.error(`Failed to fetch phase diagram: ${response.statusText}`)
      return null
    }

    // Handle gzipped files using shared decompress utility
    // Note: Vite dev server may auto-decompress .gz files and serve as application/json
    const content_type = response.headers.get(`content-type`) || ``
    const is_json_content = content_type.includes(`application/json`)
    const is_gzipped_content = content_type.includes(`gzip`) ||
      content_type.includes(`octet-stream`)

    // Only decompress if content is actually gzipped (not if Vite already decompressed it)
    const needs_decompress = !is_json_content &&
      (is_gzipped_content || url.endsWith(`.gz`))

    if (needs_decompress) {
      const buffer = await response.arrayBuffer()
      const decompressed = await decompress_data(buffer, `gzip`)
      return JSON.parse(decompressed) as PhaseDiagramData
    }

    return (await response.json()) as PhaseDiagramData
  } catch (error) {
    console.error(`Failed to load phase diagram from ${url}:`, error)
    return null
  }
}
