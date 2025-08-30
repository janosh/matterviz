import type { Vec3 } from '$lib/math'
import { simplicity_score, wyckoff_positions_from_moyo } from '$lib/symmetry'
import { structures } from '$site/structures'
import type { MoyoDataset } from '@spglib/moyo-wasm'
import { describe, expect, test } from 'vitest'

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
    const symmetric = mock_data([[0, 0, 0], [0.5, 0.5, 0.5], [0.5, 0, 0], [0, 0.5, 0]], [
      1,
      1,
      1,
      1,
    ], [`1a`, `1a`, `1a`, `1a`])
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
      site: {
        species?: Array<{ element?: unknown; occu?: unknown; oxidation_state?: unknown }>
        abc?: Vec3
        xyz?: Vec3
        label?: unknown
      },
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
    }).filter((s) => s.issues.length > 0)

    expect(
      failed.length,
      `Structures with issues:\n${
        failed.map((s) => `${s.id}: ${s.issues.join(`, `)}`).join(`\n`)
      }`,
    ).toBe(0)
  })

  test(`composition consistency`, () => {
    structures.slice(0, 5).forEach((structure) => {
      const elements = new Set(
        structure.sites.flatMap((s) => s.species.map((sp) => sp.element)),
      )
      const totalOccupancy = structure.sites.reduce(
        (sum, s) => sum + s.species.reduce((sSum, sp) => sSum + sp.occu, 0),
        0,
      )

      expect(elements.size).toBeGreaterThan(0)
      expect(totalOccupancy).toBeGreaterThan(0)

      if (`lattice` in structure && structure.lattice) {
        expect([
          structure.lattice.a,
          structure.lattice.b,
          structure.lattice.c,
          structure.lattice.volume,
        ])
          .toEqual(expect.arrayContaining([expect.any(Number)]))
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
      std_volume: 1,
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
      original_indices: [0, 1, 2, 3],
    } as unknown as MoyoDataset & { original_indices?: number[] }

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
        original_indices: test_case.expected_coverage,
      } as unknown as MoyoDataset & { original_indices?: number[] }

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
              (_, i) => [i * 0.02, i * 0.02, i * 0.02],
            ),
            numbers: Array(48).fill(1),
          },
          wyckoffs: Array(48).fill(`48a`),
        },
        expected: [{
          wyckoff: `48a`,
          elem: `H`,
          abc: [0, 0, 0],
          site_indices: Array.from({ length: 48 }, (_, i) => i),
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
      wyckoffs: Array.from({ length: 1000 }, (_, i) => `${(i % 10) + 1}a`),
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
