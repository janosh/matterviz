// Data sources (in order of precedence, highest first):
// 1. Shannon radii and oxidation states from pymatgen 2025.10.7 (https://pymatgen.org)
// 2. atomic_radius values from pymatgen
// 3. https://gist.github.com/robertwb/22aa4dbfb6bcecd94f2176caa912b952
// 4. https://github.com/Bowserinator/Periodic-Table-JSON/blob/master/PeriodicTableJSON.json
//
// To regenerate data.json with latest pymatgen data:
//   uv run src/scripts/refresh_pymatgen_data.py

// Source of truth is data.json.gz. During npm packaging, src/scripts/package-dist-assets.mjs
// rewrites dist/element/data.js to inline decompressed JSON for sync consumers.
import element_data from './data.json.gz'
import type { ChemicalElement, ElementSymbol } from './types'

export const element_by_symbol: ReadonlyMap<ElementSymbol, ChemicalElement> = new Map(
  element_data.map((element) => [element.symbol, element]),
)

// Element whose standard atomic weight lies within 0.5 u of `mass` (LAMMPS Masses sections and
// per-atom mass dump columns); null for coarse-grained beads and other non-element masses
export const element_for_mass = (mass: number): ElementSymbol | null => {
  let best: { symbol: ElementSymbol; diff: number } | null = null
  for (const { symbol, atomic_mass } of element_data) {
    const diff = Math.abs(atomic_mass - mass)
    if (!best || diff < best.diff) best = { symbol, diff }
  }
  return best && best.diff <= 0.5 ? best.symbol : null
}

export { default } from './data.json.gz'
