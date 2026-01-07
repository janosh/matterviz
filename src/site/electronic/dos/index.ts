// Export pymatgen electronic DOS files for demos
// Glob handles both .json (dev) and .json.gz (production)
import type { PymatgenCompleteDos } from '$lib/spectral/helpers'

const imports = import.meta.glob<PymatgenCompleteDos>(
  [`./*.json`, `./*.json.gz`],
  { eager: true, import: `default` },
)

// Extract files by pattern matching
const entries = Object.entries(imports)

function get_dos(pattern: string): PymatgenCompleteDos {
  const entry = entries.find(([path]) => path.includes(pattern))
  if (!entry) {
    throw new Error(
      `DOS file matching "${pattern}" not found in ${entries.map(([p]) => p).join(`, `)}`,
    )
  }
  return entry[1]
}

// Spin-polarized CompleteDos from Materials Project (mp-865805)
// Has atom_dos (Ta, Zn, Co) and spd_dos (s, p, d) for pDOS demos
export const dos_spin_polarization = get_dos(`spin-polarization`)

// Lobster CompleteDos with spin polarization (KF)
// Has atom_dos (F, K), spd_dos (s, p), and detailed orbital pdos
export const lobster_complete_dos = get_dos(`lobster`)
