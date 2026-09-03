import type { Matrix3x3, Vec3 } from '$lib/math'
import { create_lattice_converters, min_image_displacement } from '$lib/math'
import type { Crystal, Pbc } from '$lib/structure'
import { neighbor_query } from '$lib/structure/bonding'
import {
  apply_structure_id,
  calc_cna,
  calc_structure_id,
  CENTROSYMMETRY_PROPERTY,
  cna_type_name,
  CNA_TYPE_PROPERTY,
  CNA_TYPES,
} from '$lib/structure-id'
import { describe, expect, test } from 'vitest'
import {
  BCC_LATTICE_CONST,
  FCC_LATTICE_CONST,
  fcc_nn_distance,
  make_bcc,
  make_fcc,
  make_hcp,
  make_icosahedron,
  with_random_displacements,
  with_vacancy,
} from './lattices'

// CSP is a sum of 6 squared vector sums. The neighbor deltas are differences of coordinates
// that span the whole 4x3.615 = 14.5 Å supercell and pass through a frac->cart round trip, so
// one coordinate carries ~14.5 * f64_eps ~ 3.2e-15 Å of rounding; the pair sum doubles it and
// squaring gives ~4e-29 Å² per term, ~2.5e-28 Å² over 6 terms. Measured maxima are 2.08e-28 Å²
// (fcc) and 3.79e-29 Å² (bcc), matching that estimate. The 1e-24 Å² ceiling sits 4 orders above
// the measurement and 24 orders below the ~6.5 Å² a single missing bond produces.
const PERFECT_CSP_TOLERANCE = 1e-24 // Å²

// Translate a Cartesian position by a whole number of lattice vectors along each axis
const shift_by_cells = (xyz: Vec3, matrix: Matrix3x3, cells: Vec3): Vec3 =>
  xyz.map(
    (coord, axis) =>
      coord +
      cells[0] * matrix[0][axis] +
      cells[1] * matrix[1][axis] +
      cells[2] * matrix[2][axis],
  ) as Vec3

const max_finite = (values: Float64Array): number =>
  values.reduce((best, value) => (Number.isNaN(value) ? best : Math.max(best, value)), 0)

// Minimum-image distance from every site to `target_idx`, so a target near a cell face still
// finds all 12 of its neighbors instead of the 8 that happen to lie inside the box
const distances_to = (crystal: Crystal, target_idx: number): number[] => {
  const { matrix, pbc } = crystal.lattice
  const converters = create_lattice_converters(matrix)
  const target = crystal.sites[target_idx].xyz
  return crystal.sites.map(({ xyz }) =>
    Math.hypot(...min_image_displacement(target, xyz, matrix, converters, pbc)),
  )
}

