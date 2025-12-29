import type { ElementSymbol, Species } from '$lib'
import type { Vec3, Vec9 } from '$lib/math'
import type { Crystal } from '$lib/structure'
import type { WyckoffPos } from '$lib/symmetry'
import {
  apply_symmetry_operations,
  map_wyckoff_to_all_atoms,
  simplicity_score,
  wyckoff_positions_from_moyo,
} from '$lib/symmetry'
import { structures } from '$site/structures'
import type { MoyoDataset } from '@spglib/moyo-wasm'
import { describe, expect, test } from 'vitest'
import { make_crystal } from '../setup'

describe(`wyckoff_positions_from_moyo`, () => {
  const mock_data = (
    positions: number[][],
    numbers: number[],
    wyckoffs: (string | null)[],
  ) => ({ std_cell: { positions, numbers }, wyckoffs } as unknown as MoyoDataset)

  test(`handles various input scenarios`, () => {
    // Null input
    expect(wyckoff_positions_from_moyo(null)).toEqual([])

    // Symmetric sites - all H atoms with same Wyckoff letter
    const symmetric = mock_data(
      [[0, 0, 0], [0.5, 0.5, 0.5], [0.5, 0, 0], [0, 0.5, 0]],
      [1, 1, 1, 1],
      [`1a`, `1a`, `1a`, `1a`],
    )
    expect(wyckoff_positions_from_moyo(symmetric)).toEqual([{
      wyckoff: `4a`,
      elem: `H`,
      abc: [0, 0, 0],
      site_indices: [0, 1, 2, 3],
    }])

    // Mixed elements
    const mixed = mock_data([[0, 0, 0], [0.5, 0.5, 0.5]], [1, 8], [`1a`, `1b`])
    expect(wyckoff_positions_from_moyo(mixed)).toEqual([
      { wyckoff: `1a`, elem: `H`, abc: [0, 0, 0], site_indices: [0] },
      { wyckoff: `1b`, elem: `O`, abc: [0.5, 0.5, 0.5], site_indices: [1] },
    ])

    // Sorting by multiplicity then alphabetically
    const sorted = mock_data(
      [[0, 0, 0], [0.5, 0.5, 0.5], [0.25, 0.25, 0.25], [0.75, 0.75, 0.75]],
      [1, 8, 1, 1],
      [`b`, `a`, `b`, `b`],
    )
    expect(wyckoff_positions_from_moyo(sorted)).toEqual([
      { wyckoff: `1a`, elem: `O`, abc: [0.5, 0.5, 0.5], site_indices: [1] },
      { wyckoff: `3b`, elem: `H`, abc: [0, 0, 0], site_indices: [0, 2, 3] },
    ])

    // Sites without Wyckoff letters
    const no_letters = mock_data([[0, 0, 0], [0.5, 0.5, 0.5]], [1, 8], [``, `1a`])
    expect(wyckoff_positions_from_moyo(no_letters)).toEqual([
      { wyckoff: `1`, elem: `H`, abc: [0, 0, 0], site_indices: [0] },
      { wyckoff: `1a`, elem: `O`, abc: [0.5, 0.5, 0.5], site_indices: [1] },
    ])

    // Null Wyckoff values
    const null_wyckoff = mock_data([[0, 0, 0]], [1], [null])
    expect(wyckoff_positions_from_moyo(null_wyckoff)).toEqual([{
      wyckoff: `1`,
      elem: `H`,
      abc: [0, 0, 0],
      site_indices: [0],
    }])
  })

  test(`handles advanced scenarios`, () => {
    // Complex mixed occupancy sites - letter extraction and counting
    const mixed = mock_data(
      [[0.1576, 0, 0.5754], [0.1576, 0, 0.5754], [0.0201, 0.3033, 0.256], [
        0.3069,
        0,
        0.3081,
      ], [0.7091, 0, 0.0177]],
      [8, 8, 8, 8, 8],
      [`4i`, `4i`, `8j`, `4i`, `4i`],
    )
    const result = wyckoff_positions_from_moyo(mixed)
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.wyckoff).sort()).toEqual([`1j`, `4i`])
    expect(result.map((r) => r.elem)).toEqual([`O`, `O`])
    result.forEach((r) => expect(mixed.std_cell.positions).toContainEqual(r.abc))

    // Simplest coordinates selection
    const simple = mock_data(
      [[0.999, 0.999, 0.999], [0, 0, 0], [0.5, 0.5, 0.5], [0.001, 0.001, 0.001]],
      [1, 1, 1, 1],
      [`a`, `a`, `a`, `a`],
    )
    expect(wyckoff_positions_from_moyo(simple)).toEqual([{
      wyckoff: `4a`,
      elem: `H`,
      abc: [0, 0, 0],
      site_indices: [0, 1, 2, 3],
    }])

    // Different elements at same Wyckoff position
    const multi_elem = mock_data(
      [[0, 0, 0], [0.5, 0.5, 0.5], [0.25, 0.25, 0.25], [0.75, 0.75, 0.75]],
      [1, 8, 26, 6],
      [`a`, `a`, `b`, `b`],
    )
    const multi_result = wyckoff_positions_from_moyo(multi_elem)
    expect(multi_result).toHaveLength(4)
    expect(multi_result.map((r) => `${r.wyckoff}-${r.elem}`).sort()).toEqual([
      `1a-H`,
      `1a-O`,
      `1b-C`,
      `1b-Fe`,
    ])
    expect(multi_result.find((r) => r.elem === `H`)?.abc).toEqual([0, 0, 0])
    expect(multi_result.find((r) => r.elem === `O`)?.abc).toEqual([0.5, 0.5, 0.5])
  })
})

