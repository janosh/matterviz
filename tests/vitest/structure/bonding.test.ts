import type { BondPair, ElementSymbol, Vec3 } from '$lib'
import type { Matrix3x3 } from '$lib/math'
import type { PymatgenStructure, Site } from '$lib/structure'
import type { BondingStrategy } from '$lib/structure/bonding'
import * as bonding from '$lib/structure/bonding'
import { test_molecules } from '$site/molecules'
import process from 'node:process'
import { describe, expect, test } from 'vitest'
import { create_test_structure } from '../setup'

function measure_performance(func: () => void): number {
  const start = performance.now()
  func()
  return performance.now() - start
}

function make_site(xyz: Vec3, element = `C`): Site {
  return {
    xyz,
    abc: [0, 0, 0],
    species: [{ element: element as ElementSymbol, occu: 1, oxidation_state: 0 }],
    label: element,
    properties: {},
  }
}

function get_test_structure(sites: { xyz: Vec3; element?: string }[]): PymatgenStructure {
  return {
    sites: sites.map(({ xyz, element = `C` }) => make_site(xyz, element)),
    charge: 0,
    lattice: {
      matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] satisfies Matrix3x3,
      pbc: [true, true, true],
      a: 1,
      b: 1,
      c: 1,
      alpha: 90,
      beta: 90,
      gamma: 90,
      volume: 1,
    },
  }
}

function make_random_structure(n_atoms: number): PymatgenStructure {
  const elements = [`C`, `H`, `N`, `O`, `S`, `Fe`, `Na`, `Cl`]
  const sites = Array.from({ length: n_atoms }, (_, idx) => ({
    xyz: [Math.random() * 10, Math.random() * 10, Math.random() * 10] as Vec3,
    element: elements[idx % elements.length],
  }))
  return {
    ...get_test_structure(sites),
    lattice: {
      matrix: [[10, 0, 0], [0, 10, 0], [0, 0, 10]] satisfies Matrix3x3,
      pbc: [true, true, true],
      a: 10,
      b: 10,
      c: 10,
      alpha: 90,
      beta: 90,
      gamma: 90,
      volume: 1000,
    },
  }
}

describe(`Bonding Algorithms`, () => {
  const algorithms: [bonding.BondingAlgo, BondingStrategy, [number, number][]][] = [
    [bonding.electroneg_ratio, `electroneg_ratio`, [[50, 60], [200, 200], [1000, 800]]],
    [bonding.solid_angle, `solid_angle`, [[50, 100], [200, 200], [1000, 800]]],
  ]

  test.each(algorithms)(`$name performance benchmarks`, (_func, name, times) => {
    for (const [atom_count, max_time] of times) {
      const structure = make_random_structure(atom_count)
      const func = bonding.BONDING_STRATEGIES[name]
      func(structure) // Warm-up
      const measurements = Array.from(
        { length: 3 },
        () => measure_performance(() => func(structure)),
      )
      const avg_time = measurements.reduce((a, b) => a + b, 0) / measurements.length
      const is_ci = typeof process !== `undefined` && process.env?.CI === `true`
      const max_allowed = max_time * (is_ci ? 5 : 2)

      expect(
        avg_time,
        `${name} with ${atom_count} atoms: ${avg_time.toFixed(1)}ms > ${max_allowed}ms`,
      ).toBeLessThanOrEqual(max_allowed)
    }
  })

  test.each(algorithms)(`$name returns valid BondPair format`, (func) => {
    const structure = get_test_structure([
      { xyz: [0, 0, 0], element: `Fe` },
      { xyz: [2, 0, 0], element: `O` },
      { xyz: [4, 0, 0], element: `C` },
    ])
    const bonds = func(structure)
    for (const bond of bonds) {
      expect(bond.pos_1).toHaveLength(3)
      expect(bond.pos_2).toHaveLength(3)
      expect(bond.site_idx_1).toBeTypeOf(`number`)
      expect(bond.site_idx_2).toBeTypeOf(`number`)
      expect(bond.bond_length).toBeGreaterThan(0)
      expect(bond.strength).toBeGreaterThanOrEqual(0)
      expect(bond.strength).toBeLessThanOrEqual(2.0)
    }
  })

  test.each(algorithms)(`$name generates unique bonds`, (func) => {
    const bonds = func(make_random_structure(50))
    const bond_pairs = bonds.map((bond) =>
      `${Math.min(bond.site_idx_1, bond.site_idx_2)}-${
        Math.max(bond.site_idx_1, bond.site_idx_2)
      }`
    )
    expect(new Set(bond_pairs).size).toBe(bonds.length)
  })

  test.each(algorithms)(`$name handles edge cases`, (func) => {
    expect(func(get_test_structure([]))).toHaveLength(0)
    expect(func(get_test_structure([{ xyz: [0, 0, 0] }]))).toHaveLength(0)
    expect(func(get_test_structure([
      { xyz: [0, 0, 0], element: `Xx` },
      { xyz: [1, 0, 0], element: `Yy` },
    ]))).toBeDefined()
  })

  test.each(algorithms)(`$name handles distant atoms`, (func) => {
    const structure = create_test_structure(
      [[20, 0, 0], [0, 20, 0], [0, 0, 20]],
      [`H`, `H`],
      [[0, 0, 0], [10, 10, 10]],
    )
    const bonds = func(structure)
    bonds.forEach((bond) => expect(bond.bond_length).toBeGreaterThan(5))
  })
})

