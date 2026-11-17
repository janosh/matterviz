import type { Matrix3x3, Vec3 } from '#lib/math.js'
import * as math from '#lib/math.js'
import type { Crystal, StructureBond } from '#lib/structure/index.js'
import {
  diagonal_scaling,
  generate_lattice_points,
  is_valid_supercell_input,
  make_supercell,
  parse_supercell_matrix,
  parse_supercell_scaling,
  supercell_grid_edges,
  supercell_translations,
} from '#lib/structure/supercell.js'
import { describe, expect, test } from 'vite-plus/test'
import { make_crystal } from '../test-fixtures'
import { max_abs_error } from '../numeric-helpers'

const sample_structure = make_crystal(
  4,
  [
    [`Ba`, [0, 0, 0], 2],
    [`Ti`, [0.5, 0.5, 0.5], 4],
  ],
  { charge: 0 },
)

describe(`parse_supercell_scaling and parse_supercell_matrix`, () => {
  // oxfmt-ignore
  test.each([
    [`2x2x2`, [2, 2, 2]],
    [`3×1×2`, [3, 1, 2]],
    [`1x1x1`, [1, 1, 1]],
    [`2, 3, 1`, [2, 3, 1]],
    [`2 3 1`, [2, 3, 1]],
    [` 2 x 3 x 1 `, [2, 3, 1]],
    [`5`, [5, 5, 5]],
    [2, [2, 2, 2]],
    [[2, 2, 2], [2, 2, 2]],
    [[3, 1, 2], [3, 1, 2]],
  ] as [string | number | Vec3, Vec3][])(`parses %s to %s`, (input, [scale_a, scale_b, scale_c]) => {
    expect(parse_supercell_scaling(input)).toEqual([scale_a, scale_b, scale_c])
    // oxfmt-ignore
    expect(parse_supercell_matrix(input)).toEqual([[scale_a, 0, 0], [0, scale_b, 0], [0, 0, scale_c]])
  })

  // every string row fails the strict /^\d+$/ digit check or the part count (`3x` is
  // half-typed, not a lone 3; `1e3` is no digit string), as do non-integer numbers
  // oxfmt-ignore
  test.each([
    `2x2`, `3x`, `2x2x2x`, `x2x2x2`, `2,,2`, `axbxc`, `0x1x1`, `-1x2x3`, `2.5x1x1`, `1e3`, ``,
    0, 1.5, [1, 2], [0, 1, 2], [1.5, 2, 3],
  ] as (string | number | Vec3)[])(`throws error for invalid input %s`, (input) => {
    expect(() => parse_supercell_scaling(input)).toThrow(/supercell scaling/i)
    expect(() => parse_supercell_matrix(input)).toThrow(/supercell scaling/i)
    if (typeof input === `string`) expect(is_valid_supercell_input(input)).toBe(false)
  })

  // oxfmt-ignore
  test.each([
    [`1 1 0, -1 1 0, 0 0 1`, [[1, 1, 0], [-1, 1, 0], [0, 0, 1]]],
    [`1 1 0; -1 1 0; 0 0 1`, [[1, 1, 0], [-1, 1, 0], [0, 0, 1]]],
    [`0 1 0 1 0 0 0 0 1`, [[0, 1, 0], [1, 0, 0], [0, 0, 1]]], // det -1 is a valid relabeling
    [[[2, 1, 0], [0, 1, 0], [0, 0, 1]], [[2, 1, 0], [0, 1, 0], [0, 0, 1]]],
  ] as [string | Matrix3x3, Matrix3x3][])(`parses matrix %j`, (input, expected) => {
    expect(parse_supercell_matrix(input)).toEqual(expected)
    if (typeof input === `string`) expect(is_valid_supercell_input(input)).toBe(true)
  })

  // oxfmt-ignore
  test.each([
    [`1 1 0, 1 1 0, 0 0 1`, `singular`],
    [[[1, 1, 0], [2, 2, 0], [0, 0, 1]], `singular`],
    [[[1.5, 0, 0], [0, 1, 0], [0, 0, 1]], `must be integers`],
    [`1 1 0, -1 1.5 0, 0 0 1`, `Invalid supercell matrix`],
    [`1 1 0, -1 1 0, 0 0`, `Invalid supercell scaling`], // 8 numbers is no matrix
  ] as [string | Matrix3x3, string][])(`rejects %j (%s)`, (input, message) => {
    expect(() => parse_supercell_matrix(input)).toThrow(message)
    expect(is_valid_supercell_input(JSON.stringify(input))).toBe(false)
  })

  // oxfmt-ignore
  test.each([
    [[[2, 0, 0], [0, 1, 0], [0, 0, 3]], [2, 1, 3]],
    [[[1, 1, 0], [-1, 1, 0], [0, 0, 1]], null],
    [[[-1, 0, 0], [0, 1, 0], [0, 0, 1]], null],
  ] as [Matrix3x3, Vec3 | null][])(`diagonal_scaling(%j) = %j`, (matrix, expected) => {
    expect(diagonal_scaling(matrix)).toEqual(expected)
    if (!expected) expect(() => parse_supercell_scaling(matrix)).toThrow(`must be diagonal`)
  })
})

