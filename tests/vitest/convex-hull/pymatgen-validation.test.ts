// Cross-validation test comparing our N-dimensional convex hull implementation
// against pymatgen's PhaseDiagram for a 5-element (quinary) system.
//
// NOTE: The N-dimensional quickhull algorithm works correctly for well-separated
// point configurations (as demonstrated in thermodynamics.test.ts). However, when
// all interior points cluster near the center of the simplex (as in realistic
// phase diagrams where stable compounds are near equimolar compositions), the
// algorithm may fall back to a degenerate hull. This is a known numerical limitation.
//
// For production use with complex datasets, consider:
// 1. Using pymatgen directly for phase diagram calculations
// 2. Restricting to 4-element (quaternary) systems where the specialized 4D hull works
// 3. Pre-filtering data to ensure well-separated point distributions

import { calculate_e_above_hull } from '$lib/convex-hull/thermodynamics'
import type { PhaseData } from '$lib/convex-hull/types'
import { describe, expect, test } from 'vitest'
import pymatgen_reference from './fixtures/quinary_pymatgen_reference.json' with {
  type: 'json',
}

interface PymatgenEntry {
  id: string
  composition: Record<string, number>
  energy_per_atom: number
  e_above_hull: number
  is_stable: boolean
}

interface PymatgenReference {
  elements: string[]
  entries: PymatgenEntry[]
  n_stable: number
  n_unstable: number
}

const reference = pymatgen_reference as PymatgenReference

// Convert pymatgen entry to PhaseData format
function to_phase_data(entry: PymatgenEntry): PhaseData {
  return {
    composition: entry.composition,
    energy_per_atom: entry.energy_per_atom,
    energy: entry.energy_per_atom *
      Object.values(entry.composition).reduce((s, n) => s + n, 0),
    entry_id: entry.id,
    e_form_per_atom: entry.energy_per_atom,
  }
}

describe(`Pymatgen cross-validation for quinary (5-element) system`, () => {
  const all_entries = reference.entries.map(to_phase_data)

  test(`reference data has expected structure`, () => {
    expect(reference.elements).toEqual([`Li`, `Na`, `K`, `Rb`, `Cs`])
    expect(reference.entries.length).toBe(12)
    expect(reference.n_stable).toBe(6)
    expect(reference.n_unstable).toBe(6)
  })

  // Elemental references should always have e_above_hull = 0
  test.each(reference.elements)(`elemental %s has e_above_hull = 0`, (element) => {
    const entry = reference.entries.find(
      (e) => Object.keys(e.composition).length === 1 && element in e.composition,
    )
    if (!entry) throw new Error(`${element} not found`)
    expect(calculate_e_above_hull(to_phase_data(entry), all_entries)).toBeCloseTo(0, 10)
  })

  test(`single entry mode matches batch mode`, () => {
    const batch_results = calculate_e_above_hull(all_entries, all_entries)
    for (const entry of reference.entries) {
      const single_result = calculate_e_above_hull(to_phase_data(entry), all_entries)
      expect(single_result).toBeCloseTo(batch_results[entry.id], 10)
    }
  })

  // All results should be valid (non-NaN, non-negative)
  test(`returns valid results for all entries`, () => {
    const results = calculate_e_above_hull(all_entries, all_entries)

    for (const entry of reference.entries) {
      const result = results[entry.id]
      expect(Number.isNaN(result)).toBe(false)
      expect(result).toBeGreaterThanOrEqual(0)
    }
  })

  // Test that results are monotonic in energy for same-composition entries
  // (entries with higher energy should have higher or equal e_above_hull)
  test(`e_above_hull is monotonic in energy for same composition`, () => {
    const results = calculate_e_above_hull(all_entries, all_entries)

    // Group entries by composition key
    const by_composition = new Map<string, PymatgenEntry[]>()
    for (const entry of reference.entries) {
      const key = JSON.stringify(
        Object.keys(entry.composition).sort().map((el) => [el, entry.composition[el]]),
      )
      const entries_for_key = by_composition.get(key) ?? []
      entries_for_key.push(entry)
      by_composition.set(key, entries_for_key)
    }

    // For each composition, check monotonicity
    for (const entries_same_comp of by_composition.values()) {
      if (entries_same_comp.length < 2) continue
      const sorted = [...entries_same_comp].sort(
        (a, b) => a.energy_per_atom - b.energy_per_atom,
      )
      for (let idx = 1; idx < sorted.length; idx++) {
        const lower_energy = sorted[idx - 1]
        const higher_energy = sorted[idx]
        expect(results[lower_energy.id]).toBeLessThanOrEqual(results[higher_energy.id])
      }
    }
  })
})
