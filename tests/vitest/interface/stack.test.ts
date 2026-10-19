import {
  match_lattices,
  match_of_matrices,
  surface_frame,
} from '#lib/interface/lattice-match.js'
import { in_plane_supercell, make_interface } from '#lib/interface/stack.js'
import type { Heterostructure, Matrix2x2 } from '#lib/interface/types.js'
import type { Matrix3x3, Vec2, Vec3 } from '#lib/math.js'
import * as math from '#lib/math.js'
import { make_slab } from '#lib/slab/make-slab.js'
import type { Crystal } from '#lib/structure/index.js'
import { describe, expect, test } from 'vitest'
import { FCC_FACE_CENTRES, fcc_cell, make_crystal, make_rocksalt } from '../test-fixtures'

// reoriented slabs: a ∥ x, surface normal ∥ z
const slab = (crystal: Crystal, hkl: Vec3, min_slab_thickness = 6) =>
  make_slab(crystal, hkl, { min_slab_thickness, min_vacuum_thickness: 10 })
const CU_111 = slab(fcc_cell(3.615), [1, 1, 1])
const CU_100 = slab(fcc_cell(3.615), [1, 0, 0])
const AG_100 = slab(fcc_cell(4.086, `Ag`), [1, 0, 0])
const D_111 = 3.615 / Math.sqrt(3)

const counts = (crystal: Crystal): Record<string, number> =>
  Object.fromEntries(
    Object.entries(Object.groupBy(crystal.sites, ({ species }) => species[0].element)).map(
      ([elem, group]) => [elem, group?.length ?? 0],
    ),
  )
const in_plane_area = ({ lattice: { matrix } }: Crystal): number =>
  Math.hypot(...math.cross_3d(matrix[0], matrix[1]))
// distance from the nearest integer: 0 for a coordinate that is a lattice translation
const off_lattice = (frac: number): number => Math.abs(frac - Math.round(frac))
// fractional coordinates of the in-plane projection (x, y) of each site in the in-plane basis
// of `cell`; valid for reoriented slabs, whose surface is the xy plane
const projected_coords = (cell: Crystal): Vec2[] => {
  const [[a_x, a_y], [b_x, b_y]] = cell.lattice.matrix
  const det = a_x * b_y - a_y * b_x
  return cell.sites.map(({ xyz: [pos_x, pos_y] }) => [
    (pos_x * b_y - pos_y * b_x) / det,
    (pos_y * a_x - pos_x * a_y) / det,
  ])
}
// The film keeps the fractional in-plane coordinates it has in `film_cell`, now on the
// interface cell: that is the strain (and twist) of the match
const expect_film_registry = (built: Heterostructure, film_cell: Crystal): void => {
  const offset = built.interface_info.n_substrate_sites
  for (const [idx, [frac_a, frac_b]] of projected_coords(film_cell).entries()) {
    const [out_a, out_b] = built.sites[offset + idx].abc
    expect(Math.max(off_lattice(out_a - frac_a), off_lattice(out_b - frac_b))).toBeLessThan(
      1e-9,
    )
  }
}

// The slabs above are built from shared fixture constants: make_crystal hands back fresh
// arrays, and the shared fcc positions refuse mutation outright instead of leaking it
test(`make_crystal shares no arrays with its inputs and FCC_FACE_CENTRES is frozen`, () => {
  const abc: Vec3 = [0.25, 0.25, 0.25]
  const xyz: Vec3 = [1, 2, 3]
  // oxfmt-ignore
  const matrix: Matrix3x3 = [[4, 0, 0], [0, 4, 0], [0, 0, 4]]
  const crystal = make_crystal(matrix, [
    { element: `Cu`, abc },
    { element: `Cu`, xyz },
  ])
  const [abc_site, xyz_site] = crystal.sites
  expect(abc_site.abc).toEqual(abc)
  expect(abc_site.abc).not.toBe(abc)
  expect(xyz_site.xyz).toEqual(xyz)
  expect(xyz_site.xyz).not.toBe(xyz)
  expect(crystal.lattice.matrix).toEqual(matrix)
  expect(crystal.lattice.matrix).not.toBe(matrix)
  crystal.lattice.matrix.forEach((row, idx) => expect(row).not.toBe(matrix[idx]))

  expect(fcc_cell(4).sites[1].abc).not.toBe(FCC_FACE_CENTRES[1])
  expect(() => Object.assign(FCC_FACE_CENTRES[1], [1])).toThrow(TypeError)
  expect(() => Object.assign(FCC_FACE_CENTRES, [[1, 1, 1]])).toThrow(TypeError)
  expect(FCC_FACE_CENTRES[1]).toEqual([0.5, 0.5, 0])
})

