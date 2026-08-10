import type { FileInfo } from '$lib'
import type { PhaseDiagramData } from '$lib/phase-diagram'
import { build_diagram } from '$lib/phase-diagram/build-diagram'
import type { DiagramInput } from '$lib/phase-diagram/diagram-input'
import { normalize_system_name } from '$lib/phase-diagram/parse'

// Import all diagram JSON files eagerly
const diagram_modules = import.meta.glob<DiagramInput>(`./phase-diagrams/binary/data/*.json`, {
  eager: true,
  import: `default`,
})

// TDB files served at /phase-diagrams/tdb/<name> via the static symlink (url built from the
// path key, not the glob value)
const tdb_modules = import.meta.glob(`$site/phase-diagrams/tdb/*.tdb`, {
  query: `?url`,
})

const built_diagrams = Object.entries(diagram_modules).map(([path, input]) => {
  const name = path.split(`/`).pop()?.replace(`.json`, ``) ?? path
  return [name, build_diagram(input)] as const
})

// Convert to FileInfo array for binary phase diagrams
const binary_phase_diagram_files: FileInfo[] = built_diagrams.map(([name]) => ({
  name: `${name}.json`,
  url: `builtin:${name}`, // Special marker for built-in diagrams
  type: `json`,
  category: `Binary`,
  category_icon: `📊`,
}))

// Convert glob results to FileInfo array for TDB files
const tdb_files: FileInfo[] = Object.keys(tdb_modules).map((path) => {
  const name = path.split(`/`).pop() ?? path
  const url = path.replace(`/src/site`, ``) // e.g. /phase-diagrams/tdb/Al-Fe.tdb
  return { name, url, type: `tdb`, category: `TDB`, category_icon: `📄` }
})

// Combined list of all phase diagram files
export const all_phase_diagram_files: FileInfo[] = [
  ...binary_phase_diagram_files,
  ...tdb_files,
]

// Map normalized system names to precomputed diagrams for quick lookup
const precomputed_map = new Map(
  built_diagrams.map(([name, data]) => [normalize_system_name(name), data]),
)

// Find precomputed phase diagram by system name (handles any format: "Al-Cu", "AlCu", "al_cu")
export const find_precomputed_diagram = (system: string): PhaseDiagramData | undefined =>
  precomputed_map.get(normalize_system_name(system))
