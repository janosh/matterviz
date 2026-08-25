// Demo systems for /synthesis-planning: carbonate-containing Alexandria quaternaries fetched by
// src/scripts/fetch_alexandria_ternaries.py plus the ternary hulls of the phase-diagram demo.
import type { PhaseData } from '$lib/convex-hull'
import type { SynthesisConditions } from '$lib/synthesis-planning'
import { hull_system_name, quaternary_loader } from '$site/convex-hull'
import { ternary_system_files } from '$site/phase-diagrams/ternary'

export interface SynthesisDemoSystem {
  id: string
  label: string
  description: string
  // Sensible starting target and conditions for this system
  target: string
  conditions: SynthesisConditions
  load: () => Promise<PhaseData[]>
}

const quaternary_files = import.meta.glob<{ default: PhaseData[] }>(`./*.json.gz`, {
  eager: false,
})

const IN_AIR: SynthesisConditions = { temperature: 1100, open_species: [`O2`, `CO2`] }

// Starting points for systems with a textbook story; everything else defaults to the most
// complex stable phase fired at 1000 K in air
const PRESETS: Record<
  string,
  Pick<SynthesisDemoSystem, `target` | `conditions` | `description`>
> = {
  'Ba-Ti-C-O': {
    target: `BaTiO3`,
    conditions: { ...IN_AIR, temperature: 1200 },
    description: `BaCO3 + TiO2 in air, with Ba2TiO4 as the known intermediate`,
  },
  'Li-Co-C-O': {
    target: `LiCoO2`,
    conditions: IN_AIR,
    description: `Li2CO3 + cobalt oxides; Li-rich Li5CoO4 competes at high Li2CO3 fractions`,
  },
  'Ca-C-O': {
    target: `CaO`,
    conditions: { temperature: 1200, open_species: [`CO2`] },
    description: `Lime burning: single-precursor decomposition with a pressure-dependent onset`,
  },
  'Na-Fe-P-O': {
    target: `NaFePO4`,
    conditions: { temperature: 900, open_species: [`O2`] },
    description: `Quaternary target: three-precursor routes and their pairwise interfaces`,
  },
}

const demo_system = (
  id: string,
  label: string,
  load: () => Promise<PhaseData[]>,
): SynthesisDemoSystem => {
  const preset = PRESETS[label.replace(/ \(.*\)$/, ``)]
  return {
    id,
    label,
    load,
    description: preset?.description ?? ``,
    target: preset?.target ?? ``,
    conditions: preset?.conditions ?? { ...IN_AIR, temperature: 1000 },
  }
}

export const synthesis_demo_systems: SynthesisDemoSystem[] = [
  ...Object.entries(quaternary_files).map(([path, loader]) =>
    demo_system(
      path,
      `${hull_system_name(path)} (Alexandria)`,
      async () => (await loader()).default,
    ),
  ),
  // Materials Project quaternaries shared with the convex-hull demo
  ...[`Na-Fe-P-O`, `Li-Co-Ni-O`].map((system) =>
    demo_system(
      `mp:${system}`,
      `${system} (MP)`,
      async () => (await quaternary_loader(system)()).default,
    ),
  ),
  ...ternary_system_files.map((file) =>
    demo_system(file.url, file.label ?? file.name, file.load),
  ),
]
