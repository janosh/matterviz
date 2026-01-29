// Data sources (in order of precedence, highest first):
// 1. Shannon radii and oxidation states from pymatgen 2025.10.7 (https://pymatgen.org)
// 2. atomic_radius values from pymatgen
// 3. https://gist.github.com/robertwb/22aa4dbfb6bcecd94f2176caa912b952
// 4. https://github.com/Bowserinator/Periodic-Table-JSON/blob/master/PeriodicTableJSON.json
//
// To regenerate data.json.gz with latest pymatgen data:
//   python scripts/extract_pymatgen_data.py
//
// Note: Vite plugin in vite.config.ts decompresses .json.gz at build time

import type { ChemicalElement } from '$lib/element/types'
import data from './data.json.gz'

export default data as ChemicalElement[]
