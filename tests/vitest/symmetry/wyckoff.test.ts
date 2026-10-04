import type { ElementSymbol } from '#lib'
import type { Matrix3x3, Vec3 } from '#lib/math.js'
import type { Crystal } from '#lib/structure/index.js'
import type { SymmetryDataset, WyckoffPos } from '#lib/symmetry/index.js'
import {
  apply_symmetry_operations,
  count_structure_free_params,
  enrich_wyckoff_rows,
  map_wyckoff_to_all_atoms,
  wyckoff_letter,
  wyckoff_positions_from_moyo,
  wyckoff_sequence,
} from '#lib/symmetry/wyckoff.js'
import type { MoyoDataset, MoyoWyckoffPosition } from '@spglib/moyo-wasm'
import { describe, expect, test } from 'vitest'
import { cubic_matrix, make_crystal, make_wyckoff_dataset } from '../test-fixtures'

describe(`wyckoff_positions_from_moyo`, () => {
  // A plain MoyoDataset (straight from @spglib/moyo-wasm, never through analyze_structure) has
  // no input_cell; it runs inside $derived so it must return [] rather than throw
  test(`returns [] for null or a plain MoyoDataset without input_cell`, () => {
    expect(wyckoff_positions_from_moyo(null)).toEqual([])
    const { input_cell: _input, ...plain } = make_wyckoff_dataset([[0, 0, 0]], [1], [`1a`])
    expect(wyckoff_positions_from_moyo(plain as unknown as MoyoDataset)).toEqual([])
  })

  // moyo echoes back the atomic numbers analyze_structure handed it, so one off the table
  // means the two disagree about the cell; a `?` row used to be printed instead
  test(`throws on an unknown atomic number`, () => {
    expect(() =>
      wyckoff_positions_from_moyo(make_wyckoff_dataset([[0, 0, 0]], [0], [`1a`])),
    ).toThrow(/atomic number 0, not a known element/)
  })

  const three_sites = [
    [0, 0, 0],
    [0.5, 0.5, 0.5],
    [0.25, 0.25, 0.25],
  ]
  const four_sites = [...three_sites, [0.75, 0.75, 0.75]]
  test.each<{
    desc: string
    positions: number[][]
    numbers: number[]
    wyckoffs: (string | null)[]
    orig_indices?: number[][]
    expected: WyckoffPos[]
  }>([
    {
      desc: `sorts rows by multiplicity, then label`,
      positions: four_sites,
      numbers: [1, 8, 1, 1],
      wyckoffs: [`b`, `a`, `b`, `b`],
      expected: [
        { wyckoff: `1a`, elem: `O`, abc: [0.5, 0.5, 0.5], site_indices: [1] },
        { wyckoff: `3b`, elem: `H`, abc: [0, 0, 0], site_indices: [0, 2, 3] },
      ],
    },
    {
      // the old ¼ + ½·min(u, 1 − u) score rated u = 1/2 WORST, so a generic 0.30 beat it
      desc: `picks the special 1/2 over a generic coordinate as orbit representative`,
      positions: [[0.3, 0.3, 0.3], ...three_sites.slice(1)],
      numbers: [1, 1, 1],
      wyckoffs: [`a`, `a`, `a`],
      expected: [{ wyckoff: `3a`, elem: `H`, abc: [0.5, 0.5, 0.5], site_indices: [0, 1, 2] }],
    },
    {
      desc: `picks the simplest coordinates, not ones near the cell edge`,
      positions: [
        [0.999, 0.999, 0.999],
        [0, 0, 0],
        [0.5, 0.5, 0.5],
        [0.001, 0.001, 0.001],
      ],
      numbers: [1, 1, 1, 1],
      wyckoffs: [`a`, `a`, `a`, `a`],
      expected: [{ wyckoff: `4a`, elem: `H`, abc: [0, 0, 0], site_indices: [0, 1, 2, 3] }],
    },
    {
      desc: `one orbit per letter with multiplicity counted over its members`,
      positions: [
        [0.1576, 0, 0.5754],
        [0.1576, 0, 0.5754],
        [0.0201, 0.3033, 0.256],
        [0.3069, 0, 0.3081],
        [0.7091, 0, 0.0177],
      ],
      numbers: [8, 8, 8, 8, 8],
      wyckoffs: [`4i`, `4i`, `8j`, `4i`, `4i`],
      expected: [
        { wyckoff: `1j`, elem: `O`, abc: [0.0201, 0.3033, 0.256], site_indices: [2] },
        { wyckoff: `4i`, elem: `O`, abc: [0.7091, 0, 0.0177], site_indices: [0, 1, 3, 4] },
      ],
    },
    {
      desc: `different elements on the same letter stay separate rows`,
      positions: four_sites,
      numbers: [1, 8, 26, 6],
      wyckoffs: [`a`, `a`, `b`, `b`],
      expected: [
        { wyckoff: `1a`, elem: `H`, abc: [0, 0, 0], site_indices: [0] },
        { wyckoff: `1a`, elem: `O`, abc: [0.5, 0.5, 0.5], site_indices: [1] },
        { wyckoff: `1b`, elem: `Fe`, abc: [0.25, 0.25, 0.25], site_indices: [2] },
        { wyckoff: `1b`, elem: `C`, abc: [0.75, 0.75, 0.75], site_indices: [3] },
      ],
    },
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
      desc: `an empty-string letter gives a bare multiplicity`,
      positions: three_sites.slice(0, 2),
      numbers: [1, 8],
      wyckoffs: [``, `1a`],
      expected: [
        { wyckoff: `1`, elem: `H`, abc: [0, 0, 0], site_indices: [0] },
        { wyckoff: `1a`, elem: `O`, abc: [0.5, 0.5, 0.5], site_indices: [1] },
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
      positions: three_sites.slice(0, 2),
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
    {
      // input site 0 (O) was merged from original sites [0, 1], input site 1 (Li) from [2]
      desc: `expands merged input indices to original sites`,
      positions: three_sites.slice(0, 2),
      numbers: [8, 3],
      wyckoffs: [`2a`, `1b`],
      orig_indices: [[0, 1], [2]],
      expected: [
        { wyckoff: `1a`, elem: `O`, abc: [0, 0, 0], site_indices: [0, 1] },
        { wyckoff: `1b`, elem: `Li`, abc: [0.5, 0.5, 0.5], site_indices: [2] },
      ],
    },
  ])(`$desc`, ({ positions, numbers, wyckoffs, orig_indices, expected }) => {
    expect(
      wyckoff_positions_from_moyo(
        make_wyckoff_dataset(positions, numbers, wyckoffs, orig_indices),
      ),
    ).toEqual(expected)
  })

  // Multiplicity scales by the std/input size ratio (make_wyckoff_dataset assumes input ==
  // std): a primitive input with one Cu site (orbit size 1) but a 4-site conventional
  // std_cell must give 1·(n_std/n_input) = 4a, NOT raw orbit size 1. Also pins
  // site_symmetry propagation.
  test(`scales multiplicity by the std/input cell size ratio`, () => {
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
    // 0.8 + 0.5 = 1.3 wraps to 0.3, up to float error
    expect(apply_symmetry_operations([0.8, 0.8, 0.8], [operations.translation])).toEqual([
      Array(3).fill(expect.closeTo(0.3, 10)),
    ])
  })

  test.each([
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
      symprec: 1e-6,
    }) as unknown as MoyoDataset

  const h_row: WyckoffPos = { wyckoff: `1a`, elem: `H`, abc: [0, 0, 0], site_indices: [0] }
  const h_crystal = mock_structure([{ abc: [0, 0, 0], element: `H` }])
  test.each<[string, WyckoffPos[], Crystal, MoyoDataset | null, WyckoffPos[]]>([
    [`null symmetry data`, [h_row], h_crystal, null, [h_row]],
    [
      `empty displayed sites`,
      [h_row],
      { ...h_crystal, sites: [] },
      mock_sym_data(),
      [{ ...h_row, site_indices: [] }],
    ],
    [`empty wyckoff positions`, [], h_crystal, mock_sym_data(), []],
  ])(`handles %s gracefully`, (_, rows, displayed, sym_data, expected) => {
    expect(map_wyckoff_to_all_atoms(rows, displayed, h_crystal, sym_data)).toEqual(expected)
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
    // the equivalent position wraps to 0.0, so matching must probe neighbouring hash cells
    [
      `a site 1e-7 below the 0/1 wrap`,
      [0, 0, 0],
      [[0.9999999, 0.9999999, 0.9999999]],
      [0],
      undefined,
      [0],
    ],
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
      expect(
        result[0].site_indices.toSorted((left_value, right_value) => left_value - right_value),
      ).toEqual(expected)
    },
  )

  // symprec 0.1 Å joins a site 0.15 Å off N to its row, not the N2 partner 1.1 Å up c = 30 Å
  test(`scales the symprec tolerance per axis`, () => {
    const lattice = cubic_matrix(3).with(2, [0, 0, 30]) as Matrix3x3
    const dimer: [ElementSymbol, Vec3][] = [
      [`N`, [0.5, 0.5, 0.5]],
      [`N`, [0.5, 0.5, 0.5 + 1.1 / 30]],
    ]
    const rows = map_wyckoff_to_all_atoms(
      dimer.map(([elem, abc], idx) => ({ wyckoff: `1a`, elem, abc, site_indices: [idx] })),
      make_crystal(lattice, [...dimer, [`N`, [0.5, 0.5, 0.5 + 0.15 / 30]]]),
      make_crystal(lattice, dimer),
      { ...mock_sym_data(), symprec: 0.1 },
    )
    expect(rows.map((row) => row.site_indices)).toEqual([[0, 2], [1]])
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
  const database = [
    make_db_entry(`a`, `0,0,0`, `m-3m`, 1),
    make_db_entry(`c`, `x,1/4,0`, `mm2`, 4),
  ]

  test.each<[string, WyckoffPos, MoyoWyckoffPosition[], Partial<WyckoffPos>]>([
    [`1a`, make_row(`1a`), database, { coordinates: `0,0,0`, site_symmetry: `m-3m` }],
    [`4c`, make_row(`4c`), database, { coordinates: `x,1/4,0`, site_symmetry: `mm2` }],
    // moyo-provided site symmetry wins over the database fallback
    [
      `1a with moyo site symmetry`,
      make_row(`1a`, { site_symmetry: `-43m` }),
      database,
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
    [`letter missing from database`, [make_row(`2d`)], database],
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
