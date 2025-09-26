import {
  compute_formation_energy_per_atom,
  find_lowest_energy_unary_refs,
} from '$lib/phase-diagram/energies'
import type { PhaseEntry } from '$lib/phase-diagram/types'
import { describe, expect, test } from 'vitest'

// Helper to build entries succinctly
function entry(
  composition: Record<string, number>,
  energy: number,
  opts: Partial<PhaseEntry> = {},
): PhaseEntry {
  return {
    composition,
    energy,
    entry_id: opts.entry_id,
    correction: opts.correction,
    energy_per_atom: opts.energy_per_atom,
    e_form_per_atom: opts.e_form_per_atom,
  }
}

describe(`find_lowest_energy_unary_refs()`, () => {
  test(`picks lowest corrected unary per element`, () => {
    const entries: PhaseEntry[] = [
      entry({ Li: 1 }, -1.0),
      entry({ Li: 1 }, -0.9, { correction: -0.2 }), // corrected per atom = -1.1 (lower)
      entry({ O: 2 }, -10.0),
      entry({ O: 2 }, -9.6, { correction: -1.0 }), // corrected per atom = (-9.6-1.0)/2 = -5.3 < -5.0
      entry({ Li: 1, O: 1 }, -4.0),
    ]

    const refs = find_lowest_energy_unary_refs(entries)
    expect(Object.keys(refs).sort()).toEqual([`Li`, `O`])

    // Validate corrected energy per atom ordering drove selection
    const picked_li = refs[`Li`]
    const picked_o = refs[`O`]
    expect(picked_li.energy).toBe(-0.9)
    expect(picked_li.correction).toBe(-0.2)
    expect(picked_o.energy).toBe(-9.6)
    expect(picked_o.correction).toBe(-1.0)
  })

  test(`ignores non-unary entries and uses energy_per_atom if present`, () => {
    const entries: PhaseEntry[] = [
      entry({ Li: 2 }, -2.0), // -1.0 eV/at
      entry({ Li: 1 }, 0, { energy_per_atom: -1.05 }), // should win
      entry({ Li: 1, O: 1 }, -100), // non-unary, ignored
      entry({ O: 2 }, 0, { energy_per_atom: -5.1 }), // -5.1 eV/at
      entry({ O: 2 }, -10.2), // -5.1 eV/at (tie)
    ]
    const refs = find_lowest_energy_unary_refs(entries)
    expect(Object.keys(refs).sort()).toEqual([`Li`, `O`])
    expect(refs[`Li`].energy_per_atom).toBe(-1.05)
    // Either O ref with -5.1 eV/at is acceptable
    const o_e_pa = refs[`O`].energy_per_atom ?? ((refs[`O`].energy ?? 0) / 2)
    expect(Number(o_e_pa.toFixed(3))).toBe(-5.1)
  })
})

describe(`compute_formation_energy_per_atom()`, () => {
  test.each([
    // [compound, refs, expected e_form]
    [
      entry({ Li: 1, O: 1 }, -6.0),
      { Li: entry({ Li: 1 }, -1.0), O: entry({ O: 2 }, -10.0) },
      // e_pa(comp) = -6.0/2 = -3.0; refs per atom = (0.5*-1.0) + (0.5*-5.0) = -3.0; e_form = 0
      0,
    ],
    [
      entry({ Li: 1, O: 1 }, -5.9, { correction: -0.2 }),
      { Li: entry({ Li: 1 }, -1.0), O: entry({ O: 2 }, -10.0) },
      // corrected comp e_pa = (-5.9-0.2)/2 = -3.05; refs = -3.0; e_form = -0.05
      -0.05,
    ],
    [
      entry({ Li: 1, O: 1 }, -6.0),
      { Li: entry({ Li: 1 }, -1.0, { correction: -0.2 }), O: entry({ O: 2 }, -10.0) },
      // refs Li corrected = (-1.0-0.2)/1 = -1.2; refs mix = 0.5*-1.2 + 0.5*-5.0 = -3.1; e_form = -3.0 - (-3.1) = +0.1
      0.1,
    ],
  ])(`matches expected formation energy %#`, (comp, refs, expected) => {
    const e_form = compute_formation_energy_per_atom(comp, refs)
    expect(e_form).not.toBeNull()
    expect(Number(e_form?.toFixed(6))).toBe(Number(expected.toFixed(6)))
  })

  test(`returns null when a needed elemental reference is missing`, () => {
    const comp = entry({ Li: 1, O: 1 }, -6.0)
    const refs = { Li: entry({ Li: 1 }, -1.0) } as Record<string, PhaseEntry>
    expect(compute_formation_energy_per_atom(comp, refs)).toBeNull()
  })

  test(`invariant to composition scaling (per-atom)`, () => {
    const comp1 = entry({ Li: 1, O: 1 }, -6.0)
    const comp2 = entry({ Li: 2, O: 2 }, -12.0) // scaled by 2
    const refs = { Li: entry({ Li: 1 }, -1.0), O: entry({ O: 2 }, -10.0) }
    const e1 = compute_formation_energy_per_atom(comp1, refs)
    const e2 = compute_formation_energy_per_atom(comp2, refs)
    expect(Number((e1 ?? 0).toFixed(9))).toBe(Number((e2 ?? 0).toFixed(9)))
  })
})
