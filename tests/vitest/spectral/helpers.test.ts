import { THZ_TO_INVERSE_CM } from '$lib/constants'
import { array_max, type Matrix3x3, type Vec2, type Vec3 } from '$lib/math'
import { convert_frequencies } from '$lib/spectral/frequency-units'
import type { PymatgenCompleteDos } from '$lib/spectral/helpers'
import {
  ACOUSTIC_FREQ_THRESHOLD,
  are_qpoints_equivalent,
  apply_gaussian_smearing,
  gaussian_kernel_smooth,
  branch_segment_keys,
  build_point_metadata,
  classify_acoustic,
  compute_frequency_range,
  extract_k_path_points,
  find_gamma_indices,
  find_qpoint_at_rescaled_x,
  frac_k_to_cartesian,
  generate_ribbon_path,
  is_electronic_band_struct,
  k_path_labels,
  negative_fraction,
  normalize_band_structure,
  normalize_densities,
  trapezoid_weights,
  normalize_dos,
  pretty_sym_point,
  qpoint_x_position,
  scale_segment_distances,
  shift_to_fermi,
} from '$lib/spectral/helpers'
import type { BaseBandStructure, QPoint } from '$lib/spectral/types'
import { describe, expect, it, vi } from 'vitest'

// pymatgen input needs a reciprocal lattice to measure its k-path; the identity keeps the
// hand-computed fractional distances valid
const identity_rec = {
  lattice_rec: {
    matrix: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
  },
}

// Band structure along a labelled path with unit spacing; `labels[idx]` null for interior points
const make_bs = (
  labels: (string | null)[],
  overrides: Partial<BaseBandStructure> = {},
): BaseBandStructure => {
  const qpoints: QPoint[] = labels.map((label, idx) => ({
    label,
    frac_coords: [idx / Math.max(1, labels.length - 1), 0, 0],
  }))
  const label_indices = labels.flatMap((label, idx) => (label ? [idx] : []))
  const branches = label_indices.slice(1).map((end_index, branch_idx) => ({
    start_index: label_indices[branch_idx],
    end_index,
    name: `${labels[label_indices[branch_idx]]}-${labels[end_index]}`,
  }))
  const bands = overrides.bands ?? [qpoints.map((_, idx) => idx)]
  return {
    qpoints,
    branches: branches.length
      ? branches
      : [{ start_index: 0, end_index: qpoints.length - 1, name: `path` }],
    distance: qpoints.map((_, idx) => idx),
    bands,
    nb_bands: bands.length,
    labels_dict: {},
    ...overrides,
  }
}

it.each([
  [[0.25, 0, 0.5], [1.25, -1, 0.5], true],
  [[0.25, 0, 0.5], [0.250002, 0, 0.5], false],
] as [Vec3, Vec3, boolean][])(
  `are_qpoints_equivalent(%j, %j) → %s`,
  (first, second, expected) => {
    expect(are_qpoints_equivalent(first, second)).toBe(expected)
  },
)

it.each([
  [`GAMMA`, `Γ`],
  [`\\Gamma`, `Γ`],
  [`SIGMA3`, `Σ₃`],
  [`LAMBDA`, `Λ`],
  [`X1`, `X₁`],
  [`K12`, `K₁₂`],
  [`S_0`, `S₀`],
  [`GAMMA_1`, `Γ₁`],
  [``, ``],
])(`pretty_sym_point(%s) → %s`, (input, expected) => {
  expect(pretty_sym_point(input)).toBe(expected)
})

describe(`convert_frequencies`, () => {
  // CODATA 2018: h·1 THz = 4.135667696e-3 eV; 1 THz = 33.35640952 cm^-1; 1 Ha = 27.211386 eV
  it.each([
    [`THz`, 1],
    [`eV`, 4.135667696e-3],
    [`meV`, 4.135667696],
    [`cm^-1`, 33.35640951981521],
    [`Ha`, 4.135667696e-3 / 27.211386245981],
  ] as const)(`1 THz = %f %s to 1e-9 relative`, (unit, per_thz) => {
    const [value] = convert_frequencies([1], unit)
    expect(Math.abs(value / per_thz - 1)).toBeLessThan(1e-9)
  })

  it(`maps every element, returns the same array for THz and rejects unknown units`, () => {
    const [one, two] = convert_frequencies([1, 2], `meV`)
    expect(one).toBeCloseTo(4.135667696, 8)
    expect(two).toBeCloseTo(8.271335392, 8)
    const input = [1, 2]
    expect(convert_frequencies(input, `THz`)).toBe(input)
    // both sides default to THz, so the one-arg form is a no-op
    expect(convert_frequencies(input)).toBe(input)
    expect(() => convert_frequencies([1], `GHz` as never)).toThrow(/Invalid unit: GHz/)
  })
})

describe(`normalize_densities`, () => {
  const densities = [1, 2, 3, 2, 1]
  const energies = [0, 1, 2, 3, 4]
  // trapezoid weights [0.5, 1, 1, 1, 0.5] give ∫ = 8, not the 9 a left-Riemann sum reports
  it.each([
    [`max`, densities.map((val) => val / 3)],
    [`sum`, densities.map((val) => val / 9)],
    [`integral`, densities.map((val) => val / 8)],
    [null, densities],
  ] as const)(`mode %s`, (mode, expected) => {
    expect(normalize_densities(densities, energies, mode)).toEqual(expected)
  })

  // the old left-Riemann sum read only x[1] - x[0]: 11.1% low on a uniform grid, 245% off here
  it(`integral mode makes ∫ = 1 on a non-uniform grid, and leaves degenerate input alone`, () => {
    const grid = [0, 0.1, 0.2, 3, 10]
    const normalized = normalize_densities(densities, grid, `integral`)
    const integral = grid
      .slice(1)
      .reduce(
        (acc, x_val, idx) =>
          acc + ((normalized[idx] + normalized[idx + 1]) / 2) * (x_val - grid[idx]),
        0,
      )
    expect(integral).toBeCloseTo(1, 12)
    expect(normalize_densities([0, 0], [0, 1], `max`)).toEqual([0, 0])
    expect(normalize_densities([1], [0], `integral`)).toEqual([1])
  })

  // Math.max(...densities) overflows the argument limit; DOS grids reach 1e7 points
  it(`max mode handles grids beyond the spread-argument limit`, () => {
    const large = Array.from({ length: 300_000 }, (_, idx) => (idx % 97) + 1)
    expect(array_max(normalize_densities(large, large, `max`))).toBe(1)
  })
})

