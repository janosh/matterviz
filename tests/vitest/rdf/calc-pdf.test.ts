import type { Matrix3x3, Vec3 } from '$lib/math'
import type { PdfPattern, RdfPattern, TotalPdfPattern } from '$lib/rdf'
import {
  calculate_pdf,
  calculate_rdf,
  calculate_total_pdf,
  coordination_number,
  number_density,
  PDF_DEFAULT_N_BINS,
  site_composition,
} from '$lib/rdf'
import { neutron_scattering_length } from '$lib/scattering'
import type { Crystal } from '$lib/structure'
import { describe, expect, test } from 'vitest'
import { make_crystal, type SimpleSite } from '../setup'

// Cubic lattice constant shared by the sc/bcc/fcc reference cells. 3.615 Å is chosen so none of
// the analytic shell distances land on a 0.01 Å bin edge, where round-off could split one
// delta-function shell across two bins and make the peak position ambiguous.
const CUBIC_A = 3.615
// 8 Å over 800 bins = 0.01 Å, the resolution PDF work actually needs
const [PEAK_CUTOFF, PEAK_N_BINS] = [8, 800]
const PEAK_BIN_SIZE = PEAK_CUTOFF / PEAK_N_BINS

const FCC_FRAC: Vec3[] = [
  [0, 0, 0],
  [0, 0.5, 0.5],
  [0.5, 0, 0.5],
  [0.5, 0.5, 0],
]
const BCC_FRAC: Vec3[] = [
  [0, 0, 0],
  [0.5, 0.5, 0.5],
]
const SC_FRAC: Vec3[] = [[0, 0, 0]]

const cubic_cell = (element: string, frac_coords: Vec3[], a_len = CUBIC_A): Crystal =>
  make_crystal(
    a_len,
    frac_coords.map((abc) => [element, abc] as SimpleSite),
  )

// Rock salt: cation on the fcc sublattice, anion displaced by (1/2, 0, 0)
const rock_salt = (cation: string, anion: string, a_len: number): Crystal =>
  make_crystal(a_len, [
    ...FCC_FRAC.map((abc) => [cation, abc] as SimpleSite),
    ...FCC_FRAC.map(([fa, fb, fc]) => [anion, [fa + 0.5, fb, fc] as Vec3] as SimpleSite),
  ])

// Cu3Au (L1_2): Au on the corner, Cu on the three face centres. Deliberately NON-equiatomic —
// in rock salt rho_a = rho_b = rho_total/2, so passing the centre, neighbour or total density
// to coordination_number is indistinguishable. Here the 12 Cu around the one Au come out as
// 12 with rho_Cu, 4 with rho_Au and 16 with rho_total, so only one convention can pass.
const CU3AU_A = 3.75
const cu3au = (a_len: number): Crystal =>
  make_crystal(a_len, [
    [`Au`, [0, 0, 0]],
    ...FCC_FRAC.slice(1).map((abc) => [`Cu`, abc] as SimpleSite),
  ])

// Random packing with a hard minimum separation, so g(r) = 0 below `min_dist` exactly and G(r)
// there must equal the analytic line -4*pi*r*rho_0. Deterministic LCG so the cell is fixed.
function disordered_cell(n_atoms: number, box: number, min_dist: number): Crystal {
  let seed = 12345
  const rand = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32), seed / 2 ** 32)
  const coords: Vec3[] = []
  const min_sq = min_dist * min_dist
  for (let attempt = 0; attempt < 500_000 && coords.length < n_atoms; attempt++) {
    const cand: Vec3 = [rand() * box, rand() * box, rand() * box]
    const clash = coords.some((other) => {
      let dist_sq = 0
      for (let axis = 0; axis < 3; axis++) {
        let delta = cand[axis] - other[axis]
        delta -= box * Math.round(delta / box)
        dist_sq += delta * delta
      }
      return dist_sq < min_sq
    })
    if (!clash) coords.push(cand)
  }
  if (coords.length < n_atoms) {
    throw new Error(
      `Only placed ${coords.length}/${n_atoms} atoms at min_dist=${min_dist} Å in a ${box} Å box`,
    )
  }
  return make_crystal(
    box,
    coords.map((xyz) => ({ element: `Ar`, xyz })),
  )
}

