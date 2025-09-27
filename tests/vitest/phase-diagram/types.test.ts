import {
  get_arity,
  is_binary_entry,
  is_denary_entry,
  is_nonary_entry,
  is_octonary_entry,
  is_quaternary_entry,
  is_quinary_entry,
  is_senary_entry,
  is_septenary_entry,
  is_ternary_entry,
  is_unary_entry,
  PhaseEntry,
} from '$lib/phase-diagram/types'
import { describe, expect, test } from 'vitest'

describe(`arity helpers`, () => {
  const make = (comp: Record<string, number>) => ({ composition: comp } as PhaseEntry)

  test(`get_arity counts positive amounts only`, () => {
    expect(get_arity(make({ A: 1, B: 0, C: -1 }))).toBe(1)
  })

  test(`predicates for different arities`, () => {
    expect(is_unary_entry(make({ A: 1 }))).toBe(true)
    expect(is_binary_entry(make({ A: 1, B: 1 }))).toBe(true)
    expect(is_ternary_entry(make({ A: 1, B: 1, C: 1 }))).toBe(true)
    expect(is_quaternary_entry(make({ A: 1, B: 1, C: 1, D: 1 }))).toBe(true)
    expect(is_quinary_entry(make({ A: 1, B: 1, C: 1, D: 1, E: 1 }))).toBe(true)
    expect(is_senary_entry(make({ A: 1, B: 1, C: 1, D: 1, E: 1, F: 1 }))).toBe(true)
    expect(is_septenary_entry(make({ A: 1, B: 1, C: 1, D: 1, E: 1, F: 1, G: 1 }))).toBe(
      true,
    )
    expect(is_octonary_entry(make({ A: 1, B: 1, C: 1, D: 1, E: 1, F: 1, G: 1, H: 1 })))
      .toBe(true)
    expect(
      is_nonary_entry(make({ A: 1, B: 1, C: 1, D: 1, E: 1, F: 1, G: 1, H: 1, I: 1 })),
    ).toBe(true)
    expect(
      is_denary_entry(
        make({ A: 1, B: 1, C: 1, D: 1, E: 1, F: 1, G: 1, H: 1, I: 1, J: 1 }),
      ),
    ).toBe(true)
  })
})
