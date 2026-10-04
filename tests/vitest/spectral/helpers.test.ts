import { THZ_TO_INVERSE_CM } from '#lib/constants.js'
import type { Matrix3x3, Vec2, Vec3 } from '#lib/math.js'
import { convert_frequencies } from '#lib/spectral/frequency-units.js'
import type { PymatgenCompleteDos } from '#lib/spectral/helpers.js'
import {
  ACOUSTIC_FREQ_THRESHOLD,
  are_qpoints_equivalent,
  apply_gaussian_smearing,
  gaussian_kernel_smooth,
  branch_segment_keys,
  build_point_metadata,
  classify_acoustic,
  compute_frequency_range,
  density_divisor,
  extract_k_path_points,
  find_gamma_indices,
  find_qpoint_at_rescaled_x,
  frac_k_to_cartesian,
  generate_ribbon_path,
  is_electronic_band_struct,
  k_path_labels,
  negative_fraction,
  normalize_band_structure,
  trapezoid_weights,
  electronic_band_gap,
  normalize_dos,
  pretty_sym_point,
  qpoint_x_position,
  scale_segment_distances,
  shift_to_fermi,
} from '#lib/spectral/helpers.js'
import type { BaseBandStructure, QPoint } from '#lib/spectral/types.js'
import * as math from '#lib/math.js'
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
    type: `phonon`,
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
  // phonopy BAND_LABELS are LaTeX math; the `$` used to reach the tick labels
  [`$\\Gamma$`, `Γ`],
  [`$\\mathrm{X}$`, `X`],
  [`$S_{0}$`, `S₀`],
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