// 300 Ar in a 24 Å box, no two closer than 2.8 Å. Built once: the packing costs ~10^5 trials
// and both tests below bin it on the same 12 Å / 600-bin grid.
const DISORDERED = disordered_cell(300, 24, 2.8)
const DISORDERED_PDF = calculate_pdf(DISORDERED, { cutoff: 12, n_bins: 600 })

// Most patterns below are binned at the same 0.01 Å resolution, so shells land in known bins
const peak_pdf = (
  structure: Crystal,
  options: Parameters<typeof calculate_pdf>[1] = {},
): PdfPattern =>
  calculate_pdf(structure, { cutoff: PEAK_CUTOFF, n_bins: PEAK_N_BINS, ...options })

const peak_total_pdf = (
  structure: Crystal,
  options: Parameters<typeof calculate_total_pdf>[1] = {},
): TotalPdfPattern =>
  calculate_total_pdf(structure, { cutoff: PEAK_CUTOFF, n_bins: PEAK_N_BINS, ...options })

// Index of the largest G(r) inside [0, r_window). G(r) carries a factor r, so for a crystal the
// global maximum sits in a far shell — the FIRST peak has to be found in a bounded window.
const first_peak_index = (pattern: PdfPattern, r_window: number): number =>
  pattern.r.reduce(
    (best, radius, idx) =>
      radius < r_window && pattern.reduced_g_r[idx] > pattern.reduced_g_r[best] ? idx : best,
    0,
  )

const pair_of = (partial: { element_pair?: [string, string] }): [string, string] => {
  if (!partial.element_pair) throw new Error(`partial pattern without element_pair`)
  return partial.element_pair
}

const mean = (values: number[]): number =>
  values.reduce((sum, val) => sum + val, 0) / values.length

const rms = (values: number[]): number =>
  Math.sqrt(values.reduce((sum, val) => sum + val * val, 0) / values.length)

const window_values = (
  pattern: { r: number[] },
  values: number[],
  r_lo: number,
  r_hi: number,
): number[] => values.filter((_, idx) => pattern.r[idx] >= r_lo && pattern.r[idx] < r_hi)