// Geometric neighbor-list correctness (brute-force oracle, sorting, partial pbc, validation)
// lives in tests/vitest/structure/bonding.test.ts; these cover what structure-id layers on top.
describe(`neighbor list`, () => {
  test(`unwrapped trajectory coordinates classify the same as wrapped ones`, () => {
    // A trajectory frame can carry coordinates far outside the cell. The neighbor list wraps
    // before generating images, so the classification must not depend on which image of an
    // atom the file happened to store. (get_pbc_image_sites cannot be used here: its
    // is_scattered_trajectory guard returns zero images once >10% of atoms sit outside.)
    const wrapped = make_fcc([3, 3, 3])
    // Whole-cell translations only: the structure is physically identical, just stored with
    // a third of its atoms in neighboring images the way an unwrapped MD dump would.
    const unwrapped = {
      ...wrapped,
      sites: wrapped.sites.map((site, idx) => {
        if (idx % 3 !== 0) return site
        const cells: Vec3 = [2, -1, 3]
        return {
          ...site,
          abc: site.abc.map((coord, axis) => coord + cells[axis]) as Vec3,
          xyz: shift_by_cells(site.xyz, wrapped.lattice.matrix, cells),
        }
      }),
    }
    const result = calc_structure_id(unwrapped, { skip_csp: true })
    expect(result.populations.fcc).toBe(108)
  })

  test(`a non-periodic axis is not wrapped`, () => {
    // Slab geometry: periodic in a and b, free along c. Translating the whole slab along the
    // free axis is a pure change of origin and must not change a single classification. Wrapping
    // c would fold the atoms that end up below the cell onto the opposite surface, splitting the
    // slab in two.
    const bulk = make_fcc([3, 3, 3])
    const slab_lattice = { ...bulk.lattice, pbc: [true, true, false] as const }
    const at_origin = { ...bulk, lattice: slab_lattice }
    const shifted = {
      ...at_origin,
      sites: bulk.sites.map((site) => ({
        ...site,
        abc: [site.abc[0], site.abc[1], site.abc[2] - 0.5] as Vec3,
        xyz: shift_by_cells(site.xyz, bulk.lattice.matrix, [0, 0, -0.5]),
      })),
    }
    const origin_result = calc_structure_id(at_origin, { skip_csp: true })
    const shifted_result = calc_structure_id(shifted, { skip_csp: true })
    expect(shifted_result.populations).toEqual(origin_result.populations)
    // Sanity: the free surface really is visible, i.e. this is not vacuously comparing two
    // fully-fcc results
    expect(origin_result.populations.other).toBeGreaterThan(0)
    expect(origin_result.populations.fcc).toBeGreaterThan(0)
  })

  test(`a duplicate coincident site poisons only the atoms that see it`, () => {
    // neighbor_query reports coincident sites (distance 0) rather than hiding duplicate input.
    // The zero-length bond makes both duplicates Other, and can push one of them into a
    // neighbor's 12-closest set (13 atoms now tie at the nn distance), so only the 12 atoms
    // bordering the duplicate may be affected; everything further away must stay fcc.
    const crystal = make_fcc([3, 3, 3])
    const dup_idx = crystal.sites.length
    crystal.sites = [
      ...crystal.sites,
      { ...crystal.sites[0], label: `dup`, abc: [...crystal.sites[0].abc] as Vec3 },
    ]
    const bordering = new Set(
      distances_to(crystal, 0)
        .map((dist, idx) => ({ dist, idx }))
        .filter(({ dist }) => dist > 1e-9 && dist < fcc_nn_distance() * 1.01)
        .map(({ idx }) => idx),
    )
    expect(bordering.size).toBe(12)
    const result = calc_structure_id(crystal, { skip_csp: true })
    if (!result.cna_types) throw new Error(`cna_types was not computed`)
    expect(result.cna_types[0]).toBe(CNA_TYPES.other)
    expect(result.cna_types[dup_idx]).toBe(CNA_TYPES.other)
    const far_misclassified = [...result.cna_types].filter(
      (code, idx) =>
        code !== CNA_TYPES.fcc && idx !== 0 && idx !== dup_idx && !bordering.has(idx),
    )
    expect(far_misclassified).toHaveLength(0)
    expect(result.populations.fcc).toBeGreaterThanOrEqual(108 - 12)
  })
})

