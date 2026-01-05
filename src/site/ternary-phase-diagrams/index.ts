import type { FileInfo } from '$lib'
import { decompress_data } from '$lib/io/decompress'
import type { TernaryPhaseDiagramData } from '$lib/phase-diagram'

// Auto-discover ternary phase diagram files using Vite's import.meta.glob
const ternary_pd_modules = import.meta.glob(`./*.json.gz`, {
  query: `?url`,
  eager: true,
  import: `default`,
}) as Record<string, string>

// Convert glob results to FileInfo array for ternary phase diagrams
export const ternary_phase_diagram_files: FileInfo[] = Object.entries(
  ternary_pd_modules,
).map(([path, url]) => {
  const name = path.split(`/`).pop() || path
  return {
    name,
    url,
    type: `json.gz`,
    category: `Ternary`,
    category_icon: `🔺`,
  }
})

// Load ternary phase diagram data from URL
export async function load_ternary_phase_diagram(
  url: string,
): Promise<TernaryPhaseDiagramData | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      console.error(`Failed to fetch ternary phase diagram: ${response.statusText}`)
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
      return JSON.parse(decompressed) as TernaryPhaseDiagramData
    }

    return (await response.json()) as TernaryPhaseDiagramData
  } catch (error) {
    console.error(`Failed to load ternary phase diagram from ${url}:`, error)
    return null
  }
}