describe(`reduced PDF G(r)`, () => {
  test.each([
    { name: `simple cubic`, frac: SC_FRAC, nn_dist: CUBIC_A, coordination: 6, r_window: 4.3 },
    {
      name: `bcc`,
      frac: BCC_FRAC,
      nn_dist: (CUBIC_A * Math.sqrt(3)) / 2,
      coordination: 8,
      r_window: 3.4,
    },
    {
      name: `fcc`,
      frac: FCC_FRAC,
      nn_dist: CUBIC_A / Math.SQRT2,
      coordination: 12,
      r_window: 3,
    },
  ])(
    `$name: first G(r) peak sits at the analytic nn distance and integrates to CN $coordination`,
    ({ frac, nn_dist, coordination, r_window }) => {
      const pattern = peak_pdf(cubic_cell(`Cu`, frac))
      const measured_peak = pattern.r[first_peak_index(pattern, r_window)]
      // A delta-function shell falls in exactly one bin, so half a bin width is the largest
      // error possible; allow a full bin in case a shell sits right on an edge.
      expect(Math.abs(measured_peak - nn_dist)).toBeLessThan(PEAK_BIN_SIZE)

      // CN = Σ 4πr²·ρ·g(r)·Δr collapses to Σ counts / N_a: every factor coordination_number
      // applies (4πr², Δr, V, N_b, the bin-centre convention) is the exact reciprocal of what
      // rdf_from_cloud divided by, so they cancel identically. That means this checks the
      // neighbour COUNTING and that the two integrands agree — not the normalization, which a
      // wrong volume or wrong N in both places would leave untouched (see the g_ab test below
      // for the normalization itself). It also holds to 1e-11 for a disordered cell.
      // 1e-8 absolute is ~7 orders looser than the ~1e-15 observed, so summation order is free.
      const n_coord = coordination_number(pattern, pattern.rho_0, { r_max: r_window })
      expect(n_coord).toBeCloseTo(coordination, 8)
    },
  )

  test.each([400, 3000])(`fcc first-peak position is stable at n_bins=%s`, (n_bins) => {
    const pattern = calculate_pdf(cubic_cell(`Cu`, FCC_FRAC), {
      cutoff: PEAK_CUTOFF,
      n_bins,
    })
    const measured_peak = pattern.r[first_peak_index(pattern, 3.0)]
    // Only the resolution may change with n_bins; the position must not drift. Tying the
    // bound to the bin width makes the finer grids strictly harder to pass.
    expect(Math.abs(measured_peak - CUBIC_A / Math.SQRT2)).toBeLessThan(PEAK_CUTOFF / n_bins)
    // ...and every grid must agree on the peak to well inside the coarsest bin (0.02 Å)
    expect(measured_peak).toBeCloseTo(CUBIC_A / Math.SQRT2, 1)
  })

  test(`G(r) below the distance of closest approach is exactly -4*pi*r*rho_0`, () => {
    const pattern = DISORDERED_PDF
    const rho_0 = number_density(DISORDERED)
    expect(rho_0).toBeCloseTo(300 / 24 ** 3, 12)

    const excluded = pattern.r
      .map((radius, idx) => ({ radius, value: pattern.reduced_g_r[idx] }))
      .filter(({ radius }) => radius < 2.7)
    expect(excluded.length).toBeGreaterThan(100)
    for (const { radius, value } of excluded) {
      // pure arithmetic on g(r) = 0, so anything above f64 round-off would be a real bug
      expect(value).toBeCloseTo(-4 * Math.PI * radius * rho_0, 12)
    }
  })

  test(`disordered cell: g(r) -> 1 and G(r) -> 0 in the tail`, () => {
    const pattern = DISORDERED_PDF
    const tail_g = window_values(pattern, pattern.g_r, 10.8, 12)
    const tail_reduced = window_values(pattern, pattern.reduced_g_r, 10.8, 12)

    // measured: mean g = 1.00407, mean G = -0.0110
    expect(Math.abs(mean(tail_g) - 1)).toBeLessThan(0.02)
    expect(Math.abs(mean(tail_reduced))).toBeLessThan(0.05)

    // Bin-wise the tail still carries counting noise, so the sharper statement is that the
    // structure decays: rms(g - 1) falls from 0.509 over the first shells to 0.093 in the tail.
    const near_g = window_values(pattern, pattern.g_r, 2.8, 5)
    expect(rms(tail_g.map((val) => val - 1))).toBeLessThan(
      0.3 * rms(near_g.map((val) => val - 1)),
    )
  })

  test(`fcc crystal: shell-averaged g(r) converges to 1 in the tail`, () => {
    const [cutoff, n_bins] = [15, 750]
    const pattern = calculate_pdf(cubic_cell(`Cu`, FCC_FRAC), { cutoff, n_bins })
    // A crystal's g(r) is a comb of delta functions that never converges pointwise; what
    // converges is its average over a window many shells wide. measured: mean g = 0.9779.
    const tail_g = window_values(pattern, pattern.g_r, 12, 15)
    expect(Math.abs(mean(tail_g) - 1)).toBeLessThan(0.05)

    // Equivalently, the atoms actually counted in the 12-15 Å shell match the ideal-gas count
    // to within 1.1% (measured ratio 0.98949).
    const counted = coordination_number(pattern, pattern.rho_0, { r_min: 12, r_max: 15 })
    const ideal = (4 / 3) * Math.PI * (15 ** 3 - 12 ** 3) * pattern.rho_0
    expect(counted / ideal).toBeCloseTo(1, 1)
  })

  test.each([
    { cell: `NaCl`, a_len: 5.63, center: `Na`, neighbor: `Cl`, r_max: 3.4, expected_cn: 6 },
    { cell: `NaCl`, a_len: 5.63, center: `Na`, neighbor: `Na`, r_max: 4.5, expected_cn: 12 },
    { cell: `Cu3Au`, a_len: CU3AU_A, center: `Au`, neighbor: `Cu`, r_max: 3, expected_cn: 12 },
    { cell: `Cu3Au`, a_len: CU3AU_A, center: `Cu`, neighbor: `Au`, r_max: 3, expected_cn: 4 },
    { cell: `Cu3Au`, a_len: CU3AU_A, center: `Cu`, neighbor: `Cu`, r_max: 3, expected_cn: 8 },
  ])(
    `partial $center-$neighbor coordination in $cell is $expected_cn`,
    ({ cell, a_len, center, neighbor, r_max, expected_cn }) => {
      const structure = cell === `NaCl` ? rock_salt(`Na`, `Cl`, a_len) : cu3au(a_len)
      const pattern = peak_pdf(structure, {
        center_species: center,
        neighbor_species: neighbor,
      })
      expect(pattern.element_pair).toEqual([center, neighbor])
      // n_ab counts b atoms around one a atom, so the density is the NEIGHBOUR species'
      const neighbor_density = site_composition(structure)[neighbor] / a_len ** 3
      expect(coordination_number(pattern, neighbor_density, { r_max })).toBeCloseTo(
        expected_cn,
        8,
      )
    },
  )

  test(`partial g_ab carries the N_a·N_b·4πr²Δr/V normalization, not just consistent counts`, () => {
    const structure = cu3au(CU3AU_A)
    const pattern = peak_pdf(structure, { center_species: `Au`, neighbor_species: `Cu` })
    // All 12 Cu neighbours of the single Au sit at a/sqrt(2) = 2.6517 Å, inside one 0.01 Å bin
    const shell_bin = Math.floor(CU3AU_A / Math.SQRT2 / PEAK_BIN_SIZE)
    expect(pattern.g_r[shell_bin - 1] + pattern.g_r[shell_bin + 1]).toBe(0)

    // Built from the neighbour count and the cell alone — coordination_number cannot see this,
    // because there the ideal-gas factor cancels against its own reciprocal.
    const r_bin = pattern.r[shell_bin]
    const ideal_count = (1 * 3 * (4 * Math.PI * r_bin ** 2 * PEAK_BIN_SIZE)) / CU3AU_A ** 3
    // g ≈ 238 here; 1e-6 absolute is ~4e-9 relative, orders above the ulp the different
    // grouping of the same products can cost
    expect(pattern.g_r[shell_bin]).toBeCloseTo(12 / ideal_count, 6)

    // rho_0 is the TOTAL density even on a partial, and Cu3Au is non-equiatomic so the centre
    // (1/a³) and neighbour (3/a³) densities are all distinct from it
    expect(pattern.rho_0).toBeCloseTo(4 / CU3AU_A ** 3, 12)
  })

  test(`rho_0 = N/V holds for a non-cubic cell, where a³ would be wrong`, () => {
    // Triclinic; det = 4·(6·8) - 0 + 1.5·(0 - 0) ... computed below from the triple product
    const matrix: Matrix3x3 = [
      [4, 0, 0],
      [1.5, 6, 0],
      [-0.8, 2.1, 8],
    ]
    const structure = make_crystal(matrix, [
      [`Fe`, [0, 0, 0]],
      [`Fe`, [0.5, 0.5, 0.5]],
      [`O`, [0.25, 0.25, 0.25]],
    ])
    const volume = 4 * 6 * 8 // lower-triangular, so the triple product is the diagonal product
    expect(number_density(structure)).toBeCloseTo(3 / volume, 15)
  })

  // rho_0 = N/V is the normalization every g(r) and G(r) divides by, so each way it can
  // fail to exist has to say so rather than return NaN or Infinity.
  // oxfmt-ignore
  test.each([
    [`no lattice`, { sites: cubic_cell(`Cu`, FCC_FRAC).sites } as unknown as Crystal, /must have a lattice/],
    [`zero cell volume`, make_crystal([[1, 0, 0], [2, 0, 0], [0, 0, 1]], [[`Cu`, [0, 0, 0]]]), /volume is 0 Å³/],
    [`no sites`, make_crystal(4, []), /has 0 atoms/],
  ])(`number_density rejects a crystal with %s`, (_name, structure, pattern) => {
    expect(() => number_density(structure)).toThrow(pattern)
    // and calculate_total_pdf inherits the guard rather than weighting an empty composition
    if (structure.sites.length === 0) {
      expect(() => calculate_total_pdf(structure)).toThrow(pattern)
    }
  })

  test(`PDF defaults are finer than the RDF defaults and leave them untouched`, () => {
    const structure = cubic_cell(`Cu`, FCC_FRAC)
    const pdf = calculate_pdf(structure)
    expect(pdf.r).toHaveLength(PDF_DEFAULT_N_BINS)
    expect(pdf.r[1] - pdf.r[0]).toBeCloseTo(0.02, 12)
    // the RDF path must still hand its existing callers 15 Å over 75 bins
    const rdf = calculate_rdf(structure)
    expect(rdf.r).toHaveLength(75)
    expect(rdf.r[1] - rdf.r[0]).toBeCloseTo(0.2, 12)
  })

  test.each([
    { r_min: 3, r_max: 2, why: `r_max below r_min` },
    { r_min: 1, r_max: 1, why: `an empty window` },
  ])(`coordination_number throws on $why`, ({ r_min, r_max }) => {
    const pattern = calculate_pdf(cubic_cell(`Cu`, FCC_FRAC), { cutoff: 8, n_bins: 100 })
    expect(() => coordination_number(pattern, pattern.rho_0, { r_min, r_max })).toThrow(
      /Empty integration window/,
    )
  })

  test(`coordination_number needs at least two bins to infer a bin width`, () => {
    const single: RdfPattern = { r: [0.5], g_r: [1] }
    expect(() => coordination_number(single, 0.1)).toThrow(/at least 2 uniformly spaced/)
  })
})