describe(`common neighbor analysis`, () => {
  // Dilated fcc exercises a-CNA's lattice-constant independence: no a is supplied, so an
  // isotropically strained crystal must classify the same as an unstrained one.
  test.each([
    [`fcc`, () => make_fcc([4, 4, 4]), `fcc` as const, 256],
    [`bcc`, () => make_bcc([4, 4, 4]), `bcc` as const, 128],
    [`hcp`, () => make_hcp([4, 4, 4]), `hcp` as const, 128],
    [`dilated fcc`, () => make_fcc([3, 3, 3], FCC_LATTICE_CONST * 1.08), `fcc` as const, 108],
  ])(`adaptive CNA classifies a perfect %s supercell`, (_label, build, expected, n_atoms) => {
    const result = calc_structure_id(build(), { skip_csp: true })
    expect(result.n_atoms).toBe(n_atoms)
    expect(result.populations[expected]).toBe(n_atoms)
  })

  test.each([
    [`fcc`, () => make_fcc([4, 4, 4]), 0.854 * FCC_LATTICE_CONST, `fcc` as const, 256],
    [`bcc`, () => make_bcc([4, 4, 4]), 1.207 * BCC_LATTICE_CONST, `bcc` as const, 128],
  ])(
    `fixed-cutoff CNA classifies a perfect %s supercell`,
    (_label, build, cutoff, expected, n_atoms) => {
      const result = calc_structure_id(build(), { cna_mode: `fixed`, cutoff, skip_csp: true })
      expect(result.populations[expected]).toBe(n_atoms)
      // with CSP skipped the cutoff query is the only one run
      expect(result.neighbor_cutoff).toBe(cutoff)
    },
  )

  test(`fixed-cutoff CNA with a cutoff meant for the wrong phase misclassifies`, () => {
    // The bcc cutoff swallows the fcc second shell, so no atom has 12 or 14 neighbors
    const result = calc_structure_id(make_fcc([4, 4, 4]), {
      cna_mode: `fixed`,
      cutoff: 1.207 * FCC_LATTICE_CONST,
      skip_csp: true,
    })
    expect(result.populations.fcc).toBe(0)
    expect(result.populations.other).toBe(256)
  })

  // 0.05 Å (~2% of the 2.556 Å nn distance) is thermal noise CNA should ignore; 0.6 Å
  // (~23%) is past where any signature survives.
  test.each([
    [0.05, 1, `fcc` as const, 1],
    [0.6, 0, `other` as const, 0.95],
  ])(
    `%f A random displacements (seed %d): %s fraction >= %f`,
    (amplitude, seed, type, min_frac) => {
      const displaced = with_random_displacements(make_fcc([4, 4, 4]), amplitude, seed)
      const result = calc_structure_id(displaced, { skip_csp: true })
      expect(result.populations[type] / result.n_atoms).toBeGreaterThanOrEqual(min_frac)
    },
  )

  // In fixed mode CSP must not run on the cutoff list: the vacancy's neighbors have only 11
  // atoms inside the fcc cutoff, which used to make their CSP NaN instead of the large value
  // the 12 nearest (one from the second shell) give.
  test.each([
    [`adaptive`, {}],
    [`fixed`, { cna_mode: `fixed` as const, cutoff: 0.854 * FCC_LATTICE_CONST }],
  ])(
    `a vacancy leaves its 12 neighbors unclassified and raises their CSP (%s CNA)`,
    (_mode, options) => {
      const perfect = make_fcc([4, 4, 4])
      const removed_idx = 130 // an atom well away from the cell corner
      const distances = distances_to(perfect, removed_idx)
      const nn_dist = fcc_nn_distance()
      // Indices in the defective structure of the atoms that bordered the vacancy
      const neighbor_indices = new Set(
        distances
          .map((dist, idx) => ({ dist, idx }))
          .filter(({ dist }) => dist > 1e-9 && dist < nn_dist * 1.01)
          .map(({ idx }) => (idx > removed_idx ? idx - 1 : idx)),
      )
      expect(neighbor_indices.size).toBe(12)

      const result = calc_structure_id(with_vacancy(perfect, removed_idx), options)
      expect(result.n_atoms).toBe(255)
      expect(result.populations.other).toBe(12)
      expect(result.populations.fcc).toBe(243)
      expect(result.n_csp_undefined).toBe(0)
      if (!result.centrosymmetry) throw new Error(`centrosymmetry was not computed`)
      const csp = result.centrosymmetry
      const affected = [...neighbor_indices].map((idx) => csp[idx])
      const untouched = [...csp.keys()]
        .filter((idx) => !neighbor_indices.has(idx))
        .map((idx) => csp[idx])
      const min_affected = Math.min(...affected)
      const max_untouched = Math.max(...untouched)
      // A missing 1/2<110> bond of length 2.556 Å leaves its opposite unpaired, so the term is
      // |r|² = 6.53 Å². The smallest-sums pairing recovers part of that by reusing a neighbor in
      // more than one term, so require a clear separation rather than the ideal value.
      expect(min_affected).toBeGreaterThan(1)
      expect(max_untouched).toBeLessThan(PERFECT_CSP_TOLERANCE)
    },
  )

  test(`the center of a 13-atom icosahedron is the only ICO atom`, () => {
    // Exercises the 12 x (5,5,5) branch: each neighbor of the center shares exactly its five
    // icosahedral edge partners with the center, and those five form a pentagon (5 bonds in
    // one ring, so the longest chain is 5). The 12 vertices themselves are surface atoms.
    const result = calc_structure_id(make_icosahedron(), { skip_csp: true })
    expect(result.cna_types?.[0]).toBe(CNA_TYPES.ico)
    expect(result.populations.ico).toBe(1)
    expect(result.populations.other).toBe(12)
  })

  test(`calc_cna bonds neighbors at the radius the list was built with`, () => {
    const crystal = make_fcc([2, 2, 2])
    const fcc_list = neighbor_query(crystal, { cutoff: 0.854 * FCC_LATTICE_CONST })
    expect(Array.from(calc_cna(fcc_list, `fixed`))).toEqual(Array(32).fill(CNA_TYPES.fcc))
    // the bcc radius admits the fcc second shell: 18 neighbors, never 12 or 14
    const wide_list = neighbor_query(crystal, { cutoff: 1.207 * FCC_LATTICE_CONST })
    expect(Array.from(calc_cna(wide_list, `fixed`))).toEqual(Array(32).fill(CNA_TYPES.other))
  })

  test(`cna_type_name maps every code and rejects the rest`, () => {
    for (const [name, code] of Object.entries(CNA_TYPES)) {
      expect(cna_type_name(code)).toBe(name)
    }
    expect(() => cna_type_name(5)).toThrow(/not a CNA type code/)
  })
})

