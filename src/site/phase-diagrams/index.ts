import type { FileInfo } from '$lib'
import type { PhaseDiagramData } from '$lib/phase-diagram'
import { build_diagram } from '$lib/phase-diagram/build-diagram'
import type { DiagramInput } from '$lib/phase-diagram/diagram-input'
import { normalize_system_name } from '$lib/phase-diagram/parse'

// Import all diagram JSON files eagerly
const diagram_modules = import.meta.glob(`./binary/data/*.json`, {
  eager: true,
  import: `default`,
}) as Record<string, DiagramInput>

// Auto-discover TDB files
const tdb_modules = import.meta.glob(`./tdb/*.tdb`, {
  query: `?url`,
  eager: true,
  import: `default`,
}) as Record<string, string>

// Build all diagrams from JSON data
const built_diagrams = new Map<string, PhaseDiagramData>()
for (const [path, input] of Object.entries(diagram_modules)) {
  const name = path.split(`/`).pop()?.replace(`.json`, ``) || path
  built_diagrams.set(name, build_diagram(input))
}

// Convert to FileInfo array for binary phase diagrams
// These are now built-in (no URL needed), but we keep the API compatible
export const binary_phase_diagram_files: FileInfo[] = Array.from(
  built_diagrams.keys(),
).map((name) => ({
  name: `${name}.json`,
  url: `builtin:${name}`, // Special marker for built-in diagrams
  type: `json`,
  category: `Binary`,
  category_icon: `📊`,
}))

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

// Map normalized system names to {original_name, data} for quick lookup
const precomputed_map = new Map(
  Array.from(built_diagrams.entries()).map(([name, data]) => [
    normalize_system_name(name),
    { name, data },
  ]),
)

// Find precomputed phase diagram by system name (handles any format: "Al-Cu", "AlCu", "al_cu")
export function find_precomputed_diagram(
  system: string,
): PhaseDiagramData | undefined {
  return precomputed_map.get(normalize_system_name(system))?.data
}

// Backward compatibility: find precomputed URL by system name
// Returns a builtin: URL that load_binary_phase_diagram can handle
export function find_precomputed_url(system: string): string | undefined {
  const entry = precomputed_map.get(normalize_system_name(system))
  return entry ? `builtin:${entry.name}` : undefined
}

// Get diagram by exact name
export function get_diagram(name: string): PhaseDiagramData | undefined {
  return built_diagrams.get(name)
}

// For backward compatibility - load binary phase diagram
export async function load_binary_phase_diagram(
  url: string,
): Promise<PhaseDiagramData | null> {
  // Handle built-in diagrams (new format)
  if (url.startsWith(`builtin:`)) {
    const name = url.replace(`builtin:`, ``)
    return built_diagrams.get(name) ?? null
  }

  // Handle legacy .json.gz URLs - try to extract system name
  const match = url.match(/([A-Za-z0-9]+-[A-Za-z0-9]+)\.json/)
  if (match) {
    const system = match[1]
    const diagram = find_precomputed_diagram(system)
    if (diagram) return diagram
  }

  // Fallback: try to fetch from URL (for external files)
  try {
    const response = await fetch(url)
    if (!response.ok) {
      console.error(`Failed to fetch phase diagram: ${response.statusText}`)
      return null
    }
    return (await response.json()) as PhaseDiagramData
  } catch (error) {
    console.error(`Failed to load phase diagram from ${url}:`, error)
    return null
  }
}

// Export the build function for users who want to create custom diagrams
export { build_diagram } from '$lib/phase-diagram/build-diagram'
export type { DiagramInput } from '$lib/phase-diagram/diagram-input'
