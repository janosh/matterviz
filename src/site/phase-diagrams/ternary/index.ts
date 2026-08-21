// Ternary chemical systems for the /phase-diagram/ternary demo: Alexandria PBE entries
// (fetch-alexandria-ternaries.py) plus ternary subsets of the Materials Project quaternaries
// used by the convex-hull demo. Loaded lazily: vite-plugin-json-gz decompresses at build time
// and each glob entry becomes its own chunk.
import type { PhaseData } from '$lib/convex-hull/types'
import type { ElementSymbol } from '$lib/element'
import type { FileInfo } from '$lib/io'

const alexandria_files = import.meta.glob<{ default: PhaseData[] }>(`./*.json.gz`, {
  eager: false,
})
const mp_quaternary_files = import.meta.glob<{ default: PhaseData[] }>(
  `$site/convex-hull/quaternaries/*.json.gz`,
  { eager: false },
)

// Demo categories per system (mirrors SYSTEMS in fetch-alexandria-ternaries.py)
const CATEGORIES: Record<string, [category: string, icon: string]> = {
  'Li-Co-O': [`Li-ion cathodes`, `🔋`],
  'Li-Mn-O': [`Li-ion cathodes`, `🔋`],
  'Li-Ni-O': [`Li-ion cathodes`, `🔋`],
  'Li-Ti-O': [`Li-ion anodes`, `🔋`],
  'Na-Fe-O': [`Na-ion cathodes`, `🧂`],
  'Li-P-S': [`Solid electrolytes`, `⚡`],
  'Ca-C-O': [`Carbonates`, `🪨`],
  'Mg-Si-O': [`Silicates`, `🌋`],
  'Ba-Ti-O': [`Perovskites`, `💎`],
  'Fe-Cr-O': [`Alloy oxidation`, `🔩`],
  'Cu-Zn-O': [`Alloy oxidation`, `🔩`],
  'Ti-N-O': [`Nitrides`, `🛡️`],
}

const filter_by_elements = (entries: PhaseData[], elements: string[]): PhaseData[] => {
  const element_set = new Set(elements)
  return entries.filter((entry) =>
    (Object.keys(entry.composition) as ElementSymbol[])
      .filter((el) => (entry.composition[el] ?? 0) > 0)
      .every((el) => element_set.has(el)),
  )
}

export interface TernarySystemFile extends FileInfo {
  load: () => Promise<PhaseData[]>
}

const alexandria_systems: TernarySystemFile[] = Object.entries(alexandria_files).map(
  ([path, loader]) => {
    const system = path.split(`/`).pop()?.replace(`.json.gz`, ``) ?? path
    const [category, category_icon] = CATEGORIES[system] ?? [`Other`, `🧪`]
    return {
      name: `${system}.json.gz`,
      label: system,
      url: `alexandria:${system}`,
      type: `json`,
      category,
      category_icon,
      load: async () => (await loader()).default,
    }
  },
)

// Ternary subsets of the Materials Project quaternaries (full ComputedStructureEntries)
const MP_SUBSETS: [file: string, systems: string[]][] = [
  [`Li-Co-Ni-O`, [`Li-Co-O`, `Li-Ni-O`, `Co-Ni-O`]],
  [`Na-Fe-P-O`, [`Na-Fe-O`, `Fe-P-O`, `Na-P-O`]],
]
const mp_systems: TernarySystemFile[] = MP_SUBSETS.flatMap(([file, systems]) => {
  const loader = mp_quaternary_files[`/src/site/convex-hull/quaternaries/${file}.json.gz`]
  if (!loader) return []
  return systems.map((system) => ({
    name: `MP ${system}.json.gz`,
    label: `${system} (MP)`,
    url: `mp:${file}:${system}`,
    type: `json`,
    category: `Materials Project`,
    category_icon: `🗄️`,
    load: async () => filter_by_elements((await loader()).default, system.split(`-`)),
  }))
})

export const ternary_system_files: TernarySystemFile[] = [...alexandria_systems, ...mp_systems]
