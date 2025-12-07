import { calculate_e_above_hull } from '$lib/convex-hull/thermodynamics'
import type { PhaseData } from '$lib/convex-hull/types'
import { describe, expect, it } from 'vitest'

describe(`calculate_e_above_hull`, () => {
  // Helper to create entry
  const make_entry = (
    id: string,
    composition: Record<string, number>,
    energy: number, // total energy
    e_form_per_atom?: number,
  ): PhaseData => ({
    entry_id: id,
    composition,
    energy,
    energy_per_atom: energy / Object.values(composition).reduce((a, b) => a + b, 0),
    e_form_per_atom,
  })

  it(`calculates e_above_hull for unary system`, () => {
    const refs = [
      make_entry(`A-stable`, { A: 1 }, -10), // -10 eV/atom
      make_entry(`A-unstable`, { A: 1 }, -9), // -9 eV/atom
    ]
    // Stable ref sets the baseline (0). Unstable ref should be above 0 if we compare?
    // Wait, calculate_e_above_hull computes e_form_per_atom relative to lowest unary refs.
    // Lowest unary for A is -10.
    // For A-unstable: e_form = -9 - (-10) = +1. e_above_hull = 1.

    const val = calculate_e_above_hull(refs[1], refs)
    expect(val).toBeCloseTo(1.0)
  })

  it(`calculates e_above_hull for binary system`, () => {
    const refs = [
      make_entry(`A`, { A: 1 }, 0),
      make_entry(`B`, { B: 1 }, 0),
      make_entry(`AB_stable`, { A: 1, B: 1 }, -10), // -5 eV/atom formation
    ]
    // Hull should be triangle (0,0) -> (0.5, -5) -> (1,0)

    // Test entry at 0.5 (AB_unstable)
    // Total atoms 2. Energy -8 -> -4 eV/atom.
    // e_above_hull = -4 - (-5) = 1.0
    const unstable = make_entry(`AB_unstable`, { A: 1, B: 1 }, -8)

    const val = calculate_e_above_hull(unstable, refs)
    expect(val).toBeCloseTo(1.0)

    // Test entry at 0.25
    // Hull line from (0,0) to (0.5, -5) is y = -10x
    // At x=0.25, hull y = -2.5.
    // Entry energy -2 eV/atom.
    // e_above_hull = -2 - (-2.5) = 0.5
    const ent_25 = make_entry(`A3B`, { A: 3, B: 1 }, -8) // 4 atoms, -2 eV/atom
    const val_25 = calculate_e_above_hull(ent_25, refs)
    expect(val_25).toBeCloseTo(0.5)
  })

  it(`calculates e_above_hull for ternary system`, () => {
    // Simple setup: A, B, C at 0 formation energy
    // Center point ABC at -1.0 eV/atom
    const refs = [
      make_entry(`A`, { A: 1 }, 0),
      make_entry(`B`, { B: 1 }, 0),
      make_entry(`C`, { C: 1 }, 0),
      make_entry(`ABC`, { A: 1, B: 1, C: 1 }, -3), // -1 eV/atom
    ]

    // Test unstable ABC at -0.5 eV/atom
    const unstable = make_entry(`ABC_u`, { A: 1, B: 1, C: 1 }, -1.5) // -0.5 eV/atom
    // e_above_hull = -0.5 - (-1.0) = 0.5
    const val = calculate_e_above_hull(unstable, refs)
    expect(val).toBeCloseTo(0.5)
  })

  it(`calculates e_above_hull for quaternary system`, () => {
    const refs = [
      make_entry(`A`, { A: 1 }, 0),
      make_entry(`B`, { B: 1 }, 0),
      make_entry(`C`, { C: 1 }, 0),
      make_entry(`D`, { D: 1 }, 0),
      make_entry(`ABCD`, { A: 1, B: 1, C: 1, D: 1 }, -4), // -1 eV/atom
    ]

    // Unstable center point
    const unstable = make_entry(`ABCD_u`, { A: 1, B: 1, C: 1, D: 1 }, -2) // -0.5 eV/atom
    const val = calculate_e_above_hull(unstable, refs)
    expect(val).toBeCloseTo(0.5)
  })

  it(`handles multiple entries input`, () => {
    const refs = [
      make_entry(`A`, { A: 1 }, 0),
      make_entry(`B`, { B: 1 }, 0),
    ]
    const input = [
      make_entry(`A`, { A: 1 }, 0),
      make_entry(`B`, { B: 1 }, 0),
      make_entry(`AB`, { A: 1, B: 1 }, 2), // +1 eV/atom
    ]
    const result = calculate_e_above_hull(input, refs)
    expect(result).toEqual({
      A: 0,
      B: 0,
      AB: 1,
    })
  })

  it(`throws on mismatching elements`, () => {
    const refs = [make_entry(`A`, { A: 1 }, 0)]
    const entry = make_entry(`B`, { B: 1 }, 0)
    expect(() => calculate_e_above_hull(entry, refs)).toThrow(
      /not present in reference system/,
    )
  })

  it(`throws on empty references`, () => {
    const entry = make_entry(`A`, { A: 1 }, 0)
    expect(() => calculate_e_above_hull(entry, [])).toThrow(/cannot be empty/)
  })
})