describe(`simplicity_score`, () => {
  test(`calculates scores correctly`, () => {
    // Integer coordinates
    expect(simplicity_score([0, 0, 0])).toBe(0.75)
    expect(simplicity_score([1, 1, 1])).toBe(0.75)

    // Half coordinates: near_zero=0.5 each, near_half=0 each
    expect(simplicity_score([0.5, 0.5, 0.5])).toBe(1.5)

    // Mixed coordinates: [0, 0.5, 0] -> near_zero=[0,0.5,0], near_half=[0.5,0,0.5] -> 0.5 + 0.5*1.0 = 1.0
    expect(simplicity_score([0, 0.5, 0])).toBe(1.0)
    expect(simplicity_score([0.25, 0, 0])).toBe(0.875) // 0.25 + 0.5*(0.25+0.5+0.5) = 0.875
  })

  test(`handles comparisons and edge cases`, () => {
    // Preference order: closer to 0/1 better than 0.5
    expect(simplicity_score([0.1, 0.1, 0.1])).toBeLessThan(
      simplicity_score([0.5, 0.5, 0.5]),
    )
    expect(simplicity_score([0.9, 0.9, 0.9])).toBeLessThan(
      simplicity_score([0.5, 0.5, 0.5]),
    )
    expect(simplicity_score([0.01, 0.01, 0.01])).toBeLessThan(
      simplicity_score([0.49, 0.49, 0.49]),
    )

    // Coordinate wrapping
    expect(simplicity_score([1.1, 1.2, 1.3])).toBe(simplicity_score([0.1, 0.2, 0.3]))
    expect(simplicity_score([-0.1, -0.2, -0.3])).toBe(simplicity_score([0.9, 0.8, 0.7]))

    // Edge cases
    expect(simplicity_score([])).toBeNaN()
    expect(simplicity_score([0])).toBeNaN()

    // Symmetry around 0.5
    expect(simplicity_score([0.25, 0.25, 0.25])).toBe(
      simplicity_score([0.75, 0.75, 0.75]),
    )
    expect(simplicity_score([0.25, 0.25, 0.25])).toBeLessThan(
      simplicity_score([0.5, 0.5, 0.5]),
    )
  })
})