describe(`generate_lattice_points`, () => {
  // oxfmt-ignore
  test.each([
    [[1, 1, 1], [[0, 0, 0]]],
    [[2, 1, 1], [[0, 0, 0], [1, 0, 0]]],
    [[2, 2, 1], [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]]],
    [
      [2, 2, 2],
      [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]],
    ],
  ])(`generates correct lattice points for %s`, (scaling, expected) => {
    expect(generate_lattice_points(scaling as Vec3)).toEqual(expected)
  })
})

describe(`supercell_grid_edges`, () => {
  // Every unique grid edge exactly once, minus the origin cell's own 12
  const expected_count = ([n_a, n_b, n_c]: Vec3) =>
    n_a * (n_b + 1) * (n_c + 1) +
    n_b * (n_a + 1) * (n_c + 1) +
    n_c * (n_a + 1) * (n_b + 1) -
    12

  test.each([[[1, 1, 1]], [[2, 2, 2]], [[3, 1, 2]], [[4, 4, 4]]])(
    `%s covers every grid edge once, skipping the origin cell`,
    (tiling) => {
      const edges = supercell_grid_edges(tiling as Vec3)
      expect(edges).toHaveLength(expected_count(tiling as Vec3))
      // no duplicates, every edge one cell long and inside the block
      const keys = new Set(edges.map(([start, axis]) => `${start.join(`,`)}|${axis}`))
      expect(keys.size).toBe(edges.length)
      for (const [start, axis, span] of edges) {
        expect(span).toBe(1)
        expect(start[axis] + span).toBeLessThanOrEqual(tiling[axis])
        for (const [idx, index] of start.entries()) {
          expect(index).toBeGreaterThanOrEqual(0)
          expect(index).toBeLessThanOrEqual(tiling[idx])
        }
      }
      // the 12 origin-cell edges are the caller's to draw, so none may appear here
      const origin_edges = edges.filter(
        ([start, axis]) => start[axis] === 0 && start.every((index) => index <= 1),
      )
      expect(origin_edges).toEqual([])
    },
  )

  // oxfmt-ignore
  test.each<[Vec3, number[]]>([
    [[3, 4, 5], [4, 4, 4]],
    [[3, 1, 1], [4, 2, 2]],
    [[1, 3, 4], [3, 4, 4]],
  ])(`draws only the %s block outline past max_edges`, (counts, per_axis) => {
    const edges = supercell_grid_edges(counts, 10)
    expect(edges).toHaveLength(per_axis.reduce((sum, count) => sum + count, 0))
    for (const axis of [0, 1, 2]) {
      const [side_1, side_2] = [0, 1, 2].filter((idx) => idx !== axis)
      const along = edges.filter(([, edge_axis]) => edge_axis === axis)
      expect(along, `edges along ${axis}`).toHaveLength(per_axis[axis])
      for (const [start, , span] of along) {
        // rooted on a corner of the face spanned by the other two axes
        for (const side of [side_1, side_2]) {
          expect([0, counts[side]]).toContain(start[side])
        }
        // No overlap with the separately drawn origin cell, even when a side has one tile.
        const yields_origin_cell = start[side_1] <= 1 && start[side_2] <= 1
        expect(start[axis]).toBe(yields_origin_cell ? 1 : 0)
        expect(start[axis] + span).toBe(counts[axis])
        expect(span).toBeGreaterThan(0)
      }
    }
    // no edge is drawn twice
    const keys = new Set(
      edges.map(([start, axis, span]) => `${start.join(`,`)}|${axis}|${span}`),
    )
    expect(keys.size).toBe(edges.length)
  })

  test(`clamps non-positive and fractional tiling factors to whole cells`, () => {
    expect(supercell_grid_edges([0, 0, 0])).toEqual([])
    expect(supercell_grid_edges([2.7, 1, 1])).toEqual(supercell_grid_edges([2, 1, 1]))
  })
})

