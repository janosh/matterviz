import * as math from '#lib/math.js'
import type { Matrix3x3 } from '#lib/math.js'
import {
  calculate_all_pair_rdfs,
  calculate_rdf,
  rdf_bin_site_index,
  rdf_bin_sites,
  shell_volume,
} from '#lib/rdf/calc-rdf.js'
import { coordination_number } from '#lib/rdf/calc-pdf.js'
import type { RdfPattern } from '#lib/rdf/index.js'
import type { Crystal, Pbc } from '#lib/structure/index.js'
import { neighbor_query } from '#lib/structure/bonding.js'
import { make_supercell } from '#lib/structure/supercell.js'
import { is_crystal } from '#lib/structure/validation.js'
import { structure_map } from '#site/structures.js'
import { describe, expect, test } from 'vitest'
import { max_abs_error } from '../numeric-helpers'
import { make_crystal, make_rocksalt } from '../test-fixtures'

const fixture = (identifier: string): Crystal => {
  const structure = structure_map.get(identifier)
  if (!structure || !is_crystal(structure))
    throw new Error(`Test crystal ${identifier} not found`)
  return structure
}
const lu_al_structure = fixture(`mp-1234`)
const pd_structure = fixture(`mp-2`)
const bi2zr2o8_structure = fixture(`Bi2Zr2O8-Fm3m`)

const bin_width = ({ r: radius }: RdfPattern) => radius[1] - radius[0]
// Every unordered pair of the (alphabetically sorted) elements, in calculate_all_pair_rdfs order
const sorted_pairs = (...elements: string[]): [string, string][] =>
  elements
    .toSorted()
    .flatMap((el_a, idx, sorted) =>
      sorted.slice(idx).map((el_b): [string, string] => [el_a, el_b]),
    )
// Number of `density` atoms around one centre in the shell [r_min, r_max)
const shell_coordination = (
  pattern: RdfPattern,
  density: number,
  r_min: number,
  r_max: number,
): number => coordination_number(pattern, density, { r_min, r_max })

// Every shell of a simple cubic lattice with parameter `a_len` inside `cutoff`: shell radius
// and the number of lattice points on it
const simple_cubic_shells = (a_len: number, cutoff: number): Map<number, number> => {
  const reach = Math.ceil(cutoff / a_len)
  const span = Array.from({ length: 2 * reach + 1 }, (_unused, idx) => idx - reach)
  const shells = new Map<number, number>()
  for (const row_index of span) {
    for (const col_index of span) {
      for (const depth_index of span) {
        const dist = a_len * Math.hypot(row_index, col_index, depth_index)
        if (dist > 0 && dist < cutoff) shells.set(dist, (shells.get(dist) ?? 0) + 1)
      }
    }
  }
  return shells
}

// Rocksalt NaCl in the conventional cell: Na-Cl at a/2 (6), Na-Na at a/√2 (12)
const ROCKSALT_A = 5.6
const rocksalt = make_rocksalt(ROCKSALT_A)