describe(`apply_gaussian_smearing`, () => {
  const energies = [0, 1, 2, 3, 4]
  const spike = [0, 0, 10, 0, 0]

  it(`returns degenerate input untouched`, () => {
    expect(apply_gaussian_smearing(energies, spike, 0)).toBe(spike)
    expect(apply_gaussian_smearing(energies, [0, 0, 0, 0, 0], 0.5)).toEqual([0, 0, 0, 0, 0])
    // a grid with no extent has zero trapezoid weights everywhere, so the convolution scaled
    // every density to 0 rather than passing it through
    expect(apply_gaussian_smearing([0], [5], 0.5)).toEqual([5]) // one-point grid
    expect(apply_gaussian_smearing([1, 1, 1], [2, 2, 2], 0.5)).toEqual([2, 2, 2]) // no extent
  })

  it(`spreads a spike symmetrically with the normalized Gaussian shape`, () => {
    const smeared = apply_gaussian_smearing(energies, spike, 0.5)
    expect(smeared[1]).toBeCloseTo(smeared[3], 12)
    expect(smeared[1]).toBeGreaterThan(0)
    // Gaussian ratio exp(-1/(2·0.25)) = e^-2 between the first neighbour and the centre
    expect(smeared[1] / smeared[2]).toBeCloseTo(Math.exp(-2), 12)
    // the centre carries the spike's weight (1 wide here) times the kernel peak 1/(σ√2π)
    expect(smeared[2]).toBeCloseTo(10 / (0.5 * Math.sqrt(2 * Math.PI)), 12)
  })

  // the old measure-free form weighted by POINT DENSITY: a flat DOS came out anywhere from
  // 0.235 to 1.950 over this grid's interior. gaussian_kernel_smooth is its Nadaraya-Watson
  // sibling: exact on constants everywhere, with no quadrature measure.
  it(`leaves a flat density alone on a clustered grid, as does gaussian_kernel_smooth`, () => {
    const clustered = [
      ...Array.from({ length: 40 }, (_, idx) => -4 + idx * 0.1),
      ...Array.from({ length: 60 }, (_, idx) => idx * 0.005),
      ...Array.from({ length: 40 }, (_, idx) => 0.3 + idx * 0.1),
    ]
    const ones = clustered.map(() => 1)
    const smeared = apply_gaussian_smearing(clustered, ones, 0.3)
    // interior only (the convolution loses mass past the grid ends); ±4σ truncation plus
    // trapezoid error at the 0.005 → 0.1 spacing jump measures 3.21e-3
    const errors = clustered.flatMap((x_val, idx) =>
      Math.abs(x_val) > 2.5 ? [] : [Math.abs(smeared[idx] - 1)],
    )
    expect(Math.max(...errors)).toBeLessThan(5e-3)
    for (const val of gaussian_kernel_smooth(clustered, ones, 0.3)) {
      expect(val).toBeCloseTo(1, 12)
    }
    // still an actual smoother, and sigma <= 0 passes straight through
    const alternating = clustered.map((_unused, idx) => (idx % 2 === 0 ? 1 : -1))
    const smoothed = gaussian_kernel_smooth(clustered, alternating, 0.3)
    for (const val of smoothed.slice(45, 55)) expect(Math.abs(val)).toBeLessThan(0.5)
    expect(gaussian_kernel_smooth(clustered, alternating, 0)).toBe(alternating)
  })

  // The two-pointer window is only valid on an ascending grid; anything else falls back to
  // scanning every point. Pin that fallback to an unwindowed reference.
  const brute_force = (xs: number[], ys: number[], sigma: number): number[] => {
    const weights = trapezoid_weights(xs)
    return xs.map(
      (energy) =>
        xs.reduce((sum, other, jdx) => {
          const delta = energy - other
          if (Math.abs(delta) > 4 * sigma) return sum
          return sum + ys[jdx] * weights[jdx] * Math.exp(-(delta ** 2) / (2 * sigma ** 2))
        }, 0) /
        (sigma * Math.sqrt(2 * Math.PI)),
    )
  }
  const grid = Array.from({ length: 60 }, (_, idx) => idx * 0.1)
  it.each([
    [`ascending`, grid],
    // every non-monotonic grid takes the same unwindowed fallback
    [`descending`, grid.toReversed()],
    [`with duplicates`, grid.map((val, idx) => (idx % 4 === 0 ? grid[0] : val))],
  ])(`matches an unwindowed reference on a %s grid`, (_label, xs) => {
    const ys = xs.map((_, idx) => ((idx * 37) % 11) + 0.5)
    const smeared = apply_gaussian_smearing(xs, ys, 0.25)
    const expected = brute_force(xs, ys, 0.25)
    let max_abs_error = 0
    for (const [idx, val] of smeared.entries())
      max_abs_error = Math.max(max_abs_error, Math.abs(val - expected[idx]))
    expect(max_abs_error).toBeLessThan(1e-10)
  })
})

describe(`branch_segment_keys`, () => {
  it(`keys labelled branches by label pair, numbers repeats and positions unlabeled ones`, () => {
    // Γ→X→Γ→X→(unlabeled)
    const bs = make_bs([`GAMMA`, null, `X`, null, `GAMMA`, `X`])
    bs.branches.push({ start_index: 5, end_index: 5, name: `tail` })
    bs.qpoints[5] = { label: null, frac_coords: [1, 0, 0] }
    expect(branch_segment_keys(bs)).toEqual([`GAMMA_X`, `X_GAMMA`, `GAMMA_null`, `branch:3`])
    const repeated = make_bs([`GAMMA`, `X`, `GAMMA`, `X`])
    expect(branch_segment_keys(repeated)).toEqual([`GAMMA_X`, `X_GAMMA`, `GAMMA_X#2`])
  })
})

