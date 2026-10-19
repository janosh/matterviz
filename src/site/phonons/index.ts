// Extract phonon band structures and DOS from full phonon objects, eagerly for every fixture.
// Demos showing one material at a time load per file from fixtures.ts instead.

import type { PhononBandStructure, PhononDos } from '#lib/spectral/index.js'
import type { PhononData } from '#site/phonons/fixtures.js'
import { normalize_phonon_fixture, phonon_fixture_key } from '#site/phonons/fixtures.js'

// Import all phonon data files (uncompressed for dev, gzipped in git)
const raw_imports = import.meta.glob<PhononData>([`./*.json`, `./*.json.gz`], {
  eager: true,
  import: `default`,
})

// Extract filename without extension as the key
export const phonon_data: Record<string, PhononData> = {}
export const phonon_bands: Record<string, PhononBandStructure> = {}
export const phonon_dos: Record<string, PhononDos> = {}

for (const [path, data] of Object.entries(raw_imports)) {
  const identifier = phonon_fixture_key(path)
  const { bands, dos } = normalize_phonon_fixture(identifier, data)
  phonon_data[identifier] = data
  if (bands) phonon_bands[identifier] = bands
  if (dos) phonon_dos[identifier] = dos
}