describe(`structure validation`, () => {
  test(`all structures have valid data`, () => {
    const validateSite = (
      site: { species?: Partial<Species>[]; abc?: Vec3; xyz?: Vec3; label?: unknown },
      site_idx: number,
    ) => {
      const issues: string[] = []

      if (!site.species?.length) issues.push(`Site ${site_idx} missing species`)
      if (
        !site.abc || site.abc.length !== 3 ||
        site.abc.some((c) => typeof c !== `number` || !isFinite(c))
      ) {
        issues.push(`Site ${site_idx} invalid fractional coordinates`)
      }
      if (
        !site.xyz || site.xyz.length !== 3 ||
        site.xyz.some((c) => typeof c !== `number` || !isFinite(c))
      ) {
        issues.push(`Site ${site_idx} invalid Cartesian coordinates`)
      }
      if (!site.label || typeof site.label !== `string`) {
        issues.push(`Site ${site_idx} invalid label`)
      }

      let totalOccupancy = 0
      for (const [idx, species] of (site.species || []).entries()) {
        if (
          !species.element || typeof species.element !== `string` ||
          !/^[A-Z][a-z]?$/.test(species.element)
        ) {
          issues.push(
            `Site ${site_idx} species ${idx} invalid element: ${species.element}`,
          )
        }
        if (
          typeof species.occu !== `number` || !isFinite(species.occu) ||
          species.occu < 0 || species.occu > 1
        ) {
          issues.push(
            `Site ${site_idx} species ${idx} invalid occupancy: ${species.occu}`,
          )
        }
        if (
          species.oxidation_state !== undefined &&
          (typeof species.oxidation_state !== `number` ||
            !isFinite(species.oxidation_state))
        ) {
          issues.push(
            `Site ${site_idx} species ${idx} invalid oxidation state: ${species.oxidation_state}`,
          )
        }
        totalOccupancy += (species.occu as number) ?? 0
      }
      if (totalOccupancy > 1.001) {
        issues.push(`Site ${site_idx} total occupancy exceeds 1.0: ${totalOccupancy}`)
      }

      return issues
    }

    const failed = structures.map((structure) => {
      const issues: string[] = []

      if (!structure.sites?.length) issues.push(`No sites`)

      if (`lattice` in structure && structure.lattice) {
        const { lattice } = structure
        if (
          !lattice.matrix || lattice.matrix.length !== 3 ||
          lattice.matrix.some((row) => !Array.isArray(row) || row.length !== 3)
        ) {
          issues.push(`Invalid lattice matrix`)
        }
        if (
          [`a`, `b`, `c`, `alpha`, `beta`, `gamma`, `volume`].some((p) =>
            typeof lattice[p as keyof typeof lattice] !== `number`
          )
        ) {
          issues.push(`Missing lattice parameters`)
        }
      }

      structure.sites?.forEach((site, idx) => issues.push(...validateSite(site, idx)))

      return { id: structure.id || `unknown`, issues }
    }).filter((site) => site.issues.length > 0)

    expect(
      failed.length,
      `Structures with issues:\n${
        failed.map((site) => `${site.id}: ${site.issues.join(`, `)}`).join(`\n`)
      }`,
    ).toBe(0)
  })

  test(`composition consistency`, () => {
    structures.slice(0, 5).forEach((structure) => {
      const elements = new Set(
        structure.sites.flatMap((site) => site.species.map((sp) => sp.element)),
      )
      const totalOccupancy = structure.sites.reduce(
        (sum, site) =>
          sum + site.species.reduce((spec_sum, specie) => spec_sum + specie.occu, 0),
        0,
      )

      expect(elements.size).toBeGreaterThan(0)
      expect(totalOccupancy).toBeGreaterThan(0)

      if (`lattice` in structure && structure.lattice) {
        const { a, b, c, volume } = structure.lattice
        expect([a, b, c, volume]).toEqual(expect.arrayContaining([expect.any(Number)]))
      }
    })
  })
})

describe(`integration tests`, () => {
  test(`wyckoff positions for mock structures`, () => {
    const mock: MoyoDataset = {
      std_cell: {
        positions: [[0, 0, 0], [0.5, 0.5, 0.5], [0.25, 0.25, 0.25]],
        numbers: [1, 8, 26],
      },
      wyckoffs: [`a`, `b`, `c`],
      operations: [],
      number: 1,
      hm_symbol: `P1`,
      hall_number: 1,
      pearson_symbol: `aP3`,
      orbits: [],
      site_symmetry_symbols: [],
      std_linear: [],
      std_origin_shift: [0, 0, 0],
      transformation_matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      origin_shift: [0, 0, 0],
      volume: 1,
    } as unknown as MoyoDataset

    const positions = wyckoff_positions_from_moyo(mock)
    expect(positions).toHaveLength(3)
    expect(new Set(positions.map((p) => p.elem))).toEqual(new Set([`H`, `O`, `Fe`]))
    positions.forEach((p) => expect([`1a`, `1b`, `1c`]).toContain(p.wyckoff))
  })
})