describe(`qpoint_x_position / find_qpoint_at_rescaled_x`, () => {
  // Γ→X (3 steps) and X→K (2 steps), plotted into [0, 1] and [1, 1.5]
  const bs = make_bs([`GAMMA`, null, null, `X`, null, `K`])
  const x_pos: Record<string, Vec2> = { GAMMA_X: [0, 1], X_K: [1, 1.5] }

  it.each([
    [0, 0],
    [3, 1],
    [5, 1.5],
    [4, 1.25],
    [1, 1 / 3],
  ])(`q-point %i sits at x = %f and maps back`, (idx, expected_x) => {
    const x_val = qpoint_x_position(bs, idx, x_pos)
    expect(x_val).toBeCloseTo(expected_x, 12)
    expect(find_qpoint_at_rescaled_x(bs, x_val ?? NaN, x_pos)).toBe(idx)
  })

  it(`rounds interior x to the nearest q-point and snaps off-path x to the nearest endpoint`, () => {
    expect(find_qpoint_at_rescaled_x(bs, 0.6, x_pos)).toBe(2) // 0.6 · 3 = 1.8 → idx 2
    expect(find_qpoint_at_rescaled_x(bs, 9, { GAMMA_X: [0, 1] })).toBe(3) // beyond the only segment
    expect(find_qpoint_at_rescaled_x(bs, 0.5, {})).toBe(0) // no segments: fallback index
    expect(qpoint_x_position(bs, 4, { GAMMA_X: [0, 1] })).toBeNull() // branch not plotted
  })

  it(`distinguishes a repeated Gamma and resolves a zero-length discontinuity`, () => {
    const loop = make_bs([`GAMMA`, null, `X`, null, `GAMMA`])
    const loop_pos: Record<string, Vec2> = { GAMMA_X: [0, 1], X_GAMMA: [1, 2] }
    expect(find_qpoint_at_rescaled_x(loop, 0, loop_pos)).toBe(0)
    expect(find_qpoint_at_rescaled_x(loop, 2, loop_pos)).toBe(4)
    const disc = make_bs([`GAMMA`, `X`, `K`])
    const disc_pos: Record<string, Vec2> = { GAMMA_X: [0, 0.5], X_K: [0.5, 0.5] }
    expect(find_qpoint_at_rescaled_x(disc, 0.5, disc_pos)).toBe(1)
    expect(qpoint_x_position(disc, 2, disc_pos)).toBe(0.5)
  })
})

describe(`extract_k_path_points`, () => {
  it(`maps fractional to Cartesian with row-vector reciprocal lattice vectors`, () => {
    const bs = make_bs([`GAMMA`, `X`, `K`])
    bs.qpoints[2].frac_coords = [1 / 3, 1 / 3, 0]
    const recip: Matrix3x3 = [
      [2, 0.5, 0],
      [0, 2, 0],
      [0, 0, 1],
    ]
    const [gamma, x_point, k_point] = extract_k_path_points(bs, recip, { wrap_to_bz: false })
    expect(gamma).toEqual([0, 0, 0])
    expect(x_point).toEqual([1, 0.25, 0]) // 0.5·b1
    expect(k_point[0]).toBeCloseTo(2 / 3, 12)
    expect(k_point[1]).toBeCloseTo(0.5 / 3 + 2 / 3, 12)
    expect(extract_k_path_points(make_bs([], { qpoints: [] }), recip)).toEqual([])
    expect(() => extract_k_path_points(bs, [[1, 0]] as never)).toThrow(/3×3/)
    // the per-point conversion Bands uses for a clicked symmetry point agrees exactly
    expect(frac_k_to_cartesian([1 / 3, 1 / 3, 0], recip, false)).toEqual(k_point)
  })

  it(`k_path_labels pairs labeled q-points with their Cartesian positions`, () => {
    const bs = make_bs([`GAMMA`, null, `X`])
    const points: Vec3[] = [
      [0, 0, 0],
      [0.5, 0, 0],
      [1, 0, 0],
    ]
    expect(k_path_labels(bs, points)).toEqual([
      { position: [0, 0, 0], label: `Γ` },
      { position: [0.5, 0, 0], label: null },
      { position: [1, 0, 0], label: `X` },
    ])
    // points missing from a shorter path are skipped rather than paired with undefined
    expect(k_path_labels(bs, points.slice(0, 1))).toEqual([
      { position: [0, 0, 0], label: `Γ` },
    ])
  })

  it(`folds to the minimum-image point of the first Brillouin zone`, () => {
    // FCC reciprocal lattice; a point near K where per-axis wrapping is not the WS image
    const fcc_recip: Matrix3x3 = [
      [-1, 1, 1],
      [1, -1, 1],
      [1, 1, -1],
    ]
    const bs = make_bs([`K`], {
      qpoints: [{ label: `K`, frac_coords: [0.3713, 0.3713, 0.7425] }],
    })
    const [k_point] = extract_k_path_points(bs, fcc_recip)
    const norm_sq = (vec: Vec3) => vec[0] ** 2 + vec[1] ** 2 + vec[2] ** 2
    expect(k_point.map((val) => Math.round(val * 1e4) / 1e4)).toEqual([0.7425, 0.7425, 0.0001])
    for (const n1 of [-1, 0, 1]) {
      for (const n2 of [-1, 0, 1]) {
        for (const n3 of [-1, 0, 1]) {
          const translated: Vec3 = [0, 1, 2].map(
            (axis) =>
              k_point[axis] +
              n1 * fcc_recip[0][axis] +
              n2 * fcc_recip[1][axis] +
              n3 * fcc_recip[2][axis],
          ) as Vec3
          expect(norm_sq(k_point)).toBeLessThanOrEqual(norm_sq(translated) + 1e-9)
        }
      }
    }
  })
})