// Cartesian length of every explicit bond, reading cell_shift in supercell-lattice vectors
const bond_lengths_of = (cell: Crystal): number[] => {
  const to_cart = math.create_frac_to_cart(cell.lattice.matrix)
  return (cell.properties?.bonds ?? []).map(({ site_idx_1, site_idx_2, cell_shift }) => {
    const end = math.add<Vec3>(cell.sites[site_idx_2].abc, cell_shift ?? [0, 0, 0])
    return math.euclidean_dist(to_cart(cell.sites[site_idx_1].abc), to_cart(end))
  })
}

describe(`make_supercell`, () => {
  test.each([
    [[1, 1, 1], 2, 64.0, [4.0, 4.0, 4.0]], // identity scaling
    [[2, 2, 2], 16, 512.0, [8.0, 8.0, 8.0]],
    [[3, 1, 2], 12, 384.0, [12.0, 4.0, 8.0]],
    [[5, 1, 1], 10, 320.0, [20.0, 4.0, 4.0]],
  ])(
    `creates supercell with scaling %s`,
    (scaling, expected_sites, expected_volume, expected_lattice) => {
      const input = structuredClone(sample_structure)
      const supercell = make_supercell(input, scaling as string | number | Vec3)
      expect(input).toEqual(sample_structure) // the input is left untouched
      expect(supercell.sites).toHaveLength(expected_sites)
      const { a: len_a, b: len_b, c: len_c, volume } = supercell.lattice
      expect([len_a, len_b, len_c, volume]).toEqual([...expected_lattice, expected_volume])
    },
  )

  test(`preserves site properties and updates labels`, () => {
    const source = structuredClone(sample_structure)
    for (const site of source.sites)
      site.properties = {
        orig_site_idx: 7,
        orig_unit_cell_idx: 9,
        completion_image: true,
        force: [0.1, 0.2, 0.3],
      }
    const supercell = structuredClone(make_supercell(source, [2, 1, 1]))
    for (const [idx, site] of supercell.sites.entries()) {
      expect(site.properties).toEqual(source.sites[idx % source.sites.length].properties)
      expect(site.provenance).toEqual({ unit_cell_idx: idx % source.sites.length })
    }

    const elements = supercell.sites.map((site) => site.species[0].element)
    for (const element of [`Ba`, `Ti`])
      expect(elements.filter((elem) => elem === element)).toHaveLength(2)
    const labels = supercell.sites.map((site) => site.label)
    expect(labels).toEqual(expect.arrayContaining([`Ba0_000`, `Ti1_100`]))
  })

  // a periodic bond crossing into the next copy reconnects it in-cell and wraps the last one
  // oxfmt-ignore
  test.each([
    [`within each generated cell`, [{ site_idx_1: 0, site_idx_2: 1, order: 2 }],
      [{ site_idx_1: 0, site_idx_2: 1, order: 2 }, { site_idx_1: 2, site_idx_2: 3, order: 2 }]],
    [`across supercell boundaries`, [{ site_idx_1: 0, site_idx_2: 1, order: 2, cell_shift: [1, 0, 0] }],
      [{ site_idx_1: 0, site_idx_2: 3, order: 2 }, { site_idx_1: 1, site_idx_2: 2, order: 2, cell_shift: [-1, 0, 0] }]],
    // out-of-range entries the unit cell ignores must not be offset onto the next cell's atoms
    [`skipping entries the unit cell rejects`, [{ site_idx_1: 0, site_idx_2: 1, order: 2 }, { site_idx_1: 0, site_idx_2: 2, order: 1 }, { site_idx_1: -1, site_idx_2: 1, order: 1 }],
      [{ site_idx_1: 0, site_idx_2: 1, order: 2 }, { site_idx_1: 2, site_idx_2: 3, order: 2 }]],
  ] as [string, StructureBond[], StructureBond[]][])(
    `replicates explicit bond metadata %s`,
    (_desc, bonds, expected) => {
      const supercell = make_supercell(
        { ...sample_structure, properties: { bonds } },
        [2, 1, 1],
      )
      expect(supercell.properties?.bonds).toEqual(expected)
    },
  )

  // Folding an out-of-cell atom (O, outside along every axis) back in must not move it a
  // supercell vector away from its bond partner, through either the diagonal or matrix path
  // oxfmt-ignore
  test.each([
    [true, [2, 1, 1]],
    [false, [2, 1, 1]],
    [true, [2, 3, 2]],
    [true, [[1, 1, 0], [-1, 1, 0], [0, 0, 1]]],
    [false, [[2, 1, 0], [0, 1, 1], [1, 0, 1]]],
  ] as [boolean, Vec3 | Matrix3x3][])(
    `keeps explicit bond lengths (to_unit_cell=%s, scaling=%j)`,
    (to_unit_cell, scaling) => {
      const base: Crystal = {
        ...make_crystal(4, [
          { element: `O`, abc: [-0.05, -0.1, 1.05] },
          { element: `H`, abc: [0.15, 0.1, 0.9] },
        ]),
        properties: {
          bonds: [
            { site_idx_1: 0, site_idx_2: 1, order: 1 },
            { site_idx_1: 1, site_idx_2: 0, order: 2, cell_shift: [1, 0, 0] },
            { site_idx_1: 0, site_idx_2: 0, order: 1, cell_shift: [0, 1, 1] },
          ],
        },
      }
      const base_lengths = bond_lengths_of(base)
      // |(0.2, 0.2, -0.15)| * 4 Å
      expect(base_lengths[0]).toBeCloseTo(4 * Math.hypot(0.2, 0.2, 0.15), 12)
      const lengths = bond_lengths_of(make_supercell(base, scaling, to_unit_cell))
      const n_copies = Math.abs(math.det_3x3(parse_supercell_matrix(scaling)))
      expect(lengths).toHaveLength(n_copies * base_lengths.length)
      const expected = lengths.map((_, idx) => base_lengths[idx % base_lengths.length])
      expect(max_abs_error(lengths, expected)).toBeLessThan(5e-13)
    },
  )

  // the vacuum axis stays unwrapped, and a matrix may not mix it into the periodic ones
  // oxfmt-ignore
  test.each([
    [[2, 2, 1], 4],
    [[[1, 1, 0], [-1, 1, 0], [0, 0, 1]], 2],
  ] as [Vec3 | Matrix3x3, number][])(`leaves aperiodic axes unwrapped (%j)`, (scaling, n_copies) => {
    const slab = make_crystal(4, [{ element: `Si`, abc: [0.25, 0.25, -0.25] }], {
      pbc: [true, true, false],
    })
    const cell = make_supercell(slab, scaling)
    expect(cell.sites.map(({ abc, xyz }) => [abc[2], xyz[2]])).toEqual(
      Array.from({ length: n_copies }, () => [-0.25, -1]),
    )
    expect(() => make_supercell(slab, [[1, 0, 1], [0, 1, 0], [0, 0, 1]])).toThrow(
      `mixes non-periodic axis c with the others`,
    )
  })

  // oxfmt-ignore
  test.each([
    [`100x100x100`, `2,000,000 sites (limit 1,000,000)`],
    [[[1000, 0, 1], [0, 1000, 0], [0, 0, 2]], `4,000,000 sites (limit 1,000,000)`],
    [`50x100x100`, null], // right at the cap
  ] as [string | Matrix3x3, string | null][])(`site cap on supercell %j: %s`, (scaling, message) => {
    const two_sites = make_crystal(1, [[`H`, [0, 0, 0]], [`H`, [0.5, 0.5, 0.5]]])
    if (message) expect(() => make_supercell(two_sites, scaling)).toThrow(message)
    else expect(make_supercell(two_sites, scaling).sites).toHaveLength(1_000_000)
  })

  // `_${ii}${jj}${kk}` stops being injective once an index reaches two digits: in a
  // [12,12,2] supercell (1,10,0) and (11,0,0) both render as "_1100"
  test.each([
    [[2, 2, 2], `_100`],
    [[10, 1, 1], `_100`],
    [[12, 12, 2], `_1_0_0`],
    [[11, 1, 1], `_1_0_0`],
  ] as [[number, number, number], string][])(
    `%s supercell labels stay unique`,
    (scaling, second_suffix) => {
      const base = make_crystal(2, [{ element: `H`, abc: [0, 0, 0] }])
      const cell = make_supercell(base, scaling)
      const labels = cell.sites.map((site) => site.label)
      expect(new Set(labels).size).toBe(labels.length)
      expect(labels[1]).toBe(`${base.sites[0].label}${second_suffix}`)
    },
  )
})

