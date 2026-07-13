import type { ElementSymbol } from '$lib'
import * as math from '$lib/math'
import type { Matrix3x3 } from '$lib/math'
import { calculate_all_pair_rdfs, calculate_rdf } from '$lib/rdf'
import type { Pbc } from '$lib/structure'
import { structure_map } from '$site/structures'
import { describe, expect, test } from 'vitest'
import { create_test_structure, make_crystal } from '../setup'

// Use actual structure files from the project
const lu_al_structure = structure_map.get(`mp-1234`) // Lu-Al structure (binary compound)
const pd_structure = structure_map.get(`mp-2`) // Pd (simple metallic FCC)
const bi2zr2o8_structure = structure_map.get(`Bi2Zr2O8-Fm3m`) // Complex multi-element oxide

if (!lu_al_structure || !pd_structure || !bi2zr2o8_structure) {
  throw new Error(`Required test structures not found in structure_map`)
}

// Cartesian-site shorthand for create_test_structure
const make_site = (element: ElementSymbol, xyz: number[]) => ({
  species: [{ element, occu: 1, oxidation_state: 0 }],
  xyz,
})

// Helper to check basic RDF properties that all RDFs should satisfy
function check_basic_rdf_properties(radii: number[], g_r: number[], n_bins: number): void {
  expect(radii).toHaveLength(n_bins)
  expect(g_r).toHaveLength(n_bins)
  expect(g_r.every((val) => val >= 0)).toBe(true)
  expect(g_r[0]).toBe(0)
  expect(radii.every((radius, idx) => idx === 0 || radius > radii[idx - 1])).toBe(true)
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
    { sites: [make_site(`Si`, [0, 0, 0])], name: `single atom`, should_be_zero: true },
    {
      sites: [make_site(`Si`, [0, 0, 0]), make_site(`Si`, [4.5, 4.5, 4.5])],
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
  ])(`element pairs: $center-$neighbor`, ({ center, neighbor, has_signal, structure }) => {
    const result = calculate_rdf(structure, {
      center_species: center,
      neighbor_species: neighbor,
      n_bins: 50,
    })
    expect(result.element_pair).toEqual([center, neighbor])
    expect(result.g_r.some((val) => val > 0)).toBe(has_signal)
  })

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
    const [cutoff, n_bins] = [15, 75]
    const result = calculate_rdf(pd_structure, { cutoff, n_bins })
    const bin_size = cutoff / n_bins
    for (let idx = 0; idx < n_bins; idx++) {
      expect(result.r[idx]).toBeCloseTo((idx + 0.5) * bin_size, 10)
    }
  })

  test(`RDF should approach 1 for large separations (random structure)`, () => {
    const n_atoms = 100
    let seed = 12345
    const random = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32), seed / 2 ** 32)

    const sites = Array.from({ length: n_atoms }, () =>
      make_site(`Si`, [random() * 30, random() * 30, random() * 30]),
    )

    const large_structure = create_test_structure(30, sites)
    const result = calculate_rdf(large_structure, { cutoff: 12, n_bins: 75 })
    check_basic_rdf_properties(result.r, result.g_r, 75)

    const last_values = result.g_r.slice(Math.floor(0.9 * 75))
    const avg_last = last_values.reduce((sum, val) => sum + val, 0) / last_values.length
    expect(avg_last).toBeGreaterThan(0.9)
    expect(avg_last).toBeLessThan(1.1)
  })

  const corner_sites = [
    [0.5, 0.5, 0.5],
    [9.5, 0.5, 0.5],
    [0.5, 9.5, 0.5],
    [9.5, 9.5, 0.5],
  ].map((xyz) => make_site(`Si`, xyz))

  test.each([
    { pbc: [true, true, true] as Pbc, name: `full PBC`, sites: corner_sites },
    { pbc: [false, false, false] as Pbc, name: `no PBC`, sites: corner_sites },
    {
      pbc: [true, true, false] as Pbc,
      name: `slab PBC (xy only)`,
      sites: [make_site(`Si`, [0.5, 0.5, 5.0]), make_site(`Si`, [9.5, 0.5, 5.0])],
    },
  ])(`PBC effects: $name`, ({ pbc, sites }) => {
    expect.assertions(5)
    const structure = create_test_structure(10, sites)
    const options = { cutoff: 8, n_bins: 100, pbc, auto_expand: false }
    const result = calculate_rdf(structure, options)
    check_basic_rdf_properties(result.r, result.g_r, 100)
  })

  test(`different PBC settings should give different neighbor counts`, () => {
    const sites = [make_site(`Si`, [0.5, 0.5, 0.5]), make_site(`Si`, [9.5, 0.5, 0.5])]
    const structure = create_test_structure(10, sites)

    const opts = { cutoff: 8, n_bins: 100, auto_expand: false }
    const result_pbc = calculate_rdf(structure, { ...opts, pbc: [true, true, true] })
    const result_no_pbc = calculate_rdf(structure, { ...opts, pbc: [false, false, false] })

    const sum_pbc = result_pbc.g_r.reduce((sum, val) => sum + val, 0)
    const sum_no_pbc = result_no_pbc.g_r.reduce((sum, val) => sum + val, 0)
    expect(sum_pbc).toBeGreaterThan(sum_no_pbc)
  })

  test(`auto_expand keeps one non-periodic atom all-zero beyond cell length`, () => {
    const structure = create_test_structure(5, [make_site(`Si`, [0, 0, 0])])
    const result = calculate_rdf(structure, {
      cutoff: 8,
      n_bins: 80,
      auto_expand: true,
      pbc: [false, false, false],
    })
    expect(result.g_r.every((val) => val === 0)).toBe(true)
  })

  test(`auto_expand replicates only periodic axes for mixed PBC`, () => {
    const structure = create_test_structure(5, [make_site(`Si`, [0, 0, 0])])
    const result = calculate_rdf(structure, {
      cutoff: 9,
      n_bins: 90,
      auto_expand: true,
      pbc: [true, false, false],
    })
    const nonzero_bins = result.g_r
      .map((value, idx) => ({ radius: result.r[idx], value }))
      .filter(({ value }) => value > 0)

    expect(nonzero_bins.some(({ radius }) => radius > 4.5 && radius < 5.5)).toBe(true)
    expect(nonzero_bins.every(({ radius }) => radius < 6)).toBe(true)
  })

  // Regression: auto-expansion used to disable PBC on the expanded structure, so atoms near
  // the supercell boundary lost neighbors while normalization still assumed homogeneous
  // density, biasing g(r) low (first-shell coordination 5.26 instead of 6)
  test(`simple cubic keeps PBC after auto-expansion: coordination numbers exact`, () => {
    const [a_len, cutoff, n_bins] = [4, 15, 150]
    const structure = create_test_structure(a_len, [`Si`], [[0, 0, 0]])
    const { r, g_r } = calculate_rdf(structure, { cutoff, n_bins, auto_expand: true })

    // Coordination number n(r_max) = ∫₀^r_max 4πr²ρ·g(r)dr with ρ = 1/a³
    const coordination = (r_max: number) =>
      r.reduce(
        (sum, rad, idx) =>
          rad < r_max
            ? sum + (4 * Math.PI * rad ** 2 * g_r[idx] * (cutoff / n_bins)) / a_len ** 3
            : sum,
        0,
      )

    // First shell: 6 neighbors at r = a (second shell sits at a·√2 ≈ 5.66)
    expect(coordination(1.2 * a_len)).toBeCloseTo(6, 1)

    // Full integral must recover the exact brute-force count of cubic-lattice neighbors
    const span = Array.from({ length: 9 }, (_, idx) => idx - 4) // |idx| ≤ 4 > cutoff/a_len
    const exact_count = span
      .flatMap((ii) => span.flatMap((jj) => span.map((kk) => a_len * Math.hypot(ii, jj, kk))))
      .filter((dist) => dist > 0 && dist < cutoff).length
    expect(coordination(Infinity)).toBeCloseTo(exact_count, 0)
  })

  // Regression: calculate_all_pair_rdfs used to force pbc=[false,false,false], discarding
  // the caller's pbc (e.g. from RdfPlot) and dropping cross-boundary pairs
  test(`calculate_all_pair_rdfs preserves caller pbc`, () => {
    // min-image distance between the sites is 1 Å, reachable only with PBC; without PBC
    // the nearest pair sits at 9 Å, beyond the cutoff, leaving g(r) all zero
    const structure = create_test_structure(
      10,
      [`Si`, `Si`],
      [
        [0.05, 0.05, 0.05],
        [0.95, 0.05, 0.05],
      ],
    )
    const opts = { cutoff: 8, n_bins: 80, auto_expand: false, pbc: [true, true, true] as Pbc }
    const [all_pair] = calculate_all_pair_rdfs(structure, opts)
    const direct = calculate_rdf(structure, {
      ...opts,
      center_species: `Si`,
      neighbor_species: `Si`,
    })
    const first_peak_idx = all_pair.g_r.findIndex((val) => val > 0)
    expect(first_peak_idx).not.toBe(-1)
    expect(all_pair.r[first_peak_idx]).toBeCloseTo(1, 0)
    expect(all_pair.g_r).toEqual(direct.g_r)
  })

  test(`RDF calculation should be deterministic`, () => {
    const result1 = calculate_rdf(lu_al_structure, { cutoff: 5, n_bins: 50 })
    const result2 = calculate_rdf(lu_al_structure, { cutoff: 5, n_bins: 50 })
    expect(result1.r).toEqual(result2.r)
    expect(result1.g_r).toEqual(result2.g_r)
  })

  test(`RDF regression: skewed triclinic nearest image lands in correct bin`, () => {
    const lattice: Matrix3x3 = [
      [1.9705932249259481, -3.955757771584847, 1.6595752827868262],
      [-2.0392732691684845, 3.498999611184008, -1.7465434512400368],
      [3.716215074235551, 3.996782696347811, 1.0904649182023587],
    ]
    const structure = make_crystal(
      lattice,
      [
        { element: `Si`, xyz: [3.395535765213964, 4.297261971797731, 0.837260400991752] },
        { element: `Si`, xyz: [1.6425399077772327, -1.0582437501479167, 0.9390064337754569] },
      ],
      { pbc: [true, true, true] },
    )
    const cutoff = 2
    const n_bins = 20
    const result = calculate_rdf(structure, { cutoff, n_bins, auto_expand: false })
    const expected_dist = math.pbc_dist(
      structure.sites[0].xyz,
      structure.sites[1].xyz,
      lattice,
    )
    const bin_width = cutoff / n_bins
    const expected_bin = Math.floor(expected_dist / bin_width)
    const nonzero_bins = result.g_r
      .map((value, idx) => ({ value, idx }))
      .filter(({ value }) => value > 0)

    expect(nonzero_bins).toHaveLength(1)
    expect(nonzero_bins[0]?.idx).toBe(expected_bin)
  })

  test.each([
    {
      name: `triclinic`,
      lattice: [
        [5.0, 0.0, 0.0],
        [1.0, 6.0, 0.0],
        [0.5, 1.5, 7.0],
      ] satisfies Matrix3x3,
      sites: [
        make_site(`Si`, [0.0, 0.0, 0.0]),
        make_site(`Si`, [2.5, 3.0, 3.5]),
        make_site(`O`, [1.0, 1.0, 1.0]),
        make_site(`O`, [3.0, 4.0, 4.5]),
      ],
      cutoff: 10,
      n_bins: 100,
      expected_angles: {
        alpha: { not_close_to: 90 },
        beta: { not_close_to: 90 },
        gamma: { not_close_to: 90 },
      },
      expected_lengths_differ: true,
    },
    {
      name: `monoclinic`,
      lattice: [
        [5.0, 0.0, 0.0],
        [0.0, 6.0, 0.0],
        [2.0, 0.0, 7.0],
      ] satisfies Matrix3x3,
      sites: [make_site(`Na`, [0.0, 0.0, 0.0]), make_site(`Cl`, [2.5, 3.0, 3.5])],
      cutoff: 8,
      n_bins: 80,
      expected_angles: {
        alpha: { close_to: 90 },
        beta: { not_close_to: 90 },
        gamma: { close_to: 90 },
      },
      expected_lengths_differ: false,
    },
  ])(
    `should calculate RDF correctly for $name lattice`,
    ({ lattice, sites, cutoff, n_bins, expected_angles, expected_lengths_differ }) => {
      const structure = create_test_structure(lattice, sites)
      const result = calculate_rdf(structure, { cutoff, n_bins, pbc: [true, true, true] })

      // Check basic RDF properties
      check_basic_rdf_properties(result.r, result.g_r, n_bins)
      expect(result.g_r.some((val) => val > 0)).toBe(true)
      expect(result.g_r.every(isFinite)).toBe(true)

      // Check no negative or NaN values
      expect(result.g_r.every((val) => val >= 0 && !Number.isNaN(val))).toBe(true)

      // Verify correct lattice angles
      const check_angle = (
        angle: number,
        expected: { close_to?: number; not_close_to?: number },
      ) => {
        if (expected.close_to !== undefined) {
          expect(angle).toBeCloseTo(expected.close_to, 1)
        }
        if (expected.not_close_to !== undefined) {
          expect(Math.abs(angle - expected.not_close_to)).toBeGreaterThan(1)
        }
      }

      check_angle(structure.lattice.alpha, expected_angles.alpha)
      check_angle(structure.lattice.beta, expected_angles.beta)
      check_angle(structure.lattice.gamma, expected_angles.gamma)

      // Verify lattice length differences
      if (expected_lengths_differ) {
        expect(Math.abs(structure.lattice.a - structure.lattice.b)).toBeGreaterThan(0.1)
        expect(Math.abs(structure.lattice.b - structure.lattice.c)).toBeGreaterThan(0.1)
        expect(Math.abs(structure.lattice.a - structure.lattice.c)).toBeGreaterThan(0.1)
      }

      // Verify volume is positive
      expect(structure.lattice.volume).toBeGreaterThan(0)

      // Check that fractional coordinates were calculated correctly
      // For at least one site, verify xyz = lattice · abc
      const site = structure.sites[0]
      const xyz_from_abc = math.create_frac_to_cart(lattice)(site.abc)
      expect(xyz_from_abc[0]).toBeCloseTo(site.xyz[0], 10)
      expect(xyz_from_abc[1]).toBeCloseTo(site.xyz[1], 10)
      expect(xyz_from_abc[2]).toBeCloseTo(site.xyz[2], 10)
    },
  )
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
      expect(result.g_r.every(isFinite)).toBe(true)

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

    expect(patterns1).toHaveLength(patterns2.length)
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
    const [cutoff, n_bins] = [8, 80]
    const factors = [1.5, 2.0, 2.5]

    const results = factors.map((expansion_factor) =>
      calculate_rdf(pd_structure, {
        cutoff,
        n_bins,
        auto_expand: true,
        expansion_factor,
      }),
    )

    for (const result of results) {
      check_basic_rdf_properties(result.r, result.g_r, n_bins)
    }

    // Sums should be similar (within 20% of each other)
    const sums = results.map((result) => result.g_r.reduce((sum, val) => sum + val, 0))
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
    const [cutoff, n_bins] = [5, 50]

    const full_rdf_correct = calculate_rdf(bi2zr2o8_structure, { cutoff, n_bins })

    // Naive uniform averaging would give wrong result for multicomponent structures
    const partial_rdfs = calculate_all_pair_rdfs(bi2zr2o8_structure, { cutoff, n_bins })
    const full_rdf_wrong = {
      r: partial_rdfs[0]?.r ?? [],
      g_r: partial_rdfs[0].r.map(
        (_, idx) =>
          partial_rdfs.reduce((sum, partial) => sum + partial.g_r[idx], 0) /
          partial_rdfs.length,
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