describe(`calculate_rdf`, () => {
  test(`simple cubic: every shell's height and coordination number are exact`, () => {
    const [a_len, cutoff, n_bins] = [4, 15, 150]
    const pattern = calculate_rdf(make_crystal(a_len, [[`Si`, [0, 0, 0]]]), { cutoff, n_bins })
    const density = 1 / a_len ** 3
    const delta_r = bin_width(pattern)
    expect(pattern.r).toHaveLength(n_bins)
    expect(pattern.r.every((rad, idx) => Math.abs(rad - (idx + 0.5) * delta_r) < 1e-12)).toBe(
      true,
    )
    // Each shell lands wholly in the bin holding its radius, at height n / (ρ · shell volume)
    const expected = Array<number>(n_bins).fill(0)
    for (const [dist, count] of simple_cubic_shells(a_len, cutoff)) {
      const bin = Math.floor(dist / delta_r + 1e-9)
      expected[bin] += count / (density * shell_volume(pattern.r[bin], delta_r))
    }
    expect(max_abs_error(pattern.g_r, expected)).toBeLessThan(1e-9)
    expect(shell_coordination(pattern, density, 0, 1.2 * a_len)).toBeCloseTo(6, 9)
    expect(shell_coordination(pattern, density, 1.2 * a_len, 1.6 * a_len)).toBeCloseTo(12, 9)
    expect(shell_coordination(pattern, density, 1.6 * a_len, 1.9 * a_len)).toBeCloseTo(8, 9)
  })

  // The ideal-gas tail limit (g(r) -> 1 for uncorrelated points) is pinned on the same
  // calculate_rdf core by calc-pdf.test.ts (`disordered cell`), with a sharper bound.

  test(`rocksalt partials: Na-Cl first shell is 6 at a/2, Na-Na is 12 at a/√2, Cl-Na = Na-Cl`, () => {
    const opts = { cutoff: 6, n_bins: 60 }
    const partial = (center: string, neighbor: string) =>
      calculate_rdf(rocksalt, { ...opts, center_species: center, neighbor_species: neighbor })
    const [na_cl, na_na, cl_na] = [
      partial(`Na`, `Cl`),
      partial(`Na`, `Na`),
      partial(`Cl`, `Na`),
    ]
    const species_density = 4 / ROCKSALT_A ** 3
    expect(na_cl.element_pair).toEqual([`Na`, `Cl`])
    // exactly one shell below 3.5 Å, centred on a/2 = 2.8 Å
    const [first_bin] = na_cl.g_r.flatMap((val, idx) => (val > 0 ? [idx] : []))
    expect(na_cl.r[first_bin]).toBeCloseTo(ROCKSALT_A / 2 + bin_width(na_cl) / 2, 12)
    expect(shell_coordination(na_cl, species_density, 0, 3.5)).toBeCloseTo(6, 9)
    expect(shell_coordination(na_na, species_density, 0, 4.5)).toBeCloseTo(12, 9)
    expect(max_abs_error(na_cl.g_r, cl_na.g_r)).toBeLessThan(1e-12)
  })

  // The full g(r) is the concentration-weighted sum Σ_ab c_a c_b g_ab(r) over ORDERED pairs;
  // a naive mean of the unordered partials is wrong for anything but a 1:1 binary
  test.each([
    [`rocksalt`, rocksalt],
    [
      `vacant rocksalt`,
      {
        ...rocksalt,
        sites: rocksalt.sites.map((site) => ({
          ...site,
          species: site.species.map((spec) => ({
            ...spec,
            occu: spec.element === `Na` ? 0.5 : 1,
          })),
        })),
      },
    ],
    [`Bi2Zr2O8`, bi2zr2o8_structure],
    [`Lu-Al`, lu_al_structure],
  ])(`full g(r) of %s equals Σ c_a c_b g_ab(r) over the partials`, (_name, structure) => {
    const opts = { cutoff: 7, n_bins: 70 }
    const full = calculate_rdf(structure, opts)
    const partials = calculate_all_pair_rdfs(structure, opts)
    const counts: Record<string, number> = {}
    for (const { species } of structure.sites) {
      for (const { element, occu } of species) counts[element] = (counts[element] ?? 0) + occu
    }
    const n_atoms = Object.values(counts).reduce((sum, count) => sum + count, 0)
    const weighted = full.r.map((_rad, idx) =>
      partials.reduce((sum, { element_pair, g_r }) => {
        if (!element_pair) throw new Error(`partial without element_pair`)
        const [el_a, el_b] = element_pair
        const multiplicity = el_a === el_b ? 1 : 2
        return sum + (multiplicity * counts[el_a] * counts[el_b] * g_r[idx]) / n_atoms ** 2
      }, 0),
    )
    expect(max_abs_error(full.g_r, weighted)).toBeLessThan(1e-12)
    const naive_mean = full.r.map(
      (_rad, idx) => partials.reduce((sum, { g_r }) => sum + g_r[idx], 0) / partials.length,
    )
    expect(max_abs_error(full.g_r, naive_mean)).toBeGreaterThan(0.1)
  })

  test(`mixed-occupancy sites weight pairs by the occupancy product`, () => {
    // Na0.5K0.5Cl: the disordered cation site counts half towards each partial, so the
    // Na-Cl and K-Cl partials coincide and each cation sees the full 6 Cl neighbours
    const mixed: Crystal = {
      ...rocksalt,
      sites: rocksalt.sites.map((site) =>
        site.species[0].element === `Na`
          ? {
              ...site,
              species: [
                { element: `Na`, occu: 0.2, oxidation_state: 1 },
                { element: `Na`, occu: 0.3, oxidation_state: 1 },
                { element: `K`, occu: 0.5, oxidation_state: 1 },
                { element: `Ar`, occu: 0, oxidation_state: 0 },
                { element: `He`, occu: 0, oxidation_state: 0 },
              ],
            }
          : site,
      ),
    }
    const opts = { cutoff: 4, n_bins: 40 }
    const partials = calculate_all_pair_rdfs(mixed, opts)
    expect(partials.map((partial) => partial.element_pair)).toEqual(
      sorted_pairs(`Na`, `K`, `Ar`, `He`, `Cl`),
    )
    for (const { element_pair, g_r } of partials) {
      const [center_species, neighbor_species] = element_pair ?? []
      expect(g_r).toEqual(
        calculate_rdf(mixed, { ...opts, center_species, neighbor_species }).g_r,
      )
    }
    const by_pair = Object.fromEntries(
      partials.map((partial) => [partial.element_pair?.join(`-`), partial]),
    )
    expect(max_abs_error(by_pair[`Cl-K`].g_r, by_pair[`Cl-Na`].g_r)).toBeLessThan(1e-12)
    // N_Cl / V is the density of the neighbour species around each (half-occupied) K
    expect(shell_coordination(by_pair[`Cl-K`], 4 / ROCKSALT_A ** 3, 0, 3.5)).toBeCloseTo(6, 9)
    // K-Na: 12 cation neighbours at a/√2, half of them Na, seen from a half-K site
    expect(shell_coordination(by_pair[`K-Na`], 2 / ROCKSALT_A ** 3, 3.5, 4)).toBeCloseTo(6, 9)
  })

  test.each([
    [`1D chain`, [true, false, false] as Pbc, undefined, 2],
    [`2D square net`, [true, true, false] as Pbc, undefined, 4],
    [`3D`, [true, true, true] as Pbc, undefined, 6],
    // without a pbc option the lattice's own flags decide; an explicit option overrides them
    [`open lattice`, undefined, [false, false, false] as Pbc, 0],
    [`open lattice, forced`, [true, true, true] as Pbc, [false, false, false] as Pbc, 6],
  ])(`%s: pbc %j images only along periodic axes`, (_name, pbc, lattice_pbc, first_shell) => {
    const a_len = 5
    const crystal = make_crystal(a_len, [[`Si`, [0, 0, 0]]], { pbc: lattice_pbc })
    const pattern = calculate_rdf(crystal, { cutoff: 9, n_bins: 90, pbc })
    expect(shell_coordination(pattern, 1 / a_len ** 3, 4.5, 5.5)).toBeCloseTo(first_shell, 9)
    if (!first_shell) expect(pattern.g_r).toEqual(Array(90).fill(0))
  })

  test(`distances are binned over the half-open range [0, cutoff)`, () => {
    const one_atom = make_crystal(5, [[`Si`, [0, 0, 0]]])
    // nearest images sit exactly at the cutoff and are excluded...
    expect(calculate_rdf(one_atom, { cutoff: 5, n_bins: 50 }).g_r).toEqual(Array(50).fill(0))
    // ...and a shell exactly on a bin edge lands in the upper bin, as one shell, not split
    const at_edge = calculate_rdf(one_atom, { cutoff: 6, n_bins: 60 })
    const nonzero = at_edge.g_r.flatMap((val, idx) => (val > 0 ? [idx] : []))
    expect(nonzero).toEqual([50])
    expect(at_edge.r[50]).toBeCloseTo(5.05, 12)
  })

  test(`species absent from the structure give an all-zero partial`, () => {
    const { g_r, element_pair } = calculate_rdf(pd_structure, {
      center_species: `Au`,
      neighbor_species: `Au`,
    })
    expect(element_pair).toEqual([`Au`, `Au`])
    expect(g_r).toEqual(Array(75).fill(0))
  })

  test(`skewed triclinic cell: the first shell is the minimum-image pair distance`, () => {
    const lattice: Matrix3x3 = [
      [5, 0, 0],
      [1, 6, 0],
      [0.5, 1.5, 7],
    ]
    // Second atom sits near the far corner, so the short contact only exists through images
    const structure = make_crystal(lattice, [
      { element: `Si`, xyz: [0.2, 0.3, 0.4] },
      { element: `Si`, xyz: [5.9, 6.8, 6.6] },
    ])
    const [cutoff, n_bins] = [4.5, 45]
    const pattern = calculate_rdf(structure, { cutoff, n_bins })
    const nearest = math.pbc_dist(structure.sites[0].xyz, structure.sites[1].xyz, lattice)
    expect(nearest).toBeLessThan(2)
    expect(pattern.g_r.findIndex((val) => val > 0)).toBe(
      Math.floor(nearest / (cutoff / n_bins)),
    )
    // exactly one partner at that distance per atom (density of the 2-atom cell is 2/V)
    const volume = math.calc_lattice_params(lattice).volume
    expect(shell_coordination(pattern, 2 / volume, 0, nearest + 0.1)).toBeCloseTo(1, 9)
  })

  test.each([
    [`negative cutoff`, { cutoff: -5, n_bins: 50 }, /cutoff must be a positive finite/],
    [`zero bins`, { cutoff: 10, n_bins: 0 }, /n_bins must be a positive integer/],
    [`NaN cutoff`, { cutoff: Number.NaN, n_bins: 10 }, /cutoff must be a positive finite/],
    // Infinity passes `> 0`; `got cutoff=` pins the caller-side check rather than the
    // near-identical neighbor_query message that used to surface instead
    [`Infinity cutoff`, { cutoff: Infinity, n_bins: 10 }, /number, got cutoff=Infinity/],
    // `n_bins > 0` bounded neither the allocation (480 MB at 1e7 on a 3-element cell) nor the
    // type (2.5 reached `Array(2.5)`, a bare RangeError)
    [`fractional bins`, { cutoff: 10, n_bins: 2.5 }, /n_bins must be a positive integer/],
    [`1e7 bins`, { cutoff: 10, n_bins: 1e7 }, /n_bins must be a positive integer <= 1000000/],
  ])(`throws on %s`, (_name, opts, pattern) => {
    expect(() => calculate_rdf(pd_structure, opts)).toThrow(pattern)
  })

  // oxfmt-ignore
  test.each([undefined, [[1, 0, 0], [0, 1, 0], [0, 0, 0]], [[NaN, 0, 0], [0, 1, 0], [0, 0, 1]]])(
    `rejects invalid normalisation cell %s`, (matrix) => {
    const structure = {
      sites: pd_structure.sites,
      ...(matrix && { lattice: { matrix } }),
    } as Crystal
    for (const calculate of [calculate_rdf, calculate_all_pair_rdfs]) {
      expect(() => calculate(structure)).toThrow(/unit cell/)
    }
  })
})