describe(`centrosymmetry`, () => {
  // Dilated fcc: Kelchner's CSP stays 0 under affine deformation — a strained perfect crystal
  // is still centrosymmetric, so the score must remain at round-off.
  test.each([
    [`fcc`, () => make_fcc([4, 4, 4]), 12],
    [`bcc`, () => make_bcc([4, 4, 4]), 8],
    [`dilated fcc`, () => make_fcc([3, 3, 3], FCC_LATTICE_CONST * 1.15), 12],
  ])(`a perfect %s lattice has CSP = 0 to round-off`, (_label, build, n_csp_neighbors) => {
    const result = calc_structure_id(build(), { skip_cna: true, n_csp_neighbors })
    if (!result.centrosymmetry) throw new Error(`centrosymmetry was not computed`)
    expect(result.n_csp_undefined).toBe(0)
    expect(max_finite(result.centrosymmetry)).toBeLessThan(PERFECT_CSP_TOLERANCE)
  })

  // N is a property of the lattice (12 close-packed, 8 bcc), so a fixed default cannot suit
  // both: the close-packed 12 lands a DEFECT-FREE bcc crystal at 0.75*a^2 (6.18 A^2 at
  // a = 2.87 A). hcp is genuinely NOT centrosymmetric, so only its N counts.
  test.each<[string, () => Crystal, number | undefined, number, boolean | null]>([
    [`fcc`, () => make_fcc([3, 3, 3]), undefined, 12, true],
    [`bcc`, () => make_bcc([3, 3, 3]), undefined, 8, true],
    [`hcp`, () => make_hcp([3, 3, 3]), undefined, 12, null],
    [`bcc, explicit N wins`, () => make_bcc([3, 3, 3]), 12, 12, false],
  ])(
    `CSP neighbor count on %s`,
    (_label, build, n_csp_neighbors, expected_n, csp_vanishes) => {
      const result = calc_structure_id(build(), { n_csp_neighbors })
      if (!result.centrosymmetry) throw new Error(`centrosymmetry was not computed`)
      expect(result.n_csp_neighbors).toBe(expected_n)
      const max_csp = max_finite(result.centrosymmetry)
      if (csp_vanishes === true) expect(max_csp).toBeLessThan(PERFECT_CSP_TOLERANCE)
      else if (csp_vanishes === false) expect(max_csp).toBeGreaterThan(1)
    },
  )

  // `other` atoms must not vote: a 4-layer bcc Fe slab is half surface, so counting them in
  // the denominator ties the strict majority and falls back to 12, putting 0.75*a^2 back on
  // the slab's crystalline interior. hcp is the converse, its classified atoms close-packed.
  test.each([
    [`bcc`, () => make_bcc([4, 4, 4]), CNA_TYPES.bcc, 8],
    [`hcp`, () => make_hcp([4, 4, 4]), CNA_TYPES.hcp, 12],
  ])(
    `a half-surface %s slab derives its own neighbor count`,
    (_label, build, code, want_n) => {
      const bulk = build()
      const { n_csp_neighbors, centrosymmetry, cna_types } = calc_structure_id({
        ...bulk,
        lattice: { ...bulk.lattice, pbc: [true, true, false] as Pbc },
      })
      if (!centrosymmetry || !cna_types) throw new Error(`analysis missing`)
      expect(n_csp_neighbors).toBe(want_n)
      const interior = [...centrosymmetry].filter((_csp, idx) => cna_types[idx] === code)
      expect(interior.length).toBeGreaterThan(0)
      if (code !== CNA_TYPES.bcc) return
      // the bcc slab is the reachable tie: its surface outnumbers its crystalline interior,
      // which must still read as centrosymmetric
      expect(2 * interior.length).toBeLessThanOrEqual(cna_types.length)
      expect(Math.max(...interior)).toBeLessThan(PERFECT_CSP_TOLERANCE)
    },
  )

  test(`displacing a perfect lattice raises CSP well clear of round-off`, () => {
    const crystal = with_random_displacements(make_fcc([3, 3, 3]), 0.35, 7)
    const result = calc_structure_id(crystal, { skip_cna: true })
    if (!result.centrosymmetry) throw new Error(`centrosymmetry was not computed`)
    // 0.35 Å is ~14% of the 2.556 Å nearest-neighbor distance, so every site loses its
    // inversion symmetry and no site may still read as centrosymmetric.
    expect(Math.min(...result.centrosymmetry)).toBeGreaterThan(0.1)
  })

  test.each([
    [`odd count`, 11, /must be even/],
    [`below 2`, 1, /must be an integer >= 2/],
    [`above the limit`, 34, /exceeds the/],
  ])(`rejects n_csp_neighbors %s`, (_label, n_csp_neighbors, pattern) => {
    expect(() =>
      calc_structure_id(make_fcc([2, 2, 2]), { skip_cna: true, n_csp_neighbors }),
    ).toThrow(pattern)
  })
})

