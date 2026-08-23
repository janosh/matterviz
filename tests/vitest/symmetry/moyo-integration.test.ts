// Integration tests for moyo-wasm symmetry analysis
// Uses real WASM binary to verify symmetry detection behavior
// Note: Most symmetry tests use mocks (see index.test.ts)

import type { Matrix3x3, Vec3 } from '$lib/math'
import type { Crystal } from '$lib'
import type { SymmetryDataset } from '$lib/symmetry'
import {
  analyze_structure_symmetry,
  apply_symmetry_operations,
  enrich_wyckoff_rows,
  map_wyckoff_to_all_atoms,
  SPACEGROUP_SYMBOL_TO_NUM,
  spacegroup_to_crystal_sys,
  spacegroup_settings,
  spacegroup_to_lattice_system,
  spacegroup_wyckoff_positions,
  transform_cell,
  wyckoff_positions_from_moyo,
} from '$lib/symmetry'
import { structure_map } from '$site/structures'
import { space_group_type } from '@spglib/moyo-wasm'
import { beforeAll, describe, expect, test } from 'vitest'
import { fcc_primitive_matrix, init_moyo_for_tests, make_crystal } from '../setup'

// Helper to get structure or throw with descriptive error
function get_structure(id: string) {
  const structure = structure_map.get(id)
  if (!structure) throw new Error(`Structure ${id} not found`)
  return structure
}

const analyze = (id: string, symprec = 1e-4) =>
  analyze_structure_symmetry(get_structure(id), { symprec })

const analyze_crystal = (crystal: Crystal, symprec = 1e-4) =>
  analyze_structure_symmetry(crystal, { symprec })

// Shared primitive/non-conventional input cells reused across the orbit-mapping tests.
// Each returns a fresh Crystal so tests can't cross-contaminate via shared references.
// primitive FCC Cu: 1-atom input expands to a 4-atom conventional cell
const prim_fcc_cu = () =>
  make_crystal(fcc_primitive_matrix(3.61), [{ element: `Cu`, abc: [0, 0, 0] }])

// primitive diamond Si: 2-atom input expands to an 8-atom conventional cell
const prim_diamond_si = () =>
  make_crystal(fcc_primitive_matrix(5.43), [
    { element: `Si`, abc: [0, 0, 0] },
    { element: `Si`, abc: [0.25, 0.25, 0.25] },
  ])

const PO_A = 3.35 // 2x1x1 supercell of simple-cubic Po: 2-atom input reduces to a 1-atom std cell
const supercell_po = () =>
  make_crystal(
    [
      [2 * PO_A, 0, 0],
      [0, PO_A, 0],
      [0, 0, PO_A],
    ],
    [
      { element: `Po`, abc: [0, 0, 0] },
      { element: `Po`, abc: [0.5, 0, 0] },
    ],
  )

// Reference structures with textbook answers (ITA): space group, point group, Wyckoff rows.
const NACL_A = 5.64
const nacl = () =>
  make_crystal(NACL_A, [
    [`Na`, [0, 0, 0]],
    [`Na`, [0.5, 0.5, 0]],
    [`Na`, [0.5, 0, 0.5]],
    [`Na`, [0, 0.5, 0.5]],
    [`Cl`, [0.5, 0.5, 0.5]],
    [`Cl`, [0, 0, 0.5]],
    [`Cl`, [0, 0.5, 0]],
    [`Cl`, [0.5, 0, 0]],
  ])
const WZ_A = 3.25
const WZ_C = 5.2
const WZ_U = 0.375
const wurtzite_zno = () =>
  make_crystal(
    [
      [WZ_A, 0, 0],
      [-WZ_A / 2, (WZ_A * Math.sqrt(3)) / 2, 0],
      [0, 0, WZ_C],
    ],
    [
      [`Zn`, [1 / 3, 2 / 3, 0]],
      [`Zn`, [2 / 3, 1 / 3, 0.5]],
      [`O`, [1 / 3, 2 / 3, WZ_U]],
      [`O`, [2 / 3, 1 / 3, 0.5 + WZ_U]],
    ],
  )
