import type { ElementSymbol } from '$lib'
import { calculate_all_pair_rdfs, calculate_rdf, type PymatgenStructure } from '$lib/rdf'
import { structure_map } from '$site/structures'
import { describe, expect, test } from 'vitest'

// Use actual structure files from the project
const lu_al_structure = structure_map.get(`mp-1234`) // Lu-Al structure (binary compound)
const pd_structure = structure_map.get(`mp-2`) // Pd (simple metallic FCC)
const bi2zr2o8_structure = structure_map.get(`Bi2Zr2O8-Fm3m`) // Complex multi-element oxide

if (!lu_al_structure || !pd_structure || !bi2zr2o8_structure) {
  throw new Error(`Required test structures not found in structure_map`)
}

// Helper to check basic RDF properties that all RDFs should satisfy
function check_basic_rdf_properties(
  radii: number[],
  g_r: number[],
  n_bins: number,
  _name = ``,
): void {
  expect(radii).toHaveLength(n_bins)
  expect(g_r).toHaveLength(n_bins)
  expect(g_r.every((val) => val >= 0)).toBe(true)
  expect(g_r[0]).toBe(0)
  expect(radii.every((r, idx) => idx === 0 || r > radii[idx - 1])).toBe(true)
}

// Helper to create simple test structures
function create_test_structure(
  lattice_size: number,
  sites_data: Array<
    {
      species: { element: string; occu: number; oxidation_state: number }[]
      xyz: number[]
    }
  >,
): PymatgenStructure {
  return {
    lattice: {
      matrix: [
        [lattice_size, 0.0, 0.0],
        [0.0, lattice_size, 0.0],
        [0.0, 0.0, lattice_size],
      ],
      pbc: [true, true, true],
      volume: lattice_size ** 3,
      a: lattice_size,
      b: lattice_size,
      c: lattice_size,
      alpha: 90,
      beta: 90,
      gamma: 90,
    },
    sites: sites_data.map((site, idx) => ({
      species: site.species.map((sp) => ({
        ...sp,
        element: sp.element as ElementSymbol,
      })),
      xyz: site.xyz as [number, number, number],
      abc: [
        site.xyz[0] / lattice_size,
        site.xyz[1] / lattice_size,
        site.xyz[2] / lattice_size,
      ] as [number, number, number],
      label: `${site.species[0].element}${idx}`,
      properties: {},
    })),
  }
}