describe(`stable atom ordering`, () => {
  test(`wyckoff positions maintain stable ordering across multiple calls`, () => {
    const mock_data = {
      std_cell: {
        positions: [[0, 0, 0], [0.5, 0.5, 0.5], [0.25, 0.25, 0.25], [0.75, 0.75, 0.75]],
        numbers: [1, 8, 1, 1],
      },
      wyckoffs: [`2a`, `1b`, `2a`, `2a`],
      orig_indices: [0, 1, 2, 3],
    } as unknown as MoyoDataset & { orig_indices?: number[] }

    // Call the function multiple times to verify stable ordering
    const results = Array.from(
      { length: 5 },
      () => wyckoff_positions_from_moyo(mock_data),
    )

    // All results should be identical
    for (let idx = 1; idx < results.length; idx++) {
      expect(results[idx]).toEqual(results[0])
    }

    // Verify the expected structure
    expect(results[0]).toHaveLength(2)
    expect(results[0][0].wyckoff).toBe(`1b`)
    expect(results[0][0].elem).toBe(`O`)
    expect(results[0][1].wyckoff).toBe(`3a`)
    expect(results[0][1].elem).toBe(`H`)
  })
})

describe(`site coverage verification`, () => {
  test(`all sites are covered by wyckoff positions`, () => {
    const test_cases = [
      {
        positions: [[0, 0, 0], [0.5, 0.5, 0.5], [0.25, 0.25, 0.25]],
        numbers: [1, 8, 26],
        wyckoffs: [`a`, `b`, `c`],
        expected_coverage: [0, 1, 2],
      },
      {
        positions: [[0, 0, 0], [0.5, 0.5, 0.5], [0.5, 0, 0], [0, 0.5, 0]],
        numbers: [1, 1, 1, 1],
        wyckoffs: [`4a`, `4a`, `4a`, `4a`],
        expected_coverage: [0, 1, 2, 3],
      },
      {
        positions: [[0, 0, 0], [0.5, 0.5, 0.5], [0.25, 0.25, 0.25], [0.75, 0.75, 0.75]],
        numbers: [1, 8, 1, 1],
        wyckoffs: [`2a`, `1b`, `2a`, `2a`],
        expected_coverage: [0, 1, 2, 3],
      },
      {
        positions: [[0, 0, 0], [0.5, 0.5, 0.5], [0.25, 0.25, 0.25]],
        numbers: [1, 8, 26],
        wyckoffs: [null, `b`, null],
        expected_coverage: [0, 1, 2],
      },
    ]

    for (const test_case of test_cases) {
      const mock_data = {
        std_cell: { positions: test_case.positions, numbers: test_case.numbers },
        wyckoffs: test_case.wyckoffs,
        orig_indices: test_case.expected_coverage,
      } as unknown as MoyoDataset & { orig_indices?: number[] }

      const wyckoff_positions = wyckoff_positions_from_moyo(mock_data)
      const covered_indices = new Set<number>()

      for (const pos of wyckoff_positions) {
        for (const idx of pos.site_indices ?? []) covered_indices.add(idx)
      }

      const missing_indices = test_case.expected_coverage.filter((idx) =>
        !covered_indices.has(idx)
      )
      const extra_indices = Array.from(covered_indices).filter((idx) =>
        !test_case.expected_coverage.includes(idx)
      )

      expect(missing_indices).toEqual([])
      expect(extra_indices).toEqual([])
    }
  })

  test(`wyckoff positions account for all multiplicity`, () => {
    const test_cases = [
      {
        positions: [[0, 0, 0], [0.5, 0.5, 0.5], [0.5, 0, 0], [0, 0.5, 0]],
        numbers: [1, 1, 1, 1],
        wyckoffs: [`4a`, `4a`, `4a`, `4a`],
        expected_total_multiplicity: 4,
      },
      {
        positions: [[0, 0, 0], [0.5, 0.5, 0.5], [0.25, 0.25, 0.25]],
        numbers: [1, 8, 26],
        wyckoffs: [`a`, `b`, `c`],
        expected_total_multiplicity: 3,
      },
      {
        positions: [[0, 0, 0], [0.5, 0.5, 0.5], [0.25, 0.25, 0.25], [0.75, 0.75, 0.75]],
        numbers: [1, 8, 1, 1],
        wyckoffs: [`2a`, `1b`, `2a`, `2a`],
        expected_total_multiplicity: 4,
      },
    ]

    for (const test_case of test_cases) {
      const mock_data = {
        std_cell: { positions: test_case.positions, numbers: test_case.numbers },
        wyckoffs: test_case.wyckoffs,
      } as unknown as MoyoDataset

      const wyckoff_positions = wyckoff_positions_from_moyo(mock_data)
      const total_multiplicity = wyckoff_positions.reduce((sum, pos) => {
        const multiplicity = parseInt(pos.wyckoff) || 1
        return sum + multiplicity
      }, 0)

      expect(total_multiplicity).toBe(test_case.expected_total_multiplicity)
    }
  })

  test(`handles edge cases in Wyckoff position parsing`, () => {
    const edge_cases = [
      // Empty wyckoff letter
      {
        mock_data: { std_cell: { positions: [[0, 0, 0]], numbers: [1] }, wyckoffs: [``] },
        expected: [{ wyckoff: `1`, elem: `H`, abc: [0, 0, 0], site_indices: [0] }],
      },
      // Null wyckoff letter
      {
        mock_data: {
          std_cell: { positions: [[0, 0, 0]], numbers: [1] },
          wyckoffs: [null],
        },
        expected: [{ wyckoff: `1`, elem: `H`, abc: [0, 0, 0], site_indices: [0] }],
      },
      // Mixed valid and invalid wyckoff letters
      {
        mock_data: {
          std_cell: { positions: [[0, 0, 0], [0.5, 0.5, 0.5]], numbers: [1, 8] },
          wyckoffs: [`a`, null],
        },
        expected: [
          { wyckoff: `1`, elem: `O`, abc: [0.5, 0.5, 0.5], site_indices: [1] },
          { wyckoff: `1a`, elem: `H`, abc: [0, 0, 0], site_indices: [0] },
        ],
      },
      // Very large multiplicity
      {
        mock_data: {
          std_cell: {
            positions: Array.from(
              { length: 48 },
              (_, idx) => [idx * 0.02, idx * 0.02, idx * 0.02],
            ),
            numbers: Array(48).fill(1),
          },
          wyckoffs: Array(48).fill(`48a`),
        },
        expected: [{
          wyckoff: `48a`,
          elem: `H`,
          abc: [0, 0, 0],
          site_indices: Array.from({ length: 48 }, (_, idx) => idx),
        }],
      },
    ]

    edge_cases.forEach(({ mock_data, expected }) => {
      const result = wyckoff_positions_from_moyo(mock_data as unknown as MoyoDataset)
      expect(result).toEqual(expected)
    })
  })

  test(`performance with very large structures`, () => {
    const large_structure = {
      std_cell: {
        positions: Array.from({ length: 1000 }, () => [
          Math.random(),
          Math.random(),
          Math.random(),
        ]),
        numbers: Array.from({ length: 1000 }, () => Math.floor(Math.random() * 10) + 1),
      },
      wyckoffs: Array.from({ length: 1000 }, (_, idx) => `${(idx % 10) + 1}a`),
    } as unknown as MoyoDataset

    const start_time = performance.now()
    const result = wyckoff_positions_from_moyo(large_structure)
    const end_time = performance.now()

    // Should complete in reasonable time (< 50ms for 1000 sites)
    expect(end_time - start_time).toBeLessThan(50)

    // Should produce reasonable number of grouped positions
    expect(result.length).toBeGreaterThan(0)
    expect(result.length).toBeLessThanOrEqual(10) // At most 10 different multiplicities
  })
})

