import * as math from '$lib/math'
import type { Matrix3x3 } from '$lib/math'
import { calculate_all_pair_rdfs, calculate_rdf } from '$lib/rdf'
import type { RdfPattern } from '$lib/rdf'
import type { Crystal, Pbc } from '$lib/structure'
import { is_crystal } from '$lib/structure/validation'
import { structure_map } from '$site/structures'
import { describe, expect, test } from 'vitest'
import { make_crystal } from '../setup'

const fixture = (id: string): Crystal => {
  const structure = structure_map.get(id)
  if (!structure || !is_crystal(structure)) throw new Error(`Test crystal ${id} not found`)
  return structure
}
const lu_al_structure = fixture(`mp-1234`)
const pd_structure = fixture(`mp-2`)
const bi2zr2o8_structure = fixture(`Bi2Zr2O8-Fm3m`)

const bin_width = ({ r }: RdfPattern) => r[1] - r[0]
const max_abs_diff = (left: number[], right: number[]) =>
  Math.max(...left.map((val, idx) => Math.abs(val - right[idx])))

// n = ∫ 4πr² ρ g(r) dr over bins whose centre lies in (r_lo, r_hi): the number of `density`
// atoms around one centre in that shell
const shell_coordination = (
  pattern: RdfPattern,
  density: number,
  r_lo = 0,
  r_hi = Infinity,
): number =>
  pattern.r.reduce(
    (sum, rad, idx) =>
      rad > r_lo && rad < r_hi
        ? sum + 4 * Math.PI * rad ** 2 * pattern.g_r[idx] * bin_width(pattern) * density
        : sum,
    0,
  )

// Every shell of a simple cubic lattice with parameter `a_len` inside `cutoff`: shell radius
// and the number of lattice points on it
const simple_cubic_shells = (a_len: number, cutoff: number): Map<number, number> => {
  const reach = Math.ceil(cutoff / a_len)
  const span = Array.from({ length: 2 * reach + 1 }, (_unused, idx) => idx - reach)
  const shells = new Map<number, number>()
  for (const ii of span) {
    for (const jj of span) {
      for (const kk of span) {
        const dist = a_len * Math.hypot(ii, jj, kk)
        if (dist > 0 && dist < cutoff) shells.set(dist, (shells.get(dist) ?? 0) + 1)
      }
    }
  }
  return shells
}