describe(`normalize_band_structure`, () => {
  const pmg = (opts: Record<string, unknown>) => ({
    '@class': `PhononBandStructureSymmLine`,
    ...identity_rec,
    ...opts,
  })
  const line = (n_points: number) =>
    Array.from({ length: n_points }, (_, idx) => [idx / (n_points - 1), 0, 0])

  it(`passes matterviz input through, filling nb_bands and labels_dict`, () => {
    const result = normalize_band_structure({
      qpoints: [
        { label: `GAMMA`, frac_coords: [0, 0, 0] },
        { label: `X`, frac_coords: [0.5, 0, 0] },
      ],
      branches: [{ start_index: 0, end_index: 1, name: `GAMMA-X` }],
      bands: [
        [0, 1],
        [2, 3],
      ],
      distance: [0, 1],
    })
    expect(result).toMatchObject({
      nb_bands: 2,
      labels_dict: {},
      bands: [
        [0, 1],
        [2, 3],
      ],
    })
  })

  it.each([
    [`null`, null],
    [`a string`, `bands`],
    [`an empty object`, {}],
    [`empty qpoints`, { qpoints: [], branches: [], bands: [], distance: [] }],
    [
      `a distance/qpoints length mismatch`,
      {
        qpoints: [{ label: null, frac_coords: [0, 0, 0] }],
        branches: [],
        bands: [[0]],
        distance: [0, 1],
      },
    ],
    [
      `a band of the wrong length`,
      {
        qpoints: [{ label: null, frac_coords: [0, 0, 0] }],
        branches: [],
        bands: [[0, 1]],
        distance: [0],
      },
    ],
    [
      `a branch past the last q-point`,
      {
        qpoints: [{ label: null, frac_coords: [0, 0, 0] }],
        branches: [{ start_index: 0, end_index: 5, name: `t` }],
        bands: [[0]],
        distance: [0],
      },
    ],
    [`pymatgen input without bands`, pmg({ qpoints: line(2), bands: null })],
    [
      `pymatgen input with an unknown unit`,
      pmg({ qpoints: line(2), bands: [[0, 1]], unit: `GHz` }),
    ],
    [`pymatgen input with empty kpoints`, { kpoints: [], bands: { '1': [] } }],
  ])(`returns null for %s`, (_label, input) => {
    expect(normalize_band_structure(input)).toBeNull()
  })

  // Bands are stored in THz; the factor is the module's own unit table, so the test pins the
  // direction of the conversion and the unit aliases rather than re-deriving constants
  it.each([
    [undefined, 5, 5],
    [null, 5, 5], // undeclared, like normalize_dos treats `unit: null`
    [`thz`, 5, 5],
    [`ev`, 4.135667696e-3, 1],
    [`meV`, 4.135667696, 1],
    [`cm-1`, THZ_TO_INVERSE_CM, 1],
    [`cm^-1`, 2 * THZ_TO_INVERSE_CM, 2],
  ])(`converts pymatgen bands declared in %s to THz`, (unit, input, expected_thz) => {
    const result = normalize_band_structure(
      pmg({ qpoints: line(2), bands: [[0, input]], ...(unit !== undefined && { unit }) }),
    )
    expect(result?.bands[0][1]).toBeCloseTo(expected_thz, 9)
  })

  it(`transposes the frequencies_cm layout (q-points × branches, in cm^-1)`, () => {
    const result = normalize_band_structure(
      pmg({
        qpoints: line(2),
        frequencies_cm: [
          [THZ_TO_INVERSE_CM, 2 * THZ_TO_INVERSE_CM],
          [3 * THZ_TO_INVERSE_CM, 4 * THZ_TO_INVERSE_CM],
        ],
      }),
    )
    expect(
      result?.bands.map((band) => band.map((val) => Math.round(val * 1e9) / 1e9)),
    ).toEqual([
      [1, 3],
      [2, 4],
    ])
  })

  it(`labels q-points from Kpoint objects or by matching labels_dict within 1e-4`, () => {
    const from_kpoints = normalize_band_structure({
      ...identity_rec,
      qpoints: [
        { frac_coords: [0, 0, 0], label: `GAMMA` },
        { frac_coords: [0.5, 0, 0], label: `X` },
      ],
      bands: [[0, 1]],
    })
    expect(from_kpoints?.qpoints.map((qpt) => qpt.label)).toEqual([`GAMMA`, `X`])
    const from_dict = normalize_band_structure(
      pmg({
        qpoints: [
          [0.00001, -0.00001, 0],
          [0.49999, 0.00001, 0],
        ],
        bands: [[0, 1]],
        labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0] },
      }),
    )
    expect(from_dict?.qpoints.map((qpt) => qpt.label)).toEqual([`GAMMA`, `X`])
  })

  it(`accumulates distance along the path but not across a discontinuity`, () => {
    const result = normalize_band_structure(
      pmg({
        qpoints: [
          [0, 0, 0],
          [0.05, 0, 0],
          [0.1, 0, 0],
          [0.9, 0.9, 0.9],
          [0.95, 0.95, 0.95],
          [1, 1, 1],
        ],
        bands: [[0, 1, 2, 3, 4, 5]],
      }),
    )
    const expected = [
      0,
      0.05,
      0.1,
      0.1,
      0.1 + Math.hypot(0.05, 0.05, 0.05),
      0.1 + 2 * Math.hypot(0.05, 0.05, 0.05),
    ]
    result?.distance.forEach((val, idx) => expect(val).toBeCloseTo(expected[idx], 12))
  })

  // Reciprocal lattice of a hexagonal cell: a* = b* = 1 at 60°, c* = 0.4. The fractional
  // metric would give |M-K| = sqrt(1/36 + 1/9) and |K-GAMMA| = sqrt(2/9); the Cartesian one
  // gives sqrt(3)/6 and 1/sqrt(3).
  const hex_matrix = [
    [1, 0, 0],
    [0.5, Math.sqrt(3) / 2, 0],
    [0, 0, 0.4],
  ]
  const hex_path = {
    qpoints: [
      [0, 0, 0],
      [0.5, 0, 0],
      [1 / 3, 1 / 3, 0],
      [0, 0, 0],
      [0, 0, 0.5],
    ],
    bands: [[0, 1, 2, 3, 4]],
    labels_dict: { GAMMA: [0, 0, 0], M: [0.5, 0, 0], K: [1 / 3, 1 / 3, 0], A: [0, 0, 0.5] },
  }
  const hex_distance = [
    0,
    0.5,
    0.5 + Math.sqrt(3) / 6,
    0.5 + Math.sqrt(3) / 6 + 1 / Math.sqrt(3),
    0.5 + Math.sqrt(3) / 6 + 1 / Math.sqrt(3) + 0.2,
  ]

  // pymatgen's lattice_rec already includes 2π; phonopy's recip_lattice does not and is scaled
  // so the kept reciprocal lattice (and the distances measured in it) share one convention
  it.each([
    [`lattice_rec`, 1],
    [`recip_lattice`, 2 * Math.PI],
  ])(`measures k-path distance in Cartesian reciprocal space from %s.matrix`, (key, scale) => {
    const spy = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const result = normalize_band_structure({
      '@class': `PhononBandStructureSymmLine`,
      ...hex_path,
      [key]: { matrix: hex_matrix },
    })
    spy.mockRestore()
    expect(result?.distance).toHaveLength(5)
    result?.distance.forEach((val, idx) =>
      expect(val).toBeCloseTo(hex_distance[idx] * scale, 12),
    )
    result?.recip_lattice?.forEach((row, row_idx) =>
      row.forEach((val, col_idx) =>
        expect(val).toBeCloseTo(hex_matrix[row_idx][col_idx] * scale, 12),
      ),
    )
    expect(result?.recip_lattice).toHaveLength(3)
    // every labeled q-point bounds a branch, so all four legs get axis labels
    expect(result?.branches.map((branch) => branch.name)).toEqual([
      `GAMMA-M`,
      `M-K`,
      `K-GAMMA`,
      `GAMMA-A`,
    ])
  })

  it.each([
    [`no reciprocal lattice`, {}],
    [
      `a 2x2 lattice_rec.matrix`,
      {
        lattice_rec: {
          matrix: [
            [1, 0],
            [0, 1],
          ],
        },
      },
    ],
    [
      `a non-finite recip_lattice.matrix`,
      {
        recip_lattice: {
          matrix: [
            [1, 0, 0],
            [0, NaN, 0],
            [0, 0, 1],
          ],
        },
      },
    ],
  ])(`throws naming lattice_rec.matrix for pymatgen input with %s`, (_label, lattice) => {
    // built without pmg(), which would add the identity lattice_rec
    const input = {
      '@class': `PhononBandStructureSymmLine`,
      qpoints: line(2),
      bands: [[0, 1]],
    }
    // a throw, not null: the shape is recognisably pymatgen, so the missing key is a
    // fixable defect Bands surfaces in its empty state (unrecognised shapes stay null)
    expect(() => normalize_band_structure({ ...input, ...lattice })).toThrow(
      /'lattice_rec\.matrix' \(or 'recip_lattice\.matrix'\).*got keys \[@class, qpoints, bands/,
    )
  })

  it(`compute_frequency_range skips pymatgen entries that fail to normalize`, () => {
    const broken = {
      '@class': `PhononBandStructureSymmLine`,
      qpoints: line(2),
      bands: [[0, 1]],
    }
    const range = compute_frequency_range(
      { broken, fine: pmg({ qpoints: line(2), bands: [[2, 4]] }) },
      undefined,
    )
    expect(range?.[0]).toBeCloseTo(2 - 0.02 * 2, 9)
    expect(range?.[1]).toBeCloseTo(4 + 0.02 * 2, 9)
    expect(compute_frequency_range(broken, undefined)).toBeUndefined()
  })

  it(`passes pymatgen phonon flags through`, () => {
    const spy = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const flagged = normalize_band_structure(
      pmg({ qpoints: line(2), bands: [[0, 1]], has_nac: true, has_imaginary_modes: false }),
    )
    expect(flagged).toMatchObject({ has_nac: true, has_imaginary_modes: false })
    const unflagged = normalize_band_structure(pmg({ qpoints: line(2), bands: [[0, 1]] }))
    expect(unflagged && `has_nac` in unflagged).toBe(false)
    spy.mockRestore()
  })

  describe(`branches`, () => {
    const warn = () => vi.spyOn(console, `warn`).mockImplementation(() => {})

    it.each([
      [
        `a single unlabeled path`,
        [
          [0.1, 0, 0],
          [0.25, 0, 0],
          [0.4, 0, 0],
        ],
        {},
        [{ start_index: 0, end_index: 2, name: `?-?` }],
      ],
      [
        `labelled endpoints`,
        [
          [0, 0, 0],
          [0.25, 0, 0],
          [0.5, 0, 0],
        ],
        { GAMMA: [0, 0, 0], X: [0.5, 0, 0] },
        [{ start_index: 0, end_index: 2, name: `GAMMA-X` }],
      ],
      [
        `one discontinuity`,
        [
          [0, 0, 0],
          [0.1, 0, 0],
          [0.9, 0.9, 0.9],
          [1, 1, 1],
        ],
        { GAMMA: [0, 0, 0], L: [1, 1, 1] },
        [
          { start_index: 0, end_index: 1, name: `GAMMA-?` },
          { start_index: 2, end_index: 3, name: `?-L` },
        ],
      ],
      [
        `two discontinuities`,
        [
          [0, 0, 0],
          [0.1, 0, 0],
          [0.5, 0.5, 0],
          [0.6, 0.5, 0],
          [1, 1, 1],
          [1.1, 1, 1],
        ],
        { GAMMA: [0, 0, 0], K: [0.5, 0.5, 0], L: [1, 1, 1] },
        [
          { start_index: 0, end_index: 1, name: `GAMMA-?` },
          { start_index: 2, end_index: 3, name: `K-?` },
          { start_index: 4, end_index: 5, name: `L-?` },
        ],
      ],
    ])(
      `infers branches from discontinuities for %s (silently: pymatgen phonon JSON never has them)`,
      (_label, qpoints, labels_dict, expected) => {
        const spy = warn()
        const result = normalize_band_structure(
          pmg({ qpoints, bands: [qpoints.map((_, idx) => idx)], labels_dict }),
        )
        expect(result?.branches).toEqual(expected)
        expect(spy).not.toHaveBeenCalled()
        spy.mockRestore()
      },
    )

    it(`keeps valid explicit branches and drops invalid ones before falling back`, () => {
      const spy = warn()
      const explicit = normalize_band_structure(
        pmg({
          qpoints: line(3),
          bands: [[0, 1, 2]],
          branches: [
            { start_index: 0, end_index: 1, name: `a` },
            { start_index: 1, end_index: 2, name: `b` },
          ],
        }),
      )
      expect(explicit?.branches.map((branch) => branch.name)).toEqual([`a`, `b`])
      expect(spy).not.toHaveBeenCalled()
      const invalid = normalize_band_structure(
        pmg({
          qpoints: line(2),
          bands: [[0, 1]],
          branches: [
            { start_index: -1, end_index: 0, name: `x` },
            { start_index: 0, end_index: 99, name: `y` },
          ],
        }),
      )
      expect(invalid?.branches).toEqual([{ start_index: 0, end_index: 1, name: `?-?` }])
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    })
  })

  describe(`electronic (kpoints, spin-keyed bands)`, () => {
    it(`reads both spin channels and drops a malformed spin-down channel`, () => {
      const both = normalize_band_structure({
        ...identity_rec,
        kpoints: line(2),
        bands: {
          '1': [
            [0, 1],
            [2, 3],
          ],
          '-1': [
            [0.1, 1.1],
            [2.1, 3.1],
          ],
        },
        efermi: 0,
      })
      expect(both).toMatchObject({
        bands: [
          [0, 1],
          [2, 3],
        ],
        spin_down_bands: [
          [0.1, 1.1],
          [2.1, 3.1],
        ],
        nb_bands: 2,
      })
      const ragged = normalize_band_structure({
        ...identity_rec,
        kpoints: line(2),
        bands: {
          '1': [
            [0, 1],
            [2, 3],
          ],
          '-1': [[0.1], [2.1, 3.1]],
        },
      })
      expect(ragged?.spin_down_bands).toBeUndefined()
    })

    it(`recognises pymatgen input by kpoints, @class or @module, but not bare branched input`, () => {
      const branched = {
        ...identity_rec,
        kpoints: line(2),
        bands: { '1': [[0, 1]] },
        branches: [{ name: `\\Gamma-X`, start_index: 0, end_index: 1 }],
      }
      expect(normalize_band_structure(branched)).toBeNull()
      expect(
        normalize_band_structure({ '@class': `BandStructureSymmLine`, ...branched })?.branches,
      ).toHaveLength(1)
      expect(
        normalize_band_structure({
          '@module': `pymatgen.electronic_structure.bandstructure`,
          ...branched,
        })?.qpoints,
      ).toHaveLength(2)
      expect(
        normalize_band_structure({
          ...identity_rec,
          kpoints: line(2),
          bands: [
            [0, 1],
            [2, 3],
          ],
        })?.nb_bands,
      ).toBe(2)
    })
  })
})