describe(`make_supercell with a matrix`, () => {
  // hand-checked: a √2 x √2 rotated cell of simple cubic holds the corner atom and its copy
  // one cubic b away, at (0, 1, 0) · M^-1 = (0.5, 0.5, 0) (pymatgen agrees)
  test(`√2 x √2 rotated cell of simple cubic`, () => {
    const cubic = make_crystal(4, [{ element: `Fe`, abc: [0, 0, 0] }])
    // oxfmt-ignore
    const cell = make_supercell(cubic, [[1, 1, 0], [-1, 1, 0], [0, 0, 1]])
    // oxfmt-ignore
    expect(cell.lattice.matrix).toEqual([[4, 4, 0], [-4, 4, 0], [0, 0, 4]])
    expect(cell.lattice.volume).toBeCloseTo(2 * 64, 12)
    // oxfmt-ignore
    expect(cell.sites.map(({ abc, xyz, label, provenance }) => [abc, xyz, label, provenance])).toEqual([
      [[0, 0, 0], [0, 0, 0], `Fe0_0`, { unit_cell_idx: 0 }],
      [[0.5, 0.5, 0], [0, 4, 0], `Fe0_1`, { unit_cell_idx: 0 }],
    ])
  })

  // supercell_translations gives |det| lattice translations inside the new cell. Every copy is
  // its source shifted by a whole OLD lattice vector, no two copies of a site coincide modulo
  // the new cell, abc (in [0, 1) even for sources outside the cell) and xyz agree, and the
  // cell holds |det| x the sites, volume and charge. The diagonal row runs the diagonal path,
  // and the oblique L != L^T lattice catches frac <-> cart convention bugs.
  // oxfmt-ignore
  test.each([
    [[[1, 1, 0], [-1, 1, 0], [0, 0, 1]]],
    [[[-1, 1, 1], [1, -1, 1], [1, 1, -1]]],
    [[[3, 1, -2], [0, 2, 1], [1, 0, 1]]],
    [[[0, 1, 0], [1, 0, 0], [0, 0, 1]]],
    [[[2, 0, 0], [0, 3, 0], [0, 0, 1]]],
  ] as [Matrix3x3][])(`%j copies each site |det| times, once per translation`, (matrix) => {
    const expected_det = Math.round(math.det_3x3(matrix))
    const n_copies = Math.abs(expected_det)
    const { translations, det } = supercell_translations(matrix)
    expect([translations.length, det]).toEqual([n_copies, expected_det])
    // row vectors: t · M^-1 in [0, 1)^3
    const to_new_frac_rows = math.transpose_3x3(math.inverse_3x3(matrix))
    for (const translation of translations)
      for (const coord of math.dot(to_new_frac_rows, translation)) {
        expect(coord).toBeGreaterThanOrEqual(-1e-12)
        expect(coord).toBeLessThan(1 - 1e-12)
      }
    const oblique: Matrix3x3 = [[4.1, 0.2, -0.3], [0.5, 3.7, 0.1], [-0.4, 0.6, 5.2]]
    const base = make_crystal(oblique, [
      { element: `Si`, abc: [0.1, 0.2, 0.3] },
      { element: `O`, abc: [-0.15, 0.8, 1.2] }, // outside the cell along a and c
      { element: `O`, abc: [0.5, 0.5, 0.99] },
      { element: `H`, abc: [2.75, 1.0, -0.05] }, // a whole cell out, on a face, just below 0
    ], { charge: 1 })
    const cell = make_supercell(base, matrix)
    expect(cell.sites).toHaveLength(n_copies * base.sites.length)
    expect(cell.charge).toBe(n_copies)
    expect(cell.lattice.matrix).toEqual(math.dot(matrix, oblique))
    expect(cell.lattice.volume).toBeCloseTo(n_copies * base.lattice.volume, 8)
    const to_old_frac = math.create_cart_to_frac(oblique)
    const to_new_cart = math.create_frac_to_cart(cell.lattice.matrix)
    const to_new_frac = math.create_cart_to_frac(cell.lattice.matrix)
    for (const [site_idx, source] of base.sites.entries()) {
      const copies = cell.sites.filter(({ provenance }) => provenance?.unit_cell_idx === site_idx)
      expect(copies).toHaveLength(n_copies)
      for (const copy of copies) {
        const shift = to_old_frac(math.subtract(copy.xyz, source.xyz))
        expect(max_abs_error(shift, shift.map(Math.round))).toBeLessThan(1e-12)
        expect(max_abs_error(to_new_cart(copy.abc), copy.xyz)).toBeLessThan(1e-12)
        for (const coord of copy.abc) {
          expect(coord).toBeGreaterThanOrEqual(0)
          expect(coord).toBeLessThan(1)
        }
      }
      // distinct modulo the supercell: no two copies one new lattice vector apart
      for (const [idx, copy] of copies.entries())
        for (const other of copies.slice(idx + 1)) {
          const delta = to_new_frac(math.subtract(copy.xyz, other.xyz))
          expect(delta.some((coord) => Math.abs(coord - Math.round(coord)) > 1e-6)).toBe(true)
        }
    }
  })
})
