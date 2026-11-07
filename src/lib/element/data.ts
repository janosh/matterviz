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

// Elements by ascending atomic weight (ties by atomic number), for a binary-search lookup:
// a LAMMPS dump with a per-atom mass column resolves every atom of every frame, where a
// linear scan of all 118 elements cost 650 ns per atom
const by_mass = element_data.toSorted(
  (elem_a, elem_b) => elem_a.atomic_mass - elem_b.atomic_mass || elem_a.number - elem_b.number,
)
const sorted_masses = Float64Array.from(by_mass, (element) => element.atomic_mass)

// Element whose standard atomic weight lies within 0.5 u of `mass` (LAMMPS Masses sections and
// per-atom mass dump columns); null for coarse-grained beads and other non-element masses.
// Equidistant weights go to the lower atomic number.
export const element_for_mass = (mass: number): ElementSymbol | null => {
  if (!Number.isFinite(mass)) return null
  let [lower, upper] = [0, sorted_masses.length]
  while (lower < upper) {
    const middle = (lower + upper) >> 1
    if (sorted_masses[middle] < mass) lower = middle + 1
    else upper = middle
  }
  // the nearest weights sit just below `lower` and at it; walk back to the first of a run of
  // equal weights below so its lowest atomic number wins
  let below = lower - 1
  while (below > 0 && sorted_masses[below - 1] === sorted_masses[below]) below--
  const diff_below = below >= 0 ? mass - sorted_masses[below] : Infinity
  const diff_above = lower < sorted_masses.length ? sorted_masses[lower] - mass : Infinity
  const best =
    diff_below < diff_above ||
    (diff_below === diff_above && by_mass[below].number < by_mass[lower].number)
      ? below
      : lower
  return Math.min(diff_below, diff_above) <= 0.5 ? by_mass[best].symbol : null
}

export { default } from './data.json.gz'
