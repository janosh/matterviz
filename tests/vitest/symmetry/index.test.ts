import type { ElementSymbol, Species } from '$lib'
import type { Matrix3x3, Vec3, Vec9 } from '$lib/math'
import type { Crystal } from '$lib/structure'
import type { WyckoffPos } from '$lib/symmetry'
import {
  apply_symmetry_operations,
  map_std_to_orig_site_indices,
  map_wyckoff_to_all_atoms,
  simplicity_score,
  to_cell_json,
  wyckoff_multiplicity,
  wyckoff_positions_from_moyo,
} from '$lib/symmetry'
import type { MoyoDataset } from '@spglib/moyo-wasm'
import { describe, expect, test } from 'vitest'
import { make_crystal, make_wyckoff_dataset } from '../setup'
import { structures } from '$site/structures'

describe(`wyckoff_positions_from_moyo`, () => {
  test(`handles various input scenarios`, () => {
    // Null input
    expect(wyckoff_positions_from_moyo(null)).toEqual([])

    // Symmetric sites - all H atoms with same Wyckoff letter
    const symmetric = make_wyckoff_dataset(
      [
        [0, 0, 0],
        [0.5, 0.5, 0.5],
        [0.5, 0, 0],
        [0, 0.5, 0],
      ],
      [1, 1, 1, 1],
      [`1a`, `1a`, `1a`, `1a`],
    )
    expect(wyckoff_positions_from_moyo(symmetric)).toEqual([
      {
        wyckoff: `4a`,
        elem: `H`,
        abc: [0, 0, 0],
        site_indices: [0, 1, 2, 3],
      },
    ])

    // Mixed elements
    const mixed = make_wyckoff_dataset(
      [
        [0, 0, 0],
        [0.5, 0.5, 0.5],
      ],
      [1, 8],
      [`1a`, `1b`],
    )
    expect(wyckoff_positions_from_moyo(mixed)).toEqual([
      { wyckoff: `1a`, elem: `H`, abc: [0, 0, 0], site_indices: [0] },
      { wyckoff: `1b`, elem: `O`, abc: [0.5, 0.5, 0.5], site_indices: [1] },
    ])

    // Sorting by multiplicity then alphabetically
    const sorted = make_wyckoff_dataset(
      [
        [0, 0, 0],
        [0.5, 0.5, 0.5],
        [0.25, 0.25, 0.25],
        [0.75, 0.75, 0.75],
      ],
      [1, 8, 1, 1],
      [`b`, `a`, `b`, `b`],
    )
    expect(wyckoff_positions_from_moyo(sorted)).toEqual([
      { wyckoff: `1a`, elem: `O`, abc: [0.5, 0.5, 0.5], site_indices: [1] },
      { wyckoff: `3b`, elem: `H`, abc: [0, 0, 0], site_indices: [0, 2, 3] },
    ])

    // Sites without Wyckoff letters
    const no_letters = make_wyckoff_dataset(
      [
        [0, 0, 0],
        [0.5, 0.5, 0.5],
      ],
      [1, 8],
      [``, `1a`],
    )
    expect(wyckoff_positions_from_moyo(no_letters)).toEqual([
      { wyckoff: `1`, elem: `H`, abc: [0, 0, 0], site_indices: [0] },
      { wyckoff: `1a`, elem: `O`, abc: [0.5, 0.5, 0.5], site_indices: [1] },
    ])

    // Null Wyckoff values
    const null_wyckoff = make_wyckoff_dataset([[0, 0, 0]], [1], [null])
    expect(wyckoff_positions_from_moyo(null_wyckoff)).toEqual([
      {
        wyckoff: `1`,
        elem: `H`,
        abc: [0, 0, 0],
        site_indices: [0],
      },
    ])
  })

  test(`handles advanced scenarios`, () => {
    // Complex mixed occupancy sites - letter extraction and counting
    const mixed = make_wyckoff_dataset(
      [
        [0.1576, 0, 0.5754],
        [0.1576, 0, 0.5754],
        [0.0201, 0.3033, 0.256],
        [0.3069, 0, 0.3081],
        [0.7091, 0, 0.0177],
      ],
      [8, 8, 8, 8, 8],
      [`4i`, `4i`, `8j`, `4i`, `4i`],
    )
    const result = wyckoff_positions_from_moyo(mixed)
    expect(result).toHaveLength(2)
    expect(result.map((pos) => pos.wyckoff).sort()).toEqual([`1j`, `4i`])
    expect(result.map((pos) => pos.elem)).toEqual([`O`, `O`])
    result.forEach((pos) => expect(mixed.std_cell.positions).toContainEqual(pos.abc))

    // Simplest coordinates selection
    const simple = make_wyckoff_dataset(
      [
        [0.999, 0.999, 0.999],
        [0, 0, 0],
        [0.5, 0.5, 0.5],
        [0.001, 0.001, 0.001],
      ],
      [1, 1, 1, 1],
      [`a`, `a`, `a`, `a`],
    )
    expect(wyckoff_positions_from_moyo(simple)).toEqual([
      {
        wyckoff: `4a`,
        elem: `H`,
        abc: [0, 0, 0],
        site_indices: [0, 1, 2, 3],
      },
    ])

    // Different elements at same Wyckoff position
    const multi_elem = make_wyckoff_dataset(
      [
        [0, 0, 0],
        [0.5, 0.5, 0.5],
        [0.25, 0.25, 0.25],
        [0.75, 0.75, 0.75],
      ],
      [1, 8, 26, 6],
      [`a`, `a`, `b`, `b`],
    )
    const multi_result = wyckoff_positions_from_moyo(multi_elem)
    expect(multi_result).toHaveLength(4)
    expect(multi_result.map((pos) => `${pos.wyckoff}-${pos.elem}`).sort()).toEqual([
      `1a-H`,
      `1a-O`,
      `1b-C`,
      `1b-Fe`,
    ])
    expect(multi_result.find((pos) => pos.elem === `H`)?.abc).toEqual([0, 0, 0])
    expect(multi_result.find((pos) => pos.elem === `O`)?.abc).toEqual([0.5, 0.5, 0.5])

    // Multiplicity scales by the std/input size ratio (can't use make_wyckoff_dataset,
    // which assumes input == std): a primitive input with one Cu site (orbit size 1) but a
    // 4-site conventional std_cell must give 1·(n_std/n_input) = 4a, NOT raw orbit size 1.
    // Also pins site_symmetry propagation.
    const primitive_input = {
      input_cell: { positions: [[0, 0, 0]], numbers: [29] }, // Cu
      std_cell: {
        positions: [
          [0, 0, 0],
          [0, 0.5, 0.5],
          [0.5, 0, 0.5],
          [0.5, 0.5, 0],
        ],
        numbers: [29, 29, 29, 29],
      },
      wyckoffs: [`4a`],
      orbits: [0],
      site_symmetry_symbols: [`m-3m`],
      std_linear: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      std_origin_shift: [0, 0, 0],
      orig_site_indices_by_input_idx: [[0]],
    } as unknown as MoyoDataset
    expect(wyckoff_positions_from_moyo(primitive_input)).toEqual([
      { wyckoff: `4a`, elem: `Cu`, abc: [0, 0, 0], site_indices: [0], site_symmetry: `m-3m` },
    ])
  })
})