describe(`Molecular Bonding Analysis`, () => {
  test.each([
    [`water`, test_molecules.water, 2, 0.8, 1.2],
    [`methane`, test_molecules.methane, 4, 0.9, 1.3],
  ])(`%s has expected bonds`, (_name, molecule, expected_bonds, min_dist, max_dist) => {
    const bonds = bonding.electroneg_ratio(molecule)
    expect(bonds.length).toBeGreaterThanOrEqual(expected_bonds)
    bonds.forEach((bond) => {
      expect(bond.bond_length).toBeGreaterThan(min_dist)
      expect(bond.bond_length).toBeLessThan(max_dist)
    })
  })

  test(`benzene has aromatic C-C bonds`, () => {
    // Lower strength threshold to ensure C-C bonds are captured alongside C-H bonds
    const bonds = bonding.electroneg_ratio(test_molecules.benzene, {
      max_distance_ratio: 2,
      strength_threshold: 0.2,
      same_species_penalty: 0.8,
    })
    expect(bonds.length).toBeGreaterThanOrEqual(6)
    const cc_bonds = bonds.filter((bond) => {
      const elem_1 = test_molecules.benzene.sites[bond.site_idx_1].species[0].element
      const elem_2 = test_molecules.benzene.sites[bond.site_idx_2].species[0].element
      return elem_1 === `C` && elem_2 === `C` && bond.bond_length > 1.3 &&
        bond.bond_length < 1.6
    })
    expect(cc_bonds.length).toBeGreaterThanOrEqual(6)
  })

  test(`ethanol has multiple bond types`, () => {
    // Lower strength threshold to ensure all bond types are captured
    const bonds = bonding.electroneg_ratio(test_molecules.ethanol, {
      max_distance_ratio: 2,
      strength_threshold: 0.2,
      same_species_penalty: 0.8,
    })
    expect(bonds.length).toBeGreaterThanOrEqual(6)
    const distances = bonds.map((bond) => bond.bond_length)
    expect(Math.min(...distances)).toBeGreaterThan(0.8)
    expect(Math.max(...distances)).toBeLessThan(2.0)
  })
})

describe(`Crystal Structure Bonding`, () => {
  test(`simple cubic lattice`, () => {
    const structure = create_test_structure(
      [[3, 0, 0], [0, 3, 0], [0, 0, 3]],
      [`Na`, `Cl`],
      [[0, 0, 0], [0.5, 0.5, 0.5]],
    )
    const bonds = bonding.electroneg_ratio(structure, { max_distance_ratio: 3 })
    expect(bonds.length).toBeGreaterThan(0)
    expect(bonds.filter((b) => b.site_idx_1 !== b.site_idx_2).length).toBeGreaterThan(0)
  })

  test(`diamond structure`, () => {
    const structure = create_test_structure(
      [[3.57, 0, 0], [0, 3.57, 0], [0, 0, 3.57]],
      [`C`, `C`],
      [[0, 0, 0], [0.25, 0.25, 0.25]],
    )
    const bonds = bonding.electroneg_ratio(structure, { max_distance_ratio: 3 })
    expect(bonds.length).toBeGreaterThan(0)
    bonds.forEach((bond) => {
      expect(bond.bond_length).toBeGreaterThan(1.2)
      expect(bond.bond_length).toBeLessThan(2.5)
    })
  })
})