describe(`calculate_rdf`, () => {
  test.each([
    { n_bins: 50, cutoff: 10, structure: pd_structure, name: `pd_structure` },
    { n_bins: 100, cutoff: 15, structure: lu_al_structure, name: `lu_al_structure` },
  ])(
    `should return correct array lengths ($name, n_bins=$n_bins)`,
    ({ n_bins, cutoff, structure }) => {
      const result = calculate_rdf(structure, { n_bins, cutoff })
      check_basic_rdf_properties(result.r, result.g_r, n_bins)
      expect(Math.max(...result.r)).toBeCloseTo((n_bins - 0.5) * (cutoff / n_bins), 2)
    },
  )

  test.each([
    { sites: [], name: `empty structure`, should_be_zero: true },
    {
      sites: [{
        species: [{ element: `Si`, occu: 1, oxidation_state: 0 }],
        xyz: [0, 0, 0],
      }],
      name: `single atom`,
      should_be_zero: true,
    },
    {
      sites: [
        { species: [{ element: `Si`, occu: 1, oxidation_state: 0 }], xyz: [0, 0, 0] },
        {
          species: [{ element: `Si`, occu: 1, oxidation_state: 0 }],
          xyz: [4.5, 4.5, 4.5],
        },
      ],
      name: `distant atoms (cutoff 0.1)`,
      should_be_zero: true,
      cutoff: 0.1,
    },
  ])(`should handle edge cases: $name`, ({ sites, should_be_zero, cutoff = 5 }) => {
    const structure = create_test_structure(5, sites)
    const result = calculate_rdf(structure, {
      n_bins: 50,
      cutoff,
      pbc: [false, false, false],
    })
    check_basic_rdf_properties(result.r, result.g_r, 50)
    if (should_be_zero) {
      expect(result.g_r.every((val) => val === 0)).toBe(true)
    }
  })

  test.each([
    { center: `Bi`, neighbor: `O`, has_signal: true, structure: bi2zr2o8_structure },
    { center: `Pd`, neighbor: `Pd`, has_signal: true, structure: pd_structure },
    { center: `Au`, neighbor: `Au`, has_signal: false, structure: pd_structure },
  ])(
    `element pairs: $center-$neighbor`,
    ({ center, neighbor, has_signal, structure }) => {
      const result = calculate_rdf(structure, {
        center_species: center,
        neighbor_species: neighbor,
        n_bins: 50,
      })
      expect(result.element_pair).toEqual([center, neighbor])
      expect(result.g_r.some((val) => val > 0)).toBe(has_signal)
    },
  )

  test.each([
    { cutoff: -5, n_bins: 50 },
    { cutoff: 10, n_bins: 0 },
    { cutoff: -1, n_bins: -1 },
  ])(
    `should throw error for invalid parameters (cutoff=$cutoff, n_bins=$n_bins)`,
    ({ cutoff, n_bins }) => {
      expect(() => calculate_rdf(pd_structure, { cutoff, n_bins })).toThrow(
        /cutoff and n_bins must be positive/,
      )
    },
  )

  test(`should have correct radii spacing`, () => {
    const cutoff = 15
    const n_bins = 75
    const result = calculate_rdf(pd_structure, { cutoff, n_bins })
    const bin_size = cutoff / n_bins
    for (let idx = 0; idx < n_bins; idx++) {
      expect(result.r[idx]).toBeCloseTo((idx + 0.5) * bin_size, 10)
    }
  })

  test(`RDF should approach 1 for large separations (random structure)`, () => {
    const n_atoms = 100
    let seed = 12345
    const random =
      () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32), seed / 2 ** 32)

    const sites = Array.from({ length: n_atoms }, () => ({
      species: [{ element: `Si`, occu: 1, oxidation_state: 0 }],
      xyz: [random() * 30, random() * 30, random() * 30],
    }))

    const large_structure = create_test_structure(30, sites)
    const result = calculate_rdf(large_structure, { cutoff: 12, n_bins: 75 })
    check_basic_rdf_properties(result.r, result.g_r, 75)

    const last_values = result.g_r.slice(Math.floor(0.9 * 75))
    const avg_last = last_values.reduce((sum, val) => sum + val, 0) / last_values.length
    expect(avg_last).toBeGreaterThan(0.9)
    expect(avg_last).toBeLessThan(1.1)
  })

  test.each([
    {
      pbc: [true, true, true] as [boolean, boolean, boolean],
      name: `full PBC`,
      sites: [
        {
          species: [{ element: `Si`, occu: 1, oxidation_state: 0 }],
          xyz: [0.5, 0.5, 0.5],
        },
        {
          species: [{ element: `Si`, occu: 1, oxidation_state: 0 }],
          xyz: [9.5, 0.5, 0.5],
        },
        {
          species: [{ element: `Si`, occu: 1, oxidation_state: 0 }],
          xyz: [0.5, 9.5, 0.5],
        },
        {
          species: [{ element: `Si`, occu: 1, oxidation_state: 0 }],
          xyz: [9.5, 9.5, 0.5],
        },
      ],
    },
    {
      pbc: [false, false, false] as [boolean, boolean, boolean],
      name: `no PBC`,
      sites: [
        {
          species: [{ element: `Si`, occu: 1, oxidation_state: 0 }],
          xyz: [0.5, 0.5, 0.5],
        },
        {
          species: [{ element: `Si`, occu: 1, oxidation_state: 0 }],
          xyz: [9.5, 0.5, 0.5],
        },
        {
          species: [{ element: `Si`, occu: 1, oxidation_state: 0 }],
          xyz: [0.5, 9.5, 0.5],
        },
        {
          species: [{ element: `Si`, occu: 1, oxidation_state: 0 }],
          xyz: [9.5, 9.5, 0.5],
        },
      ],
    },
    {
      pbc: [true, true, false] as [boolean, boolean, boolean],
      name: `slab PBC (xy only)`,
      sites: [
        {
          species: [{ element: `Si`, occu: 1, oxidation_state: 0 }],
          xyz: [0.5, 0.5, 5.0],
        },
        {
          species: [{ element: `Si`, occu: 1, oxidation_state: 0 }],
          xyz: [9.5, 0.5, 5.0],
        },
      ],
    },
  ])(`PBC effects: $name`, ({ pbc, sites }) => {
    const structure = create_test_structure(10, sites)
    const result = calculate_rdf(structure, {
      cutoff: 8,
      n_bins: 100,
      pbc,
      auto_expand: false,
    })
    check_basic_rdf_properties(result.r, result.g_r, 100)
  })

  test(`different PBC settings should give different neighbor counts`, () => {
    const sites = [
      { species: [{ element: `Si`, occu: 1, oxidation_state: 0 }], xyz: [0.5, 0.5, 0.5] },
      { species: [{ element: `Si`, occu: 1, oxidation_state: 0 }], xyz: [9.5, 0.5, 0.5] },
    ]
    const structure = create_test_structure(10, sites)

    const result_pbc = calculate_rdf(structure, {
      cutoff: 8,
      n_bins: 100,
      pbc: [true, true, true],
      auto_expand: false,
    })
    const result_no_pbc = calculate_rdf(structure, {
      cutoff: 8,
      n_bins: 100,
      pbc: [false, false, false],
      auto_expand: false,
    })

    const sum_pbc = result_pbc.g_r.reduce((sum, val) => sum + val, 0)
    const sum_no_pbc = result_no_pbc.g_r.reduce((sum, val) => sum + val, 0)
    expect(sum_pbc).toBeGreaterThan(sum_no_pbc)
  })

  test(`RDF calculation should be deterministic`, () => {
    const result1 = calculate_rdf(lu_al_structure, { cutoff: 5, n_bins: 50 })
    const result2 = calculate_rdf(lu_al_structure, { cutoff: 5, n_bins: 50 })
    expect(result1.r).toEqual(result2.r)
    expect(result1.g_r).toEqual(result2.g_r)
  })
})