describe(`simplicity_score`, () => {
  test.each([
    [[0, 0, 0], 0.75],
    [[1, 1, 1], 0.75], // wraps to [0, 0, 0]
    [[0.5, 0.5, 0.5], 1.5],
    [[0, 0.5, 0], 1], // near_zero=[0,0.5,0], near_half=[0.5,0,0.5] -> 0.5 + 0.5*1.0
    [[0.25, 0, 0], 0.875], // 0.25 + 0.5*(0.25+0.5+0.5)
    [[0.25, 0.25, 0.25], 1.125],
    [[0.75, 0.75, 0.75], 1.125], // symmetric to 0.25 around 0.5
    [[1 / 3, 1 / 3, 1 / 3], 1.25],
    [[0.125, 0, 0], 0.8125], // 1/8 position
  ])(`scores %j as %f`, (vec, expected) => {
    expect(simplicity_score(vec)).toBeCloseTo(expected, 10)
  })

  test(`wraps coordinates into [0, 1) and ranks simpler positions lower`, () => {
    expect(simplicity_score([1.1, 1.2, 1.3])).toBe(simplicity_score([0.1, 0.2, 0.3]))
    expect(simplicity_score([-0.1, -0.2, -0.3])).toBe(simplicity_score([0.9, 0.8, 0.7]))
    expect(simplicity_score([-100, 0, 0])).toBeCloseTo(simplicity_score([0, 0, 0]), 10)

    // Preference order: closer to 0/1 is simpler than closer to 1/2
    expect(simplicity_score([0.9, 0.9, 0.9])).toBeLessThan(simplicity_score([0.5, 0.5, 0.5]))
    expect(simplicity_score([0.01, 0.01, 0.01])).toBeLessThan(
      simplicity_score([0.49, 0.49, 0.49]),
    )
  })

  test(`returns NaN for empty or invalid input`, () => {
    expect(simplicity_score([])).toBeNaN()
    expect(simplicity_score([0])).toBeNaN()
    // @ts-expect-error testing invalid input
    expect(simplicity_score(undefined)).toBeNaN()
    // @ts-expect-error testing invalid input
    expect(simplicity_score(null)).toBeNaN()
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
        site.abc?.length !== 3 ||
        site.abc.some((coord) => typeof coord !== `number` || !isFinite(coord))
      ) {
        issues.push(`Site ${site_idx} invalid fractional coordinates`)
      }
      if (
        site.xyz?.length !== 3 ||
        site.xyz.some((coord) => typeof coord !== `number` || !isFinite(coord))
      ) {
        issues.push(`Site ${site_idx} invalid Cartesian coordinates`)
      }
      if (!site.label || typeof site.label !== `string`) {
        issues.push(`Site ${site_idx} invalid label`)
      }

      let totalOccupancy = 0
      for (const [idx, species] of (site.species ?? []).entries()) {
        if (
          !species.element ||
          typeof species.element !== `string` ||
          !/^[A-Z][a-z]?$/.test(species.element)
        ) {
          issues.push(`Site ${site_idx} species ${idx} invalid element: ${species.element}`)
        }
        if (
          typeof species.occu !== `number` ||
          !isFinite(species.occu) ||
          species.occu < 0 ||
          species.occu > 1
        ) {
          issues.push(`Site ${site_idx} species ${idx} invalid occupancy: ${species.occu}`)
        }
        if (
          species.oxidation_state !== undefined &&
          (typeof species.oxidation_state !== `number` || !isFinite(species.oxidation_state))
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

    const failed = structures
      .map((structure) => {
        const issues: string[] = []

        if (!structure.sites?.length) issues.push(`No sites`)

        if (`lattice` in structure && structure.lattice) {
          const { lattice } = structure
          if (
            lattice.matrix?.length !== 3 ||
            lattice.matrix.some((row) => !Array.isArray(row) || row.length !== 3)
          ) {
            issues.push(`Invalid lattice matrix`)
          }
          if (
            [`a`, `b`, `c`, `alpha`, `beta`, `gamma`, `volume`].some(
              (param) => typeof lattice[param as keyof typeof lattice] !== `number`,
            )
          ) {
            issues.push(`Missing lattice parameters`)
          }
        }

        structure.sites?.forEach((site, idx) => issues.push(...validateSite(site, idx)))

        return { id: structure.id ?? `unknown`, issues }
      })
      .filter((site) => site.issues.length > 0)

    expect(failed).toHaveLength(0)
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
        const { a: a_len, b: b_len, c: c_len, volume } = structure.lattice
        expect([a_len, b_len, c_len, volume]).toEqual(
          expect.arrayContaining([expect.any(Number)]),
        )
      }
    })
  })
})

