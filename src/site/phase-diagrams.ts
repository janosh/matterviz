import type { FileInfo } from '#lib'
import type { BinaryPhaseDiagram, PhaseObservation } from '#lib/phase-diagram/index.js'
import { normalize_system_name } from '#site/phase-diagrams/tdb-parse.js'
import { glob_basename, site_file_info } from '#site/imports.js'
import observations from './phase-diagrams/binary/observations.json'

const diagram_modules = import.meta.glob<BinaryPhaseDiagram>(
  `./phase-diagrams/binary/data/*.json`,
  { eager: true, import: `default` },
)

// The static symlink serves these fixtures at /phase-diagrams/tdb/<name>.
const tdb_modules = import.meta.glob(`#site/phase-diagrams/tdb/*.tdb`, {
  query: `?url`,
})

export const binary_diagrams: Record<string, BinaryPhaseDiagram> = Object.fromEntries(
  Object.entries(diagram_modules).map(([path, diagram]) => [
    glob_basename(path).replace(`.json`, ``),
    diagram,
  ]),
)

const binary_phase_diagram_files: FileInfo[] = Object.keys(binary_diagrams).map((name) => ({
  name: `${name}.json`,
  url: `builtin:${name}`, // Special marker for built-in diagrams
  type: `json`,
  category: `Binary`,
  category_icon: `📊`,
}))

const tdb_files: FileInfo[] = Object.keys(tdb_modules).map((path) =>
  site_file_info(path, { type: `tdb`, category: `TDB`, category_icon: `📄` }),
)

export const all_phase_diagram_files: FileInfo[] = [
  ...binary_phase_diagram_files,
  ...tdb_files,
]

const precomputed_map = new Map(
  Object.entries(binary_diagrams).map(([name, data]) => [normalize_system_name(name), data]),
)

// Find precomputed phase diagram by system name (handles any format: "Al-Cu", "AlCu", "al_cu")
export const find_precomputed_diagram = (system: string): BinaryPhaseDiagram | undefined =>
  precomputed_map.get(normalize_system_name(system))

// Experimental observations of every demo system: observation_markers keeps a diagram's own
export const binary_observations = observations as PhaseObservation[]
