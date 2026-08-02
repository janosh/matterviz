import type { Matrix3x3, Vec3 } from '$lib/math'
import { create_lattice_converters, min_image_displacement } from '$lib/math'
import type { Crystal } from '$lib/structure'
import {
  apply_structure_id,
  build_neighbor_list,
  calc_cna,
  calc_structure_id,
  CENTROSYMMETRY_PROPERTY,
  cna_type_name,
  CNA_TYPE_PROPERTY,
  CNA_TYPES,
  find_k_nearest,
  neighbor_count,
  structure_type_fractions,
} from '$lib/structure-id'
import { describe, expect, test } from 'vitest'
import {
  BCC_LATTICE_CONST,
  bcc_nn_distance,
  FCC_LATTICE_CONST,
  fcc_nn_distance,
  make_bcc,
  make_fcc,
  make_hcp,
  make_icosahedron,
  with_random_displacements,
  with_vacancy,
} from './lattices'

// Tolerances are stated as multiples of machine epsilon for f64 (2.22e-16) where the quantity
// is exactly zero in exact arithmetic, and as physically argued absolute values otherwise.
const F64_EPS = Number.EPSILON

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

describe(`neighbor list`, () => {
  test.each([
    [`fcc`, make_fcc([3, 3, 3]), 12, fcc_nn_distance()],
    [`bcc`, make_bcc([3, 3, 3]), 8, bcc_nn_distance()],
  ])(
    `%s: every atom sees the same first shell across periodic boundaries`,
    (_label, crystal, shell_size, nn_dist) => {
      const { list, n_undercoordinated } = find_k_nearest(crystal, 14)
      expect(n_undercoordinated).toBe(0)
      let max_shell_error = 0
      for (let center_idx = 0; center_idx < list.n_centers; center_idx++) {
        expect(neighbor_count(list, center_idx)).toBeGreaterThanOrEqual(14)
        const base = list.offsets[center_idx]
        for (let neighbor = 0; neighbor < shell_size; neighbor++) {
          max_shell_error = Math.max(
            max_shell_error,
            Math.abs(list.distances[base + neighbor] - nn_dist),
          )
        }
      }
      // Ideal lattice coordinates: the first shell distance is exact to round-off
      expect(max_shell_error).toBeLessThan(1e-12)
    },
  )

  test(`neighbor deltas are sorted by ascending distance`, () => {
    const { list } = find_k_nearest(make_fcc([2, 2, 2]), 14)
    for (let center_idx = 0; center_idx < list.n_centers; center_idx++) {
      const [start, end] = [list.offsets[center_idx], list.offsets[center_idx + 1]]
      for (let idx = start + 1; idx < end; idx++) {
        expect(list.distances[idx]).toBeGreaterThanOrEqual(list.distances[idx - 1])
      }
      // deltas must stay in lockstep with distances
      for (let idx = start; idx < end; idx++) {
        const delta_norm = Math.hypot(
          list.deltas[idx * 3],
          list.deltas[idx * 3 + 1],
          list.deltas[idx * 3 + 2],
        )
        expect(Math.abs(delta_norm - list.distances[idx])).toBeLessThan(1e-12)
      }
    }
  })

  test(`adaptive cutoff reaches its ceiling after more than 21 growth steps`, () => {
    const crystal = make_fcc([1, 1, 1])
    crystal.sites = crystal.sites.slice(0, 1)
    crystal.lattice.matrix = [
      [1e12, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
    crystal.lattice.volume = 1e12
    crystal.lattice.pbc = [false, false, false]
    const { list, n_undercoordinated } = find_k_nearest(crystal, 14)
    expect(list.cutoff).toBe(4e12)
    expect(n_undercoordinated).toBe(1)
  })

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

  test.each([
    [`zero cutoff`, 0],
    [`negative cutoff`, -1],
    [`non-finite cutoff`, Number.POSITIVE_INFINITY],
  ])(`build_neighbor_list rejects %s`, (_label, cutoff) => {
    expect(() => build_neighbor_list(make_fcc([2, 2, 2]), { cutoff })).toThrow(
      /cutoff must be a positive finite number/,
    )
  })

  test(`returned buffers are sized to the used neighbor count`, () => {
    // The growable path may over-allocate backing stores; the exposed views must still report
    // exactly the written neighbor count so offsets[n_centers] and .length agree.
    const list = build_neighbor_list(make_fcc([3, 3, 3]), {
      cutoff: 0.854 * FCC_LATTICE_CONST,
    })
    expect(list.distances).toHaveLength(list.offsets[list.n_centers])
    expect(list.deltas).toHaveLength(list.distances.length * 3)
    expect(list.distances).toHaveLength(list.n_centers * 12)
  })

  test.each([
    [`fcc first shell`, () => make_fcc([3, 3, 3]), 0.854 * FCC_LATTICE_CONST],
    [`bcc first shell`, () => make_bcc([3, 3, 3]), 0.95 * BCC_LATTICE_CONST],
    [
      `noisy fcc`,
      () => with_random_displacements(make_fcc([2, 2, 2]), 0.05, 2),
      0.9 * FCC_LATTICE_CONST,
    ],
  ])(`growable buffers match min-image oracle on %s`, (label, build, cutoff) => {
    const crystal = build()
    const list = build_neighbor_list(crystal, { cutoff })
    const converters = create_lattice_converters(crystal.lattice.matrix)
    const { pbc, matrix } = crystal.lattice
    let max_abs_distance = 0
    let max_abs_delta = 0
    for (let center_idx = 0; center_idx < list.n_centers; center_idx++) {
      const center = crystal.sites[center_idx].xyz
      const expected: { distance: number; delta: Vec3 }[] = []
      for (let other_idx = 0; other_idx < crystal.sites.length; other_idx++) {
        if (other_idx === center_idx) continue
        const delta = min_image_displacement(
          center,
          crystal.sites[other_idx].xyz,
          matrix,
          converters,
          pbc,
        )
        // Same formula as build_neighbor_list (sqrt of summed squares), not Math.hypot
        const dist_sq = delta[0] * delta[0] + delta[1] * delta[1] + delta[2] * delta[2]
        if (dist_sq > cutoff * cutoff || dist_sq === 0) continue
        expected.push({ distance: Math.sqrt(dist_sq), delta })
      }
      expected.sort((left, right) => left.distance - right.distance)
      const [start, end] = [list.offsets[center_idx], list.offsets[center_idx + 1]]
      expect(end - start).toBe(expected.length)
      for (let slot = 0; slot < expected.length; slot++) {
        max_abs_distance = Math.max(
          max_abs_distance,
          Math.abs(list.distances[start + slot] - expected[slot].distance),
        )
      }
      // Equal-distance shells are not uniquely ordered. Pair each observed delta to the
      // nearest unused oracle delta so ulp-level component noise cannot reshuffle the zip.
      const unmatched = expected.map((item) => item.delta)
      for (let slot = 0; slot < expected.length; slot++) {
        const observed_delta: Vec3 = [
          list.deltas[(start + slot) * 3],
          list.deltas[(start + slot) * 3 + 1],
          list.deltas[(start + slot) * 3 + 2],
        ]
        let best_idx = 0
        let best_error = Infinity
        for (let expected_idx = 0; expected_idx < unmatched.length; expected_idx++) {
          const delta_error = Math.hypot(
            observed_delta[0] - unmatched[expected_idx][0],
            observed_delta[1] - unmatched[expected_idx][1],
            observed_delta[2] - unmatched[expected_idx][2],
          )
          if (delta_error < best_error) {
            best_error = delta_error
            best_idx = expected_idx
          }
        }
        max_abs_delta = Math.max(max_abs_delta, best_error)
        unmatched.splice(best_idx, 1)
      }
    }
    // Grid path subtracts imaged Cartesian coords; min_image goes through a frac round-trip.
    // Measured maxima on these fixtures are a few ulps (~1e-15 Å); 1e-12 Å is still far
    // below any geometric length that could change neighbor membership at these cutoffs.
    console.info(
      `${label}: max|Δdistance|=${max_abs_distance.toExponential(3)} Å, ` +
        `max|Δdelta|=${max_abs_delta.toExponential(3)} Å`,
    )
    expect(max_abs_distance).toBeLessThan(1e-12)
    expect(max_abs_delta).toBeLessThan(1e-12)
  })

  test(`duplicate coincident site is dropped from the neighbor list`, () => {
    const crystal = make_fcc([1, 1, 1])
    crystal.sites = [
      ...crystal.sites,
      { ...crystal.sites[0], label: `dup`, abc: [...crystal.sites[0].abc] as Vec3 },
    ]
    const list = build_neighbor_list(crystal, { cutoff: 0.854 * FCC_LATTICE_CONST })
    // The duplicate shares the original's coordinates, so neither lists the other (dist_sq === 0)
    expect(neighbor_count(list, 0)).toBe(neighbor_count(list, list.n_centers - 1))
    for (let center_idx = 0; center_idx < list.n_centers; center_idx++) {
      const [start, end] = [list.offsets[center_idx], list.offsets[center_idx + 1]]
      for (let idx = start; idx < end; idx++) {
        expect(list.distances[idx]).toBeGreaterThan(0)
      }
    }
  })

  test(`cluster without lattice matches a Euclidean all-pairs reference`, () => {
    // No lattice → no image replication, so the grid path is a pure Cartesian all-pairs
    // scan and must match a direct O(N²) reference with exact equality.
    const { sites } = make_fcc([2, 2, 2])
    const cutoff = 0.854 * FCC_LATTICE_CONST
    const cutoff_sq = cutoff * cutoff
    const list = build_neighbor_list({ sites }, { cutoff })
    let max_abs_distance = 0
    let max_abs_delta = 0
    for (let center_idx = 0; center_idx < sites.length; center_idx++) {
      const [center_x, center_y, center_z] = sites[center_idx].xyz
      const expected: { distance: number; delta: Vec3 }[] = []
      for (let other_idx = 0; other_idx < sites.length; other_idx++) {
        if (other_idx === center_idx) continue
        const delta: Vec3 = [
          sites[other_idx].xyz[0] - center_x,
          sites[other_idx].xyz[1] - center_y,
          sites[other_idx].xyz[2] - center_z,
        ]
        const dist_sq = delta[0] * delta[0] + delta[1] * delta[1] + delta[2] * delta[2]
        if (dist_sq > cutoff_sq || dist_sq === 0) continue
        expected.push({ distance: Math.sqrt(dist_sq), delta })
      }
      expected.sort((left, right) => left.distance - right.distance)
      const [start, end] = [list.offsets[center_idx], list.offsets[center_idx + 1]]
      expect(end - start).toBe(expected.length)
      for (let slot = 0; slot < expected.length; slot++) {
        max_abs_distance = Math.max(
          max_abs_distance,
          Math.abs(list.distances[start + slot] - expected[slot].distance),
        )
        for (let axis = 0; axis < 3; axis++) {
          max_abs_delta = Math.max(
            max_abs_delta,
            Math.abs(list.deltas[(start + slot) * 3 + axis] - expected[slot].delta[axis]),
          )
        }
      }
    }
    expect(max_abs_distance).toBe(0)
    expect(max_abs_delta).toBe(0)
  })
})

describe(`common neighbor analysis`, () => {
  test.each([
    [`fcc`, () => make_fcc([4, 4, 4]), `fcc` as const, 256],
    [`bcc`, () => make_bcc([4, 4, 4]), `bcc` as const, 128],
    [`hcp`, () => make_hcp([4, 4, 4]), `hcp` as const, 128],
  ])(`adaptive CNA classifies a perfect %s supercell`, (_label, build, expected, n_atoms) => {
    const result = calc_structure_id(build(), { skip_csp: true })
    expect(result.n_atoms).toBe(n_atoms)
    expect(result.populations[expected]).toBe(n_atoms)
    expect(result.populations.other).toBe(0)
    expect(structure_type_fractions(result)[expected]).toBe(1)
  })

  test.each([
    [`fcc`, () => make_fcc([4, 4, 4]), 0.854 * FCC_LATTICE_CONST, `fcc` as const, 256],
    [`bcc`, () => make_bcc([4, 4, 4]), 1.207 * BCC_LATTICE_CONST, `bcc` as const, 128],
  ])(
    `fixed-cutoff CNA classifies a perfect %s supercell`,
    (_label, build, cutoff, expected, n_atoms) => {
      const result = calc_structure_id(build(), { cna_mode: `fixed`, cutoff, skip_csp: true })
      expect(result.populations[expected]).toBe(n_atoms)
      expect(result.cutoff).toBe(cutoff)
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

  test(`adaptive CNA is invariant under isotropic dilation`, () => {
    // The whole point of a-CNA: no lattice constant is supplied, so a strained crystal
    // classifies the same as an unstrained one.
    const strained = calc_structure_id(make_fcc([3, 3, 3], FCC_LATTICE_CONST * 1.08), {
      skip_csp: true,
    })
    expect(strained.populations.fcc).toBe(108)
  })

  // 0.05 Å (~2% of the 2.556 Å nn distance) is thermal noise CNA should ignore; 0.6 Å
  // (~23%) is past where any signature survives.
  test.each([
    [`small (0.05 Å) leave fcc intact`, 0.05, 1, { fcc: 256 } as const],
    [`large (0.6 Å) degrade to Other`, 0.6, 0, { other_min_frac: 0.95 } as const],
  ])(`random displacements %s`, (_label, amplitude, seed, expected) => {
    const result = calc_structure_id(
      with_random_displacements(make_fcc([4, 4, 4]), amplitude, seed),
      { skip_csp: true },
    )
    if (`fcc` in expected) expect(result.populations.fcc).toBe(expected.fcc)
    if (`other_min_frac` in expected) {
      expect(result.populations.other / result.n_atoms).toBeGreaterThan(
        expected.other_min_frac,
      )
    }
  })

  test(`a vacancy leaves its 12 neighbors unclassified and raises their CSP`, () => {
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

    const result = calc_structure_id(with_vacancy(perfect, removed_idx))
    expect(result.n_atoms).toBe(255)
    expect(result.populations.other).toBe(12)
    expect(result.populations.fcc).toBe(243)
    if (!result.centrosymmetry) throw new Error(`centrosymmetry was not computed`)
    const csp = result.centrosymmetry
    const affected = [...neighbor_indices].map((idx) => csp[idx])
    const untouched = [...csp.keys()]
      .filter((idx) => !neighbor_indices.has(idx))
      .map((idx) => csp[idx])
    const min_affected = Math.min(...affected)
    const max_untouched = Math.max(...untouched)
    console.info(
      `vacancy: min CSP on the 12 neighbors = ${min_affected.toFixed(4)} Å², ` +
        `max CSP elsewhere = ${max_untouched.toExponential(3)} Å²`,
    )
    // A missing 1/2<110> bond of length 2.556 Å leaves its opposite unpaired, so the term is
    // |r|² = 6.53 Å². The smallest-sums pairing recovers part of that by reusing a neighbor in
    // more than one term, so require a clear separation rather than the ideal value.
    expect(min_affected).toBeGreaterThan(1)
    expect(max_untouched).toBeLessThan(PERFECT_CSP_TOLERANCE)
  })

  test(`the center of a 13-atom icosahedron is the only ICO atom`, () => {
    // Exercises the 12 x (5,5,5) branch: each neighbor of the center shares exactly its five
    // icosahedral edge partners with the center, and those five form a pentagon (5 bonds in
    // one ring, so the longest chain is 5). The 12 vertices themselves are surface atoms.
    const result = calc_structure_id(make_icosahedron(), { skip_csp: true })
    expect(result.cna_types?.[0]).toBe(CNA_TYPES.ico)
    expect(result.populations.ico).toBe(1)
    expect(result.populations.other).toBe(12)
  })

  test(`calc_cna refuses a neighbor list built at a different cutoff`, () => {
    const cutoff = 0.854 * FCC_LATTICE_CONST
    const list = build_neighbor_list(make_fcc([2, 2, 2]), { cutoff })
    expect(() => calc_cna(list, `fixed`, cutoff * 1.2)).toThrow(
      /needs a cutoff equal to the .* the neighbor list was built with/,
    )
    // A missing cutoff is caught by the same check
    expect(() => calc_cna(list, `fixed`)).toThrow(/got undefined/)
    // The matching cutoff is accepted
    expect(calc_cna(list, `fixed`, cutoff)[0]).toBe(CNA_TYPES.fcc)
  })

  test(`cna_type_name maps every code and rejects the rest`, () => {
    for (const [name, code] of Object.entries(CNA_TYPES)) {
      expect(cna_type_name(code)).toBe(name)
    }
    expect(() => cna_type_name(5)).toThrow(/not a CNA type code/)
  })
})

describe(`centrosymmetry`, () => {
  test.each([
    [`fcc`, () => make_fcc([4, 4, 4]), 12],
    [`bcc`, () => make_bcc([4, 4, 4]), 8],
  ])(`a perfect %s lattice has CSP = 0 to round-off`, (label, build, n_csp_neighbors) => {
    const result = calc_structure_id(build(), { skip_cna: true, n_csp_neighbors })
    if (!result.centrosymmetry) throw new Error(`centrosymmetry was not computed`)
    const observed_max = max_finite(result.centrosymmetry)
    // Printed so the report can quote the measured number rather than the bound
    console.info(
      `perfect ${label} max CSP = ${observed_max.toExponential(3)} Å² ` +
        `(${(observed_max / F64_EPS).toExponential(2)} x f64 eps)`,
    )
    expect(result.n_csp_undefined).toBe(0)
    expect(observed_max).toBeLessThan(PERFECT_CSP_TOLERANCE)
  })

  test(`displacing a perfect lattice raises CSP well clear of round-off`, () => {
    const crystal = with_random_displacements(make_fcc([3, 3, 3]), 0.35, 7)
    const result = calc_structure_id(crystal, { skip_cna: true })
    if (!result.centrosymmetry) throw new Error(`centrosymmetry was not computed`)
    // 0.35 Å is ~14% of the 2.556 Å nearest-neighbor distance, so every site loses its
    // inversion symmetry and no site may still read as centrosymmetric.
    const min_csp = Math.min(...result.centrosymmetry)
    console.info(`displaced fcc: min CSP = ${min_csp.toFixed(4)} Å²`)
    expect(min_csp).toBeGreaterThan(0.1)
  })

  test(`CSP is unchanged by an affine dilation up to the square of the strain`, () => {
    // Kelchner's CSP is invariant under affine deformation in the sense that a centrosymmetric
    // site stays centrosymmetric; a dilated perfect crystal must still score 0.
    const result = calc_structure_id(make_fcc([3, 3, 3], FCC_LATTICE_CONST * 1.15), {
      skip_cna: true,
    })
    if (!result.centrosymmetry) throw new Error(`centrosymmetry was not computed`)
    expect(max_finite(result.centrosymmetry)).toBeLessThan(PERFECT_CSP_TOLERANCE)
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
      /needs a positive cutoff/,
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
    const fractions = structure_type_fractions(result)
    expect(Object.values(fractions).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12)
  })

  test(`a cluster too small to supply 12 neighbors reports NaN instead of guessing`, () => {
    // 6 atoms and no lattice: nobody can have 12 nearest neighbors, so no CSP is defined
    const { sites } = make_fcc([1, 1, 1]) // 4 atoms
    const cluster = { sites: [...sites, ...make_bcc([1, 1, 1]).sites] } // 6 atoms total
    const result = calc_structure_id(cluster, { skip_cna: true })
    expect(result.n_csp_undefined).toBe(cluster.sites.length)
    expect(result.centrosymmetry?.every(Number.isNaN)).toBe(true)
  })

  test(`a ~10k atom supercell stays interactive`, { timeout: 30_000 }, () => {
    const crystal = make_fcc([14, 14, 14]) // 4 atoms per cell
    expect(crystal.sites).toHaveLength(10976)
    const started = performance.now()
    const result = calc_structure_id(crystal)
    const elapsed_ms = performance.now() - started
    console.info(
      `10976-atom fcc: CNA + CSP in ${elapsed_ms.toFixed(0)} ms ` +
        `(${((elapsed_ms * 1000) / crystal.sites.length).toFixed(1)} µs/atom), ` +
        `neighbor cutoff ${result.neighbor_cutoff.toFixed(2)} Å`,
    )
    expect(result.populations.fcc).toBe(10976)
    if (!result.centrosymmetry) throw new Error(`centrosymmetry was not computed`)
    expect(max_finite(result.centrosymmetry)).toBeLessThan(PERFECT_CSP_TOLERANCE)
    // Generous ceiling: this guards against an accidental O(N²) regression, not against
    // machine-to-machine variation.
    expect(elapsed_ms).toBeLessThan(20000)
  })

  test(`a non-periodic cluster still ranks its surface above its interior`, () => {
    // Dropping the lattice makes the outer atoms non-centrosymmetric; their 12 nearest
    // neighbors still exist, so CSP is defined and must be far above the interior's.
    const { sites, lattice } = make_fcc([4, 4, 4])
    const cluster = calc_structure_id({ sites }, { skip_cna: true })
    const periodic = calc_structure_id({ sites, lattice }, { skip_cna: true })
    if (!cluster.centrosymmetry || !periodic.centrosymmetry) {
      throw new Error(`centrosymmetry was not computed`)
    }
    expect(cluster.n_csp_undefined).toBe(0)
    expect(periodic.n_csp_undefined).toBe(0)
    expect(max_finite(periodic.centrosymmetry)).toBeLessThan(PERFECT_CSP_TOLERANCE)
    expect(max_finite(cluster.centrosymmetry)).toBeGreaterThan(10)
  })
})