const TRICLINIC_LATTICE: Matrix3x3 = [
  [5, 0, 0],
  [1, 6, 0],
  [0.5, 1.5, 7],
]
const triclinic_p1 = () =>
  make_crystal(TRICLINIC_LATTICE, [
    [`C`, [0.1, 0.2, 0.3]],
    [`N`, [0.4, 0.7, 0.15]],
    [`O`, [0.8, 0.35, 0.6]],
  ])
// C pair related by inversion through the origin, N on the 1a and O on the 1h center
const triclinic_p_1 = () =>
  make_crystal(TRICLINIC_LATTICE, [
    [`C`, [0.1, 0.2, 0.3]],
    [`C`, [0.9, 0.8, 0.7]],
    [`N`, [0, 0, 0]],
    [`O`, [0.5, 0.5, 0.5]],
  ])

describe(`reference structures`, () => {
  beforeAll(init_moyo_for_tests)

  test.each([
    {
      label: `NaCl rocksalt`,
      build: nacl,
      number: 225,
      hm_symbol: `F m -3 m`,
      point_group: `m-3m`,
      pearson: `cF8`,
      n_ops: 192,
      rows: [
        [`4a`, `Na`, `m-3m`, `0,0,0`, [0, 1, 2, 3]],
        [`4b`, `Cl`, `m-3m`, `1/2,1/2,1/2`, [4, 5, 6, 7]],
      ],
    },
    {
      label: `primitive diamond Si`,
      build: prim_diamond_si,
      number: 227,
      hm_symbol: `F d -3 m`,
      point_group: `m-3m`,
      pearson: `cF8`,
      n_ops: 48,
      rows: [[`8a`, `Si`, `-43m`, `1/8,1/8,1/8`, [0, 1]]],
    },
    {
      label: `wurtzite ZnO`,
      build: wurtzite_zno,
      number: 186,
      hm_symbol: `P 6_3 m c`,
      point_group: `6mm`,
      pearson: `hP4`,
      n_ops: 12,
      rows: [
        [`2b`, `Zn`, `3m.`, `1/3,2/3,z`, [0, 1]],
        [`2b`, `O`, `3m.`, `1/3,2/3,z`, [2, 3]],
      ],
    },
    {
      label: `triclinic P1`,
      build: triclinic_p1,
      number: 1,
      hm_symbol: `P 1`,
      point_group: `1`,
      pearson: `aP3`,
      n_ops: 1,
      rows: [
        [`1a`, `C`, `1`, `x,y,z`, [0]],
        [`1a`, `N`, `1`, `x,y,z`, [1]],
        [`1a`, `O`, `1`, `x,y,z`, [2]],
      ],
    },
    {
      label: `triclinic P-1`,
      build: triclinic_p_1,
      number: 2,
      hm_symbol: `P -1`,
      point_group: `-1`,
      pearson: `aP4`,
      n_ops: 2,
      rows: [
        [`1a`, `N`, `-1`, `0,0,0`, [2]],
        [`1h`, `O`, `-1`, `1/2,1/2,1/2`, [3]],
        [`2i`, `C`, `1`, `x,y,z`, [0, 1]],
      ],
    },
  ])(
    `$label: space group $number, point group $point_group, Wyckoff rows`,
    async ({ build, number, hm_symbol, point_group, pearson, n_ops, rows }) => {
      for (const symprec of [1e-5, 1e-4, 1e-2]) {
        const sym_data = await analyze_crystal(build(), symprec)
        expect(sym_data.symprec).toBe(symprec) // the tolerance really reaches moyo
        expect(sym_data.number).toBe(number)
        expect(sym_data.hm_symbol).toBe(hm_symbol)
        expect(space_group_type(sym_data.number).geometric_crystal_class).toBe(point_group)
        expect(sym_data.pearson_symbol).toBe(pearson)
        expect(sym_data.operations).toHaveLength(n_ops)
        const enriched = enrich_wyckoff_rows(
          wyckoff_positions_from_moyo(sym_data),
          spacegroup_wyckoff_positions(sym_data.hall_number),
        )
        expect(
          enriched.map((row) => [
            row.wyckoff,
            row.elem,
            row.site_symmetry,
            row.coordinates,
            row.site_indices,
          ]),
        ).toEqual(rows)
      }
    },
  )

  test(`symprec decides whether a 0.011 A displacement breaks the symmetry`, async () => {
    const crystal = nacl()
    crystal.sites[0].abc = [0.002, 0, 0] // one Na nudged along x: polar tetragonal P4mm
    expect((await analyze_crystal(crystal, 1e-4)).number).toBe(99)
    expect((await analyze_crystal(crystal, 1e-1)).number).toBe(225)
  })

  test(`merges split disordered sites and rejects unknown elements`, async () => {
    const disordered = make_crystal(5, [
      { element: `O`, abc: [0, 0, 0], occu: 0.5 },
      { element: `F`, abc: [0, 0, 0], occu: 0.5 },
      { element: `Li`, abc: [0.5, 0.5, 0.5], occu: 1 },
    ])
    const sym_data = await analyze_crystal(disordered)
    const { input_cell, orig_site_indices_by_input_idx } = sym_data
    // merge_split_partial_sites lists ungrouped sites first, then the merged O/F site, whose
    // 50/50 tie resolves by alphabetical element symbol: F (9) over O
    expect(input_cell.positions).toEqual([
      [0.5, 0.5, 0.5],
      [0, 0, 0],
    ])
    expect(input_cell.numbers).toEqual([3, 9])
    expect(orig_site_indices_by_input_idx).toEqual([[2], [0, 1]])
    expect(
      wyckoff_positions_from_moyo(sym_data).map((row) => [
        row.wyckoff,
        row.elem,
        row.site_indices,
      ]),
    ).toEqual([
      [`1a`, `F`, [0, 1]],
      [`1b`, `Li`, [2]],
    ])
    await expect(
      analyze_crystal(make_crystal(5, [{ element: `Xx`, abc: [0, 0, 0] }])),
    ).rejects.toThrow(`Unknown element at site 0: Xx`)
    await expect(analyze_structure_symmetry({ sites: [] }, {})).rejects.toThrow(
      /requires a periodic structure/,
    )
  })
})

