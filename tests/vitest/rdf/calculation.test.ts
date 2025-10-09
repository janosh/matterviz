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
  // Check array types and shapes
  expect(radii).toHaveLength(n_bins)
  expect(g_r).toHaveLength(n_bins)

  // Check RDF values are non-negative
  expect(g_r.every((val) => val >= 0)).toBe(true)

  // Check RDF starts at 0 (no atoms at r=0)
  expect(g_r[0]).toBe(0)

  // Check radii are positive and increasing
  expect(radii.every((r, idx) => idx === 0 || r > radii[idx - 1])).toBe(true)
}

describe(`calculate_rdf`, () => {
  test(`should return arrays of correct length`, () => {
    const n_bins = 50
    const result = calculate_rdf(pd_structure, { n_bins })

    expect(result.r).toHaveLength(n_bins)
    expect(result.g_r).toHaveLength(n_bins)
    check_basic_rdf_properties(result.r, result.g_r, n_bins, `pd_structure`)
  })

  test(`should handle empty structure`, () => {
    const empty_structure: PymatgenStructure = {
      lattice: {
        matrix: [
          [1.0, 0.0, 0.0],
          [0.0, 1.0, 0.0],
          [0.0, 0.0, 1.0],
        ],
      },
      sites: [],
    }

    const result = calculate_rdf(empty_structure, { n_bins: 50 })
    check_basic_rdf_properties(result.r, result.g_r, 50, `empty_structure`)
    expect(result.g_r.every((val) => val === 0)).toBe(true)
  })

  test(`RDF should start at zero (no atoms at r=0)`, () => {
    const result = calculate_rdf(lu_al_structure, { cutoff: 10, n_bins: 100 })
    expect(result.g_r[0]).toBe(0)
  })

  test(`should respect cutoff parameter`, () => {
    const cutoff = 10
    const n_bins = 100
    const result = calculate_rdf(pd_structure, { cutoff, n_bins })

    const max_r = Math.max(...result.r)
    expect(max_r).toBeCloseTo(cutoff, 2)
  })

  test(`should calculate partial RDF for specific element pairs`, () => {
    const result = calculate_rdf(bi2zr2o8_structure, {
      center_species: `Bi`,
      neighbor_species: `O`,
      cutoff: 8,
      n_bins: 50,
    })

    expect(result.element_pair).toEqual([`Bi`, `O`])
    expect(result.r).toHaveLength(50)
    expect(result.g_r).toHaveLength(50)

    // Should have non-zero values since there are Bi-O pairs
    const has_nonzero = result.g_r.some((val) => val > 0)
    expect(has_nonzero).toBe(true)
  })

  test(`should handle non-existent element species`, () => {
    const result = calculate_rdf(pd_structure, {
      center_species: `Au`,
      neighbor_species: `Au`,
      n_bins: 50,
    })

    // Should return zeros if no atoms of that species exist
    expect(result.g_r.every((val) => val === 0)).toBe(true)
  })

  test(`should throw error for invalid cutoff`, () => {
    expect(() => {
      calculate_rdf(pd_structure, { cutoff: -5 })
    }).toThrow(/cutoff and n_bins must be positive/)
  })

  test(`should throw error for invalid n_bins`, () => {
    expect(() => {
      calculate_rdf(pd_structure, { n_bins: 0 })
    }).toThrow(/cutoff and n_bins must be positive/)
  })

  test(`should respect PBC parameter`, () => {
    // With PBC disabled in all directions
    const no_pbc_result = calculate_rdf(pd_structure, {
      pbc: [0, 0, 0],
      cutoff: 10,
      n_bins: 50,
    })

    // With PBC enabled
    const pbc_result = calculate_rdf(pd_structure, {
      pbc: [1, 1, 1],
      cutoff: 10,
      n_bins: 50,
    })

    // Results should be the same for this small structure within the cutoff
    // but in general they could differ for larger structures or different cutoffs
    expect(no_pbc_result.r).toHaveLength(50)
    expect(pbc_result.r).toHaveLength(50)
  })

  test(`should calculate same-element RDF`, () => {
    const result = calculate_rdf(pd_structure, {
      center_species: `Pd`,
      neighbor_species: `Pd`,
      cutoff: 10,
      n_bins: 50,
    })

    expect(result.element_pair).toEqual([`Pd`, `Pd`])
    // Pd is FCC structure, should have peaks at nearest neighbor distances
    const has_nonzero = result.g_r.some((val) => val > 0)
    expect(has_nonzero).toBe(true)
  })

  test(`should have correct radii spacing`, () => {
    const cutoff = 15
    const n_bins = 75
    const result = calculate_rdf(pd_structure, { cutoff, n_bins })

    const bin_size = cutoff / n_bins
    for (let idx = 0; idx < n_bins; idx++) {
      const expected_r = (idx + 1) * bin_size
      expect(result.r[idx]).toBeCloseTo(expected_r, 10)
    }
  })

  test(`RDF should approach 1 for large separations (random structure)`, () => {
    // Create large random structure to test normalization
    const n_atoms = 100
    const sites: PymatgenStructure[`sites`] = []

    // Use simple seeded random (deterministic)
    let seed = 12345
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 2 ** 32
      return seed / 2 ** 32
    }

    for (let idx = 0; idx < n_atoms; idx++) {
      sites.push({
        species: [{ element: `Si`, occu: 1 }],
        xyz: [random() * 30, random() * 30, random() * 30],
      })
    }

    const large_structure: PymatgenStructure = {
      lattice: {
        matrix: [
          [30.0, 0.0, 0.0],
          [0.0, 30.0, 0.0],
          [0.0, 0.0, 30.0],
        ],
      },
      sites,
    }

    const cutoff = 12
    const n_bins = 75
    const result = calculate_rdf(large_structure, { cutoff, n_bins })

    check_basic_rdf_properties(result.r, result.g_r, n_bins, `large_random`)

    // Check if RDF approaches 1 for large separations (last 10%)
    const start_idx = Math.floor(0.9 * n_bins)
    const last_values = result.g_r.slice(start_idx)
    const avg_last = last_values.reduce((sum, val) => sum + val, 0) / last_values.length

    // Should be within 10% of 1 for a large random structure
    // (100 atoms is not quite enough for perfect convergence)
    expect(avg_last).toBeGreaterThan(0.9)
    expect(avg_last).toBeLessThan(1.1)
  })

  test(`RDF values should be all non-negative`, () => {
    const result = calculate_rdf(lu_al_structure, { cutoff: 10, n_bins: 100 })
    expect(result.g_r.every((val) => val >= 0)).toBe(true)
  })

  test(`different PBC settings should give different results`, () => {
    // Create structure where PBC will make a clear difference
    // Atoms near cell boundaries will have periodic neighbors
    const test_structure: PymatgenStructure = {
      lattice: {
        matrix: [
          [10.0, 0.0, 0.0],
          [0.0, 10.0, 0.0],
          [0.0, 0.0, 10.0],
        ],
      },
      sites: [
        // Place atoms near cell boundaries so PBC matters
        { species: [{ element: `Si`, occu: 1 }], xyz: [0.5, 0.5, 0.5] },
        { species: [{ element: `Si`, occu: 1 }], xyz: [9.5, 0.5, 0.5] },
        { species: [{ element: `Si`, occu: 1 }], xyz: [0.5, 9.5, 0.5] },
        { species: [{ element: `Si`, occu: 1 }], xyz: [9.5, 9.5, 0.5] },
      ],
    }

    const cutoff = 8
    const n_bins = 100

    const result_full_pbc = calculate_rdf(test_structure, {
      cutoff,
      n_bins,
      pbc: [1, 1, 1],
      auto_expand: false, // Disable to test PBC behavior
    })

    const result_no_pbc = calculate_rdf(test_structure, {
      cutoff,
      n_bins,
      pbc: [0, 0, 0],
      auto_expand: false, // Disable to test PBC behavior
    })

    check_basic_rdf_properties(result_full_pbc.r, result_full_pbc.g_r, n_bins, `full_pbc`)
    check_basic_rdf_properties(result_no_pbc.r, result_no_pbc.g_r, n_bins, `no_pbc`)

    // Total RDF integral should be higher with PBC (more neighbors accessible)
    const sum_full = result_full_pbc.g_r.reduce((sum, val) => sum + val, 0)
    const sum_no = result_no_pbc.g_r.reduce((sum, val) => sum + val, 0)

    expect(sum_full).toBeGreaterThan(sum_no)
  })

  test(`should handle single atom structure (all zeros)`, () => {
    const single_atom: PymatgenStructure = {
      lattice: {
        matrix: [
          [5.0, 0.0, 0.0],
          [0.0, 5.0, 0.0],
          [0.0, 0.0, 5.0],
        ],
      },
      sites: [
        {
          species: [{ element: `Si`, occu: 1 }],
          xyz: [0.0, 0.0, 0.0],
        },
      ],
    }

    const result = calculate_rdf(single_atom, {
      center_species: `Si`,
      neighbor_species: `Si`,
      cutoff: 4,
      n_bins: 100,
    })

    check_basic_rdf_properties(result.r, result.g_r, 100, `single_atom`)
    expect(result.g_r.every((val) => val === 0)).toBe(true)
  })

  test(`should handle distant atoms beyond cutoff (all zeros)`, () => {
    const distant_atoms: PymatgenStructure = {
      lattice: {
        matrix: [
          [5.0, 0.0, 0.0],
          [0.0, 5.0, 0.0],
          [0.0, 0.0, 5.0],
        ],
      },
      sites: [
        {
          species: [{ element: `Si`, occu: 1 }],
          xyz: [0.0, 0.0, 0.0],
        },
        {
          species: [{ element: `Si`, occu: 1 }],
          xyz: [4.5, 4.5, 4.5], // Very far away
        },
      ],
    }

    const result = calculate_rdf(distant_atoms, {
      center_species: `Si`,
      neighbor_species: `Si`,
      cutoff: 0.1, // Very small cutoff
      n_bins: 30,
      pbc: [0, 0, 0], // No PBC
    })

    check_basic_rdf_properties(result.r, result.g_r, 30, `distant_atoms`)
    expect(result.g_r.every((val) => val === 0)).toBe(true)
  })

  test(`different element pairs should give different RDFs`, () => {
    // Create Si-Ge structure with multiple atoms to avoid edge cases
    const si_ge_structure: PymatgenStructure = {
      lattice: {
        matrix: [
          [10.0, 0.0, 0.0],
          [0.0, 10.0, 0.0],
          [0.0, 0.0, 10.0],
        ],
      },
      sites: [
        { species: [{ element: `Si`, occu: 1 }], xyz: [0.0, 0.0, 0.0] },
        { species: [{ element: `Si`, occu: 1 }], xyz: [2.5, 0.0, 0.0] },
        { species: [{ element: `Ge`, occu: 1 }], xyz: [1.25, 1.25, 0.0] },
        { species: [{ element: `Ge`, occu: 1 }], xyz: [3.75, 1.25, 0.0] },
      ],
    }

    const cutoff = 8
    const n_bins = 100

    const rdf_si_si = calculate_rdf(si_ge_structure, {
      center_species: `Si`,
      neighbor_species: `Si`,
      cutoff,
      n_bins,
      pbc: [0, 0, 0],
    })

    const rdf_ge_ge = calculate_rdf(si_ge_structure, {
      center_species: `Ge`,
      neighbor_species: `Ge`,
      cutoff,
      n_bins,
      pbc: [0, 0, 0],
    })

    const rdf_si_ge = calculate_rdf(si_ge_structure, {
      center_species: `Si`,
      neighbor_species: `Ge`,
      cutoff,
      n_bins,
      pbc: [0, 0, 0],
    })

    check_basic_rdf_properties(rdf_si_si.r, rdf_si_si.g_r, n_bins, `Si-Si`)
    check_basic_rdf_properties(rdf_ge_ge.r, rdf_ge_ge.g_r, n_bins, `Ge-Ge`)
    check_basic_rdf_properties(rdf_si_ge.r, rdf_si_ge.g_r, n_bins, `Si-Ge`)

    // All should have non-zero values (multiple atoms of each type)
    expect(rdf_si_si.g_r.some((val) => val > 0)).toBe(true)
    expect(rdf_ge_ge.g_r.some((val) => val > 0)).toBe(true)
    expect(rdf_si_ge.g_r.some((val) => val > 0)).toBe(true)

    // The RDFs should be different from each other
    const si_si_sum = rdf_si_si.g_r.reduce((sum, val) => sum + val, 0)
    const ge_ge_sum = rdf_ge_ge.g_r.reduce((sum, val) => sum + val, 0)
    const si_ge_sum = rdf_si_ge.g_r.reduce((sum, val) => sum + val, 0)

    // At least one pair should have a different total
    const all_equal = Math.abs(si_si_sum - ge_ge_sum) < 1e-10 &&
      Math.abs(si_si_sum - si_ge_sum) < 1e-10
    expect(all_equal).toBe(false)
  })

  test(`RDF calculation should be consistent across runs`, () => {
    const cutoff = 5
    const n_bins = 50

    const result1 = calculate_rdf(lu_al_structure, { cutoff, n_bins })
    const result2 = calculate_rdf(lu_al_structure, { cutoff, n_bins })

    // Results should be identical
    expect(result1.r).toEqual(result2.r)
    expect(result1.g_r).toEqual(result2.g_r)
  })
})