describe(`integration tests`, () => {
  test(`wyckoff positions for mock structures`, () => {
    const mock = make_wyckoff_dataset(
      [
        [0, 0, 0],
        [0.5, 0.5, 0.5],
        [0.25, 0.25, 0.25],
      ],
      [1, 8, 26],
      [`a`, `b`, `c`],
    )

    const positions = wyckoff_positions_from_moyo(mock)
    expect(positions).toHaveLength(3)
    expect(new Set(positions.map((pos) => pos.elem))).toEqual(new Set([`H`, `O`, `Fe`]))
    positions.forEach((pos) => expect([`1a`, `1b`, `1c`]).toContain(pos.wyckoff))
  })
})

describe(`stable atom ordering`, () => {
  test(`wyckoff positions maintain stable ordering across multiple calls`, () => {
    const mock_data = make_wyckoff_dataset(
      [
        [0, 0, 0],
        [0.5, 0.5, 0.5],
        [0.25, 0.25, 0.25],
        [0.75, 0.75, 0.75],
      ],
      [1, 8, 1, 1],
      [`2a`, `1b`, `2a`, `2a`],
    )

    // Call the function multiple times to verify stable ordering
    const results = Array.from({ length: 5 }, () => wyckoff_positions_from_moyo(mock_data))

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

describe(`to_cell_json`, () => {
  test(`serializes lattice basis (row-major), positions, and atomic numbers`, () => {
    const parsed = JSON.parse(
      to_cell_json(
        make_crystal(5, [
          { element: `Si`, abc: [0, 0, 0] },
          { element: `O`, abc: [0.5, 0.5, 0.5] },
        ]),
      ),
    )
    expect(parsed.lattice.basis).toEqual([5, 0, 0, 0, 5, 0, 0, 0, 5])
    expect(parsed.positions).toEqual([
      [0, 0, 0],
      [0.5, 0.5, 0.5],
    ])
    expect(parsed.numbers).toEqual([14, 8]) // Si=14, O=8
  })

  test.each([
    [
      `hexagonal`,
      [
        [3, 0, 0],
        [-1.5, 2.598076211353316, 0],
        [0, 0, 5],
      ],
      `C`,
      6,
    ],
    [
      `triclinic`,
      [
        [4, 0, 0],
        [1, 3, 0],
        [0.5, 0.5, 5],
      ],
      `Fe`,
      26,
    ],
  ] as [string, Matrix3x3, string, number][])(
    `preserves non-orthogonal %s lattice vectors`,
    (_desc, matrix, element, atomic_number) => {
      const crystal = make_crystal(matrix, [{ element, abc: [0.25, 0.25, 0.25] }])
      const parsed = JSON.parse(to_cell_json(crystal))
      matrix
        .flat()
        .forEach((val, idx) => expect(parsed.lattice.basis[idx]).toBeCloseTo(val, 10))
      expect(parsed.positions[0]).toEqual([0.25, 0.25, 0.25])
      expect(parsed.numbers).toEqual([atomic_number])
    },
  )

  test.each([[`Xx`], [``]])(`throws for unknown element %j`, (element) => {
    const crystal = make_crystal(5, [{ element, abc: [0, 0, 0] }])
    expect(() => to_cell_json(crystal)).toThrow(`Unknown element at site 0`)
  })

  test(`merges split disordered sites before moyo conversion`, () => {
    const disordered_split_site = make_crystal(5, [
      { element: `O`, abc: [0, 0, 0], occu: 0.5 },
      { element: `F`, abc: [0, 0, 0], occu: 0.5 },
      { element: `Li`, abc: [0.5, 0.5, 0.5], occu: 1 },
    ])

    const parsed_cell = JSON.parse(to_cell_json(disordered_split_site))
    expect(parsed_cell.positions).toHaveLength(2)
    expect(parsed_cell.numbers).toHaveLength(2)
    expect(parsed_cell.positions).toContainEqual([0, 0, 0])
    expect(parsed_cell.positions).toContainEqual([0.5, 0.5, 0.5])
    // 50/50 tie resolves by alphabetical element symbol: F before O
    expect(new Set(parsed_cell.numbers)).toEqual(new Set([3, 9]))
  })
})

describe(`orig site mapping`, () => {
  test(`wyckoff table expands merged input indices to original sites`, () => {
    // input site 0 (O, 2a) was merged from original sites [0, 1]; input site 1 (Li, 1b)
    // from original site [2]. orig_site_indices_by_input_idx must expand both rows.
    const sym_data = make_wyckoff_dataset(
      [
        [0, 0, 0],
        [0.5, 0.5, 0.5],
      ],
      [8, 3],
      [`2a`, `1b`],
      [[0, 1], [2]],
    )

    const rows = wyckoff_positions_from_moyo(sym_data)
    const oxygen_row = rows.find((row) => row.elem === `O`)
    const lithium_row = rows.find((row) => row.elem === `Li`)
    expect(oxygen_row?.site_indices).toEqual([0, 1])
    expect(lithium_row?.site_indices).toEqual([2])
  })

  test(`std-to-orig mapping respects atomic number when positions overlap`, () => {
    const mapped = map_std_to_orig_site_indices(
      [[0, 0, 0]],
      [3],
      [
        [0, 0, 0],
        [0, 0, 0.001],
      ],
      [8, 3],
      [[0], [1]],
    )
    expect(mapped).toEqual([[1]])
  })

  test(`maps std positions through non-symmetric P before matching`, () => {
    // P (column-major flat [0,0,-1, 1,0,0, 0,-1,0]) is a NON-symmetric axis permutation
    // so a transposed (row-major) read or a skipped transform picks the wrong site.
    // x_in = P·x_std: std (0.7, 0.1, 0.8) ≡ input site 0 at (0.1, 0.2, 0.3) mod 1.
    const mapped = map_std_to_orig_site_indices(
      [[0.7, 0.1, 0.8]],
      [14],
      [
        [0.1, 0.2, 0.3],
        [0.7, 0.5, 0.9],
      ],
      [14, 14],
      [[0], [1]],
      { std_linear: [0, 0, -1, 1, 0, 0, 0, -1, 0], std_origin_shift: [0, 0, 0] },
    )
    expect(mapped).toEqual([[0]])
  })

  test(`std-lattice translation check uses P⁻¹·d ∈ ℤ³, not P·d ∈ ℤ³`, () => {
    // P scales std-x by 1/2 (col-major flat [0.5,0,0, 0,1,0, 0,0,1]). std site (0,0,0)
    // predicts input position (0,0,0). input[0] at (0.5,0,0) differs by d=(-0.5,0,0):
    // P⁻¹·d = (-1,0,0) ∈ ℤ³ ⇒ a standardized-lattice translation ⇒ exact match (dist 0).
    // input[1] at (0.01,0,0) is fractionally closer but is NOT a std-lattice translation
    // (P⁻¹·d = (-0.02,0,0)). The correct check selects input[0]; the wrong P·d check
    // (P·(-0.5,0,0) = (-0.25,0,0) ∉ ℤ³) would fall back to distance and pick input[1].
    const mapped = map_std_to_orig_site_indices(
      [[0, 0, 0]],
      [14],
      [
        [0.5, 0, 0],
        [0.01, 0, 0],
      ],
      [14, 14],
      [[0], [1]],
      { std_linear: [0.5, 0, 0, 0, 1, 0, 0, 0, 1], std_origin_shift: [0, 0, 0] },
    )
    expect(mapped).toEqual([[0]])
  })
})

describe(`site coverage verification`, () => {
  test.each<{
    desc: string
    positions: number[][]
    numbers: number[]
    wyckoffs: (string | null)[]
    expected_coverage: number[]
    expected_multiplicity: number
  }>([
    {
      desc: `three 1-site orbits`,
      positions: [
        [0, 0, 0],
        [0.5, 0.5, 0.5],
        [0.25, 0.25, 0.25],
      ],
      numbers: [1, 8, 26],
      wyckoffs: [`a`, `b`, `c`],
      expected_coverage: [0, 1, 2],
      expected_multiplicity: 3,
    },
    {
      desc: `single 4-site orbit`,
      positions: [
        [0, 0, 0],
        [0.5, 0.5, 0.5],
        [0.5, 0, 0],
        [0, 0.5, 0],
      ],
      numbers: [1, 1, 1, 1],
      wyckoffs: [`4a`, `4a`, `4a`, `4a`],
      expected_coverage: [0, 1, 2, 3],
      expected_multiplicity: 4,
    },
    {
      desc: `mixed 3-site and 1-site orbits`,
      positions: [
        [0, 0, 0],
        [0.5, 0.5, 0.5],
        [0.25, 0.25, 0.25],
        [0.75, 0.75, 0.75],
      ],
      numbers: [1, 8, 1, 1],
      wyckoffs: [`2a`, `1b`, `2a`, `2a`],
      expected_coverage: [0, 1, 2, 3],
      expected_multiplicity: 4,
    },
    {
      desc: `null Wyckoff letters`,
      positions: [
        [0, 0, 0],
        [0.5, 0.5, 0.5],
        [0.25, 0.25, 0.25],
      ],
      numbers: [1, 8, 26],
      wyckoffs: [null, `b`, null],
      expected_coverage: [0, 1, 2],
      expected_multiplicity: 3,
    },
  ])(
    `$desc: all sites covered, multiplicities sum correctly`,
    ({ positions, numbers, wyckoffs, expected_coverage, expected_multiplicity }) => {
      const rows = wyckoff_positions_from_moyo(
        make_wyckoff_dataset(positions, numbers, wyckoffs),
      )
      const covered = rows
        .flatMap((pos) => pos.site_indices ?? [])
        .sort((idx_a, idx_b) => idx_a - idx_b)
      expect(covered).toEqual(expected_coverage)

      const total_multiplicity = rows.reduce(
        (sum, pos) => sum + (wyckoff_multiplicity(pos.wyckoff) || 1),
        0,
      )
      expect(total_multiplicity).toBe(expected_multiplicity)
    },
  )

  // empty/null single-site letters are covered in `handles various input scenarios`

  test(`handles edge cases in Wyckoff position parsing`, () => {
    const edge_cases: {
      positions: number[][]
      numbers: number[]
      wyckoffs: (string | null)[]
      expected: WyckoffPos[]
    }[] = [
      // Mixed valid and invalid wyckoff letters
      {
        positions: [
          [0, 0, 0],
          [0.5, 0.5, 0.5],
        ],
        numbers: [1, 8],
        wyckoffs: [`a`, null],
        expected: [
          { wyckoff: `1`, elem: `O`, abc: [0.5, 0.5, 0.5], site_indices: [1] },
          { wyckoff: `1a`, elem: `H`, abc: [0, 0, 0], site_indices: [0] },
        ],
      },
      // Multi-letter notation keeps all trailing letters
      {
        positions: [[0, 0, 0]],
        numbers: [26],
        wyckoffs: [`24abc`],
        expected: [{ wyckoff: `1abc`, elem: `Fe`, abc: [0, 0, 0], site_indices: [0] }],
      },
      // Very large multiplicity
      {
        positions: Array.from({ length: 48 }, (_, idx) => [
          idx * 0.02,
          idx * 0.02,
          idx * 0.02,
        ]),
        numbers: Array(48).fill(1),
        wyckoffs: Array(48).fill(`48a`),
        expected: [
          {
            wyckoff: `48a`,
            elem: `H`,
            abc: [0, 0, 0],
            site_indices: Array.from({ length: 48 }, (_, idx) => idx),
          },
        ],
      },
    ]

    edge_cases.forEach(({ positions, numbers, wyckoffs, expected }) => {
      const result = wyckoff_positions_from_moyo(
        make_wyckoff_dataset(positions, numbers, wyckoffs),
      )
      expect(result).toEqual(expected)
    })
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
    rotation_180z: {
      rotation: [-1, 0, 0, 0, -1, 0, 0, 0, 1] as Vec9,
      translation: [0, 0, 0] as Vec3,
    },
    rotation_270z: {
      rotation: [0, -1, 0, 1, 0, 0, 0, 0, 1] as Vec9,
      translation: [0, 0, 0] as Vec3,
    },
    mirror_x: {
      rotation: [-1, 0, 0, 0, 1, 0, 0, 0, 1] as Vec9,
      translation: [0, 0, 0] as Vec3,
    },
    glide_x: {
      rotation: [-1, 0, 0, 0, 1, 0, 0, 0, 1] as Vec9,
      translation: [0.5, 0, 0] as Vec3,
    },
  }

  // oxfmt-ignore
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
    [
      `4-fold orbit about z`,
      [0.25, 0, 0] as Vec3,
      [
        operations.identity,
        operations.rotation_90z,
        operations.rotation_180z,
        operations.rotation_270z,
      ],
      [[0.25, 0, 0], [0, 0.25, 0], [0.75, 0, 0], [0, 0.75, 0]],
      4,
    ],
    [
      `mirror perpendicular to x`,
      [0.25, 0.5, 0.75] as Vec3,
      [operations.identity, operations.mirror_x],
      [[0.25, 0.5, 0.75], [0.75, 0.5, 0.75]],
      2,
    ],
    [
      `a-glide (mirror + half translation)`,
      [0.125, 0.25, 0.25] as Vec3,
      [operations.identity, operations.glide_x],
      [[0.125, 0.25, 0.25], [0.375, 0.25, 0.25]], // -0.125 + 0.5 = 0.375
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
})

describe(`map_wyckoff_to_all_atoms`, () => {
  // Helper factory using make_crystal
  const mock_structure = (sites: { abc: Vec3; element: ElementSymbol }[]): Crystal =>
    make_crystal(
      1,
      sites.map(({ element, abc }) => ({ element, abc })),
    )

  const mock_sym_data = (): MoyoDataset =>
    ({
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
    }) as unknown as MoyoDataset

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
    const wyckoff_pos = [
      {
        wyckoff: `2a`,
        elem: `H`,
        abc: [0.25, 0.25, 0.25] as Vec3,
        site_indices: [0],
      },
    ]

    const result = map_wyckoff_to_all_atoms(wyckoff_pos, displayed, original, mock_sym_data())

    expect(result).toHaveLength(1)
    expect(result[0].site_indices).toEqual(expect.arrayContaining([0, 1]))
    expect(result[0].site_indices).toHaveLength(2)
  })

  test(`handles different elements correctly`, () => {
    const original = mock_structure([
      { abc: [0, 0, 0], element: `H` },
      {
        abc: [0.5, 0.5, 0.5],
        element: `O`,
      },
    ])
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

    const result = map_wyckoff_to_all_atoms(wyckoff_pos, displayed, original, mock_sym_data())

    expect(result.find((pos) => pos.elem === `H`)?.site_indices).toEqual([0])
    expect(result.find((pos) => pos.elem === `O`)?.site_indices).toEqual([2])
  })

  test(`handles periodic boundary conditions`, () => {
    const original = mock_structure([{ abc: [0.1, 0.1, 0.1], element: `H` }])
    const displayed = mock_structure([
      { abc: [0.1, 0.1, 0.1], element: `H` }, // Original
      { abc: [0.9, 0.9, 0.9], element: `H` }, // Inversion: -0.1 -> 0.9
      { abc: [1.1, 1.1, 1.1], element: `H` }, // Wrapped: 1.1 -> 0.1
    ])
    const wyckoff_pos = [
      {
        wyckoff: `2a`,
        elem: `H`,
        abc: [0.1, 0.1, 0.1] as Vec3,
        site_indices: [0],
      },
    ]

    const result = map_wyckoff_to_all_atoms(wyckoff_pos, displayed, original, mock_sym_data())

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
    const wyckoff_pos = [
      {
        wyckoff: `1a`,
        elem: `H`,
        abc: [0.1, 0.2, 0.3] as Vec3,
        site_indices: [0],
      },
    ]

    const result = map_wyckoff_to_all_atoms(wyckoff_pos, displayed, original, mock_sym_data())

    expect(result[0].site_indices).toEqual(expect.arrayContaining([0, 1, 2]))
    expect(result[0].site_indices).toHaveLength(3)
  })

  test(`uses relaxed default tolerance for near-coincident sites`, () => {
    const original = mock_structure([{ abc: [0, 0, 0], element: `H` }])
    const displayed = mock_structure([
      { abc: [0, 0, 0], element: `H` },
      { abc: [0.000005, 0, 0], element: `H` }, // Within 1e-5 but > 1e-6
    ])
    const wyckoff_pos = [
      {
        wyckoff: `1a`,
        elem: `H`,
        abc: [0, 0, 0] as Vec3,
        site_indices: [0],
      },
    ]

    // Call without explicit tolerance to use the function's default
    const result = map_wyckoff_to_all_atoms(wyckoff_pos, displayed, original, mock_sym_data())

    expect(result[0].site_indices).toEqual([0, 1])
  })

  test(`respects tolerance parameter`, () => {
    const original = mock_structure([{ abc: [0, 0, 0], element: `H` }])
    const displayed = mock_structure([
      { abc: [0, 0, 0], element: `H` }, // Exact
      { abc: [0.001, 0.001, 0.001], element: `H` }, // Outside strict tolerance
      { abc: [0.0001, 0.0001, 0.0001], element: `H` }, // Close
    ])
    const wyckoff_pos = [
      {
        wyckoff: `1a`,
        elem: `H`,
        abc: [0, 0, 0] as Vec3,
        site_indices: [0],
      },
    ]

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
    const wyckoff_pos = [
      {
        wyckoff: `1a`,
        elem: `H`,
        abc: [0, 0, 0] as Vec3,
        ...(site_indices && { site_indices }),
      },
    ]

    const result = map_wyckoff_to_all_atoms(wyckoff_pos, displayed, original, mock_sym_data())

    expect(result[0].site_indices).toEqual(expected)
  })

  test(`matches sites within tolerance across the 0/1 wrap boundary`, () => {
    // displayed site sits 1e-7 below 1.0; the equivalent position wraps to 0.0 —
    // matching requires probing neighbor cells of the spatial hash with wraparound
    const original = make_crystal(1, [{ element: `H` as const, abc: [0, 0, 0] }])
    const displayed = make_crystal(1, [
      { element: `H` as const, abc: [0.9999999, 0.9999999, 0.9999999] },
    ])
    const sym_data = mock_sym_data()
    const rows = map_wyckoff_to_all_atoms(
      [{ wyckoff: `1a`, elem: `H`, abc: [0, 0, 0], site_indices: [0] }],
      displayed,
      original,
      sym_data,
    )
    expect(rows[0].site_indices).toEqual([0])
  })
})
