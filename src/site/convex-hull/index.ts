// Materials Project phase-diagram fixtures (src/scripts/fetch_mp_pd_data.py) shared by the convex-hull,
// chempot and ternary phase-diagram demos. Loaded lazily: vite-plugin-json-gz decompresses
// at build time and each glob entry becomes its own chunk. Do NOT use query:'?url' here:
// Rolldown doesn't emit .json.gz as assets for globs.
import type { PhaseData } from '$lib/convex-hull/types'

export const quaternary_files = import.meta.glob<{ default: PhaseData[] }>(
  `$site/convex-hull/quaternaries/*.json.gz`,
)
export const quinary_files = import.meta.glob<{ default: PhaseData[] }>(
  `$site/convex-hull/quinaries/*.json.gz`,
)

// Lazy loader for one quaternary by system name (`Li-Co-Ni-O`); the glob's path prefix
// stays private to this module
export const quaternary_loader = (
  system: string,
): (() => Promise<{ default: PhaseData[] }>) => {
  const loader = quaternary_files[`/src/site/convex-hull/quaternaries/${system}.json.gz`]
  if (!loader) {
    const available = Object.keys(quaternary_files).map(hull_system_name).join(`, `)
    throw new Error(`Unknown quaternary system "${system}"; available: ${available}`)
  }
  return loader
}

// `/src/site/convex-hull/quaternaries/Li-Co-Ni-O.json.gz` -> `Li-Co-Ni-O`
export const hull_system_name = (path: string): string =>
  path.split(`/`).pop()?.replace(`.json.gz`, ``) ?? path