describe(`normalize_dos`, () => {
  it.each([
    [
      `numeric spin keys`,
      { '1': [0.5, 1, 0.5], '-1': [0.4, 0.9, 0.4] },
      [0.5, 1, 0.5],
      [0.4, 0.9, 0.4],
    ],
    [
      `Spin.up/Spin.down keys`,
      { 'Spin.up': [0.3, 0.8, 0.3], 'Spin.down': [0.2, 0.7, 0.2] },
      [0.3, 0.8, 0.3],
      [0.2, 0.7, 0.2],
    ],
    [
      `spin-up listed second`,
      { '-1': [0.4, 0.9, 0.4], '1': [0.5, 1, 0.5] },
      [0.5, 1, 0.5],
      [0.4, 0.9, 0.4],
    ],
    [`a plain array`, [0.2, 0.6, 0.2], [0.2, 0.6, 0.2], undefined],
  ])(`electronic densities as %s`, (_label, densities, up, down) => {
    expect(normalize_dos({ energies: [-5, 0, 5], densities })).toEqual({
      type: `electronic`,
      energies: [-5, 0, 5],
      densities: up,
      spin_down_densities: down,
      spin_polarized: down !== undefined,
    })
  })

  it(`honours an explicit spin_polarized flag and an explicit spin_down_densities field`, () => {
    expect(
      normalize_dos({ energies: [0, 1], densities: [1, 1], spin_polarized: true }),
    ).toMatchObject({ spin_polarized: true })
    expect(
      normalize_dos({ energies: [0, 1], densities: [1, 1], spin_down_densities: [2, 2] }),
    ).toMatchObject({
      spin_polarized: true,
      spin_down_densities: [2, 2],
    })
  })

  it.each([
    [undefined, 1],
    [`THz`, 1],
    [`cm-1`, 1 / THZ_TO_INVERSE_CM],
    [`cm^-1`, 1 / THZ_TO_INVERSE_CM],
    [`cm⁻¹`, 1 / THZ_TO_INVERSE_CM],
    [`meV`, 1 / 4.135667696],
  ])(`phonon frequencies declared in %s are stored in THz`, (frequency_unit, thz_per_unit) => {
    const result = normalize_dos({
      frequencies: [0, 10],
      densities: [0, 1],
      ...(frequency_unit && { frequency_unit }),
    })
    expect(result?.type).toBe(`phonon`)
    if (result?.type === `phonon`)
      expect(result.frequencies[1]).toBeCloseTo(10 * thz_per_unit, 8)
  })

  it.each([
    [`null`, null],
    [`a string`, `dos`],
    [`missing densities`, { frequencies: [1, 2] }],
    [`a length mismatch`, { frequencies: [1, 2, 3], densities: [0, 1] }],
    [`an empty spin record`, { energies: [0, 1], densities: {} }],
    [`an unknown frequency unit`, { frequencies: [1], densities: [1], unit: `GHz` }],
    [`pymatgen input without an axis`, { '@class': `PhononDos`, densities: [0, 1] }],
  ])(`returns null for %s`, (_label, input) => {
    const spy = vi.spyOn(console, `warn`).mockImplementation(() => {})
    expect(normalize_dos(input)).toBeNull()
    spy.mockRestore()
  })
})