describe(`calc_structure_id plumbing`, () => {
  test(`writes both per-site properties and keeps them consistent with the result`, () => {
    const crystal = make_fcc([2, 2, 2])
    const result = calc_structure_id(crystal)
    apply_structure_id(crystal, result)
    for (const [site_idx, site] of crystal.sites.entries()) {
      expect(site.properties[CNA_TYPE_PROPERTY]).toBe(CNA_TYPES.fcc)
      expect(site.properties[CENTROSYMMETRY_PROPERTY]).toBe(result.centrosymmetry?.[site_idx])
    }
  })

  test(`apply_structure_id refuses a result from a different structure`, () => {
    const result = calc_structure_id(make_fcc([2, 2, 2]))
    expect(() => apply_structure_id(make_fcc([3, 3, 3]), result)).toThrow(
      /result covers 32 atoms but the structure has 108 sites/,
    )
  })

  test.each([
    [`no sites`, { sites: [] }, {}, /structure has no sites/],
    [
      `both analyses skipped`,
      undefined,
      { skip_cna: true, skip_csp: true },
      /nothing to compute/,
    ],
    [
      `fixed mode without a cutoff`,
      undefined,
      { cna_mode: `fixed` as const },
      /needs a positive cutoff.*got undefined/,
    ],
    [
      `fixed mode with a zero cutoff`,
      undefined,
      { cna_mode: `fixed` as const, cutoff: 0 },
      /needs a positive cutoff.*got 0/,
    ],
  ])(`rejects %s`, (_label, structure, options, pattern) => {
    const input = structure ?? make_fcc([2, 2, 2])
    expect(() => calc_structure_id(input as Crystal, options)).toThrow(pattern)
  })

  test(`populations always carry all five keys and sum to the atom count`, () => {
    const result = calc_structure_id(make_hcp([3, 3, 3]), { skip_csp: true })
    expect(Object.keys(result.populations).toSorted()).toEqual(
      [`bcc`, `fcc`, `hcp`, `ico`, `other`].toSorted(),
    )
    const total = Object.values(result.populations).reduce((sum, count) => sum + count, 0)
    expect(total).toBe(result.n_atoms)
  })

  test(`a cluster too small to supply 12 neighbors reports NaN instead of guessing`, () => {
    // 6 atoms and no lattice: nobody can have 12 nearest neighbors, so no CSP is defined
    const { sites } = make_fcc([1, 1, 1]) // 4 atoms
    const cluster = { sites: [...sites, ...make_bcc([1, 1, 1]).sites] } // 6 atoms total
    const result = calc_structure_id(cluster, { skip_cna: true })
    expect(result.n_csp_undefined).toBe(cluster.sites.length)
    expect(result.centrosymmetry?.every(Number.isNaN)).toBe(true)
  })

  // Large-N path: the grid has to hold a ~10k-site supercell without thrashing. Timing lives
  // in perf-baselines.test.ts; this only pins the result.
  test(`a ~10k atom supercell is classified exactly`, { timeout: 30_000 }, () => {
    const crystal = make_fcc([14, 14, 14]) // 4 atoms per cell
    expect(crystal.sites).toHaveLength(10976)
    const result = calc_structure_id(crystal)
    expect(result.populations.fcc).toBe(10976)
    if (!result.centrosymmetry) throw new Error(`centrosymmetry was not computed`)
    expect(max_finite(result.centrosymmetry)).toBeLessThan(PERFECT_CSP_TOLERANCE)
  })

  test(`a non-periodic cluster has CSP well above a periodic crystal`, () => {
    // Dropping the lattice makes the outer atoms non-centrosymmetric; their 12 nearest
    // neighbors still exist, so CSP is defined and must sit far above round-off. Periodic
    // CSP ≈ 0 for the same geometry is covered by the perfect-fcc centrosymmetry case.
    const { sites } = make_fcc([4, 4, 4])
    const cluster = calc_structure_id({ sites }, { skip_cna: true })
    if (!cluster.centrosymmetry) throw new Error(`centrosymmetry was not computed`)
    expect(cluster.n_csp_undefined).toBe(0)
    expect(max_finite(cluster.centrosymmetry)).toBeGreaterThan(10)
  })
})
