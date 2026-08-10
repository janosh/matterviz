import type { FileInfo } from '$lib'
import type { PhaseDiagramData } from '$lib/phase-diagram'
import { build_diagram } from '$lib/phase-diagram/build-diagram'
import type { DiagramInput } from '$lib/phase-diagram/diagram-input'
import { normalize_system_name } from '$lib/phase-diagram/parse'
import { SvelteMap } from 'svelte/reactivity'

const diagram_modules = import.meta.glob<DiagramInput>(`./phase-diagrams/binary/data/*.json`, {
  eager: true,
  import: `default`,
})

// The static symlink serves these fixtures at /phase-diagrams/tdb/<name>.
const tdb_modules = import.meta.glob(`$site/phase-diagrams/tdb/*.tdb`, {
  query: `?url`,
})

const built_diagrams = Object.entries(diagram_modules).map(([path, input]) => {
  const name = path.split(`/`).pop()?.replace(`.json`, ``) ?? path
  return [name, build_diagram(input)] as const
})

const binary_phase_diagram_files: FileInfo[] = built_diagrams.map(([name]) => ({
  name: `${name}.json`,
  url: `builtin:${name}`, // Special marker for built-in diagrams
  type: `json`,
  category: `Binary`,
  category_icon: `📊`,
}))

const tdb_files: FileInfo[] = Object.keys(tdb_modules).map((path) => {
  const name = path.split(`/`).pop() ?? path
  const url = path.replace(`/src/site`, ``) // e.g. /phase-diagrams/tdb/Al-Fe.tdb
  return { name, url, type: `tdb`, category: `TDB`, category_icon: `📄` }
})

export const all_phase_diagram_files: FileInfo[] = [
  ...binary_phase_diagram_files,
  ...tdb_files,
]

const precomputed_map = new SvelteMap(
  built_diagrams.map(([name, data]) => [normalize_system_name(name), data]),
)

// Find precomputed phase diagram by system name (handles any format: "Al-Cu", "AlCu", "al_cu")
export const find_precomputed_diagram = (system: string): PhaseDiagramData | undefined =>
  precomputed_map.get(normalize_system_name(system))
