import type { Matrix3x3, Vec3 } from '#lib/math.js'
import * as math from '#lib/math.js'
import { analyze_structure_symmetry, point_group_rotations } from '#lib/symmetry/analyze.js'
import {
  compute_wulff_shape,
  lattice_holohedry,
  type WulffFacetInput,
  type WulffShapeData,
} from '#lib/wulff/index.js'
import { oxide_example, wulff_examples } from '#site/wulff.js'
import { beforeAll, describe, expect, test } from 'vite-plus/test'
import { make_rng } from '../numeric-helpers'
import { cubic_matrix, init_moyo_for_tests, make_crystal } from '../test-fixtures'

const cubic = cubic_matrix(3)
const hexagonal = (a_len: number, c_len: number) =>
  math.cell_to_lattice_matrix(a_len, a_len, c_len, 90, 90, 120)
const fam = (miller: Vec3, energy: number): WulffFacetInput => ({ miller, energy })
const counts = (shape: WulffShapeData) => ({
  n_vertices: shape.vertices.length,
  n_edges: shape.edges.length,
  n_facets: shape.facets.length,
})
// Each facet carries its own plane's indices (hover and pins look facets up by them) and
// Euler's formula V - E + F = 2 holds for every convex polyhedron
const expect_closed_convex = (shape: WulffShapeData) => {
  const { n_vertices, n_edges, n_facets } = counts(shape)
  expect(new Set(shape.facets.map(({ miller }) => miller.join(`,`))).size).toBe(n_facets)
  expect(n_vertices - n_edges + n_facets).toBe(2)
  // divergence theorem: a closed surface has Σ A·n = 0
  const area_vector = shape.facets.reduce<Vec3>(
    (sum, { area, normal }) => math.add(sum, math.scale(normal, area)),
    [0, 0, 0],
  )
  expect(Math.hypot(...area_vector)).toBeLessThan(1e-12 * shape.surface_area)
  // every shape has a unit sphere's volume, its corners on their planes at the scaled distances
  const volume = shape.facets.reduce((sum, { dist, area }) => sum + dist * area, 0) / 3
  expect(volume).toBeCloseTo((4 * Math.PI) / 3, 13)
  for (const { normal, dist, vertex_indices } of shape.facets) {
    for (const idx of vertex_indices) {
      expect(math.dot(shape.vertices[idx], normal)).toBeCloseTo(dist, 13)
    }
  }
  const fraction_sum = shape.families.reduce((sum, family) => sum + family.area_fraction, 0)
  expect(fraction_sum).toBeCloseTo(1, 14)
}

