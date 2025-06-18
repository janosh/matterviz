import type { ElementSymbol } from '$lib'
import type { Matrix3x3 } from '$lib/math'
import type { PymatgenStructure, Site } from '$lib/structure'
import type { BondingAlgo } from '$lib/structure/bonding'
import { max_dist, nearest_neighbor, vdw_radius_based } from '$lib/structure/bonding'
import { describe, expect, test } from 'vitest'

// Simple performance measurement using Date.now() instead of Node's perf_hooks
function measure_performance(func: () => void): number {
  const start = Date.now()
  func()
  const end = Date.now()
  return end - start
}

// Helper to create a complete Site object
function make_site(xyz: [number, number, number], element = `C`): Site {
  return {
    xyz,
    abc: [0, 0, 0] as [number, number, number], // Placeholder fractional coordinates
    species: [
      { element: element as ElementSymbol, occu: 1, oxidation_state: 0 },
    ],
    label: element,
    properties: {},
  }
}

// Helper to create a test structure
function make_structure(
  sites: Array<{ xyz: [number, number, number]; element?: string }>,
): PymatgenStructure {
  return {
    sites: sites.map(({ xyz, element = `C` }) => make_site(xyz, element)),
    charge: 0,
    lattice: {
      matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Matrix3x3,
      pbc: [true, true, true] as [boolean, boolean, boolean],
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

// Generate random structure for performance testing
function make_random_structure(n_atoms: number): PymatgenStructure {
  const elements = [`C`, `H`, `N`, `O`, `S`]
  const sites = Array.from({ length: n_atoms }, (_, idx) => ({
    xyz: [Math.random() * 10, Math.random() * 10, Math.random() * 10] as [
      number,
      number,
      number,
    ],
    element: elements[idx % elements.length],
  }))
  return {
    ...make_structure(sites),
    lattice: {
      ...make_structure([]).lattice,
      a: 10,
      b: 10,
      c: 10,
      volume: 1000,
    },
  }
}

describe(`Bonding Algorithms`, () => {
  const algorithms: Array<[BondingAlgo, Array<[number, number]>]> = [
    [max_dist, [[10, 5], [100, 50], [500, 500]]],
    [nearest_neighbor, [[10, 10], [100, 100], [500, 1000]]],
    [vdw_radius_based, [[10, 10], [100, 100], [500, 1000]]],
  ] as const

  test.each(algorithms)(`%s performance`, (func, times) => {
    for (const [atom_count, max_time] of times) {
      const structure = make_random_structure(atom_count)
      const avg_time = (measure_performance(() => func(structure)) +
        measure_performance(() => func(structure))) /
        2
      const is_ci = (globalThis as { process?: { env?: { CI?: string } } })?.process?.env
        ?.CI === `true`
      const max_allowed = max_time * (is_ci ? 10 : 3)
      expect(
        avg_time,
        `${func.name} with ${atom_count} atoms: ${avg_time}ms > ${max_allowed}ms`,
      ).toBeLessThanOrEqual(max_allowed)
    }
  })

  test.each(algorithms)(`returns valid BondPair format`, (func) => {
    const bonds = func(
      make_structure([
        { xyz: [0, 0, 0], element: `C` },
        { xyz: [1, 0, 0], element: `H` },
      ]),
    )
    bonds.forEach((bond) => {
      expect(bond).toHaveLength(5)
      expect(bond[0]).toHaveLength(3) // from position
      expect(bond[1]).toHaveLength(3) // to position
      expect(typeof bond[2]).toBe(`number`) // from index
      expect(typeof bond[3]).toBe(`number`) // to index
      expect(bond[4]).toBeGreaterThan(0) // positive distance
    })
  })

  test.each(algorithms)(`generates unique bonds`, (func) => {
    const bonds = func(make_random_structure(20))
    const pairs = new Set(
      bonds.map(([, , a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`),
    )
    expect(pairs.size).toBe(bonds.length)
  })

  test(`max_dist finds tetrahedral bonds`, () => {
    const bonds = max_dist(
      make_structure([
        { xyz: [0, 0, 0], element: `C` },
        { xyz: [1, 0, 0], element: `H` },
        { xyz: [0, 1, 0], element: `H` },
        { xyz: [0, 0, 1], element: `H` },
      ]),
      { max_bond_dist: 1.5, min_bond_dist: 0.5 },
    )

    const center_bonds = bonds.filter(([, , a, b]) => a === 0 || b === 0)
    expect(center_bonds).toHaveLength(3)
    center_bonds.forEach((bond) => expect(bond[4]).toBeCloseTo(1.0, 6))
  })

  test(`max_dist respects distance constraints`, () => {
    const bonds = max_dist(
      make_structure([
        { xyz: [0, 0, 0] },
        { xyz: [0.3, 0, 0] },
        { xyz: [2, 0, 0] },
        { xyz: [1, 0, 0] },
      ]),
      { max_bond_dist: 1.5, min_bond_dist: 0.5 },
    )

    const valid_bond = bonds.find(
      ([, , a, b]) => (a === 0 && b === 3) || (a === 3 && b === 0),
    )
    if (!valid_bond) throw `No valid bond found`
    expect(valid_bond[4]).toBeCloseTo(1.0, 6)
  })

  test(`nearest_neighbor scaling factor works`, () => {
    const structure = make_structure([
      { xyz: [0, 0, 0] },
      { xyz: [1, 0, 0] },
      { xyz: [1.3, 0, 0] },
    ])
    const tight = nearest_neighbor(structure, { scaling_factor: 1.1 })
    const loose = nearest_neighbor(structure, { scaling_factor: 1.5 })
    expect(loose.length).toBeGreaterThanOrEqual(tight.length)
  })

  test(`vdw_radius_based bonds by atomic radii`, () => {
    const bonds = vdw_radius_based(
      make_structure([
        { xyz: [0, 0, 0], element: `C` },
        { xyz: [1.5, 0, 0], element: `C` },
        { xyz: [5, 0, 0], element: `C` },
      ]),
      { tolerance: 0.3 },
    )

    const close_bond = bonds.find((bond) => Math.abs(bond[4] - 1.5) < 0.1)
    expect(close_bond).toBeDefined()
  })

  test(`algorithms handle edge cases`, () => {
    expect(max_dist(make_structure([]))).toHaveLength(0)
    expect(max_dist(make_structure([{ xyz: [0, 0, 0] }]))).toHaveLength(0)
    expect(() => vdw_radius_based(make_structure([{ xyz: [0, 0, 0], element: `Xx` }])))
      .not.toThrow()
  })
})