describe(`total scattering-weighted PDF`, () => {
  const NACL_A = 5.63
  const nacl = () => rock_salt(`Na`, `Cl`, NACL_A)
  // calculate_all_pair_rdfs sorts the element list, so the unordered pair keys are Cl-* first
  const NACL_B: Record<string, Record<string, number>> = {
    // x-ray form factors at s = 0 reduce to Z
    xray: { Na: 11, Cl: 17 },
    neutron: { Na: 3.63, Cl: 9.577 },
  }

  test.each([`xray`, `neutron`] as const)(
    `%s NaCl weights carry the factor 2 on unlike pairs and sum to 1`,
    (radiation) => {
      const { Na: b_na, Cl: b_cl } = NACL_B[radiation]
      const total = peak_total_pdf(nacl(), { radiation })
      // 50/50 composition: c_Na = c_Cl = 1/2, so <b> = (b_Na + b_Cl)/2
      const mean_b = (b_na + b_cl) / 2
      expect(total.mean_scattering_length).toBeCloseTo(mean_b, 10)
      const analytic: Record<string, number> = {
        [`Cl-Cl`]: (0.25 * b_cl * b_cl) / mean_b ** 2,
        [`Cl-Na`]: (2 * 0.25 * b_na * b_cl) / mean_b ** 2,
        [`Na-Na`]: (0.25 * b_na * b_na) / mean_b ** 2,
      }
      expect(Object.keys(total.pair_weights).toSorted()).toEqual(Object.keys(analytic))
      for (const [pair, weight] of Object.entries(analytic)) {
        expect(total.pair_weights[pair]).toBeCloseTo(weight, 12)
      }
      // Summed over ORDERED pairs this is exactly 0.25*(b_Na + b_Cl)^2 / <b>^2 = 1
      const weight_sum = Object.values(total.pair_weights).reduce((sum, wgt) => sum + wgt, 0)
      expect(weight_sum).toBeCloseTo(1, 12)

      // Drop the multiplicity and the weights fall short of 1 by 24% (x-ray) / 15% (neutron):
      // the total g(r) would then tend to that value instead of 1.
      const no_multiplicity = (0.25 * (b_na ** 2 + b_cl ** 2 + b_na * b_cl)) / mean_b ** 2
      expect(1 - no_multiplicity).toBeGreaterThan(0.1)
    },
  )

  test(`total g(r) equals the analytic weighted sum of the partials`, () => {
    const total = peak_total_pdf(nacl(), { radiation: `xray` })
    const mean_b = (11 + 17) / 2
    const b_of = (element: string) => NACL_B.xray[element]
    const analytic_weight = (pair: [string, string], with_multiplicity: boolean): number =>
      ((with_multiplicity && pair[0] !== pair[1] ? 2 : 1) *
        0.25 *
        b_of(pair[0]) *
        b_of(pair[1])) /
      mean_b ** 2

    const weighted_sum = (with_multiplicity: boolean) =>
      total.r.map((_, bin_idx) =>
        total.partials.reduce(
          (sum, partial) =>
            sum + analytic_weight(pair_of(partial), with_multiplicity) * partial.g_r[bin_idx],
          0,
        ),
      )

    const expected = weighted_sum(true)
    const max_abs_err = Math.max(...total.g_r.map((val, idx) => Math.abs(val - expected[idx])))
    // identical additions in a different order, so only summation round-off separates them
    expect(max_abs_err).toBeLessThan(1e-10)

    // The un-multiplied version is not a subtle numerical difference: it is short by the whole
    // Na-Cl contribution, which is the largest single term in this structure.
    const naive = weighted_sum(false)
    expect(
      Math.max(...total.g_r.map((val, idx) => Math.abs(val - naive[idx]))),
    ).toBeGreaterThan(1)
  })

  test.each([`xray`, `neutron`] as const)(
    `%s: Σ w_ab·G_ab(r) reproduces the total G(r) bin-wise`,
    (radiation) => {
      // The partials' reduced_g_r is what PdfPlot draws under show_partials, and it encodes the
      // non-obvious "keep the TOTAL rho_0 even on a partial" convention. This one identity pins
      // it: Σ w_ab·4πr·rho_0·(g_ab − 1) = 4πr·rho_0·(g − Σ w_ab) equals the total only when the
      // density is shared AND the weights sum to 1. Handing back partial.g_r, or a per-species
      // density, breaks it.
      const total = peak_total_pdf(nacl(), { radiation })
      expect(total.partials.every((partial) => partial.rho_0 === total.rho_0)).toBe(true)

      const summed = total.r.map((_, bin_idx) =>
        total.partials.reduce(
          (sum, partial) =>
            sum +
            total.pair_weights[pair_of(partial).join(`-`)] * partial.reduced_g_r[bin_idx],
          0,
        ),
      )
      const max_abs_err = Math.max(
        ...total.reduced_g_r.map((val, idx) => Math.abs(val - summed[idx])),
      )
      // identical products in a different order; G(r) peaks near 1e3 here, so 1e-10 absolute
      // is ~1e-13 relative — tight, and still three orders above f64 round-off
      expect(max_abs_err).toBeLessThan(1e-10)
      // not vacuous: G_ab(r) is nowhere near g_ab(r) in magnitude
      const peak_reduced = Math.max(...total.partials[0].reduced_g_r.map(Math.abs))
      expect(peak_reduced).toBeGreaterThan(100)
    },
  )

  test.each([`xray`, `neutron`, `electron`] as const)(
    `%s total g(r) tail tracks the unweighted g(r) because the weights sum to 1`,
    (radiation) => {
      const [cutoff, n_bins] = [15, 750]
      const total = calculate_total_pdf(nacl(), { radiation, cutoff, n_bins })
      const plain = calculate_pdf(nacl(), { cutoff, n_bins })
      const tail_start = Math.floor(0.8 * n_bins)
      const total_tail = mean(total.g_r.slice(tail_start))
      const plain_tail = mean(plain.g_r.slice(tail_start))
      // NaCl's shell comb puts this window's average at 0.896, not 1 — the point here is that
      // the weighted and unweighted totals agree to <1%. With the factor of 2 dropped the
      // weighted tail would collapse to ~0.76 of the unweighted one.
      expect(Math.abs(total_tail - plain_tail)).toBeLessThan(0.01)
      expect(total.radiation).toBe(radiation)
      expect(total.partials).toHaveLength(3)
    },
  )

  // Ni-H rock salt: b_Ni = +10.3 fm but b_H = -3.739 fm, so the Ni-H cross term flips sign
  // between neutrons and x-rays while the like-pair terms stay positive for both.
  describe(`negative b_coh gives a sign-reversed neutron PDF`, () => {
    const NIH_A = 3.73
    const nih_pdf = (radiation: `xray` | `neutron`) =>
      peak_total_pdf(rock_salt(`Ni`, `H`, NIH_A), { radiation })
    const bin_at = (pattern: PdfPattern, dist: number) =>
      pattern.r.findIndex((radius) => Math.abs(radius - dist) < PEAK_BIN_SIZE / 2)

    test.each([
      { radiation: `xray` as const, cross_sign: 1 },
      { radiation: `neutron` as const, cross_sign: -1 },
    ])(`$radiation Ni-H pair weight has sign $cross_sign`, ({ radiation, cross_sign }) => {
      expect(Math.sign(neutron_scattering_length(`H`))).toBe(-1)
      expect(Math.sign(neutron_scattering_length(`Ni`))).toBe(1)
      const total = nih_pdf(radiation)
      expect(Math.sign(total.pair_weights[`H-Ni`])).toBe(cross_sign)
      expect(total.pair_weights[`Ni-Ni`]).toBeGreaterThan(0)
      expect(total.pair_weights[`H-H`]).toBeGreaterThan(0)
      expect(Object.values(total.pair_weights).reduce((sum, wgt) => sum + wgt, 0)).toBeCloseTo(
        1,
        10,
      )
    })

    test(`the Ni-H correlation is a peak for x-rays and a trough for neutrons`, () => {
      const [xray, neutron] = [nih_pdf(`xray`), nih_pdf(`neutron`)]
      const cross_bin = bin_at(xray, NIH_A / 2)
      const like_bin = bin_at(xray, NIH_A / Math.SQRT2)
      expect(cross_bin).toBeGreaterThan(0)
      expect(like_bin).toBeGreaterThan(cross_bin)

      // Only the Ni-H partial is nonzero at a/2, so its weight alone sets the sign there.
      // measured: G = +39.2 (x-ray) vs -1154.9 (neutron)
      expect(xray.reduced_g_r[cross_bin]).toBeGreaterThan(0)
      expect(neutron.reduced_g_r[cross_bin]).toBeLessThan(0)
      // ...while the Ni-Ni / H-H shell at a/sqrt(2) keeps a positive weight under both
      expect(xray.reduced_g_r[like_bin]).toBeGreaterThan(0)
      expect(neutron.reduced_g_r[like_bin]).toBeGreaterThan(0)
    })
  })

  test(`missing neutron scattering length surfaces with the composition attached`, () => {
    // Po is one of the elements absent from the NIST b_coh table
    expect(() =>
      calculate_total_pdf(cubic_cell(`Po`, SC_FRAC, 3.35), {
        radiation: `neutron`,
        cutoff: 6,
        n_bins: 300,
      }),
    ).toThrow(/Cannot weight a total neutron PDF for Po1.*No neutron scattering length for Po/)
  })

  test.each([
    { cutoff: -1, n_bins: 100 },
    { cutoff: 8, n_bins: 0 },
  ])(`calculate_total_pdf rejects cutoff=$cutoff n_bins=$n_bins`, ({ cutoff, n_bins }) => {
    expect(() => calculate_total_pdf(nacl(), { cutoff, n_bins })).toThrow(
      /cutoff must be a positive finite|n_bins must be a positive integer/,
    )
  })
})