describe(`calculate_all_pair_rdfs`, () => {
  test(`should calculate all unique element pairs`, () => {
    const patterns = calculate_all_pair_rdfs(lu_al_structure, {
      cutoff: 8,
      n_bins: 50,
    })

    // Should have Al-Al, Al-Lu, and Lu-Lu pairs
    expect(patterns).toHaveLength(3)

    const element_pairs = patterns.map((p) => p.element_pair)
    expect(element_pairs).toContainEqual([`Al`, `Al`])
    expect(element_pairs).toContainEqual([`Al`, `Lu`])
    expect(element_pairs).toContainEqual([`Lu`, `Lu`])

    // Check basic properties for all pairs
    for (const pattern of patterns) {
      check_basic_rdf_properties(
        pattern.r,
        pattern.g_r,
        50,
        pattern.element_pair?.join(`-`),
      )
    }
  })

  test(`should handle single-element structure`, () => {
    const patterns = calculate_all_pair_rdfs(pd_structure, {
      cutoff: 10,
      n_bins: 50,
    })

    // Only Pd-Pd pair should be present
    expect(patterns).toHaveLength(1)
    expect(patterns[0].element_pair).toEqual([`Pd`, `Pd`])
  })

  test(`should respect cutoff and n_bins options`, () => {
    const cutoff = 12
    const n_bins = 80
    const patterns = calculate_all_pair_rdfs(lu_al_structure, { cutoff, n_bins })

    for (const pattern of patterns) {
      expect(pattern.r).toHaveLength(n_bins)
      expect(pattern.g_r).toHaveLength(n_bins)
      expect(Math.max(...pattern.r)).toBeCloseTo(cutoff, 2)
    }
  })

  test(`RDF should have reasonable values and not be all zeros`, () => {
    const result = calculate_rdf(lu_al_structure, {
      cutoff: 8,
      n_bins: 80,
    })

    check_basic_rdf_properties(result.r, result.g_r, 80, `lu_al_structure`)

    // Should have non-zero values (atoms exist at some distances)
    const total = result.g_r.reduce((sum, val) => sum + val, 0)
    expect(total).toBeGreaterThan(0)

    // Should have some peaks (crystalline structure)
    const max_g_r = Math.max(...result.g_r)
    expect(max_g_r).toBeGreaterThan(0)

    // g(r) should not have extremely large values (indicates normalization issue)
    // For a crystal, peaks should be reasonable (< 20)
    expect(max_g_r).toBeLessThan(20)

    // Values should be finite
    expect(result.g_r.every((val) => isFinite(val))).toBe(true)
  })

  test(`RDF should not have unreasonably high peaks at short distances`, () => {
    // This catches the bug where supercell + PBC creates artificial short distances
    const result = calculate_rdf(lu_al_structure, {
      cutoff: 10,
      n_bins: 100,
      auto_expand: true,
    })

    check_basic_rdf_properties(result.r, result.g_r, 100, `lu_al_short_dist_check`)

    // Check first few bins (short distances) don't have insane values
    // In a real crystal, g(r) should not exceed ~100 even for strong peaks
    for (let idx = 0; idx < 10; idx++) {
      expect(result.g_r[idx]).toBeLessThan(100)
    }

    // Overall max should also be reasonable
    const max_g_r = Math.max(...result.g_r)
    expect(max_g_r).toBeLessThan(50)
  })

  test(`RDF with auto_expand should not create artificial close contacts`, () => {
    // Test specifically for the supercell + PBC interaction bug
    const result = calculate_rdf(pd_structure, {
      cutoff: 15,
      n_bins: 150,
      auto_expand: true,
    })

    check_basic_rdf_properties(result.r, result.g_r, 150, `auto_expand_close_contacts`)

    // First several bins should be zero (no atoms closer than ~2-3 Å in typical crystals)
    // For Pd FCC structure, nearest neighbor is typically ~2.75 Å
    const min_expected_dist = 2.0
    const bins_should_be_zero = Math.floor(min_expected_dist / (15 / 150))

    for (let idx = 0; idx < bins_should_be_zero; idx++) {
      expect(result.g_r[idx]).toBe(0)
    }

    // No unreasonably high peaks anywhere
    const max_g_r = Math.max(...result.g_r)
    expect(max_g_r).toBeLessThan(50)
  })

  test(`realistic structure (from demo) should not have artificially high peaks`, () => {
    // Use actual NaCl structure from mp-1234 (used in demos)
    const result = calculate_rdf(bi2zr2o8_structure, {
      cutoff: 10,
      n_bins: 100,
    })

    check_basic_rdf_properties(result.r, result.g_r, 100, `bi2zr2o8_structure`)

    // Should not have insanely high peaks (user reported seeing values > 6000!)
    const max_g_r = Math.max(...result.g_r)
    expect(max_g_r).toBeLessThan(100)

    // First few bins should not have crazy values
    for (let idx = 0; idx < 5; idx++) {
      expect(result.g_r[idx]).toBeLessThan(100)
    }
  })

  test(`all element pair RDFs should be consistent`, () => {
    const patterns1 = calculate_all_pair_rdfs(bi2zr2o8_structure, {
      cutoff: 5,
      n_bins: 50,
    })
    const patterns2 = calculate_all_pair_rdfs(bi2zr2o8_structure, {
      cutoff: 5,
      n_bins: 50,
    })

    // Results should be identical
    expect(patterns1.length).toBe(patterns2.length)
    for (let idx = 0; idx < patterns1.length; idx++) {
      expect(patterns1[idx].r).toEqual(patterns2[idx].r)
      expect(patterns1[idx].g_r).toEqual(patterns2[idx].g_r)
      expect(patterns1[idx].element_pair).toEqual(patterns2[idx].element_pair)
    }
  })

  test(`RDF with extreme parameters should still satisfy basic properties`, () => {
    // Very small cutoff (disable auto_expand to avoid creating enormous supercells)
    const result_small = calculate_rdf(bi2zr2o8_structure, {
      cutoff: 0.1,
      n_bins: 10,
      auto_expand: false,
    })
    check_basic_rdf_properties(result_small.r, result_small.g_r, 10, `small_cutoff`)
    expect(result_small.g_r.every((val) => val === 0)).toBe(true)

    // Large number of bins
    const result_many_bins = calculate_rdf(pd_structure, {
      cutoff: 10,
      n_bins: 1000,
    })
    check_basic_rdf_properties(
      result_many_bins.r,
      result_many_bins.g_r,
      1000,
      `many_bins`,
    )
    expect(result_many_bins.g_r.some((val) => val > 0)).toBe(true)

    // Small number of bins
    const result_few_bins = calculate_rdf(pd_structure, {
      cutoff: 5,
      n_bins: 20,
    })
    check_basic_rdf_properties(result_few_bins.r, result_few_bins.g_r, 20, `few_bins`)
  })

  test(`auto_expand should create supercell for small structures`, () => {
    // Pd structure has lattice parameters of ~3.9 Å
    // With cutoff = 15 and auto_expand = true, should create supercell
    const result_with_expand = calculate_rdf(pd_structure, {
      cutoff: 15,
      n_bins: 100,
      auto_expand: true,
    })

    // Should have some non-zero values
    const total = result_with_expand.g_r.reduce((sum, val) => sum + val, 0)
    expect(total).toBeGreaterThan(0)

    // Test that auto_expand can be disabled
    const result_no_expand = calculate_rdf(pd_structure, {
      cutoff: 15,
      n_bins: 100,
      auto_expand: false,
    })

    // Should still work (PBC handles it)
    expect(result_no_expand.g_r.length).toBe(100)
  })
})