describe(`shift_to_fermi`, () => {
  const dos = (
    efermi: number,
    energies: number[],
    extra: Partial<PymatgenCompleteDos> = {},
  ): PymatgenCompleteDos => ({
    energies,
    densities: energies.map(() => 1),
    efermi,
    ...extra,
  })

  it.each([
    [5, [-10, 0, 10], [-15, -5, 5]],
    [0, [-5, 0, 5], [-5, 0, 5]],
    [-2.5, [-10, 0, 5], [-7.5, 2.5, 7.5]],
  ])(`shifts efermi %f to 0 without mutating the input`, (efermi, energies, expected) => {
    const input = dos(efermi, energies)
    const shifted = shift_to_fermi(input)
    expect(shifted.efermi).toBe(0)
    expect(shifted.energies).toEqual(expected)
    expect(input.energies).toEqual(energies)
    expect(shifted.densities).toBe(input.densities)
  })

  it(`shifts nested atom_dos and spd_dos and keeps every other field`, () => {
    const nested = {
      '@class': `Dos`,
      energies: [0, 5, 10],
      densities: [0.3, 0.6, 0.3],
      efermi: 5,
    }
    const shifted = shift_to_fermi(
      dos(5, [0, 5, 10], {
        '@class': `LobsterCompleteDos`,
        structure: { lattice: {} },
        atom_dos: { Fe: nested },
        spd_dos: { s: nested },
      }),
    )
    expect(shifted).toMatchObject({
      '@class': `LobsterCompleteDos`,
      structure: { lattice: {} },
      efermi: 0,
      energies: [-5, 0, 5],
    })
    for (const inner of [shifted.atom_dos?.Fe, shifted.spd_dos?.s]) {
      expect(inner).toEqual({ ...nested, efermi: 0, energies: [-5, 0, 5] })
    }
  })
})