describe(`density_divisor`, () => {
  const densities = [1, 2, 3, 2, 1]
  const energies = [0, 1, 2, 3, 4]
  // trapezoid weights [0.5, 1, 1, 1, 0.5] give ∫ = 8, not the 9 a left-Riemann sum reports.
  // Channels (e.g. both spins) share one divisor: the max over all, or their summed sum/∫
  it.each([
    [`max`, 3, 3],
    [`sum`, 9, 9 + 4.5],
    [`integral`, 8, 8 + 4],
    [null, 1, 1],
  ] as const)(`mode %s`, (mode, divisor, two_channel_divisor) => {
    expect(density_divisor([densities], energies, mode)).toBe(divisor)
    const half = densities.map((val) => val / 2)
    expect(density_divisor([densities, half], energies, mode)).toBe(two_channel_divisor)
  })

  // the old left-Riemann sum read only x[1] - x[0]: 11.1% low on a uniform grid, 245% off here
  it(`integral mode makes ∫ = 1 on a non-uniform grid, and is 1 for degenerate input`, () => {
    const grid = [0, 0.1, 0.2, 3, 10]
    const divisor = density_divisor([densities], grid, `integral`)
    const normalized = densities.map((val) => val / divisor)
    const integral = grid
      .slice(1)
      .reduce(
        (acc, x_val, idx) =>
          acc + ((normalized[idx] + normalized[idx + 1]) / 2) * (x_val - grid[idx]),
        0,
      )
    expect(integral).toBeCloseTo(1, 12)
    expect(density_divisor([[0, 0]], [0, 1], `max`)).toBe(1)
    expect(density_divisor([[1]], [0], `integral`)).toBe(1)
    // all-negative channels must not flip the curve's sign
    expect(density_divisor([[-2, -1]], [0, 1], `max`)).toBe(1)
  })

  // Math.max(...densities) overflows the argument limit; DOS grids reach 1e7 points
  it(`max mode handles grids beyond the spread-argument limit`, () => {
    const large = Array.from({ length: 300_000 }, (_, idx) => (idx % 97) + 1)
    expect(density_divisor([large], large, `max`)).toBe(97)
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
  const brute_force = (x_values: number[], y_values: number[], sigma: number): number[] => {
    const weights = trapezoid_weights(x_values)
    return x_values.map(
      (energy) =>
        x_values.reduce((sum, other, jdx) => {
          const delta = energy - other
          if (Math.abs(delta) > 4 * sigma) return sum
          return (
            sum + y_values[jdx] * weights[jdx] * Math.exp(-(delta ** 2) / (2 * sigma ** 2))
          )
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
  ])(`matches an unwindowed reference on a %s grid`, (_label, x_values) => {
    const y_values = x_values.map((_, idx) => ((idx * 37) % 11) + 0.5)
    const smeared = apply_gaussian_smearing(x_values, y_values, 0.25)
    const expected = brute_force(x_values, y_values, 0.25)
    let max_abs_error = 0
    for (const [idx, val] of smeared.entries())
      max_abs_error = Math.max(max_abs_error, Math.abs(val - expected[idx]))
    expect(max_abs_error).toBeLessThan(1e-10)
  })
})

describe(`branch_segment_keys`, () => {
  it(`keys labelled branches by label pair, numbers repeats and positions unlabeled ones`, () => {
    // Γ→X→Γ→X→(unlabeled)
    const band_structure = make_bs([`GAMMA`, null, `X`, null, `GAMMA`, `X`])
    band_structure.branches.push({ start_index: 5, end_index: 5, name: `tail` })
    band_structure.qpoints[5] = { label: null, frac_coords: [1, 0, 0] }
    expect(branch_segment_keys(band_structure)).toEqual([
      `GAMMA_X`,
      `X_GAMMA`,
      `GAMMA_null`,
      `branch:3`,
    ])
    const repeated = make_bs([`GAMMA`, `X`, `GAMMA`, `X`])
    expect(branch_segment_keys(repeated)).toEqual([`GAMMA_X`, `X_GAMMA`, `GAMMA_X#2`])
  })
})

describe(`qpoint_x_position / find_qpoint_at_rescaled_x`, () => {
  // Γ→X (3 steps) and X→K (2 steps), plotted into [0, 1] and [1, 1.5]
  const band_structure = make_bs([`GAMMA`, null, null, `X`, null, `K`])
  const x_pos: Record<string, Vec2> = { GAMMA_X: [0, 1], X_K: [1, 1.5] }

  it.each([
    [0, 0],
    [3, 1],
    [5, 1.5],
    [4, 1.25],
    [1, 1 / 3],
  ])(`q-point %i sits at x = %f and maps back`, (idx, expected_x) => {
    const x_val = qpoint_x_position(band_structure, idx, x_pos)
    expect(x_val).toBeCloseTo(expected_x, 12)
    expect(find_qpoint_at_rescaled_x(band_structure, x_val ?? NaN, x_pos)).toBe(idx)
  })

  it(`rounds interior x to the nearest q-point and snaps off-path x to the nearest endpoint`, () => {
    expect(find_qpoint_at_rescaled_x(band_structure, 0.6, x_pos)).toBe(2) // 0.6 · 3 = 1.8 → idx 2
    expect(find_qpoint_at_rescaled_x(band_structure, 9, { GAMMA_X: [0, 1] })).toBe(3) // beyond the only segment
    expect(find_qpoint_at_rescaled_x(band_structure, 0.5, {})).toBe(0) // no segments: fallback index
    expect(qpoint_x_position(band_structure, 4, { GAMMA_X: [0, 1] })).toBeNull() // branch not plotted
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
  const fcc_recip: Matrix3x3 = [
    [-1, 1, 1],
    [1, -1, 1],
    [1, 1, -1],
  ]

  it(`maps fractional to Cartesian with row-vector reciprocal lattice vectors`, () => {
    const band_structure = make_bs([`GAMMA`, `X`, `K`])
    band_structure.qpoints[2].frac_coords = [1 / 3, 1 / 3, 0]
    const recip: Matrix3x3 = [
      [2, 0.5, 0],
      [0, 2, 0],
      [0, 0, 1],
    ]
    const [gamma, x_point, k_point] = extract_k_path_points(band_structure, recip, {
      wrap_to_bz: false,
    })
    expect(gamma).toEqual([0, 0, 0])
    expect(x_point).toEqual([1, 0.25, 0]) // 0.5·b1
    expect(k_point[0]).toBeCloseTo(2 / 3, 12)
    expect(k_point[1]).toBeCloseTo(0.5 / 3 + 2 / 3, 12)
    expect(extract_k_path_points(make_bs([], { qpoints: [] }), recip)).toEqual([])
    expect(() => extract_k_path_points(band_structure, [[1, 0]] as never)).toThrow(/3×3/)
    // the per-point conversion Bands uses for a clicked symmetry point agrees exactly
    expect(frac_k_to_cartesian([1 / 3, 1 / 3, 0], recip, false)).toEqual(k_point)
  })

  // A sheared (non-reduced) basis needs shifts beyond ±1: the old 27-image search left
  // 25% of random points up to 2.7x too far from Γ, outside the rendered zone
  it.each([
    [
      `sheared cubic`,
      [
        [1, 0, 0],
        [-4, 1, 0],
        [0, 0, 1],
      ],
    ],
    [
      `sheared triclinic`,
      [
        [1, 0, 0],
        [-3.2, 1, 0],
        [-1.7, -2.4, 1],
      ],
    ],
    [`FCC`, fcc_recip],
  ] as [string, Matrix3x3][])(`folds into the first zone of a %s lattice`, (_name, recip) => {
    let seed = 3
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
    const recip_t = math.transpose_3x3_matrix(recip)
    for (let trial = 0; trial < 200; trial++) {
      const frac: Vec3 = [rand(), rand(), rand()]
      const folded = frac_k_to_cartesian(frac, recip)
      let min_norm = Infinity
      for (let n_1 = -8; n_1 <= 8; n_1++)
        for (let n_2 = -8; n_2 <= 8; n_2++)
          for (let n_3 = -8; n_3 <= 8; n_3++) {
            const image = math.mat3x3_vec3_multiply(recip_t, [
              frac[0] + n_1,
              frac[1] + n_2,
              frac[2] + n_3,
            ])
            min_norm = Math.min(min_norm, Math.hypot(...image))
          }
      // brute force and the fold agree to round-off (measured ≤ 1.3e-15)
      expect(Math.abs(Math.hypot(...folded) - min_norm)).toBeLessThan(1e-12)
      // and the fold moved the point by a lattice vector only
      const shift = math.mat3x3_vec3_multiply(
        math.matrix_inverse_3x3(recip_t),
        math.subtract(folded, math.mat3x3_vec3_multiply(recip_t, frac)),
      )
      for (const coord of shift) expect(Math.abs(coord - Math.round(coord))).toBeLessThan(1e-9)
    }
  })

  it(`k_path_labels pairs labeled q-points with their Cartesian positions`, () => {
    const band_structure = make_bs([`GAMMA`, null, `X`])
    const points: Vec3[] = [
      [0, 0, 0],
      [0.5, 0, 0],
      [1, 0, 0],
    ]
    expect(k_path_labels(band_structure, points)).toEqual([
      { position: [0, 0, 0], label: `Γ` },
      { position: [0.5, 0, 0], label: null },
      { position: [1, 0, 0], label: `X` },
    ])
    // points missing from a shorter path are skipped rather than paired with undefined
    expect(k_path_labels(band_structure, points.slice(0, 1))).toEqual([
      { position: [0, 0, 0], label: `Γ` },
    ])
  })

  // a point near FCC K where per-axis wrapping is not the Wigner-Seitz image
  it(`folds to the minimum-image point of the first Brillouin zone`, () => {
    const band_structure = make_bs([`K`], {
      qpoints: [{ label: `K`, frac_coords: [0.3713, 0.3713, 0.7425] }],
    })
    const [k_point] = extract_k_path_points(band_structure, fcc_recip)
    expect(k_point.map((val) => Math.round(val * 1e4) / 1e4)).toEqual([0.7425, 0.7425, 0.0001])
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
        // the jump is X|L: a step between two labelled points, as in pymatgen paths
        labels_dict: { GAMMA: [0, 0, 0], X: [0.1, 0, 0], L: [0.9, 0.9, 0.9], W: [1, 1, 1] },
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

  // pymatgen and phonopy put a fixed point count in each segment, so in an anisotropic cell
  // every step of a long segment is many times the median. A 5x-median jump heuristic used to
  // flag all of them, giving Γ-Z zero width (audit repro: total path 1.07 vs pymatgen's 4.84).
  it(`keeps long segments of an anisotropic cell (only labelled-to-labelled steps jump)`, () => {
    const gamma_x = Array.from({ length: 6 }, (_, idx) => [idx / 10, 0, 0])
    const x_r = Array.from({ length: 6 }, (_, idx) => [0.5, 0, idx / 10])
    const result = normalize_band_structure(
      pmg({
        qpoints: [...gamma_x, ...x_r], // X duplicated at the junction, as pymatgen writes it
        bands: [Array.from({ length: 12 }, (_, idx) => idx)],
        labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0], R: [0.5, 0, 0.5] },
        lattice_rec: {
          matrix: [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 10],
          ],
        },
      }),
    )
    // Γ-X spans 0.5, X-R spans 10 * 0.5 = 5
    expect(result?.distance.at(-1)).toBeCloseTo(5.5, 12)
    expect(result?.branches.map(({ name }) => name)).toEqual([`GAMMA-X`, `X-R`])
  })

  // Reciprocal lattice of a hexagonal cell: a* = b* = 1 at 60°, c* = 0.4. The fractional
  // metric would give |M-K| = sqrt(1/36 + 1/9) and |K-GAMMA| = sqrt(2/9); the Cartesian one
  // gives sqrt(3)/6 and 1/sqrt(3).
  const hex_matrix = [
    [1, 0, 0],
    [0.5, Math.sqrt(3) / 2, 0],
    [0, 0, 0.4],
  ]
  // Midpoints between the high-symmetry points make each leg a segment: a step from one
  // labelled point straight to another is a path jump (pymatgen's rule)
  const hex_corners = [
    [0, 0, 0],
    [0.5, 0, 0],
    [1 / 3, 1 / 3, 0],
    [0, 0, 0],
    [0, 0, 0.5],
  ]
  const hex_path = {
    qpoints: hex_corners.flatMap((corner, idx) => {
      const next = hex_corners[idx + 1]
      return next ? [corner, corner.map((val, dim) => (val + next[dim]) / 2)] : [corner]
    }),
    bands: [Array.from({ length: 9 }, (_, idx) => idx)],
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
    expect(result?.distance).toHaveLength(9)
    // corners sit at even indices
    hex_distance.forEach((val, idx) =>
      expect(result?.distance[2 * idx]).toBeCloseTo(val * scale, 12),
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
    // fixable defect reported by the file adapter (unrecognised shapes stay null)
    expect(() => normalize_band_structure({ ...input, ...lattice })).toThrow(
      /'lattice_rec\.matrix' \(or 'recip_lattice\.matrix'\).*got keys \[@class, qpoints, bands/,
    )
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
          [0.05, 0, 0],
          [0.1, 0, 0],
          [0.9, 0.9, 0.9],
          [0.95, 0.95, 0.95],
          [1, 1, 1],
        ],
        { GAMMA: [0, 0, 0], X: [0.1, 0, 0], W: [0.9, 0.9, 0.9], L: [1, 1, 1] },
        [
          { start_index: 0, end_index: 2, name: `GAMMA-X` },
          { start_index: 3, end_index: 5, name: `W-L` },
        ],
      ],
      [
        `two discontinuities`,
        [
          [0, 0, 0],
          [0.05, 0, 0],
          [0.1, 0, 0],
          [0.5, 0.5, 0],
          [0.55, 0.5, 0],
          [0.6, 0.5, 0],
          [1, 1, 1],
          [1.05, 1, 1],
          [1.1, 1, 1],
        ],
        {
          GAMMA: [0, 0, 0],
          X: [0.1, 0, 0],
          K: [0.5, 0.5, 0],
          U: [0.6, 0.5, 0],
          L: [1, 1, 1],
          W: [1.1, 1, 1],
        },
        [
          { start_index: 0, end_index: 2, name: `GAMMA-X` },
          { start_index: 3, end_index: 5, name: `K-U` },
          { start_index: 6, end_index: 8, name: `L-W` },
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

describe(`electronic_band_gap`, () => {
  // oxfmt-ignore
  it.each([
    [`insulator`, [[-2, -1], [1, 3]], 0, { vbm: -1, cbm: 1, gap: 2 }],
    // vasprun rounds eigenvalues to 1e-4 eV, so band edges at E_F land a hair past it
    [`VBM rounded just above E_F`, [[-2, 5e-5], [1, 2]], 0, { vbm: 5e-5, cbm: 1, gap: 1 - 5e-5 }],
    [`CBM rounded just below E_F`, [[-2, -1], [-5e-5, 1]], 0, { vbm: -1, cbm: -5e-5, gap: 1 - 5e-5 }],
    [`metal (band crosses E_F between filled and empty bands)`, [[-2], [-0.3, 0.2], [1]], 0, null],
    [`metal crossing E_F by just over the tolerance`, [[-2], [-2e-4, 2e-4], [1]], 0, null],
    [`all bands occupied`, [[-2, -1]], 0, null],
    [`non-finite energies skipped`, [[NaN, -1], [1, Infinity]], 0, { vbm: -1, cbm: 1, gap: 2 }],
    // non-SCF line-mode run: E_F = 0 from the SCF mesh calls this a metal, occupations don't
    [`VBM 30 meV above E_F, insulating occupations`, [[-1, 0.03], [0.5, 0.9]], [[1, 1], [0, 0]], { vbm: 0.03, cbm: 0.5, gap: 0.5 - 0.03 }],
    // smearing leaves band-edge states fractional, Blöchl corrections push them past [0, 1]
    [`smeared and Blöchl-corrected occupations`, [[-1, -0.1], [0.2, 1]], [[1.002, 0.93], [0.07, -0.002]], { vbm: -0.1, cbm: 0.2, gap: 0.2 + 0.1 }],
    [`metal by occupations though no band crosses E_F`, [[-2], [-1, -0.5], [1]], [[1], [1, 0], [0]], null],
    [`occupations of non-finite energies ignored`, [[-1, NaN], [1, 2]], [[1, 0], [0, 0]], { vbm: -1, cbm: 1, gap: 2 }],
  ])(`%s`, (_desc, bands, filling, expected) => {
    expect(electronic_band_gap(bands, filling)).toEqual(expected)
  })

  // oxfmt-ignore
  it.each([
    [`too few bands (e.g. a missing spin-down channel)`, [[1, 1]], /1 occupation rows for 2 bands/],
    [`a ragged band`, [[1, 1], [0]], /occupation row 1 needs 2 finite values/],
    [`non-finite values`, [[1, NaN], [0, 0]], /occupation row 0 needs 2 finite values/],
  ])(`throws for occupations with %s`, (_desc, occupations, error) => {
    expect(() => electronic_band_gap([[-1, 0], [1, 2]], occupations)).toThrow(error)
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
  ])(`electronic densities as %s`, (_label, densities, up_vector, down) => {
    expect(normalize_dos({ energies: [-5, 0, 5], densities, efermi: 2 })).toEqual({
      type: `electronic`,
      efermi: 2,
      energies: [-5, 0, 5],
      densities: up_vector,
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
  ])(`phonon DOS in %s is stored in THz, keeping ∫g dν`, (frequency_unit, thz_per_unit) => {
    const result = normalize_dos({
      frequencies: [0, 10],
      densities: [0, 1],
      ...(frequency_unit && { frequency_unit }),
    })
    if (result?.type !== `phonon`)
      throw new Error(`expected a phonon DOS, got ${result?.type}`)
    expect(result.frequencies[1]).toBeCloseTo(10 * thz_per_unit, 8)
    expect(result.densities[1]).toBeCloseTo(1 / thz_per_unit, 8)
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
  const identifier = (val: number) => val
  it(`traces the upper edge forward and the lower edge back at y ∓ half-width px`, () => {
    const path = generate_ribbon_path([0, 1, 2], [5, 5, 5], [5, 10, 5], identifier, identifier)
    expect(path).toBe(
      `M0.00,0.00 L1.00,-5.00 L2.00,0.00 L2.00,10.00 L1.00,15.00 L0.00,10.00 Z`,
    )
    expect(generate_ribbon_path([0, 1], [5, 5], [20, 20], (val) => 2 * val, identifier)).toBe(
      `M0.00,-15.00 L2.00,-15.00 L2.00,25.00 L0.00,25.00 Z`,
    )
  })

  it.each([
    [`too few points`, [0], [0], [1]],
    [`mismatched y`, [0, 1, 2], [0, 1], [1, 1, 1]],
    [`mismatched widths`, [0, 1, 2], [0, 1, 2], [1, 1]],
  ])(`returns "" for %s`, (_label, x_vals, y_vals, half_widths) => {
    expect(generate_ribbon_path(x_vals, y_vals, half_widths, identifier, identifier)).toBe(``)
  })
})

describe(`compute_frequency_range`, () => {
  const bands_of = (bands: number[][], type: `phonon` | `electronic` = `phonon`) => ({
    sample: make_bs(
      Array.from({ length: bands[0].length }, () => null),
      { bands, type },
    ),
  })
  const dos_of = (frequencies: number[]) => ({
    sample: { type: `phonon` as const, frequencies, densities: frequencies.map(() => 1) },
  })
  it.each([
    [
      `phonon bands`,
      bands_of([
        [0, 5, 10],
        [2, 8, 15],
      ]),
      {},
      [0, 15.3],
    ],
    [`a phonon DOS`, {}, dos_of([0, 5, 15]), [0, 15.3]],
    [`bands plus DOS`, bands_of([[0, 5]]), dos_of([0, 20]), [0, 20.4]],
    [
      `multiple band structures`,
      { ...bands_of([[0, 5]]), other: bands_of([[2, 12]]).sample },
      {},
      [0, 12.24],
    ],
    [`multiple DOS`, {}, { ...dos_of([0, 8]), other: dos_of([0, 15]).sample }, [0, 15.3]],
    [
      `electronic DOS`,
      {},
      {
        sample: { type: `electronic` as const, energies: [-10, 0, 10], densities: [0, 1, 0] },
      },
      [-10.4, 10.4],
    ],
    [`non-finite band values`, bands_of([[0, NaN, 5, Infinity, 10]]), {}, [0, 10.2]],
    [
      `negative noise under 0.5%`,
      bands_of([
        [-0.01, 5, 10],
        [0, 8, 15],
      ]),
      {},
      [0, 15.3],
    ],
    [`real imaginary modes`, bands_of([[-2, -1, 0, 5, 10]]), {}, [-2.24, 10.24]],
    // A soft branch in a large cell is well under 0.5% of all |values| but still a genuine
    // instability (< -0.5 THz); the noise clamp used to cut it off at [0, 8.14]
    [
      `a soft branch in a large cell`,
      bands_of([
        ...Array.from({ length: 24 }, (_band, band_idx) =>
          Array.from(
            { length: 300 },
            (_qpt, q_idx) => 1 + (7 * ((band_idx + q_idx) % 24)) / 23,
          ),
        ),
        Array.from({ length: 300 }, (_, q_idx) => (q_idx < 15 ? -1.5 : 0)),
      ]),
      {},
      [-1.5 - 9.5 * 0.02, 8 + 9.5 * 0.02],
    ],
    // DOS grids run below 0 at zero density (-0.59 THz in mp-2691 PBE); only band
    // frequencies can signal an imaginary mode
    [
      `a DOS grid reaching below the imaginary cutoff`,
      bands_of([[0, 5, 10]]),
      dos_of(Array.from({ length: 157 }, (_, idx) => -0.6 + idx / 10)),
      [0, 15 + 15 * 0.02],
    ],
    [
      `electronic bands retain small negative values`,
      bands_of([[-0.01, 5, 10]], `electronic`),
      {},
      [-0.2102, 10.2002],
    ],
    [
      `electronic DOS extends the bands range`,
      bands_of([[-0.01, 5, 10]], `electronic`),
      { sample: { type: `electronic` as const, energies: [-5, 0, 5], densities: [0, 1, 0] } },
      [-5.3, 10.3],
    ],
    [
      `spin-down extrema in the shared electronic range`,
      {
        sample: {
          ...bands_of([[0, 1]], `electronic`).sample,
          spin_down_bands: [[-5, 10]],
        },
      },
      {},
      [-5.3, 10.3],
    ],
  ])(`%s`, (_label, bands, doses, expected) => {
    const range = compute_frequency_range(bands, doses)
    expect(range?.[0]).toBeCloseTo(expected[0], 9)
    expect(range?.[1]).toBeCloseTo(expected[1], 9)
  })

  const electronic_dos = {
    electronic: { type: `electronic` as const, energies: [0, 10], densities: [0, 1] },
  }
  it.each([
    [
      `bands`,
      { ...bands_of([[0, 10]]), electronic: bands_of([[0, 10]], `electronic`).sample },
      {},
    ],
    [`dos`, {}, { ...dos_of([0, 10]), ...electronic_dos }],
    [`both`, bands_of([[0, 10]]), electronic_dos],
  ])(`rejects mixed spectral types in %s`, (_scope, bands, doses) => {
    expect(() => compute_frequency_range(bands, doses)).toThrow(
      /Cannot mix phonon and electronic spectra/,
    )
  })

  it(`returns undefined for empty collections and honours padding`, () => {
    expect(compute_frequency_range({}, {})).toBeUndefined()
    expect(compute_frequency_range({}, dos_of([0, 10]), 0.1)).toEqual([0, 11])
  })

  it.each([
    [`efermi`, { efermi: 5 }, true],
    [`kpoints`, { kpoints: [{ frac_coords: [0, 0, 0] }] }, true],
    [`electronic @class`, { '@class': `BandStructureSymmLine`, ...identity_rec }, true],
    [
      `electronic @module`,
      { '@module': `pymatgen.electronic_structure.bandstructure`, ...identity_rec },
      true,
    ],
    [`phonon @class`, { '@class': `PhononBandStructureSymmLine`, ...identity_rec }, false],
  ])(`adapter retains type and range from %s`, (_label, marker, is_electronic) => {
    const { type: _type, ...raw } = bands_of([[-0.01, 5, 10]]).sample
    const input = { ...raw, ...marker }
    expect(is_electronic_band_struct(input)).toBe(is_electronic)
    const normalized = normalize_band_structure(input)
    if (!normalized) throw new Error(`Expected canonical bands`)
    expect(normalized.type).toBe(is_electronic ? `electronic` : `phonon`)
    const range = compute_frequency_range({ sample: normalized }, {})
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
      const band_structure = make_bs([], {
        qpoints: qpoints.map(([label, frac_coords]) => ({ label, frac_coords })),
      })
      expect(find_gamma_indices(band_structure)).toEqual(expected)
    },
  )

  it.each([
    [[0, 5, 10], 0, [0], true],
    [[-0.3, 5, 10], 0, [0], true],
    [[ACOUSTIC_FREQ_THRESHOLD, 5, 10], 0, [0], false],
    [[5, 5, 10], 0, [], null], // no Gamma point: undecidable
    [[5, 10, 0.1], 0, [0, 2], true], // acoustic if any Gamma point is near zero
    [[0, 5, 10], 99, [0], false], // missing band
  ])(
    `classify_acoustic(%j, band %i, Gamma %j) → %s`,
    (band, band_idx, gamma_indices, expected) => {
      const band_structure = make_bs([null, null, null], { bands: [band] })
      expect(classify_acoustic(band_structure, band_idx, gamma_indices)).toBe(expected)
    },
  )
})

describe(`build_point_metadata`, () => {
  const band_structure = make_bs([`GAMMA`, null, `X`], {
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
      bs: band_structure,
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