describe(`moyo-wasm integration`, () => {
  beforeAll(init_moyo_for_tests)

  // Issue #139: Mg atoms were missing from Wyckoff table. Root cause: moyo's wyckoffs
  // array indexes the INPUT cell, not std_cell — fixed by grouping input sites by orbit.
  test.each([
    [`mp-1183085-Ac4Mg2-orthorhombic`, [`Ac`, `Mg`]],
    [`mp-1183089-Ac4Mg2-monoclinic`, [`Ac`, `Mg`]],
  ])(`%s Wyckoff table includes expected elements`, async (id, expected) => {
    const rows = wyckoff_positions_from_moyo(await analyze(id))
    expect(rows.map((pos) => pos.elem)).toEqual(expect.arrayContaining(expected))
    // every row must carry a proper "multiplicity + letter" label (no bogus letter-less
    // rows from misindexing the input-cell wyckoffs array with std_cell indices)
    for (const row of rows) expect(row.wyckoff).toMatch(/^\d+[a-z]+$/)
  })

  // moyo-wasm returns HM symbols with spaces (e.g. "F m -3 m", not "Fm-3m")
  test.each([
    [`Cu-FCC`, 225, `F m -3 m`, [`4aCu`]],
    [`Fe-BCC`, 229, `I m -3 m`, [`2aFe`]],
    [`Po-simple-cubic`, 221, `P m -3 m`, [`1aPo`]],
    [`mp-862690-Ac4-hexagonal`, 194, `P 6_3/m m c`, [`2aAc`, `2cAc`]],
    [`mp-1207297-Ac2Br2O1-tetragonal`, 123, `P 4/m m m`, [`1cO`, `2hAc`, `2hBr`]],
  ])(`%s has space group %i`, async (id, expected_sg, hm_symbol, rows) => {
    const sym_data = await analyze(id)
    expect(sym_data.number).toBe(expected_sg)
    expect(sym_data.hm_symbol).toBe(hm_symbol)
    expect(wyckoff_positions_from_moyo(sym_data).map((row) => row.wyckoff + row.elem)).toEqual(
      rows,
    )
  })

  test.each([
    [`mp-1`, 1],
    [`mp-2`, 1],
    [`mp-1234`, 2],
  ])(`%s has %i unique Wyckoff positions`, async (id, expected_count) => {
    expect(wyckoff_positions_from_moyo(await analyze(id))).toHaveLength(expected_count)
  })

  // Regression: moyo-wasm serializes operation.rotation as a flat 9-array in COLUMN-major
  // order (nalgebra). A row-major read applies Wᵀ instead of W, sending atoms off-site for
  // hexagonal/trigonal cells where W is not symmetric.
  test.each([`mp-862690-Ac4-hexagonal`, `mp-1183089-Ac4Mg2-monoclinic`])(
    `%s: every symmetry op maps each site onto a symmetry-equivalent site`,
    async (id) => {
      const structure = get_structure(id)
      const sym_data = await analyze(id) // throws if structure is not periodic
      expect(sym_data.operations.length).toBeGreaterThan(1)

      const frac_dist = (p1: Vec3, p2: Vec3) =>
        // minimum-image distance in frac coords
        Math.hypot(...p1.map((c1, idx) => c1 - p2[idx] - Math.round(c1 - p2[idx])))

      for (const site of structure.sites) {
        for (const image of apply_symmetry_operations(site.abc, sym_data.operations)) {
          const on_site = structure.sites.some(
            (other) =>
              other.species[0]?.element === site.species[0]?.element &&
              frac_dist(image, other.abc) < 1e-3,
          )
          expect(on_site, `${site.species[0]?.element} image ${image} off-site`).toBe(true)
        }
      }
    },
  )

  test(`highly oblique TlBiSe2 cell: 28-atom P1 cell, one 1a row per atom`, async () => {
    const sym_data = await analyze(`TlBiSe2-highly-oblique-cell`, 1e-3)
    expect([sym_data.number, sym_data.std_cell.numbers.length]).toEqual([1, 28])
    const rows = wyckoff_positions_from_moyo(sym_data)
    expect(rows).toHaveLength(28)
    expect(rows.every((row) => row.wyckoff === `1a` && row.site_indices.length === 1)).toBe(
      true,
    )
    expect(new Set(rows.map((row) => row.elem))).toEqual(new Set([`Tl`, `Bi`, `Se`]))
  })
})