// Rocksalt NaCl in the conventional cell: Na-Cl at a/2 (6), Na-Na at a/√2 (12)
const ROCKSALT_A = 5.6
const rocksalt = make_crystal(ROCKSALT_A, [
  [`Na`, [0, 0, 0]],
  [`Na`, [0.5, 0.5, 0]],
  [`Na`, [0.5, 0, 0.5]],
  [`Na`, [0, 0.5, 0.5]],
  [`Cl`, [0.5, 0, 0]],
  [`Cl`, [0, 0.5, 0]],
  [`Cl`, [0, 0, 0.5]],
  [`Cl`, [0.5, 0.5, 0.5]],
])

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
    // Each shell lands wholly in the bin holding its radius, at height n / (ρ 4π r_bin² Δr)
    const expected = Array<number>(n_bins).fill(0)
    for (const [dist, count] of simple_cubic_shells(a_len, cutoff)) {
      const bin = Math.floor(dist / delta_r + 1e-9)
      expected[bin] += count / (density * 4 * Math.PI * pattern.r[bin] ** 2 * delta_r)
    }
    expect(max_abs_diff(pattern.g_r, expected)).toBeLessThan(1e-9)
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
    expect(max_abs_diff(na_cl.g_r, cl_na.g_r)).toBeLessThan(1e-12)
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
    expect(max_abs_diff(full.g_r, weighted)).toBeLessThan(1e-12)
    const naive_mean = full.r.map(
      (_rad, idx) => partials.reduce((sum, { g_r }) => sum + g_r[idx], 0) / partials.length,
    )
    expect(max_abs_diff(full.g_r, naive_mean)).toBeGreaterThan(0.1)
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
    expect(partials.map((partial) => partial.element_pair)).toEqual([
      [`Ar`, `Ar`],
      [`Ar`, `Cl`],
      [`Ar`, `He`],
      [`Ar`, `K`],
      [`Ar`, `Na`],
      [`Cl`, `Cl`],
      [`Cl`, `He`],
      [`Cl`, `K`],
      [`Cl`, `Na`],
      [`He`, `He`],
      [`He`, `K`],
      [`He`, `Na`],
      [`K`, `K`],
      [`K`, `Na`],
      [`Na`, `Na`],
    ])
    for (const { element_pair, g_r } of partials) {
      const [center_species, neighbor_species] = element_pair ?? []
      expect(g_r).toEqual(
        calculate_rdf(mixed, { ...opts, center_species, neighbor_species }).g_r,
      )
    }
    const by_pair = Object.fromEntries(
      partials.map((partial) => [partial.element_pair?.join(`-`), partial]),
    )
    expect(max_abs_diff(by_pair[`Cl-K`].g_r, by_pair[`Cl-Na`].g_r)).toBeLessThan(1e-12)
    // N_Cl / V is the density of the neighbour species around each (half-occupied) K
    expect(shell_coordination(by_pair[`Cl-K`], 4 / ROCKSALT_A ** 3, 0, 3.5)).toBeCloseTo(6, 9)
    // K-Na: 12 cation neighbours at a/√2, half of them Na, seen from a half-K site
    expect(shell_coordination(by_pair[`K-Na`], 2 / ROCKSALT_A ** 3, 3.5, 4)).toBeCloseTo(6, 9)
  })

  test.each([
    [`1D chain`, [true, false, false] as Pbc, 2],
    [`2D square net`, [true, true, false] as Pbc, 4],
    [`3D`, [true, true, true] as Pbc, 6],
  ])(`%s: pbc %j images only along periodic axes`, (_name, pbc, first_shell) => {
    const a_len = 5
    const pattern = calculate_rdf(make_crystal(a_len, [[`Si`, [0, 0, 0]]]), {
      cutoff: 9,
      n_bins: 90,
      pbc,
    })
    expect(shell_coordination(pattern, 1 / a_len ** 3, 4.5, 5.5)).toBeCloseTo(first_shell, 9)
  })

  test(`pbc defaults to the lattice's own flags`, () => {
    const open = make_crystal(5, [[`Si`, [0, 0, 0]]], { pbc: [false, false, false] })
    const opts = { cutoff: 8, n_bins: 40 }
    expect(calculate_rdf(open, opts).g_r.every((val) => val === 0)).toBe(true)
    expect(
      calculate_rdf(open, { ...opts, pbc: [true, true, true] }).g_r.some((val) => val > 0),
    ).toBe(true)
  })

  test(`distances are binned over the half-open range [0, cutoff)`, () => {
    const one_atom = make_crystal(5, [[`Si`, [0, 0, 0]]])
    // nearest images sit exactly at the cutoff and are excluded...
    expect(
      calculate_rdf(one_atom, { cutoff: 5, n_bins: 50 }).g_r.every((val) => val === 0),
    ).toBe(true)
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
    expect(g_r.every((val) => val === 0)).toBe(true)
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

  test.each([
    undefined,
    [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 0],
    ],
    [
      [NaN, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
  ])(`rejects invalid normalisation cell %s`, (matrix) => {
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
    [
      `Lu-Al`,
      lu_al_structure,
      [
        [`Al`, `Al`],
        [`Al`, `Lu`],
        [`Lu`, `Lu`],
      ],
    ],
    [`Pd`, pd_structure, [[`Pd`, `Pd`]]],
    ...[false, true].map<[string, Crystal, [string, string][]]>((vacancy) => [
      `five species, vacancy=${vacancy}`,
      {
        ...five_species,
        sites: five_species.sites.map((site, idx) =>
          vacancy && idx === 0
            ? {
                ...site,
                species: site.species.map((species) => ({ ...species, occu: 0 })),
              }
            : site,
        ),
      },
      [
        [`Al`, `Al`],
        [`Al`, `Cl`],
        [`Al`, `K`],
        [`Al`, `Na`],
        [`Al`, `Si`],
        [`Cl`, `Cl`],
        [`Cl`, `K`],
        [`Cl`, `Na`],
        [`Cl`, `Si`],
        [`K`, `K`],
        [`K`, `Na`],
        [`K`, `Si`],
        [`Na`, `Na`],
        [`Na`, `Si`],
        [`Si`, `Si`],
      ],
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
        expect(patterns.map((pattern) => pattern.element_pair)).toEqual(pairs)
        for (const { element_pair, r, g_r } of patterns) {
          const [center_species, neighbor_species] = element_pair ?? []
          const direct = calculate_rdf(structure, {
            ...opts,
            center_species,
            neighbor_species,
          })
          expect(r).toBe(patterns[0].r)
          expect(g_r).toEqual(direct.g_r)
        }
      }
    },
  )
})
