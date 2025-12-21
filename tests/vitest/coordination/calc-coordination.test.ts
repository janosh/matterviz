import { calc_coordination_nums } from '$lib/coordination'
import type { Crystal } from '$lib/structure'
import { describe, expect, test } from 'vitest'

describe(`calc_coordination_nums`, () => {
  // Simple cubic structure (NaCl-like)
  const simple_cubic: Crystal = {
    lattice: {
      matrix: [[5.0, 0.0, 0.0], [0.0, 5.0, 0.0], [0.0, 0.0, 5.0]],
      a: 5.0,
      b: 5.0,
      c: 5.0,
      alpha: 90,
      beta: 90,
      gamma: 90,
      volume: 125.0,
      pbc: [true, true, true],
    },
    sites: [
      {
        species: [{ element: `Na`, occu: 1, oxidation_state: 1 }],
        abc: [0, 0, 0],
        xyz: [0, 0, 0],
        label: `Na`,
        properties: {},
      },
      {
        species: [{ element: `Cl`, occu: 1, oxidation_state: -1 }],
        abc: [0.5, 0.5, 0.5],
        xyz: [2.5, 2.5, 2.5],
        label: `Cl`,
        properties: {},
      },
      {
        species: [{ element: `Na`, occu: 1, oxidation_state: 1 }],
        abc: [0.5, 0, 0],
        xyz: [2.5, 0, 0],
        label: `Na`,
        properties: {},
      },
      {
        species: [{ element: `Cl`, occu: 1, oxidation_state: -1 }],
        abc: [0, 0.5, 0.5],
        xyz: [0, 2.5, 2.5],
        label: `Cl`,
        properties: {},
      },
    ],
  }

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
    const len = 100.0
    const isolated_atoms: Crystal = {
      lattice: {
        matrix: [[len, 0.0, 0.0], [0.0, len, 0.0], [0.0, 0.0, len]],
        a: len,
        b: len,
        c: len,
        alpha: 90,
        beta: 90,
        gamma: 90,
        volume: 1000000.0,
        pbc: [false, false, false],
      },
      sites: [
        {
          species: [{ element: `H`, occu: 1, oxidation_state: 0 }],
          abc: [0, 0, 0],
          xyz: [0, 0, 0],
          label: `H`,
          properties: {},
        },
        {
          species: [{ element: `He`, occu: 1, oxidation_state: 0 }],
          abc: [0.5, 0.5, 0.5],
          xyz: [50, 50, 50],
          label: `He`,
          properties: {},
        },
      ],
    }

    // With atoms 50 Å apart, no bonds should form with default electroneg_ratio strategy
    const result = calc_coordination_nums(isolated_atoms, `electroneg_ratio`)

    expect(result.sites.length).toBe(2)
    // Both atoms should have CN = 0 since they are too far apart for bonding
    const cn_values = result.sites.map((site) => site.coordination_num)
    expect(cn_values.every((cn) => cn === 0)).toBe(true)
    expect(result.cn_histogram.get(0)).toBe(2)
  })
})