// Test structures with non-conventional input cells. moyo's per-site arrays (wyckoffs,
// orbits, site_symmetry_symbols) index the INPUT cell while std_cell may have a
// different size/order — these tests pin the orbit-based Wyckoff row construction.
describe(`Wyckoff rows for non-conventional input cells`, () => {
  beforeAll(init_moyo_for_tests)

  test(`primitive FCC Cu (1 atom input, 4 atom std cell) → single 4a row`, async () => {
    const sym_data = await analyze_crystal(prim_fcc_cu())
    expect(sym_data.number).toBe(225)
    expect(sym_data.std_cell.positions).toHaveLength(4)

    // Regression: misindexing input-cell wyckoffs with std_cell indices produced one
    // "1a" row plus three bogus letter-less "1" rows
    const rows = wyckoff_positions_from_moyo(sym_data)
    expect(rows).toEqual([
      { wyckoff: `4a`, elem: `Cu`, abc: [0, 0, 0], site_indices: [0], site_symmetry: `m-3m` },
    ])
  })

  test(`primitive diamond Si (2 atom input, 8 atom std cell) → single 8a row`, async () => {
    const sym_data = await analyze_crystal(prim_diamond_si())
    expect(sym_data.number).toBe(227) // Fd-3m

    const rows = wyckoff_positions_from_moyo(sym_data)
    expect(rows).toHaveLength(1)
    expect(rows[0].wyckoff).toBe(`8a`)
    expect(rows[0].elem).toBe(`Si`)
    expect(rows[0].site_indices).toEqual([0, 1])
    expect(rows[0].site_symmetry).toBe(`-43m`)
    // representative coordinate must be wrapped to [0, 1) (moyo std positions can be
    // negative, e.g. -0.125 for diamond)
    for (const coord of rows[0].abc) {
      expect(coord).toBeGreaterThanOrEqual(0)
      expect(coord).toBeLessThan(1)
    }
  })

  test(`2x1x1 supercell of simple-cubic Po (2 atom input, 1 atom std cell) → single 1a row`, async () => {
    const sym_data = await analyze_crystal(supercell_po())
    expect(sym_data.number).toBe(221) // Pm-3m
    expect(sym_data.std_cell.positions).toHaveLength(1)

    const rows = wyckoff_positions_from_moyo(sym_data)
    expect(rows).toHaveLength(1)
    expect(rows[0].wyckoff).toBe(`1a`) // NOT 2a: multiplicity counts the conventional cell
    expect(rows[0].site_indices).toEqual([0, 1]) // both supercell copies map to the row
  })

  test(`NaCl conventional cell with Cl listed first → 4a Na and 4b Cl rows`, async () => {
    const cl_sites: Vec3[] = [
      [0.5, 0.5, 0.5],
      [0.5, 0, 0],
      [0, 0.5, 0],
      [0, 0, 0.5],
    ]
    const na_sites: Vec3[] = [
      [0, 0, 0],
      [0, 0.5, 0.5],
      [0.5, 0, 0.5],
      [0.5, 0.5, 0],
    ]
    const crystal = make_crystal(5.64, [
      ...cl_sites.map((abc) => ({ element: `Cl`, abc })),
      ...na_sites.map((abc) => ({ element: `Na`, abc })),
    ])
    const sym_data = await analyze_crystal(crystal)
    expect(sym_data.number).toBe(225)

    const rows = wyckoff_positions_from_moyo(sym_data)
    expect(rows).toHaveLength(2)
    const na_row = rows.find((row) => row.elem === `Na`)
    const cl_row = rows.find((row) => row.elem === `Cl`)
    expect(na_row?.wyckoff).toBe(`4a`)
    expect(cl_row?.wyckoff).toBe(`4b`)
    // site indices must track the input order (Cl occupies indices 0-3)
    expect(cl_row?.site_indices).toEqual([0, 1, 2, 3])
    expect(na_row?.site_indices).toEqual([4, 5, 6, 7])
  })

  test(`P1 cell with 3 inequivalent same-element sites → 3 separate 1a rows`, async () => {
    // Regression: grouping rows by letter+element merged distinct orbits that share a
    // Wyckoff letter into a single row with inflated multiplicity ("3a")
    const crystal = make_crystal(
      [
        [5, 0, 0],
        [0.3, 6, 0],
        [0.2, 0.4, 7],
      ],
      [
        { element: `Si`, abc: [0.1, 0.2, 0.3] },
        { element: `Si`, abc: [0.45, 0.05, 0.65] },
        { element: `Si`, abc: [0.8, 0.6, 0.15] },
      ],
    )
    const sym_data = await analyze_crystal(crystal)
    expect(sym_data.number).toBe(1)

    const rows = wyckoff_positions_from_moyo(sym_data)
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(row.wyckoff).toBe(`1a`)
    // each row maps to exactly one distinct original site
    const all_indices = rows.flatMap((row) => row.site_indices ?? [])
    expect(all_indices.toSorted((idx_a, idx_b) => idx_a - idx_b)).toEqual([0, 1, 2])
  })

  test.each([
    [`Cu-FCC`],
    [`Fe-BCC`],
    [`mp-862690-Ac4-hexagonal`],
    [`mp-1183089-Ac4Mg2-monoclinic`],
  ])(`%s: Wyckoff multiplicities sum to std cell atom count`, async (id) => {
    const sym_data = await analyze(id)
    const rows = wyckoff_positions_from_moyo(sym_data)
    const total_multiplicity = rows.reduce(
      (sum, row) => sum + Number(/^\d+/.exec(row.wyckoff)?.[0]),
      0,
    )
    expect(total_multiplicity).toBe(sym_data.std_cell.positions.length)
  })
})