describe(`calculate_all_pair_rdfs`, () => {
  const five_species = make_crystal(5, [
    [`Si`, [0, 0, 0]],
    [`Na`, [0.2, 0.2, 0.2]],
    [`Cl`, [0.4, 0.4, 0.4]],
    [`K`, [0.6, 0.6, 0.6]],
    [`Al`, [0.8, 0.8, 0.8]],
  ])
  test.each<[string, Crystal, [string, string][]]>([
    [`Lu-Al`, lu_al_structure, sorted_pairs(`Lu`, `Al`)],
    [`Pd`, pd_structure, [[`Pd`, `Pd`]]],
    ...(
      [
        [false, -1],
        [true, -1],
        [false, 0],
        [false, 4],
      ] as const
    ).map<[string, Crystal, [string, string][]]>(([vacancy, mixed_idx]) => [
      `five species, vacancy=${vacancy}, mixed site=${mixed_idx}`,
      {
        ...five_species,
        sites: five_species.sites.map((site, idx) => ({
          ...site,
          species:
            idx === mixed_idx
              ? [...site.species, { element: `Cl`, occu: 0.3, oxidation_state: 0 }]
              : vacancy && idx === 0
                ? site.species.map((species) => ({ ...species, occu: 0 }))
                : site.species,
        })),
      },
      sorted_pairs(`Si`, `Na`, `Cl`, `K`, `Al`),
    ]),
  ])(
    `%s: one pattern per unordered pair, sorted, matching calculate_rdf`,
    (_name, structure, pairs) => {
      for (const pbc of [
        [true, true, true],
        [true, false, false],
        [false, false, false],
      ] as Pbc[]) {
        const opts = { cutoff: 8, n_bins: 50, pbc }
        const patterns = calculate_all_pair_rdfs(structure, opts)
        const { offsets, neighbors, distances } = neighbor_query(structure, {
          cutoff: opts.cutoff,
          pbc,
          sorted: false,
        })
        expect(patterns.map((pattern) => pattern.element_pair)).toEqual(pairs)
        for (const { element_pair, r: radius, g_r } of patterns) {
          const [center_species, neighbor_species] = element_pair ?? []
          const direct = calculate_rdf(structure, {
            ...opts,
            center_species,
            neighbor_species,
          })
          expect(radius).toBe(patterns[0].r)
          expect(g_r).toEqual(direct.g_r)
          // Independent materialized-list reference catches missed directed contacts and
          // mixed-occupancy dispatch errors in the streaming histogram. Reordering positive
          // additions has relative error <= 2*n*eps across the two summation orders.
          const weights = [center_species, neighbor_species].map((element) =>
            structure.sites.map(({ species }) =>
              species.reduce(
                (sum, spec) => sum + (spec.element === element ? spec.occu : 0),
                0,
              ),
            ),
          )
          const expected = Array<number>(opts.n_bins).fill(0)
          const bin_size = opts.cutoff / opts.n_bins
          for (let center = 0; center < structure.sites.length; center++) {
            for (let slot = offsets[center]; slot < offsets[center + 1]; slot++) {
              const bin = Math.floor(distances[slot] / bin_size + 1e-9)
              if (distances[slot] > 0 && bin < opts.n_bins) {
                expected[bin] += weights[0][center] * weights[1][neighbors[slot]]
              }
            }
          }
          const pair_weight = weights.reduce(
            (product, values) => product * values.reduce((sum, weight) => sum + weight, 0),
            1,
          )
          const { volume } = math.calc_lattice_params(structure.lattice.matrix)
          const relative_tolerance = 2 * distances.length * Number.EPSILON
          for (let bin = 0; bin < opts.n_bins; bin++) {
            if (pair_weight > 0)
              expected[bin] /= (pair_weight * shell_volume(radius[bin], bin_size)) / volume
            expect(Math.abs(g_r[bin] - expected[bin])).toBeLessThanOrEqual(
              relative_tolerance * Math.abs(expected[bin]),
            )
          }
        }
      }
    },
  )
})