describe(`Electronegativity-Based Bonding`, () => {
  test(`chemical preferences`, () => {
    const ionic = get_test_structure([
      { xyz: [0, 0, 0], element: `Na` },
      { xyz: [2.3, 0, 0], element: `Cl` },
      { xyz: [4.6, 0, 0], element: `Na` },
      { xyz: [6.9, 0, 0], element: `Cl` },
    ])
    const metal = get_test_structure([
      { xyz: [0, 0, 0], element: `Fe` },
      { xyz: [2.5, 0, 0], element: `Fe` },
      { xyz: [1.25, 2.2, 0], element: `Fe` },
      { xyz: [3.75, 2.2, 0], element: `Fe` },
    ])
    const ionic_bonds = bonding.electroneg_ratio(ionic, { max_distance_ratio: 2.5 })
    const metal_bonds = bonding.electroneg_ratio(metal, { max_distance_ratio: 2 })
    expect(ionic_bonds.length).toBeGreaterThan(0)
    expect(metal_bonds.length).toBeGreaterThan(0)
  })

  test(`bond type identification`, () => {
    const na_cl = get_test_structure([
      { xyz: [0, 0, 0], element: `Na` },
      { xyz: [2.3, 0, 0], element: `Cl` },
    ])
    const c_c = get_test_structure([
      { xyz: [0, 0, 0], element: `C` },
      { xyz: [1.5, 0, 0], element: `C` },
    ])
    const ionic = bonding.electroneg_ratio(na_cl, { max_distance_ratio: 2.5 })
    const covalent = bonding.electroneg_ratio(c_c, { max_distance_ratio: 2.5 })
    expect(ionic).toHaveLength(1)
    expect(covalent).toHaveLength(1)
    expect(ionic[0].bond_length).toBeCloseTo(2.3, 1)
    expect(covalent[0].bond_length).toBeCloseTo(1.5, 1)
  })

  test(`parameter sensitivity`, () => {
    const structure = get_test_structure([
      { xyz: [0, 0, 0], element: `Fe` },
      { xyz: [2.5, 0, 0], element: `Fe` },
      { xyz: [1.25, 2.2, 0], element: `O` },
    ])
    const lenient = bonding.electroneg_ratio(structure, {
      metal_metal_penalty: 0.8,
      metal_nonmetal_bonus: 1.2,
    })
    const strict = bonding.electroneg_ratio(structure, {
      metal_metal_penalty: 0.1,
      metal_nonmetal_bonus: 2.5,
    })
    expect(lenient.length).not.toBe(strict.length)
  })

  test(`distance constraints`, () => {
    const structure = get_test_structure([
      { xyz: [0, 0, 0], element: `Na` },
      { xyz: [10, 0, 0], element: `Cl` },
    ])
    expect(bonding.electroneg_ratio(structure, { max_distance_ratio: 5 })).toHaveLength(0)
  })
})

describe(`Algorithm Comparison`, () => {
  test(`simple bonds`, () => {
    const structure = get_test_structure([
      { xyz: [0, 0, 0], element: `C` },
      { xyz: [1.5, 0, 0], element: `O` },
    ])
    expect(bonding.solid_angle(structure)).toHaveLength(1)
    expect(bonding.electroneg_ratio(structure)).toHaveLength(1)
  })

  test(`large structures`, () => {
    const large_structure = make_random_structure(500)
    expect(bonding.electroneg_ratio(large_structure)).toBeInstanceOf(Array)
    expect(bonding.solid_angle(large_structure)).toBeInstanceOf(Array)
  })
})

describe(`Bond Strength Validation`, () => {
  test.each(Object.values(bonding.BONDING_STRATEGIES))(
    `valid strength values`,
    (strategy) => {
      const structure = get_test_structure([
        { xyz: [0, 0, 0], element: `C` },
        { xyz: [1.5, 0, 0], element: `O` },
        { xyz: [0, 1.5, 0], element: `H` },
      ])
      strategy(structure).forEach((bond: BondPair) => {
        expect(bond.strength).toBeGreaterThanOrEqual(0)
        expect(bond.strength).toBeLessThanOrEqual(2)
      })
    },
  )
})
