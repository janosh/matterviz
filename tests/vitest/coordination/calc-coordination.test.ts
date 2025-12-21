import { calc_coordination_nums } from '$lib/coordination'
import { describe, expect, test } from 'vitest'
import { make_crystal } from '../setup'

describe(`calc_coordination_nums`, () => {
  // Simple cubic structure (NaCl-like)
  const simple_cubic = make_crystal(5, [
    { element: `Na`, abc: [0, 0, 0], oxidation_state: 1 },
    { element: `Cl`, abc: [0.5, 0.5, 0.5], oxidation_state: -1 },
    { element: `Na`, abc: [0.5, 0, 0], oxidation_state: 1 },
    { element: `Cl`, abc: [0, 0.5, 0.5], oxidation_state: -1 },
  ])

  test(`should calculate coordination numbers`, () => {
    const result = calc_coordination_nums(simple_cubic, `electroneg_ratio`)

    expect(result.sites.length).toBe(4)
    expect(result.cn_histogram.size).toBeGreaterThan(0)
    expect(result.cn_by_element.size).toBe(2) // Na and Cl
  })

  test(`should group by element`, () => {
    const result = calc_coordination_nums(simple_cubic, `electroneg_ratio`)

    expect(result.cn_by_element.has(`Na`)).toBe(true)
    expect(result.cn_by_element.has(`Cl`)).toBe(true)
    expect(result.cn_histogram_by_element.has(`Na`)).toBe(true)
    expect(result.cn_histogram_by_element.has(`Cl`)).toBe(true)
  })

  test(`should work with solid_angle strategy`, () => {
    const result = calc_coordination_nums(simple_cubic, `solid_angle`)

    expect(result.sites.length).toBe(4)
    expect(result.cn_histogram.size).toBeGreaterThan(0)
  })

  test(`should handle structure with distant atoms`, () => {
    const isolated_atoms = make_crystal(
      100,
      [
        { element: `H`, abc: [0, 0, 0] },
        { element: `He`, abc: [0.5, 0.5, 0.5] },
      ],
      { pbc: [false, false, false] },
    )

    // With atoms 50 Å apart, no bonds should form with default electroneg_ratio strategy
    const result = calc_coordination_nums(isolated_atoms, `electroneg_ratio`)

    expect(result.sites.length).toBe(2)
    // Both atoms should have CN = 0 since they are too far apart for bonding
    const cn_values = result.sites.map((site) => site.coordination_num)
    expect(cn_values.every((cn) => cn === 0)).toBe(true)
    expect(result.cn_histogram.get(0)).toBe(2)
  })
})