describe(`rdf_bin_sites`, () => {
  const options = { cutoff: 8, n_bins: 80 }

  // Re-finding a bin's pairs with a search cut at that bin's upper edge must recover exactly
  // the contacts the full-cutoff histogram counted, in every bin (empty ones included).
  // Ordered structures carry unit occupancies, so counts are integers up to division round-off
  // (~1e-15 relative); 1e-9 absolute is far below one contact.
  test.each<[string, Crystal, [string, string] | undefined]>([
    [`Lu-Al full RDF`, lu_al_structure, undefined],
    [`Lu-Al partial Al-Lu`, lu_al_structure, [`Al`, `Lu`]],
    [`Lu-Al partial Al-Al`, lu_al_structure, [`Al`, `Al`]],
    [`rocksalt partial Cl-Na`, make_rocksalt(), [`Cl`, `Na`]],
  ])(`%s: each bin's pairs are the ones the histogram counted`, (_name, structure, pair) => {
    const [center_species, neighbor_species] = pair ?? []
    const pattern = calculate_rdf(structure, { ...options, center_species, neighbor_species })
    const element_of = (idx: number) => structure.sites[idx].species[0].element
    const count = (element: string) =>
      structure.sites.filter((_site, idx) => element_of(idx) === element).length
    const pair_weight = pair ? count(pair[0]) * count(pair[1]) : structure.sites.length ** 2
    const { volume } = math.calc_lattice_params(structure.lattice.matrix)
    let [max_err, total_pairs] = [0, 0]
    // the one-search index of every bin finds exactly what each per-bin search does
    const index = rdf_bin_site_index(structure, { ...options, element_pair: pair })
    for (const [bin_idx, g_val] of pattern.g_r.entries()) {
      // undo the ideal-gas normalisation: the raw (ordered-pair) count the histogram binned
      const shell = shell_volume(pattern.r[bin_idx], bin_width(pattern))
      const raw_count = (g_val * pair_weight * shell) / volume
      const found = rdf_bin_sites(structure, { ...options, bin_idx, element_pair: pair })
      expect(index(bin_idx)).toEqual(found)
      max_err = Math.max(max_err, Math.abs(found.n_pairs - raw_count))
      total_pairs += found.n_pairs
      // a partial's centres carry its first element, their partners its second
      if (pair) {
        expect(found.site_indices.every((idx) => element_of(idx) === pair[0])).toBe(true)
        expect(found.neighbor_indices.every((idx) => element_of(idx) === pair[1])).toBe(true)
      }
    }
    expect(max_err).toBeLessThan(1e-9)
    expect(total_pairs).toBeGreaterThan(0)
  })

  // 1000 sites on 200k bins would take 51 MB of bitsets: past the budget each bin gets its own
  // search, the same answer for no retained memory
  test(`answers bins by per-bin searches when the bitsets exceed their budget`, () => {
    const structure = make_supercell(make_rocksalt(ROCKSALT_A), [5, 5, 5])
    const fine = { cutoff: 4, n_bins: 200_000 }
    const before = process.memoryUsage().arrayBuffers
    const index = rdf_bin_site_index(structure, fine)
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(1024 ** 2)
    // the Na-Cl shell at a/2 = 2.8 A, its empty neighbour bin and the last bin
    for (const bin_idx of [140_000, 140_001, 199_999]) {
      expect(index(bin_idx)).toEqual(rdf_bin_sites(structure, { ...fine, bin_idx }))
    }
    expect(index(140_000).n_pairs).toBe(6 * structure.sites.length)
    expect(() => index(200_000)).toThrow(`bin_idx must be an integer in [0, 200000)`)
  })

  test.each([-1, 80, 2.5])(`rejects bin_idx %s outside the 80-bin grid`, (bin_idx) => {
    const message = `bin_idx must be an integer in [0, 80)`
    expect(() => rdf_bin_sites(pd_structure, { ...options, bin_idx })).toThrow(message)
    expect(() => rdf_bin_site_index(pd_structure, options)(bin_idx)).toThrow(message)
  })
})
