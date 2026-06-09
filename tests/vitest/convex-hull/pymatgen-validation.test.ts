// Cross-validation test comparing our N-dimensional convex hull implementation
// against pymatgen's PhaseDiagram for a 5-element (quinary) system.
//
// Hull points use reduced barycentric coords ((N-1) spatial + 1 energy): full barycentric
// coords sum to 1 and would confine all points to an affine subspace (degenerate hull).

import type { ElementSymbol } from '$lib'
import { calculate_e_above_hull } from '$lib/convex-hull/thermodynamics'
import type { PhaseData } from '$lib/convex-hull/types'
import { describe, expect, test } from 'vitest'
import pymatgen_reference from './fixtures/quinary_pymatgen_reference.json' with { type: 'json' }

interface PymatgenEntry {
  id: string
  composition: Record<string, number>
  e_form_per_atom: number
  e_above_hull: number
  is_stable: boolean
}

interface PymatgenReference {
  elements: ElementSymbol[]
  entries: PymatgenEntry[]
  n_stable: number
  n_unstable: number
}

const reference = pymatgen_reference as PymatgenReference

// Convert pymatgen entry to PhaseData format
function to_phase_data(entry: PymatgenEntry): PhaseData {
  const n_atoms = Object.values(entry.composition).reduce((sum, count) => sum + count, 0)
  return {
    composition: entry.composition,
    e_form_per_atom: entry.e_form_per_atom,
    energy_per_atom: entry.e_form_per_atom, // same since elemental refs are 0
    energy: entry.e_form_per_atom * n_atoms,
    entry_id: entry.id,
  }
}

describe(`Pymatgen cross-validation for quinary (5-element) system`, () => {
  const all_entries = reference.entries.map(to_phase_data)
  const results = calculate_e_above_hull(all_entries, all_entries)

  test(`reference data has expected structure`, () => {
    expect(reference.elements).toEqual([`Li`, `Na`, `K`, `Rb`, `Cs`])
    expect(reference.entries).toHaveLength(12)
    expect(reference.n_stable).toBe(6)
    expect(reference.n_unstable).toBe(6)
    // Every element must have an elemental reference entry in the fixture
    const unary_elements = reference.entries
      .filter((entry) => Object.keys(entry.composition).length === 1)
      .flatMap((entry) => Object.keys(entry.composition))
    expect(unary_elements.toSorted()).toEqual(reference.elements.toSorted())
  })

  // Direct comparison of e_above_hull against pymatgen's PhaseDiagram values
  test.each(reference.entries)(`e_above_hull matches pymatgen for $id`, (entry) => {
    expect(results[entry.id]).toBeCloseTo(entry.e_above_hull, 3)
    expect(results[entry.id] < 1e-6).toBe(entry.is_stable)
    expect(results[entry.id]).toBeGreaterThanOrEqual(0) // valid: non-NaN, non-negative
    // Elemental references sit exactly on the hull
    if (Object.keys(entry.composition).length === 1) {
      expect(results[entry.id]).toBeCloseTo(0, 10)
    }
  })

  test(`single entry mode matches batch mode`, () => {
    for (const entry of reference.entries) {
      const single_result = calculate_e_above_hull(to_phase_data(entry), all_entries)
      expect(single_result).toBeCloseTo(results[entry.id], 10)
    }
  })

  // Test that results are monotonic in energy for same-composition entries
  // (entries with higher energy should have higher or equal e_above_hull)
  test(`e_above_hull is monotonic in energy for same composition`, () => {
    // Group entries by composition key
    const by_composition = new Map<string, PymatgenEntry[]>()
    for (const entry of reference.entries) {
      const key = JSON.stringify(
        Object.keys(entry.composition)
          .toSorted()
          .map((el) => [el, entry.composition[el]]),
      )
      const entries_for_key = by_composition.get(key) ?? []
      entries_for_key.push(entry)
      by_composition.set(key, entries_for_key)
    }

    // For each composition, check monotonicity
    for (const entries_same_comp of by_composition.values()) {
      if (entries_same_comp.length < 2) continue
      const sorted = entries_same_comp.toSorted(
        (left_entry, right_entry) => left_entry.e_form_per_atom - right_entry.e_form_per_atom,
      )
      for (let idx = 1; idx < sorted.length; idx++) {
        const lower_energy = sorted[idx - 1]
        const higher_energy = sorted[idx]
        expect(results[lower_energy.id]).toBeLessThanOrEqual(results[higher_energy.id])
      }
    }
  })
})
