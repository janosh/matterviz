// Export pymatgen electronic DOS file for demos
// Glob handles both .json (dev) and .json.gz (production)
import type { PymatgenCompleteDos } from '$lib/spectral/helpers'

const imports = import.meta.glob<PymatgenCompleteDos>(
  [`./*.json`, `./*.json.gz`],
  { eager: true, import: `default` },
)

export const dos_spin_polarization = Object.values(imports)[0]
