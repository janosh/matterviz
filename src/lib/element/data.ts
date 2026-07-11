// Data sources (in order of precedence, highest first):
// 1. Shannon radii and oxidation states from pymatgen 2025.10.7 (https://pymatgen.org)
// 2. atomic_radius values from pymatgen
// 3. https://gist.github.com/robertwb/22aa4dbfb6bcecd94f2176caa912b952
// 4. https://github.com/Bowserinator/Periodic-Table-JSON/blob/master/PeriodicTableJSON.json
//
// To regenerate data.json with latest pymatgen data:
//   python scripts/extract_pymatgen_data.py

// Source of truth is data.json.gz. During npm packaging, scripts/package-dist-assets.ts
// rewrites dist/element/data.js to inline decompressed JSON for sync consumers.
import element_data from './data.json.gz'
import type { ChemicalElement, ElementSymbol } from './types'

export const element_by_symbol: ReadonlyMap<ElementSymbol, ChemicalElement> = new Map(
  element_data.map((element) => [element.symbol, element]),
)

export { default } from './data.json.gz'