describe(`calculate_all_pair_rdfs`, () => {
  test.each([
    { structure: lu_al_structure, expected_pairs: 3, name: `binary compound (Lu-Al)` },
    { structure: pd_structure, expected_pairs: 1, name: `single element (Pd)` },
  ])(`should calculate all unique pairs: $name`, ({ structure, expected_pairs }) => {
    const patterns = calculate_all_pair_rdfs(structure, { cutoff: 8, n_bins: 50 })
    expect(patterns).toHaveLength(expected_pairs)

    for (const pattern of patterns) {
      check_basic_rdf_properties(pattern.r, pattern.g_r, 50)
      expect(pattern.element_pair).toBeDefined()
    }
  })

  test(`should respect cutoff and n_bins for all pairs`, () => {
    const cutoff = 12
    const n_bins = 80
    const patterns = calculate_all_pair_rdfs(lu_al_structure, { cutoff, n_bins })

    for (const pattern of patterns) {
      expect(pattern.r).toHaveLength(n_bins)
      expect(Math.max(...pattern.r)).toBeCloseTo((n_bins - 0.5) * (cutoff / n_bins), 2)
    }
  })

  test.each([
    { structure: lu_al_structure, cutoff: 8, n_bins: 80, max_peak: 20, name: `Lu-Al` },
    {
      structure: pd_structure,
      cutoff: 15,
      n_bins: 150,
      max_peak: 50,
      name: `Pd (auto_expand)`,
      auto_expand: true,
    },
    {
      structure: bi2zr2o8_structure,
      cutoff: 10,
      n_bins: 100,
      max_peak: 100,
      name: `Bi2Zr2O8`,
    },
  ])(
    `RDF should have reasonable peak values: $name`,
    ({ structure, cutoff, n_bins, max_peak, auto_expand = false }) => {
      const result = calculate_rdf(structure, { cutoff, n_bins, auto_expand })
      check_basic_rdf_properties(result.r, result.g_r, n_bins)

      const max_g_r = Math.max(...result.g_r)
      expect(max_g_r).toBeGreaterThan(0)
      expect(max_g_r).toBeLessThan(max_peak)
      expect(result.g_r.every((val) => isFinite(val))).toBe(true)

      // First few bins should not have crazy values
      for (let idx = 0; idx < Math.min(10, n_bins); idx++) {
        expect(result.g_r[idx]).toBeLessThan(max_peak)
      }
    },
  )

  test(`RDF with auto_expand should respect minimum physical distances`, () => {
    const result = calculate_rdf(pd_structure, {
      cutoff: 15,
      n_bins: 150,
      auto_expand: true,
    })
    check_basic_rdf_properties(result.r, result.g_r, 150)

    // For Pd FCC, nearest neighbor is ~2.75 Å, so bins below 2 Å should be zero
    const min_expected_dist = 2.0
    const bins_should_be_zero = Math.floor(min_expected_dist / (15 / 150))
    for (let idx = 0; idx < bins_should_be_zero; idx++) {
      expect(result.g_r[idx]).toBe(0)
    }
  })

  test(`all_pair_rdfs calculation should be deterministic`, () => {
    const patterns1 = calculate_all_pair_rdfs(bi2zr2o8_structure, {
      cutoff: 5,
      n_bins: 50,
    })
    const patterns2 = calculate_all_pair_rdfs(bi2zr2o8_structure, {
      cutoff: 5,
      n_bins: 50,
    })

    expect(patterns1.length).toBe(patterns2.length)
    for (let idx = 0; idx < patterns1.length; idx++) {
      expect(patterns1[idx].r).toEqual(patterns2[idx].r)
      expect(patterns1[idx].g_r).toEqual(patterns2[idx].g_r)
      expect(patterns1[idx].element_pair).toEqual(patterns2[idx].element_pair)
    }
  })

  test.each([
    {
      cutoff: 0.1,
      n_bins: 10,
      auto_expand: false,
      name: `tiny cutoff`,
      should_be_zero: true,
    },
    {
      cutoff: 10,
      n_bins: 1000,
      auto_expand: true,
      name: `many bins`,
      should_be_zero: false,
    },
    { cutoff: 5, n_bins: 20, auto_expand: true, name: `few bins`, should_be_zero: false },
  ])(`extreme parameters: $name`, ({ cutoff, n_bins, auto_expand, should_be_zero }) => {
    const result = calculate_rdf(pd_structure, { cutoff, n_bins, auto_expand })
    check_basic_rdf_properties(result.r, result.g_r, n_bins)
    if (should_be_zero) {
      expect(result.g_r.every((val) => val === 0)).toBe(true)
    } else {
      expect(result.g_r.some((val) => val > 0)).toBe(true)
    }
  })

  test.each([
    { expansion_factor: 1.5, name: `minimal` },
    { expansion_factor: 2.0, name: `standard` },
    { expansion_factor: 2.5, name: `conservative` },
    { expansion_factor: 3.0, name: `extra conservative` },
  ])(
    `expansion_factor $expansion_factor ($name) should give reasonable RDFs`,
    ({ expansion_factor }) => {
      const result = calculate_rdf(pd_structure, {
        cutoff: 10,
        n_bins: 100,
        auto_expand: true,
        expansion_factor,
      })
      check_basic_rdf_properties(result.r, result.g_r, 100)

      const max_g_r = Math.max(...result.g_r)
      expect(max_g_r).toBeGreaterThan(0)
      expect(max_g_r).toBeLessThan(50)

      // No artificial peaks at short distances
      const min_expected_dist = 2.0
      const bins_should_be_zero = Math.floor(min_expected_dist / (10 / 100))
      for (let idx = 0; idx < bins_should_be_zero; idx++) {
        expect(result.g_r[idx]).toBe(0)
      }
    },
  )

  test(`different expansion_factors should give similar RDF shapes`, () => {
    const cutoff = 8
    const n_bins = 80
    const factors = [1.5, 2.0, 2.5]

    const results = factors.map((expansion_factor) =>
      calculate_rdf(pd_structure, { cutoff, n_bins, auto_expand: true, expansion_factor })
    )

    for (const result of results) {
      check_basic_rdf_properties(result.r, result.g_r, n_bins)
    }

    // Sums should be similar (within 20% of each other)
    const sums = results.map((r) => r.g_r.reduce((sum, val) => sum + val, 0))
    const avg_sum = sums.reduce((sum, val) => sum + val, 0) / sums.length
    for (const sum of sums) {
      expect(Math.abs(sum - avg_sum) / avg_sum).toBeLessThan(0.2)
    }
  })

  test(`expansion_factor works with calculate_all_pair_rdfs`, () => {
    const patterns = calculate_all_pair_rdfs(pd_structure, {
      cutoff: 10,
      n_bins: 50,
      expansion_factor: 2.5,
    })
    expect(patterns).toHaveLength(1)
    expect(patterns[0].element_pair).toEqual([`Pd`, `Pd`])
    check_basic_rdf_properties(patterns[0].r, patterns[0].g_r, 50)

    const max_g_r = Math.max(...patterns[0].g_r)
    expect(max_g_r).toBeGreaterThan(0)
    expect(max_g_r).toBeLessThan(50)
  })

  test(`full RDF should properly weight element pairs`, () => {
    const cutoff = 5
    const n_bins = 50

    const full_rdf_correct = calculate_rdf(bi2zr2o8_structure, { cutoff, n_bins })

    // Naive uniform averaging would give wrong result for multicomponent structures
    const partial_rdfs = calculate_all_pair_rdfs(bi2zr2o8_structure, { cutoff, n_bins })
    const full_rdf_wrong = {
      r: partial_rdfs[0]?.r ?? [],
      g_r: partial_rdfs[0].r.map((_, idx) =>
        partial_rdfs.reduce((sum, p) => sum + p.g_r[idx], 0) / partial_rdfs.length
      ),
    }

    // Calculate max difference
    const max_diff = Math.max(
      ...full_rdf_correct.g_r.map((val, idx) => Math.abs(val - full_rdf_wrong.g_r[idx])),
    )
    expect(max_diff).toBeGreaterThan(0.1)
    check_basic_rdf_properties(full_rdf_correct.r, full_rdf_correct.g_r, n_bins)
  })
})