describe(`in_plane_supercell`, () => {
  const nacl = slab(make_rocksalt(), [1, 0, 0], 5)
  // oxfmt-ignore
  test.each([
    [[1, 0], [0, 1]],
    [[2, 0], [0, 3]],
    [[2, 1], [0, 2]],
    [[3, -1], [1, 2]],
    [[5, 3], [2, 1]], // unimodular, far from HNF
    [[0, 1], [1, 0]], // det −1
    [[1, 2], [3, 4]], // det −2
    [[-2, 1], [1, 3]], // det −7
    [[-1, 0], [0, -1]],
  ] satisfies Matrix2x2[])(`%j: |det| cells of exact lattice translates`, (...matrix) => {
    const [[m00, m01], [m10, m11]] = matrix
    const n_cells = Math.abs(m00 * m11 - m01 * m10)
    const cell = in_plane_supercell({ ...nacl, charge: 1.5 }, matrix)
    expect(cell.charge).toBe(1.5 * n_cells)
    const [vec_a, vec_b, vec_c] = nacl.lattice.matrix
    expect(cell.lattice.matrix).toEqual([
      math.add(math.scale(vec_a, m00), math.scale(vec_b, m01)),
      math.add(math.scale(vec_a, m10), math.scale(vec_b, m11)),
      vec_c,
    ])
    expect(cell.lattice.pbc).toEqual([true, true, false])
    expect(cell.sites).toHaveLength(n_cells * nacl.sites.length)
    const scaled = Object.entries(counts(nacl)).map(([elem, num]) => [elem, num * n_cells])
    expect(counts(cell)).toEqual(Object.fromEntries(scaled))
    expect(cell.sites.length / in_plane_area(cell)).toBeCloseTo(
      nacl.sites.length / in_plane_area(nacl),
      12,
    )
    const to_old_frac = math.create_cart_to_frac(nacl.lattice.matrix)
    const to_cart = math.create_frac_to_cart(cell.lattice.matrix)
    for (const [idx, { abc, xyz }] of cell.sites.entries()) {
      expect(abc[0] >= 0 && abc[0] < 1 && abc[1] >= 0 && abc[1] < 1).toBe(true)
      expect(math.euclidean_dist(xyz, to_cart(abc))).toBeLessThan(1e-12)
      // each copy differs from its source site by an in-plane lattice vector of the old cell
      const source = nacl.sites[Math.floor(idx / n_cells)]
      const [d_a, d_b, d_c] = to_old_frac(math.subtract(xyz, source.xyz))
      expect(Math.max(off_lattice(d_a), off_lattice(d_b), Math.abs(d_c))).toBeLessThan(1e-9)
    }
    // ...and no two copies coincide, so the |det| translations are distinct cosets
    const frac = cell.sites.map(({ abc }) => abc)
    for (const [idx_1, abc_1] of frac.entries()) {
      for (const abc_2 of frac.slice(idx_1 + 1)) {
        const delta: Vec3 = [
          abc_1[0] - abc_2[0] - Math.round(abc_1[0] - abc_2[0]),
          abc_1[1] - abc_2[1] - Math.round(abc_1[1] - abc_2[1]),
          abc_1[2] - abc_2[2],
        ]
        expect(Math.hypot(...to_cart(delta))).toBeGreaterThan(1)
      }
    }
  })

  // oxfmt-ignore
  test.each([
    [[[1, 2], [2, 4]], `(det 0)`],
    [[[1.5, 0], [0, 1]], `must be integer`],
    [[[300, 0], [0, 300]], `above MAX_SLAB_SITES=50000`],
  ] satisfies [Matrix2x2, string][])(`rejects %j`, (matrix, message) => {
    expect(() => in_plane_supercell(nacl, matrix)).toThrow(message)
  })
})