describe(`apply_symmetry_operations`, () => {
  const operations = {
    identity: {
      rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] as Vec9,
      translation: [0, 0, 0] as Vec3,
    },
    inversion: {
      rotation: [-1, 0, 0, 0, -1, 0, 0, 0, -1] as Vec9,
      translation: [0, 0, 0] as Vec3,
    },
    translation: {
      rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] as Vec9,
      translation: [0.5, 0.5, 0.5] as Vec3,
    },
    rotation_90z: {
      rotation: [0, 1, 0, -1, 0, 0, 0, 0, 1] as Vec9,
      translation: [0, 0, 0] as Vec3,
    },
  }

  test.each([
    [
      `identity operation`,
      [0.25, 0.25, 0.25] as Vec3,
      [operations.identity],
      [[0.25, 0.25, 0.25]],
      1,
    ],
    [
      `inversion operation`,
      [0.25, 0.25, 0.25] as Vec3,
      [operations.identity, operations.inversion],
      [[0.25, 0.25, 0.25], [0.75, 0.75, 0.75]],
      2,
    ],
    [
      `translation operation`,
      [0.25, 0.25, 0.25] as Vec3,
      [operations.identity, operations.translation],
      [[0.25, 0.25, 0.25], [0.75, 0.75, 0.75]],
      2,
    ],
    [
      `negative coordinates wrapping`,
      [0.25, 0.25, 0.25] as Vec3,
      [operations.inversion],
      [[0.75, 0.75, 0.75]],
      1,
    ],
    [
      `deduplication of equivalent positions`,
      [0, 0, 0] as Vec3,
      [operations.identity, operations.identity],
      [[0, 0, 0]],
      1,
    ],
    [
      `complex rotation matrix`,
      [1, 0, 0] as Vec3,
      [operations.rotation_90z],
      [[0, 0, 0]], // [1,0,0] * rotation = [0,-1,0] -> [0,0,0] after wrapping
      1,
    ],
    [
      `multiple operations with deduplication`,
      [0.5, 0.5, 0.5] as Vec3,
      [operations.identity, operations.inversion, operations.translation],
      [[0.5, 0.5, 0.5], [0, 0, 0]],
      2,
    ],
  ])(`handles %s`, (_, position, ops, expected_positions, expected_length) => {
    const result = apply_symmetry_operations(position, ops)
    expect(result).toHaveLength(expected_length)
    expect(result).toEqual(expect.arrayContaining(expected_positions))
  })

  test(`wraps coordinates to unit cell with floating point precision`, () => {
    const position: Vec3 = [0.8, 0.8, 0.8]
    const result = apply_symmetry_operations(position, [operations.translation])

    expect(result).toHaveLength(1)
    // 0.8 + 0.5 = 1.3, wrapped to 0.3 (with floating point precision)
    expect(result[0][0]).toBeCloseTo(0.3, 10)
    expect(result[0][1]).toBeCloseTo(0.3, 10)
    expect(result[0][2]).toBeCloseTo(0.3, 10)
  })

  test.each([
    [[0, 0, 0] as Vec3, [0, 0, 0]],
    [[1, 1, 1] as Vec3, [0, 0, 0]], // Wraps to origin
    [[0.999999, 0.999999, 0.999999] as Vec3, [0.999999, 0.999999, 0.999999]],
  ])(`handles edge case coordinates %j -> %j`, (position, expected) => {
    const result = apply_symmetry_operations(position, [operations.identity])
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(expected)
  })

  test(`performance with many operations`, () => {
    const position: Vec3 = [0.1, 0.2, 0.3]
    const many_operations = Array.from({ length: 48 }, (_, idx) => ({
      rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] satisfies Vec9,
      translation: [idx * 0.02, idx * 0.02, idx * 0.02] as Vec3,
    }))

    const start_time = performance.now()
    const result = apply_symmetry_operations(position, many_operations)
    const end_time = performance.now()

    expect(end_time - start_time).toBeLessThan(10)
    expect(result.length).toBeGreaterThan(0)
    expect(result.length).toBeLessThanOrEqual(48)
  })
})

