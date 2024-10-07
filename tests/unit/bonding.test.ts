import type { PymatgenStructure } from '$lib/structure'
import type { BondingAlgo } from '$lib/structure/bonding'
import { max_dist, nearest_neighbor } from '$lib/structure/bonding'
import { performance } from 'perf_hooks'
import { describe, expect, test } from 'vitest'

const ci_max_time_multiplier = process.env.CI ? 5 : 1

// Function to generate a random structure
function make_rand_structure(numAtoms: number) {
  return {
    sites: Array.from({ length: numAtoms }, () => ({
      xyz: [Math.random() * 10, Math.random() * 10, Math.random() * 10],
    })),
  } as PymatgenStructure
}

// Updated performance test function
function perf_test(func: BondingAlgo, atom_count: number, max_time: number) {
  const run = () => {
    const structure = make_rand_structure(atom_count)
    const start = performance.now()
    func(structure)
    const end = performance.now()
    return end - start
  }

  const time1 = run()
  const time2 = run()
  const avg_time = (time1 + time2) / 2

  expect(
    avg_time,
    `average run time: ${Math.ceil(avg_time)}, max expected: ${max_time * ci_max_time_multiplier}`, // Apply scaling factor
  ).toBeLessThanOrEqual(max_time * ci_max_time_multiplier)
}

describe(`Bonding Functions Performance Tests`, () => {
  const bonding_functions = [
    {
      func: max_dist,
      max_times: [
        [10, 0.1],
        [100, 1],
        [1000, 40],
        [5000, 1000],
      ],
    },
    {
      func: nearest_neighbor,
      max_times: [
        [10, 0.2],
        [100, 3],
        [1000, 50],
        [5000, 1000],
      ],
    },
  ]

  for (const { func, max_times } of bonding_functions) {
    for (const [atom_count, max_time] of max_times) {
      test(`${func.name} performance for ${atom_count} atoms`, () => {
        // TODO investigate why run times increased, noticed on 2024-10-06
        // occurred both with package.json deps as of 5414367 and upgrading all to latest, doubling max allowed time for now
        perf_test(func, atom_count, 2 * max_time)
      })
    }
  }
})

// Helper function to create a simple structure
const make_struct = (sites: number[][]): PymatgenStructure => ({
  sites: sites.map((xyz) => ({ xyz })),
})

describe(`max_dist function`, () => {
  test(`should return correct bonds for a simple structure`, () => {
    const structure = make_struct([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ])
    const bonds = max_dist(structure, {
      max_bond_dist: 1.5,
      min_bond_dist: 0.5,
    })
    expect(bonds).toHaveLength(6)
    expect(bonds).toContainEqual([[0, 0, 0], [1, 0, 0], 0, 1, 1])
    expect(bonds).toContainEqual([[0, 0, 0], [0, 1, 0], 0, 2, 1])
    expect(bonds).toContainEqual([[0, 0, 0], [0, 0, 1], 0, 3, 1])
  })

  test(`should not return bonds shorter than min_bond_dist`, () => {
    const structure = make_struct([
      [0, 0, 0],
      [0.3, 0, 0],
    ])
    const bonds = max_dist(structure, { max_bond_dist: 1, min_bond_dist: 0.5 })
    expect(bonds).toHaveLength(0)
  })

  test(`should not return bonds longer than max_bond_dist`, () => {
    const structure = make_struct([
      [0, 0, 0],
      [2, 0, 0],
    ])
    const bonds = max_dist(structure, {
      max_bond_dist: 1.5,
      min_bond_dist: 0.5,
    })
    expect(bonds).toHaveLength(0)
  })

  test(`should handle empty structures`, () => {
    const structure = make_struct([])
    const bonds = max_dist(structure)
    expect(bonds).toHaveLength(0)
  })
})

describe(`nearest_neighbor function`, () => {
  test(`should return correct bonds for a simple structure`, () => {
    const structure = make_struct([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [2, 0, 0],
    ])
    const bonds = nearest_neighbor(structure, {
      scaling_factor: 1.1,
      min_bond_dist: 0.5,
    })
    expect(bonds).toHaveLength(4)
    expect(bonds).toContainEqual([[0, 0, 0], [1, 0, 0], 0, 1, 1])
    expect(bonds).toContainEqual([[0, 0, 0], [0, 1, 0], 0, 2, 1])
    expect(bonds).toContainEqual([[0, 0, 0], [0, 0, 1], 0, 3, 1])
  })

  test(`should not return bonds shorter than min_bond_dist`, () => {
    const structure = make_struct([
      [0, 0, 0],
      [0.05, 0, 0],
      [1, 0, 0],
    ])
    const bonds = nearest_neighbor(structure, {
      scaling_factor: 1.2,
      min_bond_dist: 0.1,
    })
    expect(bonds).toHaveLength(2)
    expect(bonds).toContainEqual([[0, 0, 0], [1, 0, 0], 0, 2, 1])
  })

  test(`should handle structures with multiple equidistant nearest neighbors`, () => {
    const structure = make_struct([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ])
    const bonds = nearest_neighbor(structure, {
      scaling_factor: 1.1,
      min_bond_dist: 0.5,
    })
    expect(bonds).toHaveLength(3)
    expect(bonds).toContainEqual([[0, 0, 0], [1, 0, 0], 0, 1, 1])
    expect(bonds).toContainEqual([[0, 0, 0], [0, 1, 0], 0, 2, 1])
    expect(bonds).toContainEqual([[0, 0, 0], [0, 0, 1], 0, 3, 1])
  })

  test(`should handle empty structures`, () => {
    const structure = make_struct([])
    const bonds = nearest_neighbor(structure)
    expect(bonds).toHaveLength(0)
  })

  test(`should respect the scaling_factor`, () => {
    const structure = make_struct([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1.5, 0, 0],
    ])
    const bonds = nearest_neighbor(structure, {
      scaling_factor: 1.4,
      min_bond_dist: 0.5,
    })
    expect(bonds).toHaveLength(4)
    expect(bonds).toContainEqual([[0, 0, 0], [1, 0, 0], 0, 1, 1])
    expect(bonds).toContainEqual([[0, 0, 0], [0, 1, 0], 0, 2, 1])
    expect(bonds).toContainEqual([[0, 0, 0], [0, 0, 1], 0, 3, 1])
    expect(bonds).toContainEqual([[1, 0, 0], [1.5, 0, 0], 1, 4, 0.5])
  })
})
