import type { PhaseData } from '$lib/convex-hull/types'
import type { ElementSymbol } from '$lib/element'

export const phase = (
  composition: Partial<Record<ElementSymbol, number>>,
  energy_per_atom: number,
  overrides: Partial<PhaseData> = {},
): PhaseData => {
  const atoms = Object.values(composition).reduce((sum, amt) => sum + amt, 0)
  return { composition, energy_per_atom, energy: energy_per_atom * atoms, ...overrides }
}

// Li-Na-K toy system with one T-dependent phase. Elements are synthetic (dG_f = 0), so AB's
// tabulated free energies are its formation energies: dG_f(AB) = -0.5 + 0.0005 (T - 300).
//  400 K: ABC appears inside the AB-AC-BC tie-triangle (AB + AC + BC → 2 ABC)
//  850 K: tie-lines AB-AC and AB-BC flip to A-ABC and B-ABC (two simultaneous flips)
// 1300 K: AB leaves the hull (AB → A + B)
export const toy_temps = Array.from({ length: 13 }, (_, idx) => 300 + idx * 100)
export const toy_entries: PhaseData[] = [
  phase({ Li: 1, Na: 1 }, -0.5, {
    entry_id: `AB`,
    temperatures: toy_temps,
    free_energies: toy_temps.map((temp) => -0.5 + 0.0005 * (temp - 300)),
  }),
  phase({ Li: 1, K: 1 }, -0.3, { entry_id: `AC` }),
  phase({ Na: 1, K: 1 }, -0.3, { entry_id: `BC` }),
  phase({ Li: 1, Na: 1, K: 1 }, -0.35, { entry_id: `ABC` }),
]
export const toy_elements: [ElementSymbol, ElementSymbol, ElementSymbol] = [`Li`, `Na`, `K`]