describe(`map_wyckoff_to_all_atoms`, () => {
  // Helper factory using make_crystal
  const mock_structure = (sites: { abc: Vec3; element: string }[]): Crystal =>
    make_crystal(
      1,
      sites.map((site) => ({ element: site.element as ElementSymbol, abc: site.abc })),
    )

  const mock_sym_data = (): MoyoDataset => ({
    operations: [
      { rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 0] }, // Identity
      { rotation: [-1, 0, 0, 0, -1, 0, 0, 0, -1], translation: [0, 0, 0] }, // Inversion
    ],
    std_cell: {
      lattice: {
        basis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      },
      positions: [],
      numbers: [],
    },
    wyckoffs: [],
    number: 1,
    hm_symbol: `P-1`,
    hall_number: 2,
    pearson_symbol: `aP1`,
    orbits: [],
    site_symmetry_symbols: [],
    std_origin_shift: [0, 0, 0],
  } as unknown as MoyoDataset)

  test.each([
    [
      `null symmetry data`,
      [{ wyckoff: `1a`, elem: `H`, abc: [0, 0, 0] as Vec3, site_indices: [0] }],
      mock_structure([{ abc: [0, 0, 0], element: `H` }]),
      mock_structure([{ abc: [0, 0, 0], element: `H` }]),
      null,
      undefined,
      (result: WyckoffPos[], input: [WyckoffPos[], ...unknown[]]) =>
        expect(result).toEqual(input[0]),
    ],
    [
      `empty displayed sites`,
      [{ wyckoff: `1a`, elem: `H`, abc: [0, 0, 0] as Vec3, site_indices: [0] }],
      mock_structure([{ abc: [0, 0, 0], element: `H` }]),
      { ...mock_structure([{ abc: [0, 0, 0], element: `H` }]), sites: [] },
      mock_sym_data(),
      undefined,
      (result: WyckoffPos[]) => expect(result[0].site_indices).toEqual([]),
    ],
    [
      `empty wyckoff positions`,
      [],
      mock_structure([{ abc: [0, 0, 0], element: `H` }]),
      mock_structure([{ abc: [0, 0, 0], element: `H` }]),
      mock_sym_data(),
      undefined,
      (result: WyckoffPos[]) => expect(result).toEqual([]),
    ],
  ])(
    `handles %s gracefully`,
    (_, wyckoff_pos, original, displayed, sym_data, tolerance, assertion) => {
      const result = map_wyckoff_to_all_atoms(
        wyckoff_pos,
        displayed,
        original,
        sym_data,
        tolerance,
      )
      assertion(result, [wyckoff_pos, original, displayed, sym_data])
    },
  )

  test(`maps single atom with symmetry operations`, () => {
    const original = mock_structure([{ abc: [0.25, 0.25, 0.25], element: `H` }])
    const displayed = mock_structure([
      { abc: [0.25, 0.25, 0.25], element: `H` }, // Original
      { abc: [0.75, 0.75, 0.75], element: `H` }, // Inversion equivalent
    ])
    const wyckoff_pos = [{
      wyckoff: `2a`,
      elem: `H`,
      abc: [0.25, 0.25, 0.25] as Vec3,
      site_indices: [0],
    }]

    const result = map_wyckoff_to_all_atoms(
      wyckoff_pos,
      displayed,
      original,
      mock_sym_data(),
    )

    expect(result).toHaveLength(1)
    expect(result[0].site_indices).toEqual(expect.arrayContaining([0, 1]))
    expect(result[0].site_indices).toHaveLength(2)
  })

  test(`handles different elements correctly`, () => {
    const original = mock_structure([{ abc: [0, 0, 0], element: `H` }, {
      abc: [0.5, 0.5, 0.5],
      element: `O`,
    }])
    const displayed = mock_structure([
      { abc: [0, 0, 0], element: `H` },
      { abc: [0, 0, 0], element: `O` },
      { abc: [0.5, 0.5, 0.5], element: `O` },
      { abc: [0.5, 0.5, 0.5], element: `H` },
    ])
    const wyckoff_pos = [
      { wyckoff: `1a`, elem: `H`, abc: [0, 0, 0] as Vec3, site_indices: [0] },
      { wyckoff: `1b`, elem: `O`, abc: [0.5, 0.5, 0.5] as Vec3, site_indices: [1] },
    ]

    const result = map_wyckoff_to_all_atoms(
      wyckoff_pos,
      displayed,
      original,
      mock_sym_data(),
    )

    expect(result.find((r) => r.elem === `H`)?.site_indices).toEqual([0])
    expect(result.find((r) => r.elem === `O`)?.site_indices).toEqual([2])
  })

  test(`handles periodic boundary conditions`, () => {
    const original = mock_structure([{ abc: [0.1, 0.1, 0.1], element: `H` }])
    const displayed = mock_structure([
      { abc: [0.1, 0.1, 0.1], element: `H` }, // Original
      { abc: [0.9, 0.9, 0.9], element: `H` }, // Inversion: -0.1 -> 0.9
      { abc: [1.1, 1.1, 1.1], element: `H` }, // Wrapped: 1.1 -> 0.1
    ])
    const wyckoff_pos = [{
      wyckoff: `2a`,
      elem: `H`,
      abc: [0.1, 0.1, 0.1] as Vec3,
      site_indices: [0],
    }]

    const result = map_wyckoff_to_all_atoms(
      wyckoff_pos,
      displayed,
      original,
      mock_sym_data(),
    )

    expect(result[0].site_indices).toHaveLength(3)
    expect(result[0].site_indices).toEqual(expect.arrayContaining([0, 1, 2]))
  })

  test(`wraps distances for coordinates far outside [0,1)`, () => {
    const original = mock_structure([{ abc: [0.1, 0.2, 0.3], element: `H` }])
    const displayed = mock_structure([
      { abc: [0.1, 0.2, 0.3], element: `H` }, // Exact
      { abc: [2.1, 2.2, 3.3], element: `H` }, // Offset by whole cells (should match exactly)
      { abc: [-0.9, -0.8, -0.7], element: `H` }, // Negative offset by whole cells (should match)
    ])
    const wyckoff_pos = [{
      wyckoff: `1a`,
      elem: `H`,
      abc: [0.1, 0.2, 0.3] as Vec3,
      site_indices: [0],
    }]

    const result = map_wyckoff_to_all_atoms(
      wyckoff_pos,
      displayed,
      original,
      mock_sym_data(),
    )

    expect(result[0].site_indices).toEqual(expect.arrayContaining([0, 1, 2]))
    expect(result[0].site_indices).toHaveLength(3)
  })

  test(`uses relaxed default tolerance for near-coincident sites`, () => {
    const original = mock_structure([{ abc: [0, 0, 0], element: `H` }])
    const displayed = mock_structure([
      { abc: [0, 0, 0], element: `H` },
      { abc: [0.000005, 0, 0], element: `H` }, // Within 1e-5 but > 1e-6
    ])
    const wyckoff_pos = [{
      wyckoff: `1a`,
      elem: `H`,
      abc: [0, 0, 0] as Vec3,
      site_indices: [0],
    }]

    // Call without explicit tolerance to use the function's default
    const result = map_wyckoff_to_all_atoms(
      wyckoff_pos,
      displayed,
      original,
      mock_sym_data(),
    )

    expect(result[0].site_indices).toEqual([0, 1])
  })

  test(`respects tolerance parameter`, () => {
    const original = mock_structure([{ abc: [0, 0, 0], element: `H` }])
    const displayed = mock_structure([
      { abc: [0, 0, 0], element: `H` }, // Exact
      { abc: [0.001, 0.001, 0.001], element: `H` }, // Outside strict tolerance
      { abc: [0.0001, 0.0001, 0.0001], element: `H` }, // Close
    ])
    const wyckoff_pos = [{
      wyckoff: `1a`,
      elem: `H`,
      abc: [0, 0, 0] as Vec3,
      site_indices: [0],
    }]

    const strict_result = map_wyckoff_to_all_atoms(
      wyckoff_pos,
      displayed,
      original,
      mock_sym_data(),
      1e-8,
    )
    const loose_result = map_wyckoff_to_all_atoms(
      wyckoff_pos,
      displayed,
      original,
      mock_sym_data(),
      1e-2,
    )

    expect(strict_result[0].site_indices).toEqual([0])
    expect(loose_result[0].site_indices).toEqual([0, 1, 2])
  })

  test.each([
    [`invalid original indices`, [5, 10], []],
    [`missing site_indices`, undefined, []],
  ])(`handles %s`, (_, site_indices, expected) => {
    const original = mock_structure([{ abc: [0, 0, 0], element: `H` }])
    const displayed = mock_structure([{ abc: [0, 0, 0], element: `H` }])
    const wyckoff_pos = [{
      wyckoff: `1a`,
      elem: `H`,
      abc: [0, 0, 0] as Vec3,
      ...(site_indices && { site_indices }),
    }]

    const result = map_wyckoff_to_all_atoms(
      wyckoff_pos,
      displayed,
      original,
      mock_sym_data(),
    )

    expect(result[0].site_indices).toEqual(expected)
  })

  test(`performance with large structures`, () => {
    const original = mock_structure(
      Array.from(
        { length: 100 },
        (_, idx) => ({ abc: [idx * 0.01, idx * 0.01, idx * 0.01] as Vec3, element: `H` }),
      ),
    )
    const displayed = mock_structure(
      Array.from(
        { length: 200 },
        (_, idx) => ({
          abc: [idx * 0.005, idx * 0.005, idx * 0.005] as Vec3,
          element: `H`,
        }),
      ),
    )
    const wyckoff_pos = Array.from(
      { length: 10 },
      (_, idx) => ({
        wyckoff: `1a`,
        elem: `H`,
        abc: [idx * 0.1, idx * 0.1, idx * 0.1] as Vec3,
        site_indices: [idx],
      }),
    )

    const start_time = performance.now()
    const result = map_wyckoff_to_all_atoms(
      wyckoff_pos,
      displayed,
      original,
      mock_sym_data(),
    )
    const end_time = performance.now()

    expect(end_time - start_time).toBeLessThan(100)
    expect(result).toHaveLength(wyckoff_pos.length)
  })
})