describe(`compute_wulff_shape`, () => {
  // Shape factors A/V^(2/3) from edge length s (or prism apothem 1 and half-height h): regular
  // octahedron A = 2√3·s², V = (√2/3)·s³; cuboctahedron (6 squares and 8 triangles, 4 planes at
  // every corner) A = (6 + 2√3)·s², V = (5√2/3)·s³; hexagonal prism A = 4√3·(1 + 2h), V = 4√3·h
  const octahedron_sf = (2 * Math.sqrt(3)) / (Math.SQRT2 / 3) ** (2 / 3)
  const cuboctahedron_sf = (6 + 2 * Math.sqrt(3)) / ((5 * Math.SQRT2) / 3) ** (2 / 3)
  const prism_h = 0.35 / 0.53 // pymatgen 2026.10.24's WulffShape gives 5.834110692845166
  const prism_sf =
    (4 * Math.sqrt(3) * (1 + 2 * prism_h)) / (4 * Math.sqrt(3) * prism_h) ** (2 / 3)
  const hex = hexagonal(2.63, 5.21)
  // [label, lattice, families, vertices, edges, faces, facets per family, shape factor (null:
  // none known independently)]
  type ShapeCase = [
    string,
    Matrix3x3,
    WulffFacetInput[],
    number,
    number,
    number,
    number[],
    number | null,
  ]
  // oxfmt-ignore
  const shape_cases: ShapeCase[] = [
    [`cube`, cubic, [fam([1, 0, 0], 1.3)], 8, 12, 6, [6], 6],
    [`octahedron`, cubic, [fam([1, 1, 1], 2)], 6, 12, 8, [8], octahedron_sf],
    // shape factor from pymatgen 2026.10.24's WulffShape
    [`truncated octahedron`, cubic, [fam([1, 0, 0], 1), fam([1, 1, 1], Math.sqrt(3) / 2)], 24, 36, 14, [6, 8], 5.314739699971959],
    [`cuboctahedron`, cubic, [fam([1, 0, 0], 1), fam([1, 1, 1], 2 / Math.sqrt(3))], 12, 24, 14, [6, 8], cuboctahedron_sf],
    // {100} drops out once γ100/γ111 exceeds √3
    ...[1.8, 2, 5].map((ratio): ShapeCase => [`{100} at γ ratio ${ratio}`, cubic, [fam([1, 0, 0], ratio), fam([1, 1, 1], 1)], 6, 12, 8, [0, 8], octahedron_sf]),
    // 6/mmm: six planes per prism family, two basal ones, a twelve-plane {101} bipyramid
    [`hexagonal prism {100}`, hex, [fam([1, 0, 0], 0.53), fam([0, 0, 1], 0.35)], 12, 18, 8, [6, 2], prism_sf],
    [`hexagonal prism {110}`, hex, [fam([1, 1, 0], 0.53), fam([0, 0, 1], 0.35)], 12, 18, 8, [6, 2], prism_sf],
    [`hexagonal bipyramid`, hex, [fam([1, 0, 1], 0.4)], 8, 18, 12, [12], null],
  ]
  test.each(shape_cases)(
    `%s: %i vertices, %i edges, %i faces`,
    (_label, lattice, facets, n_vertices, n_edges, n_facets, per_family, shape_factor) => {
      const shape = compute_wulff_shape(lattice, facets)
      expect(counts(shape)).toEqual({ n_vertices, n_edges, n_facets })
      expect_closed_convex(shape)
      expect(shape.families.map((family) => family.n_facets)).toEqual(per_family)
      if (shape_factor !== null) expect(shape.shape_factor).toBeCloseTo(shape_factor, 12)
    },
  )

  // The shape keeps its size (a unit sphere's volume) whatever the scale of the energies, and a
  // family off the shape changes nothing (distances of γ/γ_max shrank it as an absent γ rose)
  const [{ lattice: ir_lattice, facets: ir_facets }] = wulff_examples
  test.each<[string, number, WulffFacetInput[]]>([
    ...[0.01, 1e4].map((factor): [string, number, WulffFacetInput[]] => [
      `every γ × ${factor}`,
      factor,
      ir_facets.map(({ miller, energy }) => fam(miller, energy * factor)),
    ]),
    [`absent {110} at γ = 50`, 1, ir_facets.with(1, fam([1, 1, 0], 50))],
  ])(`%s leaves the shape unchanged`, (_label, factor, facets) => {
    const ref = compute_wulff_shape(ir_lattice, ir_facets)
    const shape = compute_wulff_shape(ir_lattice, facets)
    expect(shape.facets).toHaveLength(ref.facets.length)
    const ref_facets = new Map(ref.facets.map((facet) => [facet.miller.join(`,`), facet]))
    const deviations = shape.facets.flatMap(({ miller, dist, area }) => {
      const match = ref_facets.get(miller.join(`,`))
      return match ? [Math.abs(dist - match.dist), Math.abs(area - match.area)] : [Infinity]
    })
    expect(Math.max(...deviations)).toBeLessThan(1e-12)
    expect(shape.shape_factor).toBeCloseTo(ref.shape_factor, 12)
    expect(shape.weighted_surface_energy / factor).toBeCloseTo(ref.weighted_surface_energy, 12)
  })

  // γ(Δμ) = γ₀ + slope·Δμ: zero slopes leave γ as given, bit for bit, while the illustrative
  // oxide trades its O-terminated {001} for reduced {111} facets from O-rich to O-poor
  test(`surface energies follow Δμ through their slopes`, () => {
    const { lattice, facets, delta_mu_range } = oxide_example
    const flat = facets.map(({ miller, energy }) => fam(miller, energy))
    const zero_slopes = facets.map((facet) => ({ ...facet, slope: 0 }))
    expect(compute_wulff_shape(lattice, zero_slopes, { delta_mu: -2.7 })).toEqual(
      compute_wulff_shape(lattice, flat),
    )
    const at = (delta_mu: number) => compute_wulff_shape(lattice, facets, { delta_mu })
    const present = (delta_mu: number) =>
      at(delta_mu).families.map(({ n_facets }) => n_facets > 0)
    // [110, 101, 100, 001, 111]
    expect(present(delta_mu_range[1])).toEqual([true, true, true, true, false])
    expect(present(delta_mu_range[0])).toEqual([true, false, true, false, true])
    // 0.45 + 0.15·3 lands 1 ulp below 0.9 in f64
    for (const [idx, energy] of [0.5, 0.6, 0.65, 0.9, 0.45].entries()) {
      expect(at(-3).families[idx].energy).toBeCloseTo(energy, 15)
    }
    expect(() => at(4)).toThrow(
      `Surface energy of (0 0 1) at Δμ = 4 eV must be a positive number`,
    )
  })

  const ti_cell = hexagonal(4.5783, 2.8303)
  const caps = [fam([1, 0, 0], 1), fam([0, 0, 1], 1.1)]
  // [lattice, holohedry order, families bounding a shape in it]
  // oxfmt-ignore
  const holohedry_cases: [Matrix3x3, number, WulffFacetInput[]][] = [
    [cubic, 48, [fam([1, 0, 0], 1), fam([1, 1, 1], 1.05)]],
    [ti_cell, 24, caps],
    // hand-written cells rounded to 3 or 4 decimals keep their symmetry within WULFF_SYMPREC
    ...[3, 4].map((digits): [Matrix3x3, number, WulffFacetInput[]] => [ti_cell.map((row) => row.map((val) => Number(val.toFixed(digits)))) as Matrix3x3, 24, caps]),
    [[[3, 0, 0], [0, 3, 0], [0, 0, 3.006]], 16, caps], // c/a = 1.002: tetragonal, not cubic
    [[[3, 0, 0], [0, 4, 0], [0.7, 0, 5]], 4, [...caps, fam([0, 1, 0], 1.2)]], // monoclinic
  ]
  test.each(holohedry_cases)(
    `lattice_holohedry of %j has %i integer rotations`,
    (lattice, n_ops, facets) => {
      const ops = lattice_holohedry(lattice)
      expect(ops).toHaveLength(n_ops)
      for (const rot of ops) expect(rot.flat().every(Number.isInteger)).toBe(true)
      expect_closed_convex(compute_wulff_shape(lattice, facets))
    },
  )

  describe(`with moyo point groups`, () => {
    beforeAll(init_moyo_for_tests)
    // ZnO wurtzite (P6₃mc, polar 6mm): textbook a = 3.25, c = 5.21 Å, u = 0.382
    // oxfmt-ignore
    const wurtzite = make_crystal(hexagonal(3.25, 5.21), [[`Zn`, [1 / 3, 2 / 3, 0]], [`Zn`, [2 / 3, 1 / 3, 0.5]], [`O`, [1 / 3, 2 / 3, 0.382]], [`O`, [2 / 3, 1 / 3, 0.882]]])

    // Ir's cell is the one MP used; ω-Ti's is rebuilt from MP slab cells to 4 decimals (a, c
    // off by ~1e-4 Å), which shifts its area fractions by up to 6.4e-5. Both crystals are
    // holohedral, so moyo's point group gives the lattice holohedry's shape.
    test.each(wulff_examples.map((example) => [example.label, example] as const))(
      `%s reproduces the Materials Project's Wulff shape`,
      async (_label, example) => {
        const { mp, mp_tolerance: tol, lattice, facets } = example
        const sym = await analyze_structure_symmetry(example.structure, {})
        const point_group = point_group_rotations(sym.operations)
        expect(point_group).toHaveLength(lattice_holohedry(lattice).length)
        const shape = compute_wulff_shape(lattice, facets, { point_group })
        expect_closed_convex(shape)
        const by_holohedry = compute_wulff_shape(lattice, facets)
        const max_error = (fractions: number[]) =>
          Math.max(
            ...shape.families.map(({ area_fraction }, idx) =>
              Math.abs(area_fraction - fractions[idx]),
            ),
          )
        expect(max_error(mp.surfaces.map(({ area_fraction }) => area_fraction))).toBeLessThan(
          tol,
        )
        expect(
          max_error(by_holohedry.families.map(({ area_fraction }) => area_fraction)),
        ).toBeLessThan(5e-15)
        // families MP lists as present are present here, down to ω-Ti's 1.9e-6 {102} sliver
        expect(shape.families.map(({ n_facets }) => n_facets > 0)).toEqual(
          mp.surfaces.map(({ area_fraction }) => area_fraction > 0),
        )
        expect(Math.abs(shape.shape_factor / mp.shape_factor - 1)).toBeLessThan(tol)
        expect(
          Math.abs(shape.weighted_surface_energy / mp.weighted_surface_energy - 1),
        ).toBeLessThan(tol)
        expect(Math.abs(shape.anisotropy / mp.surface_anisotropy - 1)).toBeLessThan(10 * tol)
      },
    )

    test(`polar wurtzite keeps (001) and (00-1) as separate families`, async () => {
      const sym = await analyze_structure_symmetry(wurtzite, {})
      const point_group = point_group_rotations(sym.operations)
      expect(point_group).toHaveLength(12)
      const shape = compute_wulff_shape(
        wurtzite.lattice.matrix,
        [fam([1, 0, 0], 1), fam([0, 0, 1], 0.8), fam([0, 0, -1], 1.2)],
        { point_group },
      )
      expect(shape.families.map(({ multiplicity }) => multiplicity)).toEqual([6, 1, 1])
      expect(counts(shape)).toEqual({ n_vertices: 12, n_edges: 18, n_facets: 8 })
      // the holohedry ties them together
      expect(() =>
        compute_wulff_shape(wurtzite.lattice.matrix, [
          fam([0, 0, 1], 0.8),
          fam([0, 0, -1], 1.2),
        ]),
      ).toThrow(/symmetry-equivalent/)
    })
  })

  // Brute force over every plane triple: corners satisfying all half-spaces, then each plane's
  // polygon, as an independent check on the dual-hull construction
  const brute_force = (lattice: Matrix3x3, facets: WulffFacetInput[]) => {
    const point_group = lattice_holohedry(lattice)
    const lattice_inv = math.inverse_3x3(lattice)
    const max_energy = Math.max(...facets.map(({ energy }) => energy))
    const planes: { normal: Vec3; dist: number; family_idx: number }[] = []
    for (const [family_idx, { miller, energy }] of facets.entries()) {
      for (const rot of point_group) {
        const g_vec = math.dot(lattice_inv, math.mul_3x3_vec3(math.transpose_3x3(rot), miller))
        const normal = math.scale(g_vec, 1 / Math.hypot(...g_vec))
        if (planes.some((plane) => math.euclidean_dist(plane.normal, normal) < 1e-9)) continue
        planes.push({ normal, dist: energy / max_energy, family_idx })
      }
    }
    const corners: Vec3[] = []
    for (let idx_a = 0; idx_a < planes.length; idx_a++) {
      for (let idx_b = idx_a + 1; idx_b < planes.length; idx_b++) {
        for (let idx_c = idx_b + 1; idx_c < planes.length; idx_c++) {
          const triple = [planes[idx_a], planes[idx_b], planes[idx_c]]
          const matrix = triple.map(({ normal }) => normal) as Matrix3x3
          if (Math.abs(math.det_3x3(matrix)) < 1e-10) continue
          const corner = math.mul_3x3_vec3(
            math.inverse_3x3(matrix),
            triple.map(({ dist }) => dist) as Vec3,
          )
          const inside = planes.every(
            ({ normal, dist }) => math.dot(normal, corner) <= dist + 1e-9,
          )
          if (inside && !corners.some((other) => math.euclidean_dist(other, corner) < 1e-7)) {
            corners.push(corner)
          }
        }
      }
    }
    const family_area = facets.map(() => 0)
    let volume = 0
    for (const { normal, dist, family_idx } of planes) {
      const on_plane = corners.filter(
        (corner) => Math.abs(math.dot(normal, corner) - dist) < 1e-7,
      )
      if (on_plane.length < 3) continue
      const center = math.scale(math.add(...on_plane), 1 / on_plane.length)
      const axis_u = math.subtract(on_plane[0], center)
      const axis_w = math.cross_3d(normal, axis_u)
      const angle = (point: Vec3) => {
        const off = math.subtract(point, center)
        return Math.atan2(math.dot(off, axis_w), math.dot(off, axis_u))
      }
      const ring = on_plane.toSorted((left, right) => angle(left) - angle(right))
      const offsets = ring.map((point) => math.subtract(point, center))
      let area = 0
      for (const [idx, off] of offsets.entries()) {
        const cross = math.cross_3d(off, offsets[(idx + 1) % offsets.length])
        area += math.dot(cross, normal) / 2
      }
      family_area[family_idx] += area
      volume += (dist * area) / 3
    }
    const total = family_area.reduce((sum, area) => sum + area, 0)
    return {
      fractions: family_area.map((area) => area / total),
      shape_factor: total / volume ** (2 / 3),
    }
  }

  test(`random shapes on cubic, hexagonal and triclinic lattices match brute force`, () => {
    const rand = make_rng(7) // seeded, so failures reproduce
    const rand_int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))
    let [n_checked, max_frac_err, max_sf_err] = [0, 0, 0]
    for (let trial = 0; n_checked < 30 && trial < 300; trial++) {
      const lattice: Matrix3x3 = [
        cubic,
        hexagonal(2 + 2 * rand(), 2 + 4 * rand()),
        [
          [2 + 3 * rand(), 0, 0],
          [2 * rand() - 1, 2 + 3 * rand(), 0],
          [2 * rand() - 1, 2 * rand() - 1, 2 + 3 * rand()],
        ] as Matrix3x3,
      ][trial % 3]
      const facets: WulffFacetInput[] = Array.from({ length: rand_int(2, 6) }, () =>
        fam([rand_int(-3, 3), rand_int(-3, 3), rand_int(-3, 3)], 1 + rand()),
      ).filter(({ miller }) => miller.some((val) => val !== 0))
      let shape: WulffShapeData
      try {
        shape = compute_wulff_shape(lattice, facets)
      } catch (err) {
        // random families may repeat or leave the shape open; anything else is a bug
        expect(String(err)).toMatch(/symmetry-equivalent|appears twice|unbounded/)
        continue
      }
      if (shape.families.reduce((sum, { multiplicity }) => sum + multiplicity, 0) > 100)
        continue
      const ref = brute_force(lattice, facets)
      for (const [idx, { area_fraction }] of shape.families.entries()) {
        max_frac_err = Math.max(max_frac_err, Math.abs(area_fraction - ref.fractions[idx]))
      }
      max_sf_err = Math.max(max_sf_err, Math.abs(shape.shape_factor / ref.shape_factor - 1))
      n_checked++
    }
    expect(n_checked).toBe(30)
    expect(max_frac_err).toBeLessThan(1e-12)
    expect(max_sf_err).toBeLessThan(1e-12)
  })

  // oxfmt-ignore
  const four_fold: Matrix3x3 = [[0, -1, 0], [1, 0, 0], [0, 0, 1]]
  // 4mm: no inversion or horizontal mirror, so nothing caps -z
  const rotations_4mm = lattice_holohedry(cubic).filter((rot) => rot[2][2] > 0.5)
  const box_101 = [fam([1, 0, 1], 1)]
  // [lattice, families, point group (default the holohedry), error]
  // oxfmt-ignore
  const error_cases: [Matrix3x3, WulffFacetInput[], Matrix3x3[] | undefined, RegExp][] = [
    [cubic, [], undefined, /at least one facet family/],
    [cubic, [fam([1, 0, 0], 0)], undefined, /must be a positive number/],
    [cubic, [fam([1, 0, 0], Number.NaN)], undefined, /must be a positive number/],
    [cubic, [fam([0, 0, 0], 1)], undefined, /do not define a plane/],
    [cubic, [fam([1, 0, 0], 1), fam([0, 1, 0], 2)], undefined, /symmetry-equivalent/],
    [cubic, [fam([1, 0, 0], 1), fam([2, 0, 0], 2)], undefined, /symmetry-equivalent/],
    [cubic, [fam([1, 1, 0], 1), fam([1, 1, 0], 2)], undefined, /^Facet \(1 1 0\) appears twice$/],
    // unbounded: antiparallel or coplanar normals, or a point group leaving -z open
    [hexagonal(3, 5), [fam([0, 0, 1], 1)], undefined, /all 2 facet normals lie in one plane/],
    [hexagonal(3, 5), [fam([1, 0, 0], 1), fam([1, 1, 0], 1)], undefined, /all 12 facet normals lie in one plane/],
    [cubic, [fam([1, 0, 0], 1), fam([0, 0, 1], 1)], rotations_4mm, /unbounded: no facet family cuts direction \[0, 0, −1\]/],
    // a cubic 4-fold is no symmetry of a hexagonal lattice; a Cartesian 6-fold is no fractional one
    [hexagonal(3, 5), box_101, [four_fold], /is not an integer symmetry of lattice/],
    [hexagonal(3, 5), box_101, [[[0.5, -Math.sqrt(3) / 2, 0], [Math.sqrt(3) / 2, 0.5, 0], [0, 0, 1]]], /is not an integer symmetry of lattice/],
    // metric-preserving but not integer
    [cubic, box_101, [four_fold.map((row) => row.map((val) => val + 1e-9)) as Matrix3x3], /not an integer/],
    // near misses: the cubic group on c/a = 1.01, a 4-fold swapping a = 3 and b = 3.03
    [[[3, 0, 0], [0, 3, 0], [0, 0, 3.03]], box_101, lattice_holohedry(cubic), /not an integer symmetry/],
    [[[3, 0, 0], [0, 3.03, 0], [0, 0, 30]], box_101, [four_fold], /not an integer symmetry/],
    // not groups
    [cubic, box_101, [], /do not form a group/],
    [cubic, box_101, [four_fold], /do not form a group/],
  ]
  test.each(error_cases)(
    `rejects invalid input %#`,
    (lattice, facets, point_group, message) => {
      expect(() => compute_wulff_shape(lattice, facets, { point_group })).toThrow(message)
    },
  )
})