describe(`map_wyckoff_to_all_atoms across display frames`, () => {
  beforeAll(init_moyo_for_tests)

  // Analyze `orig`, then re-express its Wyckoff rows onto the `displayed` cell (whatever
  // frame the viewer renders) and return the mapped rows.
  const map_rows = (orig: Crystal, displayed: Crystal, sym_data: SymmetryDataset) =>
    map_wyckoff_to_all_atoms(wyckoff_positions_from_moyo(sym_data), displayed, orig, sym_data)

  test(`conventional-cell display: all 4 FCC copies map to the 4a row`, async () => {
    const orig = prim_fcc_cu()
    const sym_data = await analyze_crystal(orig)
    const displayed = transform_cell(orig, `conventional`, sym_data)
    expect(displayed.sites).toHaveLength(4)

    const rows = map_rows(orig, displayed, sym_data)
    expect(rows).toHaveLength(1)
    expect(rows[0].site_indices).toEqual([0, 1, 2, 3])
  })

  test(`primitive-cell display maps correctly`, async () => {
    const orig = prim_fcc_cu()
    const sym_data = await analyze_crystal(orig)
    const displayed = transform_cell(orig, `primitive`, sym_data)
    expect(displayed.sites).toHaveLength(1)

    expect(map_rows(orig, displayed, sym_data)[0].site_indices).toEqual([0])
  })

  test(`conventional display of primitive diamond: origin shift forces conv-frame matching`, async () => {
    // diamond's std_origin_shift is (1/8,1/8,1/8), so the original-frame lattice match
    // is rejected (positions mismatch) and matching must run in the conventional frame,
    // where the F-centering copies are only reachable via the input-lattice translation
    // check (P·d ∈ ℤ³) — all 8 conventional-cell atoms must map to the single 8a row
    const orig = prim_diamond_si()
    const sym_data = await analyze_crystal(orig)
    const displayed = transform_cell(orig, `conventional`, sym_data)
    expect(displayed.sites).toHaveLength(8)

    const rows = map_rows(orig, displayed, sym_data)
    expect(rows).toHaveLength(1)
    expect(rows[0].site_indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  test(`supercell display: both copies of the original site are matched`, async () => {
    const orig = make_crystal(PO_A, [{ element: `Po`, abc: [0, 0, 0] }])
    const sym_data = await analyze_crystal(orig)
    // displayed = 2x1x1 supercell of the original 1-atom Po cell (both copies must match)
    const rows = map_rows(orig, supercell_po(), sym_data)
    expect(rows[0].site_indices).toEqual([0, 1])
  })
})

// Cross-validate the hand-rolled space group tables against moyo's authoritative data
describe(`space group tables vs moyo`, () => {
  beforeAll(init_moyo_for_tests)

  test(`crystal system, lattice system + HM symbols for all 230 space groups`, () => {
    for (let num = 1; num <= 230; num++) {
      const sg_type = space_group_type(num)
      expect(spacegroup_to_crystal_sys(num), `crystal system of ${num}`).toBe(
        sg_type.crystal_system.toLowerCase(),
      )
      expect(spacegroup_to_lattice_system(num), `lattice system of ${num}`).toBe(
        sg_type.lattice_system.toLowerCase(),
      )
      // condensed short Hermann-Mauguin symbol must round-trip through the symbol table
      const condensed_hm = sg_type.hm_short.replaceAll(/\s+/g, ``)
      expect(SPACEGROUP_SYMBOL_TO_NUM[condensed_hm], `symbol ${condensed_hm} → number`).toBe(
        num,
      )
    }
  })
})

// The WASM lookups take integer ids and panic (not throw) on anything else, which a malformed
// `sym_data` prop would trigger inside SymmetryStats' $derived; out-of-range ids return []
describe(`space-group database lookups validate their ids`, () => {
  beforeAll(init_moyo_for_tests)

  test.each([
    [`spacegroup_wyckoff_positions`, spacegroup_wyckoff_positions, 1, 530],
    [`spacegroup_settings`, spacegroup_settings, 1, 230],
  ] as const)(`%s returns rows for %i..%i and [] otherwise`, (_name, lookup, min, max) => {
    for (const valid of [min, max, Math.floor((min + max) / 2)]) {
      expect(lookup(valid).length, `id ${valid}`).toBeGreaterThan(0)
    }
    for (const invalid of [0, -1, min - 1, max + 1, 1.5, NaN, Infinity, -Infinity]) {
      expect(lookup(invalid), `id ${invalid}`).toEqual([])
    }
  })
})