it.each([
  [[0, 1, 2, 3], 10, 20, [10, 10 + 10 / 3, 10 + 20 / 3, 20]],
  [[5, 5, 5], 10, 20, [15, 15, 15]], // zero-length segment → midpoint
  [[42], 0, 10, [5]],
  [[], 0, 10, []],
])(`scale_segment_distances(%j, %f, %f) → %j`, (distances, x_start, x_end, expected) => {
  const result = scale_segment_distances(distances, x_start, x_end)
  expect(result).toHaveLength(expected.length)
  expected.forEach((val, idx) => expect(result[idx]).toBeCloseTo(val, 12))
})

describe(`generate_ribbon_path`, () => {
  const id = (val: number) => val
  it(`traces the upper edge forward and the lower edge back, widths normalised to the max`, () => {
    // max width 2 at x = 1: half-width 10 px, so y = 5 ± 10; width 1 gives ± 5
    const path = generate_ribbon_path([0, 1, 2], [5, 5, 5], [1, 2, 1], id, id, 10)
    expect(path).toBe(
      `M0.00,0.00 L1.00,-5.00 L2.00,0.00 L2.00,10.00 L1.00,15.00 L0.00,10.00 Z`,
    )
    expect(generate_ribbon_path([0, 1], [5, 5], [1, 1], (val) => 2 * val, id, 10, 2)).toBe(
      `M0.00,-15.00 L2.00,-15.00 L2.00,25.00 L0.00,25.00 Z`,
    )
    // non-finite widths count as 0
    expect(generate_ribbon_path([0, 1, 2], [0, 0, 0], [1, Infinity, 1], id, id, 10)).toContain(
      `L1.00,0.00`,
    )
  })

  it.each([
    [`too few points`, [0], [0], [1]],
    [`mismatched y`, [0, 1, 2], [0, 1], [1, 1, 1]],
    [`mismatched widths`, [0, 1, 2], [0, 1, 2], [1, 1]],
    [`no positive width`, [0, 1, 2], [0, 1, 0], [0, -1, NaN]],
  ])(`returns "" for %s`, (_label, x_vals, y_vals, widths) => {
    expect(generate_ribbon_path(x_vals, y_vals, widths, id, id, 10)).toBe(``)
  })
})

describe(`compute_frequency_range`, () => {
  const bands_of = (bands: number[][]) =>
    make_bs(
      Array.from({ length: bands[0].length }, () => null),
      { bands },
    )

  it.each([
    [
      `phonon bands`,
      bands_of([
        [0, 5, 10],
        [2, 8, 15],
      ]),
      undefined,
      [0, 15.3],
    ],
    [`a phonon DOS`, undefined, { frequencies: [0, 5, 15], densities: [0, 1, 0] }, [0, 15.3]],
    [
      `bands plus DOS`,
      bands_of([[0, 5]]),
      { frequencies: [0, 20], densities: [0, 1] },
      [0, 20.4],
    ],
    [
      `a dict of band structures`,
      { a: bands_of([[0, 5]]), b: bands_of([[2, 12]]) },
      undefined,
      [0, 12.24],
    ],
    [
      `a dict of DOS`,
      undefined,
      {
        a: { frequencies: [0, 8], densities: [0, 1] },
        b: { frequencies: [0, 15], densities: [0, 1] },
      },
      [0, 15.3],
    ],
    [
      `an electronic DOS (no clamp, padded both sides)`,
      undefined,
      { energies: [-10, 0, 10], densities: [0, 1, 0] },
      [-10.4, 10.4],
    ],
    [`non-finite band values`, bands_of([[0, NaN, 5, Infinity, 10]]), undefined, [0, 10.2]],
    [
      `negative noise under 0.5% (clamped)`,
      bands_of([
        [-0.01, 5, 10],
        [0, 8, 15],
      ]),
      undefined,
      [0, 15.3],
    ],
    [`real imaginary modes (kept)`, bands_of([[-2, -1, 0, 5, 10]]), undefined, [-2.24, 10.24]],
    // a plain `=` in the DOS loop let the last entry overwrite the phonon flag, disabling the
    // imaginary-mode clamp (reported [-0.3102, 15.3002])
    [
      `a phonon DOS listed before an electronic one (phonon flag not overwritten)`,
      bands_of([[-0.01, 5, 10]]),
      {
        phonon: { frequencies: [0, 15], densities: [0, 1] },
        electronic: { energies: [0, 10], densities: [0, 1] },
      },
      [0, 15.3],
    ],
    [
      `an electronic DOS overriding phonon-looking bands`,
      bands_of([[-0.01, 5, 10]]),
      { type: `electronic`, energies: [-5, 0, 5], densities: [0, 1, 0] },
      [-5.3, 10.3],
    ],
  ])(`%s`, (_label, bands, doses, expected) => {
    const range = compute_frequency_range(bands, doses)
    expect(range?.[0]).toBeCloseTo(expected[0], 9)
    expect(range?.[1]).toBeCloseTo(expected[1], 9)
  })

  it(`returns undefined without data and honours the padding factor`, () => {
    expect(compute_frequency_range(undefined, undefined)).toBeUndefined()
    expect(compute_frequency_range({}, {})).toBeUndefined()
    expect(
      compute_frequency_range(undefined, { frequencies: [0, 10], densities: [0, 1] }, 0.1),
    ).toEqual([0, 11])
  })

  // Raw electronic markers must be read before normalisation strips them: with a small
  // negative value, phonon input clamps to 0 while electronic input keeps it. A @class marker
  // routes through the pymatgen converter, which needs the reciprocal lattice. Bands.svelte
  // classifies its input with the same predicate, so the two cannot disagree.
  it.each([
    [`efermi`, { efermi: 5 }, true],
    [`kpoints`, { kpoints: [{ frac_coords: [0, 0, 0] }] }, true],
    [`an electronic @class`, { '@class': `BandStructureSymmLine`, ...identity_rec }, true],
    [
      `an electronic @module`,
      { '@module': `pymatgen.electronic_structure.bandstructure`, ...identity_rec },
      true,
    ],
    [`a phonon @class`, { '@class': `PhononBandStructureSymmLine`, ...identity_rec }, false],
  ])(`detects electronic bands via %s`, (_label, marker, is_electronic) => {
    const input = { ...bands_of([[-0.01, 5, 10]]), ...marker }
    expect(is_electronic_band_struct(input)).toBe(is_electronic)
    const range = compute_frequency_range(input, undefined)
    expect(range?.[0]).toBeCloseTo(is_electronic ? -0.01 - 10.01 * 0.02 : 0, 9)
  })
})

