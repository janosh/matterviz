import type { ElementSymbol } from '$lib'
import type { Vec3 } from '$lib/math'
import type { Crystal } from '$lib/structure'
import type { SymmetryDataset, WyckoffPos } from '$lib/symmetry'
import {
  apply_symmetry_operations,
  count_structure_free_params,
  enrich_wyckoff_rows,
  map_wyckoff_to_all_atoms,
  wyckoff_letter,
  wyckoff_positions_from_moyo,
  wyckoff_sequence,
} from '$lib/symmetry'
import type { MoyoDataset, MoyoWyckoffPosition } from '@spglib/moyo-wasm'
import { describe, expect, test } from 'vitest'
import { make_crystal, make_wyckoff_dataset } from '../setup'

describe(`wyckoff_positions_from_moyo`, () => {
  // A plain MoyoDataset (straight from @spglib/moyo-wasm, never through analyze_structure) has
  // no input_cell; it runs inside $derived so it must return [] rather than throw
  test(`returns [] for a plain MoyoDataset without input_cell`, () => {
    const { input_cell: _input, ...plain } = make_wyckoff_dataset([[0, 0, 0]], [1], [`1a`])
    expect(wyckoff_positions_from_moyo(plain as unknown as MoyoDataset)).toEqual([])
  })

  test(`handles various input scenarios`, () => {
    // Null input
    expect(wyckoff_positions_from_moyo(null)).toEqual([])

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

    // simplicity_score picks the orbit representative; the old ¼ + ½·min(u, 1 − u) scored
    // u = 1/2 WORST, so a generic 0.30 beat the special 0.50
    const special_vs_generic = make_wyckoff_dataset(
      [
        [0.3, 0.3, 0.3],
        [0.5, 0.5, 0.5],
        [0.25, 0.25, 0.25],
      ],
      [1, 1, 1],
      [`a`, `a`, `a`],
    )
    expect(wyckoff_positions_from_moyo(special_vs_generic)[0].abc).toEqual([0.5, 0.5, 0.5])

    // moyo echoes back the atomic numbers analyze_structure handed it, so one off the table
    // means the two disagree about the cell; a `?` row used to be printed instead
    expect(() =>
      wyckoff_positions_from_moyo(make_wyckoff_dataset([[0, 0, 0]], [0], [`1a`])),
    ).toThrow(/atomic number 0, not a known element/)

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
    expect(result.map((pos) => pos.wyckoff).toSorted()).toEqual([`1j`, `4i`])
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
    expect(multi_result.map((pos) => `${pos.wyckoff}-${pos.elem}`).toSorted()).toEqual([
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
    } as unknown as SymmetryDataset
    expect(wyckoff_positions_from_moyo(primitive_input)).toEqual([
      { wyckoff: `4a`, elem: `Cu`, abc: [0, 0, 0], site_indices: [0], site_symmetry: `m-3m` },
    ])
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
})

describe(`site coverage verification`, () => {
  // empty/null single-site letters are covered in `handles various input scenarios`
  const three_sites = [
    [0, 0, 0],
    [0.5, 0.5, 0.5],
    [0.25, 0.25, 0.25],
  ]
  test.each<{
    desc: string
    positions: number[][]
    numbers: number[]
    wyckoffs: (string | null)[]
    expected: WyckoffPos[]
  }>([
    {
      desc: `three 1-site orbits of distinct elements each get their own row`,
      positions: three_sites,
      numbers: [1, 8, 26],
      wyckoffs: [`a`, `b`, `c`],
      expected: [
        { wyckoff: `1a`, elem: `H`, abc: [0, 0, 0], site_indices: [0] },
        { wyckoff: `1b`, elem: `O`, abc: [0.5, 0.5, 0.5], site_indices: [1] },
        { wyckoff: `1c`, elem: `Fe`, abc: [0.25, 0.25, 0.25], site_indices: [2] },
      ],
    },
    {
      // letterless sites of different elements must NOT be merged into one orbit
      desc: `two null-letter sites of different elements stay separate rows`,
      positions: three_sites,
      numbers: [1, 8, 26],
      wyckoffs: [null, `b`, null],
      expected: [
        { wyckoff: `1`, elem: `H`, abc: [0, 0, 0], site_indices: [0] },
        { wyckoff: `1`, elem: `Fe`, abc: [0.25, 0.25, 0.25], site_indices: [2] },
        { wyckoff: `1b`, elem: `O`, abc: [0.5, 0.5, 0.5], site_indices: [1] },
      ],
    },
    {
      desc: `mixed valid and missing Wyckoff letters`,
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
    {
      desc: `multi-letter notation keeps all trailing letters`,
      positions: [[0, 0, 0]],
      numbers: [26],
      wyckoffs: [`24abc`],
      expected: [{ wyckoff: `1abc`, elem: `Fe`, abc: [0, 0, 0], site_indices: [0] }],
    },
    {
      desc: `very large multiplicity`,
      positions: Array.from({ length: 48 }, (_, idx) => [idx * 0.02, idx * 0.02, idx * 0.02]),
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
  ])(`$desc`, ({ positions, numbers, wyckoffs, expected }) => {
    expect(
      wyckoff_positions_from_moyo(make_wyckoff_dataset(positions, numbers, wyckoffs)),
    ).toEqual(expected)
  })
})

describe(`apply_symmetry_operations`, () => {
  const operations: Record<string, MoyoDataset[`operations`][number]> = {
    identity: {
      rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      translation: [0, 0, 0],
    },
    inversion: {
      rotation: [-1, 0, 0, 0, -1, 0, 0, 0, -1],
      translation: [0, 0, 0],
    },
    translation: {
      rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      translation: [0.5, 0.5, 0.5],
    },
    rotation_90z: {
      rotation: [0, 1, 0, -1, 0, 0, 0, 0, 1],
      translation: [0, 0, 0],
    },
    rotation_180z: {
      rotation: [-1, 0, 0, 0, -1, 0, 0, 0, 1],
      translation: [0, 0, 0],
    },
    rotation_270z: {
      rotation: [0, -1, 0, 1, 0, 0, 0, 0, 1],
      translation: [0, 0, 0],
    },
    mirror_x: {
      rotation: [-1, 0, 0, 0, 1, 0, 0, 0, 1],
      translation: [0, 0, 0],
    },
    glide_x: {
      rotation: [-1, 0, 0, 0, 1, 0, 0, 0, 1],
      translation: [0.5, 0, 0],
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

  // wrap_to_unit_cell only snaps within 1e-10 of 1, so x = 1 - 5e-10 survives wrapping while
  // its inversion image -x wraps to 5e-10; both round to 0.00000000 at 8 decimals and are one
  // position (the key used to read 1.00000000 vs 0.00000000 and kept both)
  test.each([1 - 5e-10, 1 - 1e-9, 1 - 4e-9])(
    `dedupes a position at %d against its lattice-equivalent image near 0`,
    (coord) => {
      const position: Vec3 = [coord, 0.25, 0.25]
      const result = apply_symmetry_operations(position, [
        operations.identity,
        operations.mirror_x,
      ])
      expect(result).toHaveLength(1)
    },
  )
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

  // One H orbit mapped onto a displayed cell. Coordinates outside [0, 1) wrap by whole cells,
  // the default tolerance is a relaxed 1e-5, and site_indices past the end map to nothing.
  const near_zero: Vec3[] = [
    [0, 0, 0],
    [0.001, 0.001, 0.001],
    [0.0001, 0.0001, 0.0001],
  ]
  test.each<[string, Vec3, Vec3[], number[], number | undefined, number[]]>([
    [
      `periodic images`,
      [0.1, 0.1, 0.1],
      [
        [0.1, 0.1, 0.1],
        [0.9, 0.9, 0.9],
        [1.1, 1.1, 1.1],
      ],
      [0],
      undefined,
      [0, 1, 2],
    ],
    [
      `whole-cell offsets`,
      [0.1, 0.2, 0.3],
      [
        [0.1, 0.2, 0.3],
        [2.1, 2.2, 3.3],
        [-0.9, -0.8, -0.7],
      ],
      [0],
      undefined,
      [0, 1, 2],
    ],
    [
      `the 1e-5 default tolerance`,
      [0, 0, 0],
      [
        [0, 0, 0],
        [0.000005, 0, 0],
      ],
      [0],
      undefined,
      [0, 1],
    ],
    [`a strict tolerance`, [0, 0, 0], near_zero, [0], 1e-8, [0]],
    [`a loose tolerance`, [0, 0, 0], near_zero, [0], 1e-2, [0, 1, 2]],
    [`indices past the structure`, [0, 0, 0], [[0, 0, 0]], [5, 10], undefined, []],
  ])(
    `maps an orbit onto %s`,
    (_label, orbit, displayed_abc, site_indices, tolerance, expected) => {
      const result = map_wyckoff_to_all_atoms(
        [{ wyckoff: `1a`, elem: `H`, abc: orbit, site_indices }],
        mock_structure(displayed_abc.map((abc) => ({ abc, element: `H` as const }))),
        mock_structure([{ abc: orbit, element: `H` }]),
        mock_sym_data(),
        tolerance,
      )
      expect(result[0].site_indices.toSorted((a, b) => a - b)).toEqual(expected)
    },
  )

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

const make_row = (wyckoff: string, overrides: Partial<WyckoffPos> = {}): WyckoffPos => ({
  wyckoff,
  elem: `Na`,
  abc: [0, 0, 0],
  site_indices: [],
  ...overrides,
})

const make_db_entry = (
  letter: string,
  coordinates: string,
  site_symmetry = `m-3m`,
  multiplicity = 1,
): MoyoWyckoffPosition => ({ multiplicity, letter, site_symmetry, coordinates })

describe(`wyckoff_letter`, () => {
  test.each([
    [`4a`, `a`],
    [`192h`, `h`],
    [`8A`, `A`], // moyo encodes ITA's 27th letter alpha as uppercase A (e.g. Pmmm)
    [`1`, ``],
    [``, ``],
  ])(`extracts letter from %j as %j`, (label, expected) => {
    expect(wyckoff_letter(label)).toBe(expected)
  })
})

describe(`wyckoff_sequence`, () => {
  test.each<[string, string[], string]>([
    [`perovskite Pm-3m`, [`1a`, `1b`, `3c`], `c b a`],
    [`repeated letters get superscript counts`, [`8c`, `8c`, `4a`], `c² a`],
    [`descending letter order regardless of input order`, [`4e`, `2a`, `4e`, `8j`], `j e² a`],
    [`single orbit`, [`4a`], `a`],
    [`empty`, [], ``],
    [`double-digit counts`, Array.from({ length: 12 }, () => `2e`), `e¹²`],
    // alpha (A) is the letter AFTER z, so the general position still comes first
    [`Pmmm-style alpha general position`, [`1a`, `8A`, `2z`], `A z a`],
  ])(`%s`, (_desc, labels, expected) => {
    expect(wyckoff_sequence(labels.map((label) => make_row(label)))).toBe(expected)
  })

  test(`ignores rows without a letter`, () => {
    expect(wyckoff_sequence([make_row(`4`), make_row(`1a`)])).toBe(`a`)
  })
})

describe(`enrich_wyckoff_rows`, () => {
  const db = [make_db_entry(`a`, `0,0,0`, `m-3m`, 1), make_db_entry(`c`, `x,1/4,0`, `mm2`, 4)]

  test.each<[string, WyckoffPos, MoyoWyckoffPosition[], Partial<WyckoffPos>]>([
    [`1a`, make_row(`1a`), db, { coordinates: `0,0,0`, site_symmetry: `m-3m` }],
    [`4c`, make_row(`4c`), db, { coordinates: `x,1/4,0`, site_symmetry: `mm2` }],
    // moyo-provided site symmetry wins over the database fallback
    [
      `1a with moyo site symmetry`,
      make_row(`1a`, { site_symmetry: `-43m` }),
      db,
      { coordinates: `0,0,0`, site_symmetry: `-43m` },
    ],
    // alpha (uppercase A) general positions match too
    [
      `8A`,
      make_row(`8A`),
      [make_db_entry(`A`, `x,y,z`, `1`, 8)],
      { coordinates: `x,y,z`, site_symmetry: `1` },
    ],
  ])(
    `attaches ITA coordinates and site symmetry to %s`,
    (_desc, row, db_positions, expected) => {
      expect(enrich_wyckoff_rows([row], db_positions)[0]).toMatchObject(expected)
    },
  )

  test.each<[string, WyckoffPos[], MoyoWyckoffPosition[]]>([
    [`empty database`, [make_row(`1a`)], []],
    [`letter missing from database`, [make_row(`2d`)], db],
  ])(`passes rows through unchanged with %s`, (_desc, rows, db_positions) => {
    const enriched = enrich_wyckoff_rows(rows, db_positions)
    expect(enriched).toEqual(rows)
    expect(enriched.every((row) => row.coordinates === undefined)).toBe(true)
  })
})

describe(`count_structure_free_params`, () => {
  test.each<[string, (string | undefined)[], number | null]>([
    [`all fixed`, [`0,0,0`, `1/2,1/2,1/2`], 0],
    [`mixed orbits sum per-orbit free params`, [`x,y,z`, `1/4,1/4,z`, `0,0,0`], 4],
    // repeated variables count once per orbit: x,2x and x,-x each have one/two free params
    [`distinct variables per triplet`, [`x,2x,1/2`, `x,-x,z`, `x,x,x`, `-y,x-y,2/3`], 6],
    [`any row missing coordinates yields null`, [`x,y,z`, undefined], null],
    [`empty rows yield null (no orbit info, not 0 DOF)`, [], null],
  ])(`%s`, (_desc, coords, expected) => {
    const rows = coords.map((coordinates, idx) =>
      make_row(`${idx + 1}a`, coordinates !== undefined ? { coordinates } : {}),
    )
    expect(count_structure_free_params(rows)).toBe(expected)
  })
})
