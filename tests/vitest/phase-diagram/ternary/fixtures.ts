import type { PhaseData } from '$lib/convex-hull/types'
import type { ElementSymbol } from '$lib/element'
import { make_phase } from '../../setup'

// Li-Na-K toy system with one T-dependent phase. Elements are synthetic (dG_f = 0), so AB's
// tabulated free energies are its formation energies: dG_f(AB) = -0.5 + 0.0005 (T - 300).
//  400 K: ABC appears inside the AB-AC-BC tie-triangle (AB + AC + BC → 2 ABC)
//  850 K: tie-lines AB-AC and AB-BC flip to A-ABC and B-ABC (two simultaneous flips)
// 1300 K: AB leaves the hull (AB → A + B)
export const toy_temps = Array.from({ length: 13 }, (_, idx) => 300 + idx * 100)
export const toy_entries: PhaseData[] = [
  make_phase({ Li: 1, Na: 1 }, -0.5, {
    entry_id: `AB`,
    temperatures: toy_temps,
    free_energies: toy_temps.map((temp) => -0.5 + 0.0005 * (temp - 300)),
  }),
  make_phase({ Li: 1, K: 1 }, -0.3, { entry_id: `AC` }),
  make_phase({ Na: 1, K: 1 }, -0.3, { entry_id: `BC` }),
  make_phase({ Li: 1, Na: 1, K: 1 }, -0.35, { entry_id: `ABC` }),
]
export const toy_elements: [ElementSymbol, ElementSymbol, ElementSymbol] = [`Li`, `Na`, `K`]
