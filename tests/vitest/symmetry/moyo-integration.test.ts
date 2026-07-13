// Integration tests for moyo-wasm symmetry analysis
// Uses real WASM binary to verify symmetry detection behavior
// Note: Most symmetry tests use mocks (see index.test.ts)

import type { Vec3 } from '$lib/math'
import type { Crystal } from '$lib'
import {
  analyze_structure_symmetry,
  apply_symmetry_operations,
  get_conventional_cell,
  get_primitive_cell,
  map_wyckoff_to_all_atoms,
  SPACEGROUP_SYMBOL_TO_NUM,
  spacegroup_num_to_crystal_sys,
  spacegroup_num_to_lattice_system,
  wyckoff_multiplicity,
  wyckoff_positions_from_moyo,
} from '$lib/symmetry'
import { structure_map } from '$site/structures'
import type { MoyoDataset } from '@spglib/moyo-wasm'
import { space_group_type } from '@spglib/moyo-wasm'
import { beforeAll, describe, expect, test } from 'vitest'
import { init_moyo_for_tests, make_crystal } from '../setup'

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
const FCC_A = 3.61 // primitive FCC Cu: 1-atom input expands to a 4-atom conventional cell
const prim_fcc_cu = () =>
  make_crystal(
    [
      [0, FCC_A / 2, FCC_A / 2],
      [FCC_A / 2, 0, FCC_A / 2],
      [FCC_A / 2, FCC_A / 2, 0],
    ],
    [{ element: `Cu`, abc: [0, 0, 0] }],
  )

const SI_A = 5.43 // primitive diamond Si: 2-atom input expands to an 8-atom conventional cell
const prim_diamond_si = () =>
  make_crystal(
    [
      [0, SI_A / 2, SI_A / 2],
      [SI_A / 2, 0, SI_A / 2],
      [SI_A / 2, SI_A / 2, 0],
    ],
    [
      { element: `Si`, abc: [0, 0, 0] },
      { element: `Si`, abc: [0.25, 0.25, 0.25] },
    ],
  )

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

  // Note: moyo-wasm returns HM symbols with spaces (e.g. "F m -3 m" not "Fm-3m")
  test.each([
    [`Cu-FCC`, 225],
    [`Fe-BCC`, 229],
    [`Po-simple-cubic`, 221],
    [`mp-862690-Ac4-hexagonal`, 194],
    [`mp-1207297-Ac2Br2O1-tetragonal`, 123],
  ])(`%s has space group %i`, async (id, expected_sg) => {
    const sym_data = await analyze(id)
    expect(sym_data.number).toBe(expected_sg)
    expect(sym_data.hm_symbol).toBeDefined()
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

  test(`highly oblique TlBiSe2 cell is handled correctly`, async () => {
    const sym_data = await analyze(`TlBiSe2-highly-oblique-cell`, 1e-3)

    expect(sym_data.number).toBeGreaterThan(0)
    expect(sym_data.std_cell.numbers.length).toBeGreaterThan(0)

    const elements = wyckoff_positions_from_moyo(sym_data).map((pos) => pos.elem)
    expect(elements).toEqual(expect.arrayContaining([`Tl`, `Bi`, `Se`]))
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
    expect(all_indices.sort((idx_a, idx_b) => idx_a - idx_b)).toEqual([0, 1, 2])
  })

  test(`std→orig site mapping uses the std_linear transform (primitive NaCl input)`, async () => {
    // Primitive rocksalt cell: std (conventional) frame differs from the input frame, so
    // raw fractional-coordinate matching across cells would be meaningless
    const a_nacl = 5.64
    const crystal = make_crystal(
      [
        [0, a_nacl / 2, a_nacl / 2],
        [a_nacl / 2, 0, a_nacl / 2],
        [a_nacl / 2, a_nacl / 2, 0],
      ],
      [
        { element: `Na`, abc: [0, 0, 0] },
        { element: `Cl`, abc: [0.5, 0.5, 0.5] },
      ],
    )
    const sym_data = await analyze_crystal(crystal)
    expect(sym_data.number).toBe(225)
    expect(sym_data.std_cell.positions).toHaveLength(8)

    const na_number = 11
    sym_data.std_cell.numbers.forEach((num, std_idx) => {
      const expected_orig_idx = num === na_number ? 0 : 1
      expect(sym_data.orig_site_indices_by_std_idx?.[std_idx], `std site ${std_idx}`).toEqual([
        expected_orig_idx,
      ])
    })
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
      (sum, row) => sum + wyckoff_multiplicity(row.wyckoff),
      0,
    )
    expect(total_multiplicity).toBe(sym_data.std_cell.positions.length)
  })
})

describe(`map_wyckoff_to_all_atoms across display frames`, () => {
  beforeAll(init_moyo_for_tests)

  // Analyze `orig`, then re-express its Wyckoff rows onto the `displayed` cell (whatever
  // frame the viewer renders) and return the mapped rows.
  const map_rows = (orig: Crystal, displayed: Crystal, sym_data: MoyoDataset) =>
    map_wyckoff_to_all_atoms(wyckoff_positions_from_moyo(sym_data), displayed, orig, sym_data)

  test(`conventional-cell display: all 4 FCC copies map to the 4a row`, async () => {
    const orig = prim_fcc_cu()
    const sym_data = await analyze_crystal(orig)
    const displayed = get_conventional_cell(orig, sym_data)
    expect(displayed.sites).toHaveLength(4)

    const rows = map_rows(orig, displayed, sym_data)
    expect(rows).toHaveLength(1)
    expect(rows[0].site_indices).toEqual([0, 1, 2, 3])
  })

  test(`primitive-cell display maps correctly`, async () => {
    const orig = prim_fcc_cu()
    const sym_data = await analyze_crystal(orig)
    const displayed = get_primitive_cell(orig, sym_data)
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
    const displayed = get_conventional_cell(orig, sym_data)
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
      expect(spacegroup_num_to_crystal_sys(num), `crystal system of ${num}`).toBe(
        sg_type.crystal_system.toLowerCase(),
      )
      expect(spacegroup_num_to_lattice_system(num), `lattice system of ${num}`).toBe(
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