it.each([
  [[], 0],
  [[1, 2, 3], 0],
  [[-1, -2, -3], 1],
  [[0, 0], 0],
  [[-2, -1, 7], 0.3],
  [[NaN, -1, 1, Infinity], 0.5],
  [[NaN, Infinity, -Infinity], 0],
])(`negative_fraction(%j) → %f`, (values, expected) => {
  expect(negative_fraction(values)).toBeCloseTo(expected, 12)
})

describe(`acoustic classification`, () => {
  it.each([
    [
      [
        [null, [1, 0, 0]],
        [null, [0.5, 0, 0]],
        [null, [-1, 0, 0]],
      ],
      [0, 2],
    ],
    [
      [
        [`GAMMA`, [0, 0, 0]],
        [`X`, [0.5, 0, 0]],
        [`GAMMA`, [0, 0, 0]],
      ],
      [0, 2],
    ],
    [[[`X`, [0.5, 0, 0]]], []],
    [[], []],
    [[[null, [0.02, 0, 0]]], []],
    [[[null, [0.009, -0.005, 0.001]]], [0]],
  ] as [[string | null, Vec3][], number[]][])(
    `find_gamma_indices(%j) → %j`,
    (qpoints, expected) => {
      const bs = make_bs([], {
        qpoints: qpoints.map(([label, frac_coords]) => ({ label, frac_coords })),
      })
      expect(find_gamma_indices(bs)).toEqual(expected)
    },
  )

  it.each([
    [0, [0], true],
    [-0.3, [0], true],
    [ACOUSTIC_FREQ_THRESHOLD, [0], false],
    [5, [], null], // no Gamma point: undecidable
  ])(`a band at %f THz at Gamma %j → %s`, (freq, gamma_indices, expected) => {
    expect(
      classify_acoustic(
        make_bs([null, null, null], { bands: [[freq, 5, 10]] }),
        0,
        gamma_indices,
      ),
    ).toBe(expected)
  })

  it(`is acoustic if any Gamma point is near zero and false for a missing band`, () => {
    const bs = make_bs([null, null, null], { bands: [[5, 10, 0.1]] })
    expect(classify_acoustic(bs, 0, [0, 2])).toBe(true)
    expect(classify_acoustic(bs, 99, [0])).toBe(false)
  })
})

describe(`build_point_metadata`, () => {
  const bs = make_bs([`GAMMA`, null, `X`], {
    bands: [
      [0, 5, 10],
      [3, 6, 9],
    ],
    band_widths: [
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ],
  })
  const build = (overrides: Partial<Parameters<typeof build_point_metadata>[0]> = {}) =>
    build_point_metadata({
      x_vals: [0, 1, 2],
      y_vals: [0, 5, 10],
      band_idx: 0,
      spin: `up`,
      is_acoustic: true,
      bs,
      start_idx: 0,
      ...overrides,
    })

  it(`fills per-point q-point data, band widths and central-difference slopes`, () => {
    const [first, middle, last] = build()
    expect(first).toEqual({
      aria_label: `Select band 1, q-point 1`,
      band_idx: 0,
      qpoint_idx: 0,
      spin: `up`,
      is_acoustic: true,
      nb_bands: 2,
      frac_coords: [0, 0, 0],
      qpoint_label: `GAMMA`,
      band_width: 0.1,
      slope: 5,
    })
    expect(middle).toMatchObject({
      qpoint_label: null,
      qpoint_idx: 1,
      band_width: 0.2,
      slope: 5,
    })
    expect(last).toMatchObject({ qpoint_label: `X`, band_width: 0.3, slope: 5 })
  })

  it(`offsets into the path with start_idx and uses one-sided slopes at the ends`, () => {
    const [first, last] = build({
      x_vals: [0, 2],
      y_vals: [5, 9],
      band_idx: 1,
      spin: `down`,
      is_acoustic: null,
      start_idx: 1,
    })
    expect(first).toMatchObject({
      qpoint_idx: 1,
      band_idx: 1,
      spin: `down`,
      is_acoustic: null,
      band_width: 0.5,
      slope: 2,
      aria_label: `Select band 2, q-point 2`,
    })
    expect(last).toMatchObject({ qpoint_idx: 2, qpoint_label: `X`, band_width: 0.6, slope: 2 })
    const without_widths = build({
      bs: make_bs([`GAMMA`, null, `X`]),
      x_vals: [0],
      y_vals: [5],
    })
    expect(without_widths[0]).toMatchObject({ band_width: null, slope: null }) // single point: dx = 0
    expect(build({ x_vals: [], y_vals: [] })).toEqual([])
  })
})