describe(`make_interface`, () => {
  const cu_ag_matches = match_lattices(
    surface_frame(CU_100).basis,
    surface_frame(AG_100).basis,
  )
  // a twisted match, whose off-diagonal film matrix exercises the full in-plane projection
  const twisted = cu_ag_matches.find(
    ({ film_matrix: [[, m01], [m10]] }) => m01 !== 0 || m10 !== 0,
  )
  if (!twisted) throw new Error(`Cu(100)/Ag(100) has no twisted match`)
  const heights = ({ sites, lattice }: Crystal): number[] => {
    const normal = math.normalize_vec(lattice.matrix[2])
    return sites.map(({ xyz }) => math.dot(xyz, normal))
  }

  test(`fcc(111) on itself keeps every site's ABC registry and opens the exact gap`, () => {
    // the slab's c is tilted, so its abc[0..1] are not the in-plane positions of the sites:
    // stacking by abc[0..1] alone would shift layers off their ABC registry
    const [c_x, c_y] = CU_111.lattice.matrix[2]
    expect(Math.hypot(c_x, c_y)).toBeGreaterThan(0.5)
    const misread = projected_coords(CU_111).map(([frac_a, frac_b], idx) => {
      const [abc_a, abc_b] = CU_111.sites[idx].abc
      return Math.max(off_lattice(abc_a - frac_a), off_lattice(abc_b - frac_b))
    })
    expect(math.array_max(misread)).toBeGreaterThan(0.1)
    const key = ([frac_a, frac_b]: number[]) => `${frac_a.toFixed(6)},${frac_b.toFixed(6)}`

    const built = make_interface(CU_111, CU_111, { gap: D_111, vacuum: 12 })
    const { interface_info: info, lattice, sites } = built
    const n_slab = CU_111.sites.length
    expect([info.n_substrate_sites, info.n_film_sites, sites.length]).toEqual([
      n_slab,
      n_slab,
      2 * n_slab,
    ])
    expect(new Set(sites.map(({ abc }) => key(abc))).size).toBe(3)
    // every output site = its input site shifted along the normal, up to an in-plane
    // lattice vector (c of the output cell is the normal)
    const [z_min] = math.array_extent(CU_111.sites.map(({ xyz }) => xyz[2]))
    const to_frac = math.create_cart_to_frac(lattice.matrix)
    for (const [idx, site] of sites.entries()) {
      const bottom = idx < n_slab ? 0 : info.substrate_thickness + D_111
      const source = CU_111.sites[idx % n_slab].xyz
      const [d_a, d_b, d_c] = to_frac(
        math.subtract(site.xyz, math.add(source, [0, 0, bottom - z_min])),
      )
      expect(Math.max(off_lattice(d_a), off_lattice(d_b), Math.abs(d_c))).toBeLessThan(1e-9)
      expect(site.properties.interface_role).toBe(idx < n_slab ? `substrate` : `film`)
    }
    // with gap = d_111 the film's bottom layer sits exactly where the next bulk layer would
    const site_heights = heights(built)
    const [, sub_top] = math.array_extent(site_heights.slice(0, n_slab))
    const [film_bottom] = math.array_extent(site_heights.slice(n_slab))
    expect(Math.abs(film_bottom - sub_top - D_111)).toBeLessThan(1e-9)
  })

  test.each([
    [0, 15],
    [1.7, 0],
    [3.25, 8.5],
  ])(`gap %s Å, vacuum %s Å: cell height, normal c, roles and counts`, (gap, vacuum) => {
    const match = twisted
    const built = make_interface(CU_100, AG_100, { match, gap, vacuum })
    const { interface_info: info, lattice, sites } = built
    expect(info).toMatchObject({ match, gap, vacuum, shift: [0, 0] })
    expect([info.n_substrate_sites, info.n_film_sites]).toEqual([
      match.n_substrate_cells * CU_100.sites.length,
      match.n_film_cells * AG_100.sites.length,
    ])
    expect(sites).toHaveLength(info.n_substrate_sites + info.n_film_sites)
    expect(counts(built)).toEqual({ Cu: info.n_substrate_sites, Ag: info.n_film_sites })
    const roles = sites.map(({ properties }) => properties.interface_role)
    expect(roles.indexOf(`film`)).toBe(info.n_substrate_sites)
    expect(roles.lastIndexOf(`substrate`)).toBe(info.n_substrate_sites - 1)
    expect(lattice.pbc).toEqual([true, true, false])
    const height = info.substrate_thickness + gap + info.film_thickness + vacuum
    expect(Math.abs(lattice.c - height)).toBeLessThan(1e-9)
    const [vec_a, vec_b, vec_c] = lattice.matrix
    const normal = math.normalize_vec(math.cross_3d(vec_a, vec_b))
    expect(math.dot(normal, vec_c)).toBeCloseTo(height, 9)
    expect(in_plane_area(built)).toBeCloseTo(match.area, 9)
    const site_heights = heights(built)
    const [sub_bottom, sub_top] = math.array_extent(
      site_heights.slice(0, info.n_substrate_sites),
    )
    const [film_bottom, film_top] = math.array_extent(
      site_heights.slice(info.n_substrate_sites),
    )
    expect(Math.abs(sub_bottom)).toBeLessThan(1e-9)
    expect(Math.abs(film_bottom - sub_top - gap)).toBeLessThan(1e-9)
    expect(Math.abs(film_top - film_bottom - info.film_thickness)).toBeLessThan(1e-9)
    expect_film_registry(built, in_plane_supercell(AG_100, match.film_matrix))
  })

  test(`without a match a near-commensurate film is strained 1×1 onto the substrate`, () => {
    const film = slab(fcc_cell(3.615 * 1.02), [1, 0, 0])
    const built = make_interface(CU_100, film)
    const { match } = built.interface_info
    expect([match.n_film_cells, match.n_substrate_cells]).toEqual([1, 1])
    const strain = 1 / 1.02 - 1
    const [exx, exy, , eyy] = match.strain.flat()
    expect(
      Math.max(Math.abs(exx - strain), Math.abs(exy), Math.abs(eyy - strain)),
    ).toBeLessThan(1e-12)
    expect(built.lattice.matrix.slice(0, 2)).toEqual(CU_100.lattice.matrix.slice(0, 2))
    expect_film_registry(built, film)
  })

  test(`shift moves only the film, by exactly the shift in fractional coordinates`, () => {
    const shift: Vec2 = [0.25, 0.6]
    const [plain, shifted] = [[0, 0], shift].map((offset) =>
      make_interface(CU_111, CU_111, { shift: offset as Vec2 }),
    )
    const n_sub = plain.interface_info.n_substrate_sites
    expect(shifted.sites.slice(0, n_sub)).toEqual(plain.sites.slice(0, n_sub))
    expect(shifted.interface_info.shift).toEqual(shift)
    const in_cell = shifted.sites.every(({ abc: [frac_a, frac_b] }) =>
      [frac_a, frac_b].every((frac) => frac >= 0 && frac < 1),
    )
    expect(in_cell).toBe(true)
    for (const [idx, site] of shifted.sites.slice(n_sub).entries()) {
      const { abc } = plain.sites[n_sub + idx]
      expect(off_lattice(site.abc[0] - abc[0] - shift[0])).toBeLessThan(1e-12)
      expect(off_lattice(site.abc[1] - abc[1] - shift[1])).toBeLessThan(1e-12)
      expect(site.abc[2]).toBe(abc[2])
    }
  })

  test(`keeps site species, labels and properties, sums charges, drops the substrate id`, () => {
    const tagged = (crystal: Crystal, charge: number) => ({
      ...crystal,
      id: `slab-${charge}`,
      charge,
      sites: crystal.sites.map((site, idx) => ({
        ...site,
        label: `L${idx}`,
        properties: { tag: idx },
      })),
    })
    const [substrate, film] = [tagged(CU_100, 0.5), tagged(AG_100, -2)]
    const built = make_interface(substrate, film, { match: twisted })
    const { n_film_cells, n_substrate_cells } = twisted
    expect(built.charge).toBe(0.5 * n_substrate_cells - 2 * n_film_cells)
    expect(built.id).toBeUndefined()
    const sub_cell = in_plane_supercell(substrate, twisted.substrate_matrix)
    const film_cell = in_plane_supercell(film, twisted.film_matrix)
    expect(built.sites.map(({ label, properties: { tag } }) => [label, tag])).toEqual(
      [...sub_cell.sites, ...film_cell.sites].map(({ label, properties: { tag } }) => [
        label,
        tag,
      ]),
    )
  })

  // A match is only a pair of supercell matrices: its strain is re-evaluated on the slabs
  // it stacks, so a match found for Ag on Cu says Cu on Cu is strain-free
  test(`re-evaluates a match on the slabs it stacks`, () => {
    const { interface_info } = make_interface(CU_100, CU_100, { match: twisted })
    const frame = surface_frame(CU_100).basis
    expect(interface_info.match).toEqual(match_of_matrices(frame, frame, twisted))
    expect(interface_info.match.von_mises).not.toBe(twisted.von_mises)
  })

  // Regression: a slab read from a file can straddle the cell's c boundary. Translated by
  // c/2, half of it wraps to the bottom of the cell, which must not count the vacuum as slab
  // (nor, with a tilted c, shift the wrapped layers in-plane).
  test.each([
    [`straight c`, CU_100],
    [`tilted c`, CU_111],
  ])(`a slab wrapped across the c boundary (%s) stacks like the contiguous one`, (_, cu) => {
    const to_cart = math.create_frac_to_cart(cu.lattice.matrix)
    const translated = (wrap: boolean): Crystal => ({
      ...cu,
      sites: cu.sites.map((site) => {
        const frac_c = site.abc[2] + 0.5
        const abc: Vec3 = [site.abc[0], site.abc[1], wrap ? frac_c % 1 : frac_c]
        return { ...site, abc, xyz: to_cart(abc) }
      }),
    })
    const [contiguous, wrapped] = [false, true].map(translated)
    const n_wrapped = wrapped.sites.filter(({ abc }) => abc[2] < 0.5).length
    expect(n_wrapped > 0 && n_wrapped < cu.sites.length).toBe(true)
    const [plain, from_wrapped] = [contiguous, wrapped].map((cu_slab) =>
      make_interface(cu_slab, cu_slab, { gap: 2, vacuum: 10 }),
    )
    const thickness = plain.interface_info.substrate_thickness
    expect(thickness).toBeLessThan(10)
    expect(from_wrapped.interface_info.substrate_thickness).toBeCloseTo(thickness, 9)
    expect(from_wrapped.lattice.c).toBeCloseTo(plain.lattice.c, 9)
    for (const [idx, { abc }] of from_wrapped.sites.entries()) {
      const ref = plain.sites[idx].abc
      const diffs = [off_lattice(abc[0] - ref[0]), off_lattice(abc[1] - ref[1])]
      expect(Math.max(...diffs, Math.abs(abc[2] - ref[2]))).toBeLessThan(1e-9)
    }
  })

  // The film is read in its own surface frame, so rotating it rigidly in 3D (lattice and
  // positions) cannot change the interface
  test(`a rigidly rotated film gives the same interface`, () => {
    const rotation: Matrix3x3 = [
      [0.36, 0.48, -0.8],
      [-0.8, 0.6, 0],
      [0.48, 0.64, 0.6],
    ]
    const rotate = (vec: Vec3): Vec3 => math.mat3x3_vec3_multiply(rotation, vec)
    const [vec_a, vec_b, vec_c] = AG_100.lattice.matrix
    const rotated: Crystal = {
      ...AG_100,
      lattice: { ...AG_100.lattice, matrix: [rotate(vec_a), rotate(vec_b), rotate(vec_c)] },
      sites: AG_100.sites.map((site) => ({ ...site, xyz: rotate(site.xyz) })),
    }
    const [plain, from_rotated] = [AG_100, rotated].map((film) =>
      make_interface(CU_100, film, { match: twisted }),
    )
    expect(from_rotated.interface_info.match).toEqual(
      expect.objectContaining({ n_film_cells: twisted.n_film_cells }),
    )
    const max_dist = math.array_max(
      from_rotated.sites.map(({ xyz }, idx) => math.euclidean_dist(xyz, plain.sites[idx].xyz)),
    )
    expect(max_dist).toBeLessThan(1e-9)
  })

  const monolayer = slab(make_crystal(3.35, [[`Po`, [0, 0, 0]]]), [1, 0, 0], 0)
  test.each([
    [CU_100, AG_100, {}, `does not fit substrate mesh (a=2.5562 Å, b=2.5562 Å, γ=90.00°)`],
    // oxfmt-ignore
    [CU_100, AG_100, { match: { ...twisted, film_matrix: [[0, 2], [2, 0]] } }, `positive determinants`],
    // oxfmt-ignore
    [CU_100, AG_100, { match: { ...twisted, substrate_matrix: [[0, 1], [1, 0]] } }, `positive determinants`],
    [{ ...CU_100, sites: [] }, AG_100, {}, `substrate slab has no sites`],
    [CU_100, { ...AG_100, sites: [] }, {}, `film slab has no sites`],
    [CU_100, CU_100, { gap: -1 }, `gap must be a non-negative finite number, got -1`],
    [CU_100, CU_100, { vacuum: Infinity }, `vacuum must be a non-negative finite number`],
    [CU_100, CU_100, { shift: [NaN, 0] }, `shift must be finite, got [null,0]`],
    [monolayer, monolayer, { gap: 0, vacuum: 0 }, `zero height`],
  ] satisfies [Crystal, Crystal, Parameters<typeof make_interface>[2], string][])(
    `rejects %#`,
    (substrate, film, options, message) => {
      expect(() => make_interface(substrate, film, options)).toThrow(message)
    },
  )
})
