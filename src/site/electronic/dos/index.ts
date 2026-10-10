// Export pymatgen electronic DOS files for demos
// Glob handles both .json (dev) and .json.gz (production)
import type { PymatgenCompleteDos } from '#lib/spectral/helpers.js'

const imports = import.meta.glob<PymatgenCompleteDos>([`./*.json`, `./*.json.gz`], {
  eager: true,
  import: `default`,
})

const entries = Object.entries(imports)

// Exported so single-use demo datasets (e.g. lobster) load inline at the call site
export function get_dos(pattern: string): PymatgenCompleteDos {
  const entry = entries.find(([path]) => path.includes(pattern))
  if (!entry) {
    const paths = entries.map(([path]) => path).join(`, `)
    throw new Error(`DOS file matching "${pattern}" not found in ${paths}`)
  }
  return entry[1]
}

// Spin-polarized CompleteDos from Materials Project (mp-865805)
// Has atom_dos (Ta, Zn, Co) and spd_dos (s, p, d) for pDOS demos
export const dos_spin_polarization = get_dos(`spin-polarization`)
