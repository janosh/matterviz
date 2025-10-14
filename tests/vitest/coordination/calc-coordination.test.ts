import type { PymatgenStructure } from '$lib'
import { calc_coordination_numbers } from '$lib/coordination'
import { describe, expect, test } from 'vitest'

describe(`calc_coordination_numbers`, () => {
  // Simple cubic structure (NaCl-like)
  const simple_cubic: PymatgenStructure = {
    lattice: {
      matrix: [
        [5.0, 0.0, 0.0],
        [0.0, 5.0, 0.0],
        [0.0, 0.0, 5.0],
      ],
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
    const result = calc_coordination_numbers(simple_cubic, `nearest_neighbor`)

    expect(result.sites.length).toBe(4)
    expect(result.cn_histogram.size).toBeGreaterThan(0)
    expect(result.cn_by_element.size).toBe(2) // Na and Cl
  })

  test(`should group by element`, () => {
    const result = calc_coordination_numbers(simple_cubic, `nearest_neighbor`)

    expect(result.cn_by_element.has(`Na`)).toBe(true)
    expect(result.cn_by_element.has(`Cl`)).toBe(true)
    expect(result.cn_histogram_by_element.has(`Na`)).toBe(true)
    expect(result.cn_histogram_by_element.has(`Cl`)).toBe(true)
  })

  test(`should work with max distance ratio strategy`, () => {
    const result = calc_coordination_numbers(simple_cubic, 4.0)

    expect(result.sites.length).toBe(4)
    expect(result.cn_histogram.size).toBeGreaterThan(0)
  })

  test(`should handle structure with distant atoms using max distance ratio`, () => {
    const isolated_atoms: PymatgenStructure = {
      lattice: {
        matrix: [
          [100.0, 0.0, 0.0],
          [0.0, 100.0, 0.0],
          [0.0, 0.0, 100.0],
        ],
        a: 100.0,
        b: 100.0,
        c: 100.0,
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

    // Use max distance ratio 1.2 — with atoms 50 Å apart and small covalent radii,
    // 1.2 × (r_H + r_He) << 50 Å, so no bonds should form
    const result = calc_coordination_numbers(isolated_atoms, 1.2)

    expect(result.sites.length).toBe(2)
    // Both atoms should have CN = 0 since bonding distance is well below separation
    const cn_values = result.sites.map((site) => site.coordination_number)
    expect(cn_values.every((cn) => cn === 0)).toBe(true)
    expect(result.cn_histogram.get(0)).toBe(2)
  })
})
